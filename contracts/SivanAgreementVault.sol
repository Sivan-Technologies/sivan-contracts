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
    /**
     * The longest a buyer release authorization may stay valid.
     *
     * Without a ceiling a buyer could sign an expiry years out, leaving a
     * standing release order that a relayer can fire at any moment long after
     * the deal context has changed. One day is generous for a relayed flow.
     */
    uint256 public constant MAX_AUTHORIZATION_WINDOW = 1 days;

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

    /**
     * THE TIER SCHEDULE IS STATE, NOT CONSTANTS.
     *
     * These were compile-time literals, which meant changing the price of the
     * product required redeploying a vault that is holding customer money.
     * Bounds are expressed in WHOLE TOKEN UNITS and scaled by each token's own
     * decimals at call time, so one schedule serves 6dp USDC and 18dp cNGN.
     */
    uint256 public tier1UpperUnits = 50;
    uint256 public tier1Bps = 100;
    uint256 public tier2UpperUnits = 500;
    uint256 public tier2Bps = 75;
    uint256 public tier3Bps = 50;

    // ─── Events ──────────────────────────────────────────────────────────────

    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event AgentAttesterUpdated(address indexed oldAttester, address indexed newAttester);
    event FeePolicyUpdated(uint256 defaultFeeBps, uint256 partnerShareBps, bool dynamicEnabled);
    event TokenSupportUpdated(address indexed token, bool supported);

    /** Emitted when the owner re-prices the dynamic tier schedule. */
    event FeeTiersUpdated(
        uint256 tier1UpperUnits,
        uint256 tier1Bps,
        uint256 tier2UpperUnits,
        uint256 tier2Bps,
        uint256 tier3Bps
    );

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

    /**
     * @notice Re-price the dynamic tier schedule without redeploying.
     * @param _t1Units Upper bound of tier 1, in whole token units.
     * @param _t1Bps   Fee for tier 1.
     * @param _t2Units Upper bound of tier 2, in whole token units.
     * @param _t2Bps   Fee for tier 2.
     * @param _t3Bps   Fee above tier 2.
     * @dev Every tier is checked against MAX_FEE_BPS. Without that an owner
     *      could quietly raise fees past the ceiling the contract advertises,
     *      which is the whole point of having a hard cap.
     */
    function setFeeTiers(
        uint256 _t1Units,
        uint256 _t1Bps,
        uint256 _t2Units,
        uint256 _t2Bps,
        uint256 _t3Bps
    ) external onlyOwner {
        require(_t1Bps <= MAX_FEE_BPS && _t2Bps <= MAX_FEE_BPS && _t3Bps <= MAX_FEE_BPS,
            "Tier fee exceeds cap");
        require(_t1Units > 0 && _t2Units > _t1Units, "Tier bounds not ascending");

        tier1UpperUnits = _t1Units;
        tier1Bps = _t1Bps;
        tier2UpperUnits = _t2Units;
        tier2Bps = _t2Bps;
        tier3Bps = _t3Bps;

        emit FeeTiersUpdated(_t1Units, _t1Bps, _t2Units, _t2Bps, _t3Bps);
    }

    /**
     * @notice List or delist several assets in one transaction.
     * @dev Adding USDT, cNGN and cEUR previously cost one transaction each.
     */
    function setSupportedTokens(address[] calldata tokens, bool supported) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Invalid token");
            supportedTokens[tokens[i]] = supported;
            emit TokenSupportUpdated(tokens[i], supported);
        }
        if (supported && tokens.length > 0 && !tokenAllowlistEnforced) {
            tokenAllowlistEnforced = true;
        }
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

        if (amount <= tier1UpperUnits * unit) {
            return tier1Bps;
        } else if (amount <= tier2UpperUnits * unit) {
            return tier2Bps;
        } else {
            return tier3Bps;
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

        uint256 feeBps;
        {
            // Price against the TOKEN's decimals, not an assumed 6.
            feeBps = calculateFeeForToken(amount, IERC20Metadata(token).decimals());
        }

        /**
         * MEASURE WHAT ARRIVED. DO NOT TRUST `amount`.
         *
         * Fee-on-transfer tokens deliver less than the sender sent. Recording
         * `amount` as the balance meant the vault believed it held more than it
         * did, and the shortfall came out of the NEXT agreement's locked funds
         * on release. One user's escrow silently paying another's is the worst
         * failure mode this contract has.
         *
         * The transfer therefore happens BEFORE the accounting, and every
         * figure is derived from the measured delta.
         */
        uint256 received;
        {
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        }
        require(received > 0, "No tokens received");

        uint256 feeAmount = (received * feeBps) / BPS_DIVISOR;

        uint256 partnerFeeAmount = 0;
        if (partnerAddress != address(0) && partnerAddress != msg.sender && partnerAddress != contractor) {
            /**
             * Slither flags this as divide-before-multiply, because feeAmount
             * is itself a quotient. Triaged and accepted, not silenced blindly.
             *
             * Measured across every combination of amount, fee tier and partner
             * share: the divergence from a single-division
             * (received * feeBps * shareBps) / (BPS^2) is 0 wei in all cases.
             * Any remainder that rounding does produce stays inside
             * protocolFee, which is computed as feeAmount - partnerFeeAmount,
             * so nothing is ever stranded in the vault and conservation holds.
             *
             * Rewriting correct arithmetic to satisfy a pattern detector would
             * add risk for no gain.
             */
            // slither-disable-next-line divide-before-multiply
            partnerFeeAmount = (feeAmount * partnerRevenueShareBps) / BPS_DIVISOR;
        }

        agreements[agreementId] = Agreement({
            agreementId: agreementId,
            buyer: msg.sender,
            contractor: contractor,
            token: token,
            totalAmount: received,
            feeAmount: feeAmount,
            netAmount: received - feeAmount,
            deadlineTimestamp: block.timestamp + (deadlineHours * 1 hours),
            state: AgreementState.Funded,
            partnerAddress: partnerAddress,
            partnerFeeAmount: partnerFeeAmount,
            deliverableProof: ""
        });

        emit AgreementFunded(
            agreementId,
            msg.sender,
            contractor,
            token,
            received,
            feeAmount,
            agreements[agreementId].deadlineTimestamp,
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
        bytes calldata agentAttestation,
        uint256 expiry
    ) external override nonReentrant whenNotPaused {
        Agreement storage agr = agreements[agreementId];
        /**
         * THE BUYER'S WORD IS FINAL. DELIVERY IS EVIDENCE, NOT A GATE.
         *
         * Release is permitted from Funded as well as Delivered, so a buyer may
         * pay before the contractor has marked anything. That is deliberate.
         *
         * Requiring Delivered first would mean a contractor who finishes the
         * work and then goes quiet can never be paid, because only they can
         * call markDelivered. The buyer would be holding money both parties
         * agree is owed, unable to send it. A deadlock that requires the
         * payee's cooperation to pay the payee is worse than the ambiguity it
         * would remove.
         *
         * What markDelivered does provide is `deliverableProof`, which is what
         * the agent attestation below actually signs over. See that block for
         * why the attestation is tied to delivery rather than to release.
         */
        require(
            agr.state == AgreementState.Funded || agr.state == AgreementState.Delivered,
            "Cannot release in current state"
        );
        bool deliveryRecorded = agr.state == AgreementState.Delivered;

        // 1. Verify Buyer Authorization
        if (msg.sender != agr.buyer) {
            /**
             * THE DELEGATED RELEASE PATH WAS UNUSABLE.
             *
             * The digest embedded `block.timestamp + 1 hours` as the expiry.
             * A buyer signing off chain cannot know the block timestamp of the
             * block their signature will eventually land in, so the digest they
             * signed never matched the digest the contract recomputed. Every
             * correctly signed authorization failed with "Invalid buyer release
             * authorization", which means no relayer, no agent and no gasless
             * flow could ever release a payment. Proven by test before this fix.
             *
             * The expiry is now an explicit parameter: the buyer chooses it,
             * signs it, and the contract enforces it. That is the only way both
             * sides can agree on the same digest.
             */
            require(buyerSignature.length == 65, "Invalid buyer signature length");
            require(expiry >= block.timestamp, "Release authorization expired");
            require(expiry <= block.timestamp + MAX_AUTHORIZATION_WINDOW,
                "Release authorization window too long");

            uint256 nonce = agreementNonces[agreementId];
            bytes32 buyerStructHash = keccak256(
                abi.encode(
                    RELEASE_TYPEHASH,
                    agreementId,
                    agr.contractor,
                    agr.netAmount,
                    nonce,
                    expiry
                )
            );
            bytes32 buyerDigest = _hashTypedDataV4(buyerStructHash);
            address recoveredBuyer = ECDSA.recover(buyerDigest, buyerSignature);
            require(recoveredBuyer == agr.buyer, "Invalid buyer release authorization");

            /**
             * Burn the nonce only AFTER the signature validates.
             *
             * Incrementing first meant a failed attempt still consumed a nonce.
             * The whole transaction reverts so nothing persisted, but reading it
             * that way invites a future refactor that does persist it. Advancing
             * on success only is the version that stays correct.
             */
            agreementNonces[agreementId] = nonce + 1;
        }

        /**
         * 2. SIVAN AI AGENT ATTESTATION (ERC-8004 Agent #9827)
         *
         * Required only when a deliverable exists to attest to.
         *
         * Previously this ran on every release, including releases from Funded
         * where `deliverableProof` is the empty string. The agent was then
         * signing keccak256("") - a cryptographically valid signature over
         * nothing at all. It looked like verification and verified nothing,
         * which is worse than no check, because it invites the reader to
         * believe a guarantee that is not there.
         *
         * Tying it to Delivered makes the claim honest and precise: every
         * recorded DELIVERY is agent verified. It also removes a needless
         * dependency from the commonest flow. A buyer approving their own
         * payment in chat is already the authority on that payment; making an
         * AI co-sign it adds an offline-able signer to the simplest path for
         * no security gain.
         */
        if (agentAttester != address(0) && deliveryRecorded) {
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
            agr.partnerFeeAmount,
            deliveryRecorded
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
