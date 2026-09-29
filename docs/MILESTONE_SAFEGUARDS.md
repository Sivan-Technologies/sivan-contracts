# Milestone safeguards — 2026-09-29

New milestone-vault code only. Single-agreement Solidity and deployment are unchanged.
Not deployed or independently audited. Existing immutable deployments cannot be patched.

## Funding pause

Constructor adds a fifth argument, `fundingAdmin`, separate from treasury and primary
reviewer. It is immutable; a Safe can change its own signers without changing its
address. `setFundingPaused(bool)` is callable only by that address and emits
`FundingPauseChanged`. The admin cannot move escrow, change amounts, rewrite terms,
rule on disputes or unilaterally replace reviewers. It cannot be a project party
or that project's independent reviewer.

Only `fundProject` checks the pause. Proposals and acceptance remain possible but
cannot receive deposits while paused. All existing delivery, release, refund,
dispute, overdue-review, escalation, reviewer-recovery and mutual settlement paths
remain callable subject to their normal authorization and timing. A pause cannot
reverse a transaction already funded or prevent every settlement exploit.

Overdue-review initiation is party-only: `requestOverdueReview` requires the
project buyer or contractor. It remains available while funding is paused and
only after the delivery-review deadline. An unrelated keeper cannot initiate
arbitration, but anyone may still call `escalateMilestone` for an already-open
dispute whose primary-review deadline has passed. Existing immutable deployments
require a new version to acquire this authorization change.

The runner requires reviewed Safe-compatible 2-of-3 funding-admin readbacks in
all modes, including testnet_eoa. The contract itself accepts an address; it does
not claim to identify Safe implementations or enforce their future thresholds.
Monitor admin multisig owner/module/threshold changes after deployment. Test
fixtures are not production Safe deployments. No multisig was created here.

## Bilateral independent-reviewer recovery

`proposeProject` adds a final `recoveryPeriod` (seconds), between 1 and 30 days.
This is included in the immutable terms hash accepted before funding; there is
no invisible default. The application should disclose the chosen wait clearly.

On escalation, the milestone stores its own active reviewer and assignment time.
After that wait, `replaceIndependentReviewer` accepts buyer and contractor EIP-712
signatures (EOA or ERC-1271) over:

`ReviewerReplacement(projectId,index,termsHash,currentReviewer,replacement,nonce,expiry)`

The domain binds chain and vault. Expiry must be current and no more than one day
ahead. A separate replacement nonce prevents replay without changing settlement
nonces. Replacement must be distinct from the parties, treasury, primary reviewer,
funding admin, vault, zero and the current reviewer. Recovery requires a still
disputed and escalated milestone. Anyone may relay the two valid signatures,
including the admin, but no role can bypass either party's signature.

Only that milestone changes: active reviewer, replacement nonce, assignment time.
No token transfer, allocation change, new dispute, state reset or change to other
milestones occurs. The new reviewer gets a fresh full recovery wait. The old
reviewer immediately loses authority for that case when replacement is mined.
Until it is mined, the current reviewer can still rule; transaction ordering cannot
be retroactively undone. Settled milestones cannot replace reviewers.

`ReviewerReplaced` and per-milestone `activeReviewer` are authoritative after
recovery; project-level `independentReviewer` remains the initially agreed reviewer.
Both-party settlement remains possible before/after replacement, including while
funding is paused. If either party refuses and the reviewer remains unavailable,
funds may stay disputed indefinitely. This feature is not guaranteed recovery.

## Integration and release changes

- Update milestone ABI, constructor args, proposal recovery argument and terms display.
- Index funding-pause and reviewer-replacement events by chain + vault + project + index.
- Display pause as “new funding unavailable”, not “all withdrawals disabled”.
- Use `FUNDING_ADMIN` and mandatory reviewed `ADMIN_*` policy fields in milestone env.
- New deployment reviewer proofs bind funding admin and its policy; regenerate proofs.
- Risk acknowledgement is now `funding-pause-bilateral-reviewer-recovery`.
- Do not deploy until tests, review and explicit deployment authorization are complete.

## Verification (local, 2026-09-29)

- 236 Hardhat tests passed, including pause-only funding, every existing exit while
  paused, authority isolation, exact-case replacement, accepted recovery bounds,
  EOA/ERC-1271 bilateral signatures, domain separation, replay/expiry rejection,
  former-reviewer rejection and mandatory 2-of-3 funding-admin preflight readback.
- 27 Foundry tests passed, 0 failed/skipped. Fuzz tests used 2,048 cases each;
  invariant tests used 512 runs at depth 100. Milestone randomized sequences now
  include funding pause/unpause. The milestone conservation invariant executed
  51,200 calls, including 39,149 rejected invalid transitions (not successful payouts).
- Clean-build Slither medium/high gate passed with the previously documented
  exact-ID/transfer-delta triage. 35 low/informational results remain; this is not
  an independent audit or proof of production readiness.
- The single-agreement Solidity, interface and deployment path remain unchanged.
- No live deployment, multisig creation or fund movement occurred. Application
  integration and a live intended-Safe testnet lifecycle remain unverified.
