# Milestone overdue-review authorization fix

Addresses RC-L01 from the c907f20 review. Only the project's buyer or contractor
may now call `requestOverdueReview`. Unrelated callers, including the funding
admin, treasury and reviewers, cannot initiate arbitration through that endpoint.

An unauthorized attempt leaves the milestone, balances and normal buyer release
path unchanged. Both parties retain overdue review after the agreed deadline,
including while funding is paused. The contractor can therefore still request
review if the buyer stops responding.

Permissionless `escalateMilestone` is unchanged: it moves an existing dispute to
the independent reviewer after the primary deadline. It does not open a dispute
or move funds. Other dispute, settlement, fee, signature and funding logic is
unchanged. `SivanAgreementVault.sol` is untouched.

Regressions cover unrelated/control-role callers, preserved ordinary release,
buyer and contractor initiation, exact review-deadline boundaries, repeat calls,
paused operation and independent adjudication after permissionless escalation.
The Foundry milestone handler now calls overdue review as either project party,
so its stateful accounting test continues to exercise successful review transitions.

Existing deployments are immutable. This change requires a new reviewed milestone
deployment; no live contract was patched or deployed by this task. No ABI argument
changes are required, but clients/keepers must use the correct caller identity.
Generate a fresh deployment reviewer proof for the changed creation bytecode;
the protected deployment tooling should reject a proof for the old artifact.

Validation completed locally:

- All 255 Hardhat tests passed, including single/milestone integration regressions.
- All 31 Foundry tests passed, none failed/skipped; fuzz tests used 2,048 runs,
  invariants used 512 runs at depth 100.
- Clean Solidity build and Slither medium/high gate passed. The 37 existing
  low/informational results remain; no new suppression was introduced.
- `git diff --check` passed. No single-agreement implementation changes.

Evidence: `/tmp/overdue-fix-hardhat.log`, `/tmp/overdue-fix-foundry.log`,
`/tmp/overdue-fix-compile.log`, `/tmp/overdue-fix-slither.log`.
No commit, push, deployment or live transaction was performed for this fix.
