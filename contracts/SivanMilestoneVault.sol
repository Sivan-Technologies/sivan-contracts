// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Separate, immutable escrow for atomically funded milestone projects.
/// @dev Not wired into production deployment tooling. No AI or administrator may
/// authorize a payout except the reviewers explicitly accepted by both parties.
/// Only reviewed, exact-transfer, non-rebasing ERC20 tokens are supported.
contract SivanMilestoneVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant MAX_FEE_BPS = 300;
    uint256 public constant DISPUTE_GRACE = 2 days;
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "MilestoneSettlement(bytes32 projectId,uint256 index,bytes32 termsHash,uint256 buyerRefund,uint256 nonce,uint256 expiry)"
    );

    enum State { Unfunded, Funded, Delivered, Disputed, Released, Refunded }
    struct Input {
        uint256 amount;
        uint256 duration;
        bytes32 scopeHash;
    }
    struct Project {
        address buyer;
        address contractor;
        address token;
        address independentReviewer;
        uint256 total;
        uint256 reservedFee;
        uint256 remaining;
        uint256 acceptanceExpiry;
        uint256 reviewWindow;
        uint256 arbitrationWindow;
        uint256 fundedAt;
        uint256 count;
        bool sequential;
        bool accepted;
        bytes32 termsHash;
    }
    struct Milestone {
        uint256 amount;
        uint256 reservedFee;
        uint256 duration;
        uint256 deliveredAt;
        uint256 reviewDeadline;
        uint256 nonce;
        bool escalated;
        State state;
        bytes32 scopeHash;
        bytes32 proofHash;
    }

    address public immutable feeCollector;
    address public immutable primaryReviewer;
    uint256 public immutable feeBps;
    mapping(address => bool) public supportedToken;
    mapping(address => uint256) public tokenLiability;
    mapping(bytes32 => Project) public projects;
    mapping(bytes32 => mapping(uint256 => Milestone)) public milestones;

    event ProjectProposed(bytes32 indexed projectId, address indexed buyer, address indexed contractor, bytes32 termsHash);
    event ProjectAccepted(bytes32 indexed projectId, bytes32 termsHash);
    event ProjectFunded(bytes32 indexed projectId, uint256 amount, uint256 reservedFee);
    event MilestoneDelivered(bytes32 indexed projectId, uint256 indexed index, bytes32 proofHash);
    event MilestoneDisputed(bytes32 indexed projectId, uint256 indexed index, uint256 primaryDeadline);
    event MilestoneEscalated(bytes32 indexed projectId, uint256 indexed index, address reviewer);
    event MilestoneSettled(bytes32 indexed projectId, uint256 indexed index, uint256 buyerRefund, uint256 contractorNet, uint256 fee);

    constructor(address collector, address reviewer, uint256 rateBps, address[] memory tokens)
        EIP712("SivanMilestoneVault", "1")
    {
        require(collector != address(0) && collector != address(this), "Invalid collector");
        require(reviewer != address(0) && reviewer != address(this), "Invalid reviewer");
        require(rateBps <= MAX_FEE_BPS, "Fee exceeds cap");
        require(tokens.length > 0 && tokens.length <= 20, "Invalid token count");
        feeCollector = collector;
        primaryReviewer = reviewer;
        feeBps = rateBps;
        for (uint256 i; i < tokens.length; ++i) {
            require(tokens[i].code.length > 0 && !supportedToken[tokens[i]], "Invalid token");
            supportedToken[tokens[i]] = true;
        }
    }

    function deriveProjectId(address buyer, bytes12 nonce) external pure returns (bytes32) {
        require(buyer != address(0), "Invalid buyer");
        return bytes32(abi.encodePacked(buyer, nonce));
    }

    function getProject(bytes32 id) external view returns (Project memory) { return projects[id]; }
    function getMilestone(bytes32 id, uint256 index) external view returns (Milestone memory) { return milestones[id][index]; }

    /// @dev Scope hashes commit to the off-chain deliverables and acceptance criteria.
    /// Terms cannot be edited; a changed proposal requires a fresh buyer-owned ID.
    function proposeProject(
        bytes32 id, address contractor, address token, address independentReviewer,
        Input[] calldata inputs, bool sequential, uint256 reviewWindow,
        uint256 arbitrationWindow, uint256 acceptanceExpiry
    ) external {
        require(address(bytes20(id)) == msg.sender, "Project ID must belong to buyer");
        require(projects[id].buyer == address(0), "Project already exists");
        require(contractor != address(0) && contractor != msg.sender && contractor != address(this), "Invalid contractor");
        require(msg.sender != feeCollector && contractor != feeCollector, "Treasury party conflict");
        require(msg.sender != primaryReviewer && contractor != primaryReviewer, "Primary reviewer conflict");
        require(independentReviewer != address(0) && independentReviewer != address(this)
            && independentReviewer != msg.sender && independentReviewer != contractor
            && independentReviewer != primaryReviewer && independentReviewer != feeCollector, "Independent reviewer conflict");
        require(supportedToken[token], "Unsupported token");
        require(inputs.length > 0 && inputs.length <= MAX_MILESTONES, "Invalid milestone count");
        require(reviewWindow >= 1 days && reviewWindow <= 30 days, "Invalid delivery review window");
        require(arbitrationWindow == 1 days || arbitrationWindow == 3 days || arbitrationWindow == 7 days, "Invalid arbitration window");
        require(acceptanceExpiry > block.timestamp && acceptanceExpiry <= block.timestamp + 30 days, "Invalid acceptance expiry");
        uint256 total = 0;
        for (uint256 i; i < inputs.length; ++i) {
            require(inputs[i].amount > 0 && inputs[i].scopeHash != bytes32(0), "Invalid milestone");
            require(inputs[i].duration >= 1 hours && inputs[i].duration <= 365 days, "Invalid duration");
            if (sequential && i > 0) require(inputs[i].duration >= inputs[i-1].duration, "Unordered deadlines");
            total += inputs[i].amount;
        }
        uint256 fee = Math.mulDiv(total, feeBps, 10000);
        Project storage p = projects[id];
        p.buyer = msg.sender;
        p.contractor = contractor;
        p.token = token;
        p.independentReviewer = independentReviewer;
        p.total = total;
        p.reservedFee = fee;
        p.acceptanceExpiry = acceptanceExpiry;
        p.reviewWindow = reviewWindow;
        p.arbitrationWindow = arbitrationWindow;
        p.count = inputs.length;
        p.sequential = sequential;
        p.termsHash = keccak256(abi.encode(block.chainid, address(this), id, msg.sender, contractor,
            token, independentReviewer, primaryReviewer, feeCollector, feeBps, inputs, sequential,
            reviewWindow, arbitrationWindow, acceptanceExpiry));
        uint256 cumulative = 0;
        uint256 allocated = 0;
        for (uint256 i; i < inputs.length; ++i) {
            cumulative += inputs[i].amount;
            uint256 cumulativeFee = Math.mulDiv(fee, cumulative, total);
            Milestone storage m = milestones[id][i];
            m.amount = inputs[i].amount;
            m.duration = inputs[i].duration;
            m.scopeHash = inputs[i].scopeHash;
            m.reservedFee = cumulativeFee - allocated;
            allocated = cumulativeFee;
        }
        emit ProjectProposed(id, msg.sender, contractor, p.termsHash);
    }

    function acceptProject(bytes32 id, bytes32 expectedTermsHash) external {
        Project storage p = projects[id];
        require(msg.sender == p.contractor, "Only contractor");
        require(block.timestamp <= p.acceptanceExpiry && p.fundedAt == 0, "Acceptance closed");
        require(expectedTermsHash == p.termsHash, "Terms mismatch");
        p.accepted = true;
        emit ProjectAccepted(id, expectedTermsHash);
    }

    /// @notice One transfer funds all milestones or the entire transaction reverts.
    function fundProject(bytes32 id, bytes32 expectedTermsHash) external nonReentrant {
        Project storage p = projects[id];
        require(msg.sender == p.buyer, "Only buyer");
        require(p.accepted && block.timestamp <= p.acceptanceExpiry, "Terms not accepted or expired");
        require(p.termsHash == expectedTermsHash, "Terms mismatch");
        require(p.fundedAt == 0, "Already funded");
        p.fundedAt = block.timestamp;
        p.remaining = p.total;
        tokenLiability[p.token] += p.total;
        for (uint256 i; i < p.count; ++i) milestones[id][i].state = State.Funded;
        uint256 beforeBalance = IERC20(p.token).balanceOf(address(this));
        IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.total);
        // Intentional transfer-delta equality, not equality against total liabilities.
        // Prior donations are included in beforeBalance and cannot block funding.
        // Reject taxed/rebasing transfers rather than underfund accepted allocations.
        // slither-disable-next-line incorrect-equality
        require(IERC20(p.token).balanceOf(address(this)) == beforeBalance + p.total, "Exact transfer required");
        emit ProjectFunded(id, p.total, p.reservedFee);
    }

    function markDelivered(bytes32 id, uint256 index, bytes32 proofHash) external {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(msg.sender == p.contractor, "Only contractor");
        require(m.state == State.Funded && block.timestamp <= p.fundedAt + m.duration, "Delivery closed");
        require(proofHash != bytes32(0), "Proof required");
        m.state = State.Delivered;
        m.deliveredAt = block.timestamp;
        m.proofHash = proofHash;
        emit MilestoneDelivered(id, index, proofHash);
    }

    /// @notice Explicit buyer acceptance, not an automatic payout on delivery.
    function releaseMilestone(bytes32 id, uint256 index) external nonReentrant {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(msg.sender == p.buyer, "Only buyer");
        require(m.state == State.Delivered, "Delivery required");
        if (p.sequential) {
            for (uint256 i; i < index; ++i) {
                State prior = milestones[id][i].state;
                require(prior == State.Released || prior == State.Refunded, "Earlier milestone unsettled");
            }
        }
        _settle(id, index, p, m, 0);
    }

    /// @dev Undelivered funds only. Delivered work never becomes buyer-refundable
    /// merely because review/arbitration times out.
    function refundUndelivered(bytes32 id, uint256 index) external nonReentrant {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(msg.sender == p.buyer, "Only buyer");
        require(m.state == State.Funded, "Not undelivered");
        require(block.timestamp > p.fundedAt + m.duration + DISPUTE_GRACE, "Refund not due");
        _settle(id, index, p, m, m.amount);
    }

    function disputeMilestone(bytes32 id, uint256 index) external {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(msg.sender == p.buyer || msg.sender == p.contractor, "Only parties");
        require(m.state == State.Funded || m.state == State.Delivered, "Not disputable");
        if (m.state == State.Funded) require(block.timestamp <= p.fundedAt + m.duration + DISPUTE_GRACE, "Dispute window closed");
        _dispute(id, index, p, m);
    }

    /// @notice Anyone can progress an unanswered delivery into human review.
    function requestOverdueReview(bytes32 id, uint256 index) external {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(m.state == State.Delivered && block.timestamp > m.deliveredAt + p.reviewWindow, "Review not overdue");
        _dispute(id, index, p, m);
    }

    function escalateMilestone(bytes32 id, uint256 index) external {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(m.state == State.Disputed && !m.escalated && block.timestamp > m.reviewDeadline, "Escalation not due");
        m.escalated = true;
        emit MilestoneEscalated(id, index, p.independentReviewer);
    }

    /// @dev Arbitration and mutually signed settlements can close out of order
    /// even on sequential projects, so an earlier dispute cannot trap a refund.
    function resolveMilestone(bytes32 id, uint256 index, uint256 buyerRefund) external nonReentrant {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(m.state == State.Disputed, "Not disputed");
        if (m.escalated) require(msg.sender == p.independentReviewer, "Only independent reviewer");
        else require(msg.sender == primaryReviewer && block.timestamp <= m.reviewDeadline, "Primary review closed");
        _settle(id, index, p, m, buyerRefund);
    }

    /// @notice Both parties may cancel or agree a full/partial settlement while active.
    function settleByAgreement(bytes32 id, uint256 index, uint256 buyerRefund, uint256 expiry,
        bytes calldata buyerSignature, bytes calldata contractorSignature) external nonReentrant
    {
        (Project storage p, Milestone storage m) = _get(id, index);
        require(expiry >= block.timestamp && expiry <= block.timestamp + 1 days, "Invalid expiry");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SETTLEMENT_TYPEHASH,
            id, index, p.termsHash, buyerRefund, m.nonce, expiry)));
        require(SignatureChecker.isValidSignatureNow(p.buyer, digest, buyerSignature), "Buyer consent required");
        require(SignatureChecker.isValidSignatureNow(p.contractor, digest, contractorSignature), "Contractor consent required");
        _settle(id, index, p, m, buyerRefund);
    }

    function _get(bytes32 id, uint256 index) internal view returns (Project storage p, Milestone storage m) {
        p = projects[id];
        require(p.fundedAt != 0 && index < p.count, "Unknown funded milestone");
        m = milestones[id][index];
    }

    function _dispute(bytes32 id, uint256 index, Project storage p, Milestone storage m) internal {
        m.state = State.Disputed;
        m.reviewDeadline = block.timestamp + p.arbitrationWindow;
        emit MilestoneDisputed(id, index, m.reviewDeadline);
    }

    function _settle(bytes32 id, uint256 index, Project storage p, Milestone storage m, uint256 buyerRefund) internal {
        require(m.state == State.Funded || m.state == State.Delivered || m.state == State.Disputed, "Already settled");
        require(buyerRefund <= m.amount, "Refund exceeds allocation");
        uint256 grossPaid = m.amount - buyerRefund;
        uint256 fee = Math.mulDiv(m.reservedFee, grossPaid, m.amount);
        m.state = grossPaid == 0 ? State.Refunded : State.Released;
        ++m.nonce;
        p.remaining -= m.amount;
        tokenLiability[p.token] -= m.amount;
        IERC20 token = IERC20(p.token);
        if (buyerRefund != 0) token.safeTransfer(p.buyer, buyerRefund);
        if (grossPaid > fee) token.safeTransfer(p.contractor, grossPaid - fee);
        if (fee != 0) token.safeTransfer(feeCollector, fee);
        emit MilestoneSettled(id, index, buyerRefund, grossPaid - fee, fee);
    }
}
