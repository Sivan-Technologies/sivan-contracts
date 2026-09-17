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
     *        delivered before release, which is also when an agent attestation
     *        was required. False when the buyer released directly from Funded.
     *        Carried on the event so a dispute can later distinguish "the buyer
     *        paid against verified delivery" from "the buyer simply paid",
     *        without replaying state.
     */
    event AgreementReleased(
        bytes32 indexed agreementId,
        address indexed buyer,
        address indexed contractor,
        uint256 netAmount,
        uint256 protocolFee,
        uint256 partnerFee,
        bool deliveryRecorded
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

    function getAgreement(bytes32 agreementId) external view returns (Agreement memory);
}
