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
  vault, either party, the primary reviewer, agent or accepted fee collector.
  Funding also rejects a partner matching the independent reviewer, even at zero
  fees. Positive fee payments recheck this separation at settlement. Separate
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

Before proposing terms, derive the ID using `deriveAgreementId(buyer, nonce)`:
20 bytes of buyer address followed by a unique 12-byte nonce. Use
`scripts/helpers/agreement-id.js` for JavaScript clients. Persist the ID and
associate it with chain, vault and both parties; never reuse it for that buyer.
Raw hash/UUID IDs from earlier deployments are not valid for new funding in this
source version. Existing deployed vaults and their exit paths remain unchanged.

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

Direct `mutualRefund(id, "0x")` still lets the contractor return everything to the
buyer. Legacy relayed refund signatures are rejected. Relayers must use
`mutualRefundWithConsent(id, expiry, signature)` with the current
`refundConsentNonces(id)`. Contractor cancellation, recording delivery and opening
a dispute invalidate previously issued refund consent. See
[the current signing schema and migration notes](SECURITY_REMEDIATION_2026-09-29.md).
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
the recorded deposit exactly. No new fee rate is introduced. The accepted collector
is snapshotted at funding in `agreementFeeCollectors(agreementId)` and announced by
`AgreementFeeCollectorLocked`. All settlements use that snapshot, never the current
global collector. Later collector changes apply only to future funding and invalidate
previously accepted, unfunded fee terms. There is no per-agreement collector setter
or fallback to the global collector; choose an accessible, protected recipient.
This address-level guard cannot prevent common ownership or subsequent forwarding.
Indexers must process `DisputeSettledByAgreement`
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

At commit `ed8714c`, 142 Hardhat tests and 25 Foundry tests passed locally,
including timeout followed by immediate refund, deadline handover, bilateral
acceptance, fee-recipient snapshots, reviewer conflicts, replay protection and
split-payment conservation. Eight fuzz tests ran 2,048 cases each; seven invariants
ran 512 runs × 100 calls each. The original recipient/conflict reproductions are
now rejection regressions. See [the full review and reproduction commands](FOUNDRY_SETTLEMENT_REVIEW_2026-09-22.md).
For planned networks and evidence gates, see the
[EVM implementation and test plan](EVM_MULTICHAIN_IMPLEMENTATION_AND_TEST_PLAN.md).
This is not production clearance, remote end-to-end validation or an independent audit.
