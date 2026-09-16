// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./interfaces/ISivanAgreementVault.sol";

/**
 * @title SivanAgreementVault
 * @author Samson Micheal (Sivan Technology)
 * @notice Autonomous Non-Custodial x402 Service Agreement Settlement Facility on Celo.
 * @dev Fully non-custodial milestone vault supporting dynamic fees, developer partner splits,
 *      and dual cryptographic attestation (Buyer + Sivan AI Registered Agent #9827).
 */
contract SivanAgreementVault is ISivanAgreementVault, ReentrancyGuard, Pausable, Ownable, EIP712 {
    using SafeERC20 for IERC20;

    // ─── Constants & Fee Policy ──────────────────────────────────────────────

    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public constant MAX_FEE_BPS = 300; // Hard safety cap: Protocol fee cannot exceed 3%
    uint256 public constant MAX_PARTNER_SHARE_BPS = 5000; // Developer partner share capped at 50% of fee

    bytes32 public constant RELEASE_TYPEHASH = keccak256(
        "ReleaseAuthorization(bytes32 agreementId,address contractor,uint256 netAmount,uint256 nonce,uint256 expiry)"
    );

    bytes32 public constant AGENT_ATTESTATION_TYPEHASH = keccak256(
        "AgentAttestation(bytes32 agreementId,uint256 agentId,bytes32 deliverableHash,uint256 timestamp)"
    );

    bytes32 public constant CONTRACTOR_CONSENT_TYPEHASH = keccak256(
        "ContractorRefundConsent(bytes32 agreementId,uint256 nonce)"
    );

    // ─── State Variables ─────────────────────────────────────────────────────

    address public feeCollector;
    address public agentAttester;
    uint256 public registeredAgentId; // ERC-8004 Agent ID (9827 on Celo Mainnet)

    uint256 public defaultFeeBps; // Base fee basis points (e.g. 100 = 1%)
    uint256 public partnerRevenueShareBps; // Developer affiliate revenue share (e.g. 3000 = 30% of protocol fee)
    bool public dynamicTieredFeesEnabled;

    mapping(bytes32 => Agreement) public agreements;
    mapping(bytes32 => uint256) public agreementNonces;
    mapping(address => bool) public supportedTokens;
    /** True once the owner lists a first token. See setSupportedToken. */
    bool public tokenAllowlistEnforced;

    // ─── Events ──────────────────────────────────────────────────────────────

    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event AgentAttesterUpdated(address indexed oldAttester, address indexed newAttester);
    event FeePolicyUpdated(uint256 defaultFeeBps, uint256 partnerShareBps, bool dynamicEnabled);
    event TokenSupportUpdated(address indexed token, bool supported);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _feeCollector,
        address _agentAttester,
        uint256 _registeredAgentId,
        address initialOwner
    )
        Ownable(initialOwner)
        EIP712("Sivan Celo Settlement Facility", "1")
    {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_agentAttester != address(0), "Invalid agent attester");

        feeCollector = _feeCollector;
        agentAttester = _agentAttester;
        registeredAgentId = _registeredAgentId;

        defaultFeeBps = 100; // 1.0% default
        partnerRevenueShareBps = 3000; // 30% of fee routed to integrating developer
        dynamicTieredFeesEnabled = true;
    }

    // ─── External Management ─────────────────────────────────────────────────

    function setFeeCollector(address _newCollector) external onlyOwner {
        require(_newCollector != address(0), "Invalid address");
        emit FeeCollectorUpdated(feeCollector, _newCollector);
        feeCollector = _newCollector;
    }

    function setAgentAttester(address _newAttester, uint256 _newAgentId) external onlyOwner {
        require(_newAttester != address(0), "Invalid address");
        emit AgentAttesterUpdated(agentAttester, _newAttester);
        agentAttester = _newAttester;
        registeredAgentId = _newAgentId;
    }

    function setFeePolicy(
        uint256 _defaultFeeBps,
        uint256 _partnerShareBps,
        bool _dynamicEnabled
    ) external onlyOwner {
        require(_defaultFeeBps <= MAX_FEE_BPS, "Fee exceeds safety cap");
        require(_partnerShareBps <= MAX_PARTNER_SHARE_BPS, "Partner share exceeds cap");
        defaultFeeBps = _defaultFeeBps;
        partnerRevenueShareBps = _partnerShareBps;
        dynamicTieredFeesEnabled = _dynamicEnabled;
        emit FeePolicyUpdated(_defaultFeeBps, _partnerShareBps, _dynamicEnabled);
    }

    function setSupportedToken(address token, bool supported) external onlyOwner {
        require(token != address(0), "Invalid token");
        supportedTokens[token] = supported;
        // The first time the owner lists ANY token, the vault starts refusing
        // everything not on the list. Before that it stays permissive so a new
        // deployment is usable.
        if (supported && !tokenAllowlistEnforced) {
            tokenAllowlistEnforced = true;
        }
        emit TokenSupportUpdated(token, supported);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Fee Calculation ─────────────────────────────────────────────────────

    /**
     * @notice Computes dynamic platform fee based on volume tier or base fee rate.
     */
    /**
     * @notice Fee in bps for an amount denominated in a token with `decimals`.
     * @dev THE TIERS WERE HARDCODED TO 6 DECIMALS.
     *
     * `50 * 1e6` is correct for USDC. cUSD on Celo is 18 decimals, and the
     * README lists cUSD as supported. With an 18dp token every realistic
     * amount is astronomically larger than 500 * 1e6, so EVERY cUSD agreement
     * silently landed in the cheapest 0.50% tier: a 10 cUSD micro payment was
     * charged the whale rate. Tiers are now scaled to the token's own unit.
     */
    function calculateFeeForToken(uint256 amount, uint8 decimals) public view returns (uint256 feeBps) {
        if (!dynamicTieredFeesEnabled) {
            return defaultFeeBps;
        }

        uint256 unit = 10 ** uint256(decimals);

        // Tier 1: <= 50 units   -> 1.00% (100 bps)
        // Tier 2: <= 500 units  -> 0.75% (75 bps)
        // Tier 3: > 500 units   -> 0.50% (50 bps)
        if (amount <= 50 * unit) {
            return 100;
        } else if (amount <= 500 * unit) {
            return 75;
        } else {
            return 50;
        }
    }

    /** @notice Backwards-compatible 6-decimal helper. Prefer calculateFeeForToken. */
    function calculateFee(uint256 amount) public view returns (uint256 feeBps) {
        return calculateFeeForToken(amount, 6);
    }

    // ─── Core Lifecycle: Deposit ─────────────────────────────────────────────

    /**
     * @notice Deposit and lock milestone funds non-custodially into the vault.
     * @param agreementId Unique identifier for the service agreement.
     * @param contractor Destination address of the contractor.
     * @param token ERC-20 token address (e.g. Celo USDC or cUSD).
     * @param amount Total amount to lock.
     * @param deadlineHours Duration of the delivery window in hours.
     * @param partnerAddress Optional third-party developer or referral affiliate address.
     */
    function deposit(
        bytes32 agreementId,
        address contractor,
        address token,
        uint256 amount,
        uint256 deadlineHours,
        address partnerAddress
    ) external override nonReentrant whenNotPaused {
        require(agreementId != bytes32(0), "Invalid agreement id");
        require(contractor != address(0), "Invalid contractor address");
        require(contractor != msg.sender, "Contractor cannot be buyer");
        require(token != address(0), "Invalid token");
        /**
         * THE WHITELIST WAS WRITTEN BUT NEVER READ.
         *
         * setSupportedToken() populated `supportedTokens` and nothing ever
         * consulted it, so an owner who believed they had restricted the vault
         * to USDC and cUSD had not: any ERC-20 could be locked here, including
         * a worthless or malicious one.
         *
         * Gated on `tokenAllowlistEnforced` rather than enforced outright,
         * because a freshly deployed vault has an empty map and would refuse
         * every deposit. The owner opts in once the first token is listed.
         */
        if (tokenAllowlistEnforced) {
            require(supportedTokens[token], "Token not supported");
        }
        require(amount > 0, "Amount must be positive");
        require(deadlineHours > 0 && deadlineHours <= 720, "Deadline between 1h and 30d");

        Agreement storage agr = agreements[agreementId];
        require(agr.state == AgreementState.Uninitialized, "Agreement already exists");

        // Price against the TOKEN's decimals, not an assumed 6.
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint256 feeBps = calculateFeeForToken(amount, tokenDecimals);
        uint256 feeAmount = (amount * feeBps) / BPS_DIVISOR;
        uint256 netAmount = amount - feeAmount;

        uint256 partnerFeeAmount = 0;
        if (partnerAddress != address(0) && partnerAddress != msg.sender && partnerAddress != contractor) {
            partnerFeeAmount = (feeAmount * partnerRevenueShareBps) / BPS_DIVISOR;
        }

        uint256 deadlineTimestamp = block.timestamp + (deadlineHours * 1 hours);

        agreements[agreementId] = Agreement({
            agreementId: agreementId,
            buyer: msg.sender,
            contractor: contractor,
            token: token,
            totalAmount: amount,
            feeAmount: feeAmount,
            netAmount: netAmount,
            deadlineTimestamp: deadlineTimestamp,
            state: AgreementState.Funded,
            partnerAddress: partnerAddress,
            partnerFeeAmount: partnerFeeAmount,
            deliverableProof: ""
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit AgreementFunded(
            agreementId,
            msg.sender,
            contractor,
            token,
            amount,
            feeAmount,
            deadlineTimestamp,
            partnerAddress
        );
    }

    // ─── Core Lifecycle: Deliver ─────────────────────────────────────────────

    /**
     * @notice Signals that milestone deliverables have been submitted.
     */
    function markDelivered(
        bytes32 agreementId,
        string calldata proofUrl
    ) external override {
        Agreement storage agr = agreements[agreementId];
        require(agr.state == AgreementState.Funded, "Agreement not in funded state");
        require(msg.sender == agr.contractor || msg.sender == agr.buyer, "Unauthorized deliverer");
        require(bytes(proofUrl).length > 0, "Proof URL required");

        agr.state = AgreementState.Delivered;
        agr.deliverableProof = proofUrl;

        emit DeliverableSubmitted(agreementId, agr.contractor, proofUrl);
    }

    // ─── Core Lifecycle: Release Payment ─────────────────────────────────────

    /**
     * @notice Releases payment to the contractor upon dual cryptographic attestation.
     * @dev Dual attestation requires:
     *      1. Buyer authorization (either msg.sender == buyer, or valid EIP-712 buyer signature).
     *      2. Sivan AI Registered Agent Attestation (#9827).
     */
    function releasePayment(
        bytes32 agreementId,
        bytes calldata buyerSignature,
        bytes calldata agentAttestation
    ) external override nonReentrant whenNotPaused {
        Agreement storage agr = agreements[agreementId];
        require(
            agr.state == AgreementState.Funded || agr.state == AgreementState.Delivered,
            "Cannot release in current state"
        );

        // 1. Verify Buyer Authorization
        if (msg.sender != agr.buyer) {
            require(buyerSignature.length == 65, "Invalid buyer signature length");
            uint256 nonce = agreementNonces[agreementId]++;
            bytes32 buyerStructHash = keccak256(
                abi.encode(
                    RELEASE_TYPEHASH,
                    agreementId,
                    agr.contractor,
                    agr.netAmount,
                    nonce,
                    block.timestamp + 1 hours
                )
            );
            bytes32 buyerDigest = _hashTypedDataV4(buyerStructHash);
            address recoveredBuyer = ECDSA.recover(buyerDigest, buyerSignature);
            require(recoveredBuyer == agr.buyer, "Invalid buyer release authorization");
        }

        // 2. Verify Sivan AI Agent Attestation (ERC-8004 Agent #9827)
        if (agentAttester != address(0)) {
            require(agentAttestation.length == 65, "Invalid agent attestation length");
            bytes32 deliverableHash = keccak256(bytes(agr.deliverableProof));
            bytes32 agentStructHash = keccak256(
                abi.encode(
                    AGENT_ATTESTATION_TYPEHASH,
                    agreementId,
                    registeredAgentId,
                    deliverableHash,
                    agr.deadlineTimestamp
                )
            );
            bytes32 agentDigest = _hashTypedDataV4(agentStructHash);
            address recoveredAgent = ECDSA.recover(agentDigest, agentAttestation);
            require(recoveredAgent == agentAttester, "Invalid Sivan AI agent attestation");
        }

        agr.state = AgreementState.Released;

        uint256 protocolFee = agr.feeAmount - agr.partnerFeeAmount;

        // Disburse Net Payout to Contractor
        IERC20(agr.token).safeTransfer(agr.contractor, agr.netAmount);

        // Disburse Sivan Protocol Fee
        if (protocolFee > 0 && feeCollector != address(0)) {
            IERC20(agr.token).safeTransfer(feeCollector, protocolFee);
        }

        // Disburse Developer Partner Affiliate Share
        if (agr.partnerFeeAmount > 0 && agr.partnerAddress != address(0)) {
            IERC20(agr.token).safeTransfer(agr.partnerAddress, agr.partnerFeeAmount);
        }

        emit AgreementReleased(
            agreementId,
            agr.buyer,
            agr.contractor,
            agr.netAmount,
            protocolFee,
            agr.partnerFeeAmount
        );
    }

    // ─── Safety Lifecycle: Timeout Auto-Refund ───────────────────────────────

    /**
     * @notice Allows the buyer to autonomously reclaim 100% of deposited funds if deadline expires.
     * @dev Zero agent or admin intervention required. True non-custodial guarantee.
     */
    function refundBuyer(bytes32 agreementId) external override nonReentrant {
        Agreement storage agr = agreements[agreementId];
        require(agr.state == AgreementState.Funded, "Cannot refund in current state");
        require(msg.sender == agr.buyer, "Only buyer can trigger timeout refund");
        require(block.timestamp > agr.deadlineTimestamp, "Deadline has not yet expired");

        agr.state = AgreementState.Refunded;
        uint256 refundAmount = agr.totalAmount;

        IERC20(agr.token).safeTransfer(agr.buyer, refundAmount);

        emit AgreementRefunded(agreementId, agr.buyer, refundAmount, "Deadline expired without delivery");
    }

    // ─── Safety Lifecycle: Mutual Refund ─────────────────────────────────────

    /**
     * @notice Allows mutual refund back to buyer if contractor explicitly consents.
     */
    function mutualRefund(
        bytes32 agreementId,
        bytes calldata contractorConsentSignature
    ) external override nonReentrant {
        Agreement storage agr = agreements[agreementId];
        require(
            agr.state == AgreementState.Funded || agr.state == AgreementState.Delivered || agr.state == AgreementState.Disputed,
            "Cannot refund in current state"
        );

        if (msg.sender != agr.contractor) {
            require(contractorConsentSignature.length == 65, "Invalid signature length");
            uint256 nonce = agreementNonces[agreementId]++;
            bytes32 consentStructHash = keccak256(
                abi.encode(CONTRACTOR_CONSENT_TYPEHASH, agreementId, nonce)
            );
            bytes32 consentDigest = _hashTypedDataV4(consentStructHash);
            address recoveredContractor = ECDSA.recover(consentDigest, contractorConsentSignature);
            require(recoveredContractor == agr.contractor, "Contractor consent required for mutual refund");
        }

        agr.state = AgreementState.Refunded;
        uint256 refundAmount = agr.totalAmount;

        IERC20(agr.token).safeTransfer(agr.buyer, refundAmount);

        emit AgreementRefunded(agreementId, agr.buyer, refundAmount, "Mutual refund agreed by parties");
    }

    // ─── View Helpers ────────────────────────────────────────────────────────

    function getAgreement(bytes32 agreementId) external view override returns (Agreement memory) {
        return agreements[agreementId];
    }
}
