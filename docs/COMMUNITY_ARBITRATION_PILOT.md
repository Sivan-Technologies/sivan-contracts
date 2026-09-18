# Community arbitration pilot — policy and implementation plan

Date: 2026-09-18
Status: **proposed rules for approval; not implemented in Solidity**.
Scope: local tests first, then a separately authorized Celo Sepolia pilot.
No CELO staking, slashing, production deployment, Vera changes, or automatic
settlement integration is authorized by this document.

## 1. Agreed direction versus proposed parameters

Agreed direction: a human Sivan reviewer uses Vera's evidence workspace, with
appeals handled by three vetted community reviewers. Two matching votes determine
the panel outcome. Vera has no vote and no signing authority. Unavailable reviewers
may be replaced under a disclosed process; absence of a ruling is not a payout.

The following are **recommended pilot parameters, not yet approved fund rules**:

| Parameter | Proposal |
| --- | --- |
| Primary review | 14 days after a dispute is opened |
| Appeal window | 7 days after a primary ruling is recorded |
| Panel acceptance | 3 days after assignment |
| Panel deliberation | 7 days after all three reviewers accept |
| Panel quorum | 2 identical votes out of 3 distinct accepted reviewers |
| Replacement rounds | At most 2, each with new explicit acceptance/voting deadlines |
| Pilot outcomes | Full buyer refund or contractor net payout; no partial split |
| Reviewer fees | None during the test-token pilot |

Durations are proposals, not claims about an industry standard. Tests must
exercise exact deadline boundaries. Do not deploy these defaults without approval.

## 2. Appointment and independence

Proposed appointing authority: a dedicated reviewer-management multisig, distinct
from the settlement signer. For local tests use labelled test signers only.
Actual people, public addresses and quorum must be explicitly configured before
any remote pilot. Never reuse production wallet keys in tests.

Maintain a vetted roster, documented eligibility, availability and conflicts.
Exclude the buyer, contractor, primary reviewer and conflicted affiliates from the
appeal panel. Different wallet addresses alone do not prove independent people.
Disclose that a Sivan-appointed roster is not fully decentralized arbitration.

Freeze the selected panel and case terms. Changes to the general roster affect
future assignments, not existing votes. Record assignment and replacement events
with the actor, reason and timestamps. Require reviewers to accept a case before
they vote. Provide parties a conflict-reporting path before deliberation starts.

## 3. Terms accepted before funding

Bind a versioned terms hash to each agreement, including scope, deliverables,
acceptance criteria, evidence rules, review/appeal windows, appointing authority,
primary reviewer, fee policy and the unresolved-arbitration warning.

Require buyer and contractor acceptance of that same hash before funding. A buyer
deposit alone must not be represented as contractor consent. For a signed design,
bind acceptance to chain ID, contract, agreement ID, both parties, nonce and expiry.
Do not place personal documents on-chain; retain access-controlled originals and
commit their canonical hashes. Settlement keys remain outside Vera.

## 4. Proposed state transitions

```text
Disputed → PrimaryReview
  ├─ ruling → AppealWindow
  │              ├─ no appeal at deadline → FinalRuling
  │              └─ either party appeals → PanelReview
  └─ primary deadline expires → PanelReview

PanelReview
  ├─ 2 matching votes → FinalRuling
  └─ acceptance/voting deadline missed → ReplacementRound
                    ├─ valid replacement panel → PanelReview
                    └─ replacement budget exhausted → Unresolved

FinalRuling → execute fixed outcome once → Released or Refunded
Any open dispute state → both parties sign settlement → Released or Refunded
```

Do not pay on recording a primary ruling: an appeal must remain economically
possible throughout the appeal window. A final appeal ruling has no second appeal
in this pilot. Record outcomes and execute separately; execution must recheck the
case state so a stale primary ruling cannot race an appeal or mutual settlement.

Ordinary `refundBuyer()` and buyer-authorized release must not bypass an open
arbitration. Do not return a disputed case to Delivered with an expired refund
deadline. No timeout alone selects a winner.

## 5. Voting and replacement safety

- Bind votes to case ID, panel round, evidence root, terms hash and outcome.
- One immutable vote per reviewer per round; no vote replay across cases/rounds.
- Reviewers receive the same closed evidence package. Reopening evidence requires
  an explicit versioned process, not silently changing what a vote refers to.
- Replace a reviewer for nonacceptance, missed voting deadline or established
  conflict under the disclosed procedure, never for an unpopular vote.
- Preserve eligible votes when replacing only a nonvoting seat. If a conflict
  invalidates a cast vote, start a new auditable round rather than silently editing
  the tally. This exception needs review to prevent strategic panel resets.
- Do not claim bribery resistance or Sybil resistance from a 2-of-3 threshold.
- Final outcomes are immutable. Duplicate execution attempts cannot move funds.

## 6. If all reviewer replacements fail

**Proposal requiring explicit approval:** enter `Unresolved`. Do not automatically
refund, pay the contractor, split funds, restart the ordinary refund clock or let
the owner override the outcome. A mutually signed settlement remains available.
Any later external adjudication mechanism would need to be agreed in advance;
it is not an unspecified administrator escape hatch.

This choice can lock disputed funds indefinitely. That is a real trade-off, not
a technical guarantee of safety. Both parties must be told and must accept it.
If Sivan requires a guaranteed time-to-exit, a different economic fallback must
be explicitly selected before this design is implemented. These two goals cannot
both be promised solely by assigning more reviewers.

## 7. Vera integration boundary

Use [the API mapping](SIVAN_VERA_API_INTEGRATION.md) for evidence and review briefs.
Persist mappings between chain/vault/agreement, Vera UUID, terms hash, evidence
root, summary hash, reviewer identity and case round. Human votes/rulings originate
from authorized humans, not from Vera's free-text decision field or AI output.

No source code or settings in the Vera repository change in this pilot plan.
No automatic synchronization or settlement service is implemented by this document.

## 8. Implementation sequence after policy approval

1. Agree the parameters, appointing authority, independence policy and Unresolved
   behavior. Record the approval/version in this document.
2. Implement a separate arbitration state machine/module and a vault integration
   that cannot bypass it. Review who can create cases, assign panels and execute
   rulings; adding a module alone must not leave owner-only payout bypasses.
3. Add binding terms acceptance, round-aware voting and one-time settlement events.
4. Update ABI consumers and deployment checks. Existing immutable vaults do not
   upgrade; preserve their old ABI/address registry for historical reads.
5. Test locally with synthetic accounts and test tokens, then obtain separate
   authorization for a new Sepolia deployment. No mainnet testing.

## 9. Required acceptance tests

- Buyer and contractor must accept identical terms before funding.
- Primary ruling cannot execute during the appeal period.
- Appeal and execution at boundary timestamps have a deterministic ordering rule.
- Unauthorized, duplicate and stale-round votes are rejected.
- Two matching eligible votes finalize; one vote cannot finalize.
- Reviewer replacement cannot erase a valid unfavorable vote.
- Repeated replacement cannot silently extend the case beyond the disclosed rounds.
- Timeout → ordinary refund remains blocked for a disputed delivery.
- Owner, Vera, unrelated participants and replayed signatures cannot choose payout.
- Mutual settlement requires both parties' case-specific signatures.
- Pause, unavailable reviewers, lost keys and fee-recipient transfer failure cases
  are tested and their limitations documented rather than declared impossible.
- Conservation: contractor + buyer + legitimate fees equals escrowed amount;
  unrelated agreements remain solvent; terminal settlements cannot execute twice.
- No-quorum exhaustion reaches Unresolved, with the funds-lock risk made explicit.

## 10. Current repository status

Existing code still uses owner arbitration and its prior timeout behavior. This
document does not repair that known policy issue. Lifecycle tooling safeguards,
packaging repair and Vera API documentation are separate completed work.
Current tests passing is not evidence that this proposed panel policy exists.
