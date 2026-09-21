# Agreed arbitration and independent escalation

Implemented locally on 2026-09-21. Not deployed. Existing immutable vaults are unchanged.
This supersedes earlier descriptions of timeout restoring Funded/Delivered or
guaranteeing a permissionless refund.

## Policy

- Both parties accept exactly 24 hours, 72 hours or seven days of primary review
  before funding. These are maximum primary windows, not mandatory waits or a
  promise of final settlement within that time.
- The primary reviewer is the owner at proposal time, snapshotted for the deal.
  Ownership transfers cannot replace that reviewer on existing agreements.
- The independent reviewer is agreed before funding. It cannot be zero, the
  vault, either party, the primary reviewer, agent or fee collector. Separate
  addresses do not prove organizational independence: verify conflicts, control
  and availability off-chain. A multisig can act as reviewer; the vault does not
  implement a community voting panel.
- The primary clock starts when either party raises a dispute. Before its
  deadline only the primary reviewer can rule; at or after it only the independent
  reviewer can rule. This authority boundary works without a keeper transaction.
- Timeout NEVER restores unilateral refund/release eligibility or moves funds.
  State stays Disputed. Recording escalation cannot reset the clock.
- **If the independent reviewer never acts, funds can remain locked indefinitely.**
  There is no second automatic deadline, automatic winner or admin replacement.
  The independent reviewer can still rule later, or the parties can voluntarily
  settle. Disclose this before acceptance and funding. Vera has no new authority.

The delivery-inspection window is separate from arbitration. It is pinned when
terms are proposed; the 24/72/168-hour options do not change the delivery deadline
or the existing default inspection window.

## Funding integration: new mandatory steps

The existing six-argument `deposit` now fails without bilateral acceptance:

1. Calculate `fundingHash = keccak256(abi.encode(token, amount, deadlineHours,
   partnerAddress))` using `(address,uint256,uint256,address)`, in token base units.
2. Buyer calls `proposeArbitrationTerms(agreementId, contractor,
   independentReviewer, primaryReviewPeriod, fundingHash, expiresAt)`.
   Review periods are seconds: 86400, 259200 or 604800. Expiry limits acceptance
   and funding, not the later rights of a funded agreement.
3. Clients read `proposedArbitrationTerms(buyer, agreementId)` and display both
   reviewers, clocks, funding inputs and indefinite-lock risk. Read
   `arbitrationTermsHash(buyer, agreementId)`, which binds the proposal, buyer,
   agreement ID, chain and vault. The fee-policy fingerprint prevents funding
   after fee settings change without new acceptance.
4. Contractor calls `acceptArbitrationTerms(buyer, agreementId, expectedHash, true)`.
   A stale hash fails. False revokes acceptance before funding. Re-proposing
   resets acceptance. Proposals are namespaced by buyer.
5. Buyer approves tokens and deposits with exactly those funding inputs and
   contractor. `ArbitrationTermsLocked` records the funded commitment.

Reviewer addresses and review period are then immutable in `arbitrationCases`.
Changing fee policy requires new acceptance before funding. Changing the delivery
window default does not change an already accepted inspection window.

## Dispute integration

- `raiseDispute` sets `primaryDeadline` once and emits `ArbitrationReviewStarted`.
  `refundUnlockAt` is not an arbitration clock or a refund entitlement in Disputed.
- `claimArbitrationTimeout` records escalation and emits `ArbitrationEscalated`.
  Legacy `ArbitrationTimedOut` has refundAmount=0; it is NOT a settlement event.
- `resolveDispute` enforces the snapshotted reviewer and deadline, requires a
  nonempty reason, and retains the binary full-refund or contractor-net outcome.
- Legacy `disputeResolvedByTimeout` remains false. Read `arbitrationCases`, actual
  time and settlement events. Escalation, rulings and settlement work while paused.

## Voluntary settlement

Existing contractor-consented `mutualRefund` still returns everything to the buyer.
It is a voluntary contractor concession, not an arbitration award.

`settleDisputeByAgreement` additionally accepts a buyer refund and pays the remainder
to the contractor, using both parties' EIP-712 signatures over:

```text
Domain: name="Sivan Celo Settlement Facility", version="1",
        chainId=<actual chain>, verifyingContract=<vault>
DisputeSettlement(bytes32 agreementId,uint256 buyerRefund,uint256 nonce,uint256 expiry)
```

Read `agreementNonces(agreementId)` before signing. Expiry must be current and no
more than one day ahead at submission. Any relayer may submit the two signatures.
EOA and ERC-1271 validation are supported. Failed validation does not consume the
nonce; settled agreements cannot settle again.

The buyer's refund is fee-free. Original fee and partner-fee snapshots are prorated
on the contractor's gross portion, rounding down. Protocol fee equals prorated
total fee minus partner fee. Refund + contractor net + protocol + partner equals
the recorded deposit exactly. No new fee rate is introduced; existing fee-collector
destination behavior is unchanged. Indexers must process `DisputeSettledByAgreement`
for the actual refund/net/fee, rather than assume the original full net was paid.

## Rollout

A new deployment and frontend/backend funding, reviewer and event-indexing changes
are required. Updated ABI does not upgrade the existing Sepolia vault.
No deployment or live transactions were run.

Lifecycle scripts require explicit `INDEPENDENT_REVIEWER` and
`PRIMARY_REVIEW_HOURS=24|72|168`; they perform bilateral acceptance before deposits.
Older vaults fail capability preflight before new approvals/deposits. Existing
RESUME refund checks remain separate. These scripts have not been run remotely.

This implements independent escalation for primary nonresponse, not appeals,
community staking or three-person voting. Production still requires independent
security review, client integration and verified reviewer operations.

## Local validation

The Hardhat suite passes 131 tests, including timeout followed by immediate
refund, exact deadline handover, bilateral term acceptance, stale/revoked terms,
fee changes, paused resolution, signature replay/domain checks and split-payment
conservation. Lifecycle helper configuration and acceptance are tested locally.
The Foundry sources were updated, including initializing the invariant fixture's
token allowlist, but its suite could not be run here: `forge` and `lib/forge-std`
are absent. No claim of remote end-to-end or independent audit coverage is made.
