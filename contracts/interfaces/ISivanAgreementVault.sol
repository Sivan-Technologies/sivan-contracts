// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISivanAgreementVault
 * @notice Interface for the Sivan AI Non-Custodial Service Agreement Settlement
 *         Facility on Celo. This is Layer 2 of the x402 stack: the on-chain
 *         facility that off-chain HTTP 402 coordination settles into, not an
 *         x402 protocol implementation itself.
 * @dev Enables autonomous milestone locking, dual-attestation release, dynamic fees, and partner splits.
 */
interface ISivanAgreementVault {
    enum AgreementState {
        Uninitialized,
        Funded,
        Delivered,
        Released,
        Refunded,
        Disputed
    }

    struct Agreement {
        bytes32 agreementId;
        address buyer;
        address contractor;
        address token;
        uint256 totalAmount;
        uint256 feeAmount;
        uint256 netAmount;
        uint256 deadlineTimestamp;
        AgreementState state;
        address partnerAddress;
        uint256 partnerFeeAmount;
        string deliverableProof;
        /**
         * When markDelivered was called. Zero until then.
         *
         * This exists because "delivered" needs a clock of its own. Without it
         * the Delivered state had no expiry, so entering it removed the buyer's
         * timeout refund permanently. See DELIVERY_REVIEW_WINDOW.
         */
        uint256 deliveredAt;
        /** When a dispute was raised. Zero if none has ever been raised. */
        uint256 disputedAt;
        /**
         * True once an arbitration timed out without a ruling.
         *
         * A timeout restores the pre-dispute position rather than awarding
         * funds, so this flag is what stops the cycle repeating: without it a
         * party could dispute, wait out the owner, dispute again, and postpone
         * settlement forever in 14 day steps.
         */
        bool disputeResolvedByTimeout;
        /**
         * THE SINGLE SOURCE OF TRUTH FOR WHEN THE BUYER MAY RECLAIM FUNDS.
         *
         * Every refund check reads this one field instead of recomputing from
         * whatever the global settings happen to say at call time. That
         * indirection is the whole point: an audit found that refundBuyer read
         * the live `deliveryReviewWindow`, so widening it from 7 to 30 days
         * retroactively revoked a refund a buyer had ALREADY become entitled
         * to on an agreement that was already funded and already delivered.
         *
         * Set at deposit to the funding deadline, pushed out once by delivery,
         * and pushed out once by a dispute. It never moves for any other
         * reason and never moves twice for the same reason, so its value is
         * always predictable from the agreement's own history.
         */
        uint256 refundUnlockAt;
        /**
         * The review window agreed AT FUNDING TIME, in seconds.
         *
         * Snapshotted so re-pricing the global window cannot reach backwards
         * into live agreements. New terms apply to new deals only.
         */
        uint256 reviewWindowSnapshot;
    }

    event AgreementFunded(
        bytes32 indexed agreementId,
        address indexed buyer,
        address indexed contractor,
        address token,
        uint256 totalAmount,
        uint256 feeAmount,
        uint256 deadlineTimestamp,
        address partnerAddress
    );

    event DeliverableSubmitted(
        bytes32 indexed agreementId,
        address indexed contractor,
        string proofUrl
    );

    /**
     * @param deliveryRecorded True when the contractor had marked the milestone
     *        delivered before release. NOTE: on the arbitrated route this is
     *        true without any agent attestation having been verified, so it
     *        means "a delivery was claimed", NOT "delivery was agent verified".
     *        Read `route` to tell those apart.
     * @param route How the settlement was authorised. An audit pointed out
     *        that deliveryRecorded alone was being read as proof of agent
     *        verification, which it never was on the arbitration path. Making
     *        the route explicit stops downstream reporting from inferring a
     *        guarantee the contract did not check.
     *
     *        BuyerAuthorised  the buyer released; an agent attestation was
     *                         verified if and only if deliveryRecorded is true
     *        Arbitrated       the owner ruled for the contractor; NO agent
     *                         attestation was checked on this path
     */
    /** How a release was authorised. See AgreementReleased. */
    enum SettlementRoute {
        BuyerAuthorised,
        Arbitrated
    }

    event AgreementReleased(
        bytes32 indexed agreementId,
        address indexed buyer,
        address indexed contractor,
        uint256 netAmount,
        uint256 protocolFee,
        uint256 partnerFee,
        bool deliveryRecorded,
        SettlementRoute route
    );

    event AgreementRefunded(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 refundAmount,
        string reason
    );

    event AgreementDisputed(
        bytes32 indexed agreementId,
        address indexed initiator,
        string reason
    );

    /**
     * @notice Emitted when the owner adjudicates a dispute.
     * @param releasedToContractor True if funds went to the contractor, false
     *        if they were returned to the buyer. There is no third option and
     *        no partial split: the arbiter chooses one party, and the amount is
     *        always the full agreement, so there is no discretion over how much.
     */
    event DisputeResolved(
        bytes32 indexed agreementId,
        address indexed arbiter,
        bool releasedToContractor,
        string reason
    );

    /** Emitted when the owner re-prices the delivery review window. */
    event DeliveryReviewWindowUpdated(uint256 oldWindow, uint256 newWindow);

    /**
     * @notice Emitted whenever an agreement's refund unlock time moves.
     * @dev Every movement is observable, so the buyer's earliest exit can be
     *      reconstructed from logs alone without replaying contract state.
     */
    event RefundUnlockScheduled(
        bytes32 indexed agreementId,
        uint256 previousUnlockAt,
        uint256 newUnlockAt,
        string reason
    );

    /** Emitted when an unarbitrated dispute times out back to the buyer. */
    event ArbitrationTimedOut(
        bytes32 indexed agreementId,
        address indexed caller,
        uint256 refundAmount
    );

    function deposit(
        bytes32 agreementId,
        address contractor,
        address token,
        uint256 amount,
        uint256 deadlineHours,
        address partnerAddress
    ) external;

    function markDelivered(
        bytes32 agreementId,
        string calldata proofUrl
    ) external;

    function releasePayment(
        bytes32 agreementId,
        bytes calldata buyerSignature,
        bytes calldata agentAttestation,
        uint256 expiry
    ) external;

    function refundBuyer(bytes32 agreementId) external;

    function mutualRefund(
        bytes32 agreementId,
        bytes calldata contractorConsentSignature
    ) external;

    /**
     * @notice Freezes an agreement for arbitration. Callable by either party.
     * @dev The escape hatch from a standoff. Either side may raise a dispute
     *      while funds are still held, which parks the agreement in Disputed
     *      until the owner adjudicates or the arbitration period expires.
     */
    function raiseDispute(bytes32 agreementId, string calldata reason) external;

    /**
     * @notice Returns funds to the buyer when arbitration was never completed.
     * @dev Callable by ANYONE once ARBITRATION_PERIOD has elapsed since the
     *      dispute was raised. This is the fallback that makes the no-permanent
     *      lock guarantee true: it needs no owner, no counterparty and no
     *      privileged key, so it survives a renounced owner, a lost key and a
     *      simply absent operator.
     */
    function claimArbitrationTimeout(bytes32 agreementId) external;

    /**
     * @notice Owner adjudicates a disputed agreement.
     * @param releaseToContractor True pays the contractor and takes the fee,
     *        false returns the full amount to the buyer.
     */
    function resolveDispute(
        bytes32 agreementId,
        bool releaseToContractor,
        string calldata reason
    ) external;

    function getAgreement(bytes32 agreementId) external view returns (Agreement memory);
}
