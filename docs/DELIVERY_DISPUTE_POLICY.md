# Delivery, refund and dispute policy

This document explains what happens to locked funds when the two parties
disagree, and why the rules are drawn where they are. It exists because the
first version of the vault had no answer to that question, and the absence was
not obvious from reading the code.

## The bug this policy replaces

`markDelivered` accepted any nonempty string, from either party, with no
deadline check. `refundBuyer` only ran while the agreement was `Funded`.

Those two facts combined into a griefing attack:

1. Buyer funds an agreement with a 7 day deadline.
2. The contractor delivers nothing. The deadline passes. The buyer is now
   entitled to a full refund.
3. Before the buyer's refund transaction lands, the contractor calls
   `markDelivered(id, "ipfs://anything")`. State becomes `Delivered`.
4. Every exit is now closed:

| Path | Why it fails |
| --- | --- |
| `refundBuyer` | reverts, state is not `Funded` |
| `releasePayment` | needs the buyer, who will not pay for nothing |
| `mutualRefund` | needs the contractor, who is the attacker |
| `raiseDispute` | did not exist |

The funds were unreachable by every party, permanently.

**Nobody profits, which is why it is easy to miss.** There is no theft, so the
bug reads as untidy rather than critical. But for the buyer the outcome is
identical to theft, the cost to the attacker is one transaction, and the
natural next step is a ransom demand the contract gives the buyer no way to
resist.

A second finding surfaced while fixing this. `AgreementState.Disputed` was
declared in the enum, `AgreementDisputed` was declared as an event, and
`mutualRefund` explicitly accepted `Disputed` as a valid starting state. No
function ever set it. The entire dispute path was unreachable, and
`mutualRefund` was handling a case that could not occur. Anyone auditing the
enum would reasonably conclude an arbiter of last resort existed.

## The policy

### 1. Delivery is an assertion, not a proof

Anyone entitled to file a delivery claim can file a false one. A contract
cannot tell a real deliverable from a fabricated URL. The only question it can
usefully answer is **how long an unverified assertion may hold the money
still**, and the answer must be finite.

### 2. Delivery moves the deadline, it does not remove it

Marking delivered starts a **review window** of `deliveryReviewWindow`,
default 7 days, measured from `deliveredAt`. During it the buyer may release or
dispute. If they do neither, `refundBuyer` becomes available again.

The window is anchored to `deliveredAt` rather than to the original deadline so
that a contractor who delivers early is not given a shorter review period than
one who delivers on the final day. Anchoring to the deadline would have
punished promptness.

### 3. Late delivery is refused

`markDelivered` now requires `block.timestamp <= deadlineTimestamp`.

Once the deadline passes the buyer's refund right has vested, and nothing the
contractor does unilaterally should be able to claw it back. A contractor who
finishes late is not cut off from payment: the buyer may still release from
`Funded` at any time, and `releasePayment` permits exactly that. What they
cannot do is force the buyer to wait.

### 4. Either party can escalate; only the owner can adjudicate

`raiseDispute(id, reason)` is callable by the buyer or the contractor, from
`Funded` or `Delivered`. It freezes the agreement in `Disputed`, which closes
every unilateral exit for both sides.

Both parties need this. A buyer facing a false delivery claim needs it, and so
does a contractor who delivered real work to a buyer now stalling to run out
the review window. Giving it to only one side would just relocate the standoff.

**The owner cannot raise a dispute.** Letting the operator freeze arbitrary
agreements would be a unilateral power over funds it does not own, which is the
custody this vault exists to avoid. The owner can only rule on disputes the
parties themselves have raised.

### 5. The arbiter's power is deliberately narrow

`resolveDispute(id, releaseToContractor, reason)` is the only place a
non-party moves money. It is fenced in on every side:

- Runs **only** from `Disputed`, which only a party can enter.
- A **binary choice between two addresses fixed at deposit time**. The owner
  cannot name a recipient, cannot split, cannot take a cut, cannot pay itself.
- **Cannot change the amount.** Payout is `netAmount`, fee is the fee computed
  when the agreement was funded.
- **Refunds charge no fee.** A deal resolved back to the buyer did not settle,
  so the protocol does not bill for it. More importantly, charging one would
  give the operator a financial interest in the outcome of disputes it is
  adjudicating, which is exactly the incentive an arbiter must not have.

The worst a compromised owner can do is decide a genuine dispute wrongly, in
favour of one of the two people already arguing over that specific money. It
cannot steal, and it cannot touch anything nobody has disputed. That is a much
smaller blast radius than an admin withdrawal function, which is the usual
shape of this feature and the one that keeps appearing in escrow exploits.

### 6. Pause must never trap funds

`refundBuyer`, `mutualRefund` and `resolveDispute` are all exempt from
`whenNotPaused`. Pause stops new money entering and stops the happy path. It
must never become a way to freeze money already inside.

### 7. The review window is bounded at both ends

`setDeliveryReviewWindow` enforces `1 day <= window <= 30 days`.

The upper bound is what makes the refund guarantee real. Without it an owner
could set the window to a thousand years and recreate the original lockup
through configuration rather than code.

The lower bound is not a formality. A window of zero would let a buyer refund
the instant a genuine delivery was filed, which is the mirror image of the bug
being fixed: it would hand buyers a way to take back funds for work actually
done. Both parties need a period in which the other cannot rug them.

## State machine

```
                    deposit
                       |
                       v
                  [ Funded ] ---- releasePayment ------> [ Released ]
                   |  |  |
                   |  |  +------- refundBuyer ---------> [ Refunded ]
                   |  |            (after deadline)
                   |  |
                   |  +---------- mutualRefund --------> [ Refunded ]
                   |               (contractor consents)
                   |
            markDelivered (on or before deadline)
                   |
                   v
              [ Delivered ] ---- releasePayment -------> [ Released ]
                   |  |            (+ agent attestation)
                   |  |
                   |  +---------- refundBuyer ---------> [ Refunded ]
                   |               (after deliveredAt + reviewWindow)
                   |
              raiseDispute (either party, also from Funded)
                   |
                   v
              [ Disputed ] ----- resolveDispute(true) --> [ Released ]
                       \
                        \------- resolveDispute(false) -> [ Refunded ]
                         \
                          \----- mutualRefund ----------> [ Refunded ]
```

`mutualRefund` still works from `Disputed`: if both parties agree on an outcome
they do not need an arbiter, and their agreement outranks arbitration.

## Guarantees

| Guarantee | Enforced by |
| --- | --- |
| No agreement can be locked forever | `invariant_everyOpenAgreementHasABoundedExit` |
| A buyer's vested refund cannot be revoked | deadline check in `markDelivered` |
| A delivery claim delays the refund by a bounded, known time | `MAX_DELIVERY_REVIEW_WINDOW` |
| A real contractor cannot be rugged by an instant refund | `MIN_DELIVERY_REVIEW_WINDOW` |
| The operator cannot freeze funds | `raiseDispute` rejects the owner |
| The operator cannot steal funds | `resolveDispute` is a binary choice between fixed addresses |
| The operator does not profit from its own rulings | dispute refunds charge no fee |
| Pausing cannot strand money | exit paths are not `whenNotPaused` |

## Test coverage

**75 Hardhat tests** (was 34) and **7 Foundry invariants over 12,800 calls**
(was 6).

`test/SivanAgreementVault.lockup.test.js` contains 41 adversarial tests written
from the attacker's side: each describes something a malicious party wants to
do and asserts they cannot. The cooperative cases are included too, because the
usual way a lockup fix breaks a product is by walling off the honest paths.

Every new guard was mutation tested. Each was removed or inverted, the suite
re-run to confirm tests fail meaningfully, then restored and verified
byte-identical with `diff -q`:

| Mutation | Tests that caught it |
| --- | --- |
| Remove the deadline check in `markDelivered` | 4 |
| Make `Delivered` unrefundable (the original bug) | 4 |
| Remove the review window check | 2 |
| Remove `onlyOwner` from `resolveDispute` | 1 |
| Remove the party check in `raiseDispute` | 2 |
| Charge a fee on dispute refunds | 1 |
| Remove the window setter's upper bound | 1 |

The invariant suite was also checked for vacuity, because an invariant that is
never exercised passes for the wrong reason. Injecting a deliberate `revert`
into the `Delivered` and `Disputed` branches confirmed the fuzzer genuinely
reaches both states rather than skipping them. Removing the `markDelivered`
deadline check then made `invariant_everyOpenAgreementHasABoundedExit` fail on
its own, rediscovering the original bug without being told where to look.

Slither reports nothing against `SivanAgreementVault`.

## Breaking changes

- `Agreement` gains `deliveredAt` and `disputedAt`. Anything decoding the
  struct by position must be updated.
- `markDelivered` now reverts after the deadline. Backends that retried late
  deliveries will now get `"Deadline passed, delivery too late"` and should
  route the buyer to release or dispute instead.
- Two new functions, `raiseDispute` and `resolveDispute`, and one new setter,
  `setDeliveryReviewWindow`.
- Two new events, `DisputeResolved` and `DeliveryReviewWindowUpdated`.

**The deployed Celo Sepolia vault `0x0592edf3...787caf` has the bug and cannot
be upgraded.** It is not proxied. Redeploy before any further integration
testing, and treat the existing address as a throwaway.
