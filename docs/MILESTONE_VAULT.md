# Milestone projects: separate vault

Status: initial implementation and local tests, not deployed or independently audited.
2026-09-29 update: funding-only pause and jointly signed per-case reviewer recovery
are implemented. See [safeguards](MILESTONE_SAFEGUARDS.md) for the new constructor
argument, recovery-period proposal argument and deployment requirements.
`SivanAgreementVault.sol` and its interface, behavior and deployment commands are
unchanged. `SivanMilestoneVault.sol` is a separate immutable contract, not a proxy,
adapter or replacement for funded single agreements.

## Agreed payment model

A buyer proposes a project with 1–20 milestone allocations. The contractor accepts
the exact terms hash on-chain. The buyer approves the token if necessary, then
`fundProject` transfers the full project amount once. Either every allocation is
funded or the transaction reverts. Proposal and acceptance are separate transactions;
"one deposit" does not mean the entire setup takes one wallet interaction.

For an illustrative 1% deployment policy:

| Milestone | Gross locked | Reserved fee | Net on full release |
| --- | ---: | ---: | ---: |
| Design | 100 | 1 | 99 |
| Backend | 250 | 2.50 | 247.50 |
| Frontend | 150 | 1.50 | 148.50 |
| Total | 500 | 5 | 495 |

The fee rate is a constructor parameter, immutable and capped at 300 bps. It is
not assumed to be 1% in production, and does not copy the single vault's tiered
fee schedule. A final fee policy must be approved before any deployment.
Tokens are accounted in their base units; the vault does not assume six decimals
or attempt USD conversion. The application must show token units honestly.

The project fee is `floor(total * feeBps / 10000)`. Cumulative proportional
allocation ensures all milestone fee portions sum exactly to the project fee.
Rounding may allocate an extra base unit to a later milestone. Both parties accept
these exact allocations. No fees leave the vault at funding.

## Release, refund and dispute rules

- The contractor records a nonzero delivery-proof hash before the milestone deadline.
- Only the buyer can perform ordinary acceptance/release. Marking delivery alone
  cannot move funds. There is no automated AI signing or delegated ordinary release
  in this first milestone implementation. Smart-account buyers can call directly.
- Independent releases are the default application choice (`sequential=false`).
- Optional sequential mode requires earlier milestones to be terminal (released or
  refunded) before ordinary release. Delivery may be recorded out of order.
  Arbitration and mutually signed settlements bypass this ordering: an earlier
  dispute must not trap a later negotiated refund or authorized ruling.
- Deadlines are durations from project funding, not from the preceding release.
  Sequential proposals require nondecreasing deadlines. UI terms must make this clear.
- Undelivered milestones can be fully refunded by the buyer after the deadline plus
  a two-day dispute filing grace. The grace ends before unilateral refund starts.
- Delivered milestones never become unilaterally refundable merely due to timeout.
  Only the project's buyer or contractor can request human review after the agreed
  delivery review window expires. Unrelated callers and control-role addresses
  cannot initiate overdue review. Permissionless escalation applies only after a
  dispute has already been opened and its primary-review deadline has expired.
- Either party may dispute active work; undelivered disputes must be filed within
  the deadline plus grace. A disputed milestone cannot be ordinarily released/refunded.
- Primary review lasts an agreed 24 hours, 72 hours or seven days from dispute.
  After expiry, anyone may escalate to the independent reviewer. Expired primary
  authority cannot settle, even before the escalation transaction is submitted.
- Independent review has no automatic payout timeout. After the agreed recovery
  wait, both parties can sign to replace the reviewer for only that milestone.
  Funds can still remain disputed
  indefinitely if the reviewer does not act and the parties cannot agree. Disclose
  this limitation before funding; a keeper alone cannot decide the outcome.
- Reviewers can award full or partial refunds. Both parties can also sign an EIP-712
  settlement for any active milestone, including a stalled dispute or cancellation.
- The refunded portion includes its reserved fee. Fee on a partial award is
  `floor(milestoneReservedFee * grossPaid / milestoneGross)`. A full refund charges
  zero; a full release charges the full milestone fee. Each milestone settles once,
  not through repeated partial draws. Gas already spent is not refundable.

## Consent and authority

Project IDs contain the buyer address and a unique 12-byte nonce. The terms hash
binds the chain, vault, parties, token, allocations/scopes, reviewers, fee policy,
ordering, time windows and acceptance expiry. Scope hashes commit to off-chain
deliverables and acceptance criteria; Sivan must retain that document durably.
Terms cannot be edited; changed proposals need a new ID and fresh acceptance.

The treasury and primary reviewer are immutable constructor roles. The independent
reviewer cannot be a project party, the primary reviewer, the treasury, funding
admin or the vault. Parties cannot be the treasury, primary reviewer or funding
admin. There is no partner-fee path.
The primary reviewer is the accepted Sivan decision-maker, not an AI payout key.

Mutual settlement signatures bind project, milestone index, exact terms hash,
refund, nonce, expiry, chain and contract. Both signatures are required, support
ERC-1271, and have at most a one-day validity window. Final settlement invalidates
reuse. Reviewers and parties must independently review before signing.

## Asset and operational limitations

- Only constructor-allowlisted, reviewed exact-transfer, non-rebasing ERC20s.
  Taxed incoming transfers revert atomically. Issuer pauses/blacklists or changed
  token behavior can still block settlement; allowlisting is not a token audit.
- No token rescue or administrative drain exists. Unsolicited donations are not
  credited to a project and may be permanently stranded. Never send directly.
- A dedicated funding admin can pause new deposits only. No global role rotation,
  fee update or token-list update exists. Per-case independent reviewer recovery
  requires both parties' signatures, never a unilateral administrator decision.
- No changes to existing single-agreement deployment scripts. A separate guarded
  milestone runner is available. No live deployment or application wiring performed.

## Application integration still required

1. Offer Single job / Milestone project without rerouting existing single jobs.
2. Persist the buyer-namespaced project ID and canonical scope documents/hashes.
3. Submit proposal; show exact allocations/fees/rules; obtain contractor acceptance.
4. Approve the correct token spender and call `fundProject(id, expectedTermsHash)`.
5. Confirm `ProjectFunded` on the correct chain and contract before showing funded.
6. Index per-milestone delivery, dispute, escalation and settlement events idempotently;
   handle reorgs and reconcile with contract state. Never treat submission as success.
7. Expose acceptance, full refunds where eligible, disputes and signed settlement.
8. Test wallet switching, retries, duplicate submissions, reviewer multisigs and
   frontend/backend recovery against a separately authorized testnet deployment.

## Tests

Local verification on 2026-09-28: all 201 Hardhat tests passed (19 milestone
tests plus existing regressions); the new Foundry accounting fuzz test passed
2,048 cases. Slither's medium/high gate passed with 34 remaining lower-severity
or informational findings across the combined codebase, after the documented
single-line transfer-delta annotation and existing single-vault exact-ID triage.
Milestone runtime bytecode is 12,513 bytes with the repository compiler settings.
These results are local, not remote testnet or independent-audit evidence.

`npx hardhat test test/SivanMilestoneVault.test.js` covers atomic funding, buyer
namespaces, accepted terms, independent/sequential releases, refunds, arbitration
timeouts, proportional fees, EIP-712 consent/replay, taxed transfers, donations,
cross-project isolation and conservation of balances.

`forge test --match-contract MilestoneAccountingTest --fuzz-runs 2048` varies all
three allocations, fee rates and partial refunds through mixed settlement paths.
The full existing single-agreement suite must remain green too.

Static analysis deliberately retains the funding balance-delta equality: exact
incoming amounts are necessary to fund the accepted allocations. The single-line
Slither annotation is documented and covered by taxed-transfer and donation tests;
it is not a detector-wide suppression or independent audit approval.

Additional E2E coverage in `test/milestone-end-to-end.test.js` exercises full payout
with 6/18-decimal tokens, maximum milestone count, receipt/event reconciliation,
ERC-1271 contract parties, cross-domain signature rejection, failed-transfer
rollback/retry, token reentrancy and sequential dispute recovery. These are local
test fixtures, not real token issuers or a production multisig implementation.
`forge-test/MilestoneInvariant.t.sol` adds randomized stateful sequences checking
balance conservation, backed liabilities, remaining allocations and one settlement
nonce per completed milestone.

Before production: independent security review, further adversarial coverage,
dedicated protected deployment/readback tooling,
approved governance/fee settings, and full application testnet integration remain
required. Passing local tests is not production certification.
