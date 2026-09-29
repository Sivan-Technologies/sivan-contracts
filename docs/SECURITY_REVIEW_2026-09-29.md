# Sivan contracts: internal security review

Historical baseline findings: subsequent fixes and their validation are documented
in [the remediation report](SECURITY_REMEDIATION_2026-09-29.md). The reproduction
descriptions below refer to the reviewed baseline, not a claim that fixes were
already present at that time.

Date: 2026-09-29. Scope: single-agreement and milestone vaults, their local tests,
deployment controls, dependency advisory status and CI configuration.

Contract baseline: `c7abf1335d3e8811e51b2658ac4d8c952df7213d` on staging.
During the review, HEAD advanced externally to
`61d57e6966b7d98e2d9cd41a0b999d3cf79a9dbd`; the diff contains only the two
audit reproduction tests. No contract or deployment implementation changed.

This is an internal, time-bounded source review with local adversarial testing,
not an independent audit, formal verification, or mainnet approval. No deployment,
live account action, or real-fund transaction was performed. The reviewer did not
commit or push during this review.

## Opinion

The milestone vault has meaningful fund-accounting and authorization safeguards.
Its new funding-only pause and bilateral reviewer replacement are materially
better than giving an administrator discretionary control of disputed funds.
However, I do not recommend a production release yet. Two reproduced
single-agreement behaviors need remediation or explicit, informed policy
acceptance, and the dependency gate has a moderate advisory to address.

No critical or high-severity vulnerability was confirmed in the examined paths.
That is not a claim that none exists. Passing arithmetic invariants does not
establish that funds went to the economically rightful party.

## Findings

### M-01: Buyer-authored delivery can shorten the agreed work deadline

Severity: Medium. Status: reproduced locally; not fixed.

Locations: `contracts/SivanAgreementVault.sol:694`, `:717`, `:913`.
Reproduction: `test/security-review-2026-09-29.test.js`, first test.

`markDelivered` accepts either party, including the buyer, and replaces
`refundUnlockAt` with the current timestamp plus the delivery review window.
It does not require contractor authorization for a buyer's delivery claim.

Reproduced sequence:

1. Both parties agree to a 30-day job and fund 100 test USDC.
2. The buyer immediately marks the job delivered with arbitrary nonempty text.
3. The refund clock becomes approximately seven days instead of 30 days.
4. After that shorter window, the buyer refunds the entire 100 USDC while the
   original work deadline is still in the future. The contractor receives zero.

The contractor can prevent the unilateral refund by disputing in time. Therefore
this is not instantaneous theft or a theft of unrelated escrow. It does allow the
buyer to shorten the contractor's protection and impose an unexpected monitoring
deadline. Additionally, `DeliverableSubmitted` records the contractor address even
when the buyer initiated the claim, which can mislead event-only consumers.

Recommendation: allow the contractor to open delivery review, or require their
explicit, scoped consent when the buyer records delivery. If buyer-only delivery
is retained, it must not unilaterally accelerate refund eligibility. Decide
separately whether genuine contractor-authorized early delivery should shorten
the work deadline; do not change that business policy accidentally by applying
an unconditional maximum timestamp. Cover both actor paths and event attribution.

This behavior is separate from the previously fixed arbitration-timeout/refund
loophole. The latter remains blocked while an agreement is disputed.

### M-02: Legacy refund consent has neither expiry nor a cancellation path

Severity: Medium, conditional on a contractor having signed a refund authorization.
Status: reproduced locally; not fixed.

Location: `contracts/SivanAgreementVault.sol:928`.
Reproduction: `test/security-review-2026-09-29.test.js`, second test.

The EIP-712 `ContractorRefundConsent` signs only agreement ID and nonce. It does
not expire. Delivery and opening a dispute do not invalidate it, and there is no
contractor-facing nonce invalidation operation for cancelling outstanding consent.

Reproduced sequence:

1. Contractor signs refund consent while the job is funded, without submitting it.
2. Contractor subsequently records delivery and raises a payment dispute.
3. Time advances one year in the local test.
4. An unrelated relayer submits the old signature. The buyer receives the full
   deposit and the contractor receives zero.

This is not signature forgery: it executes an authentic authorization whose
lifetime is unlimited. The risk is treating this signature as temporary consent
when the contract treats it as standing consent across later business events.
Terminal-state checks still prevent a second payout.

Recommendation: add signed expiry and explicit contractor-controlled nonce
invalidation, and document whether lifecycle transitions invalidate consent.
If changing the signature schema, version it deliberately and test replay,
cancellation and cross-domain behavior. Do not silently reinterpret signatures
already issued for an immutable deployed contract.

### D-01: A pinned tooling dependency has a moderate advisory

Severity: Moderate dependency advisory; reachable exploit in Sivan not established.
Status: confirmed by a fresh npm advisory scan; not fixed.

Location: `package.json:42`, corresponding lockfile entry.

The override pins `undici` to `6.28.0`. The maintainer advisory
[GHSA-3wwx-pv8p-q78v](https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v)
identifies affected 6.x versions as `>=6.25.0 <6.28.1`, with `6.28.1` patched.
It concerns a process crash caused by a malicious compressed WebSocket message.
The scan returned 1 moderate and 15 low advisories, with no high or critical ones.

This is a JavaScript tooling exposure, not a demonstrated Solidity fund-drain
vulnerability. I did not demonstrate that a deployed Sivan component reaches the
affected WebSocket path. Nevertheless, the configured moderate-level npm audit
gate is not satisfied by this dependency set.

Recommendation: update the override and lockfile to a compatible patched version,
then rerun clean install, reproducible build, tests and npm audit. Assess the
remaining low advisories explicitly rather than claiming a clean dependency scan.

## Milestone and operational observations

These are design risks or assurance gaps, not additional confirmed theft bugs.

### Permissionless overdue review changes the available settlement path

At `SivanMilestoneVault.sol:259`, anyone can move an overdue Delivered milestone
into Disputed. An outsider can therefore precede a late buyer release with this
call and force reviewer involvement or a new bilateral settlement. They cannot
choose the recipient or take funds. This is an explicit keeper-friendly policy,
but its griefing/transaction-ordering consequence should be accepted deliberately.
Restrict initiation to parties or authorized keepers if public escalation is not
part of the intended policy. This observation was source-reviewed, not separately
reproduced by a new test in this review.

### Recovery requires cooperation; it is not guaranteed liquidity

Milestone reviewer replacement requires buyer and contractor signatures after the
agreed wait. If one refuses and the reviewer remains unavailable, funds can remain
disputed indefinitely. The single-agreement vault does not have the milestone
reviewer-replacement mechanism. Mutual settlement is an alternative, but it also
depends on cooperation. This follows the agreed no-unilateral-timeout-payout policy.

### Address separation is not independence of people or controlling keys

The checks reject direct reviewer/party/fee-recipient address conflicts. They
cannot establish that separate addresses have separate beneficial controllers.
Reviewed Safe bytecode, threshold, owners, modules, guard and fallback-handler
checks are useful deployment controls, but their correctness depends on separately
reviewed policy inputs. Wallet configurations can change after preflight. Maintain
independent signer custody and monitoring; do not market an address inequality as
proof of independent adjudication.

### Mutable and immutable authorities have different availability risks

Single-vault delivered releases depend on the current global agent attester.
Changing it can invalidate outstanding attestations. Its pause also blocks normal
release, unlike the milestone funding-only pause. Dispute and refund paths are
different exits, not an equivalent guarantee of immediate contractor payment.

Milestone treasury, primary reviewer and funding-admin addresses are immutable.
Loss of their effective signing capability affects their roles; an admin left
unavailable while funding is paused prevents new funding, not existing settlement.
Prefer recoverable, independently operated multisigs and a documented migration
plan. No arbitrary admin seizure/rescue mechanism should be added casually.

### Token behavior remains a trust assumption

Milestone funding rejects non-exact incoming transfers. The single vault measures
the actual incoming balance delta. Neither design makes issuer blacklisting,
token upgrades, negative rebases or arbitrary outbound token behavior safe.
SafeERC20 success is not proof of exact recipient delivery for every possible
token. Restrict the asset list to reviewed behavior and test actual supported
tokens and issuer controls before live use. A blocked immutable fee recipient can
make fee-bearing settlements revert atomically.

### Test coverage is substantial but incomplete

The milestone randomized handler exercises nine selectors on one funded project.
It does not randomly interleave bilateral settlements, reviewer replacements,
multiple concurrent projects or ERC-1271 wallet policy changes. Deterministic
tests cover several of these separately; that is not the same as a stateful
invariant over their combinations.

The milestone invariant ran 51,200 calls, of which 39,193 reverted on invalid
transitions. Those reverts are not a failed invariant, but the raw call count
should not be described as 51,200 successful settlement scenarios. Add a more
state-aware handler and explicit progress/coverage counters for critical paths.

## Verification performed

| Check | Result | Limitation |
| --- | --- | --- |
| Existing Hardhat suite | 236 passed | Local contracts and test fixtures |
| New behavioral reproductions | 2 passed | Passing means the risks were reproduced, not fixed |
| Foundry | 27 passed, none failed/skipped | 2,048 runs per fuzz test; 512 invariant runs at depth 100 |
| Clean Solidity build | Passed, Solidity 0.8.24 / Cancun | Does not certify every EVM chain |
| Slither | Medium/high gate passed; 35 reported low/informational results | Existing exact suppressions/triage remain; not zero findings |
| npm advisory scan | 1 moderate, 15 low, 0 high/critical | Tooling exploit reachability not proven |
| GitHub CI | Baseline run reported failure | Individual current job logs not retrieved |
| Live deployment/application lifecycle | Not performed | No real funds, frontend/backend or production-key validation |

Local evidence files are `/tmp/security-review-hardhat.log`,
`/tmp/security-review-forge.log`, `/tmp/security-review-compile.log`,
`/tmp/security-review-slither.log`, and `/tmp/security-review-npm.json`.
These temporary logs are not permanent release artifacts.

The GitHub status read identified failed run
<https://github.com/Sivan-Technologies/sivan-contracts/actions/runs/36554653755>
for `c7abf13`. The next authenticated job-detail request was blocked by the tool's
approval/usage limit. The exact current failed-job list is therefore unverified;
an earlier fork-RPC configuration problem must not be assumed to be the only
current cause. No attempt was made to bypass the restriction.

Tracked environment filenames were checked: only example templates were listed.
This is not a complete historical secret scan or a review of actual production
signer custody. Backend authentication, frontend signing prompts, Vera, cloud
infrastructure and real Safe integration were not audited here.

## What is working well

- Both designs use explicit accepted funding/arbitration terms rather than
  silently assigning reviewer authority after funding.
- Timeout escalation does not restore unilateral access to disputed funds.
- Milestone pause affects new funding only; existing settlement routes remain.
- Reviewer replacement binds project, milestone, terms, current/new reviewer,
  nonce and expiry, requires both signatures, and does not move money.
- Settlement state and accounting changes precede outbound transfers; failures
  revert atomically. Tested conservation and duplicate-settlement guards held.
- Deployment tooling checks actual chain IDs and roles, records broadcast intent,
  and keeps mainnet deployment disabled pending release approval.

## Release recommendation

1. Resolve M-01 before accepting real work on the single-agreement version.
2. Resolve M-02 or explicitly disclose and accept permanent refund consent;
   bounded, cancellable consent is the safer product behavior.
3. Patch D-01, rerun dependency/build gates, and retrieve successful current CI.
4. Extend stateful milestone testing for reviewer replacement and bilateral
   settlement combinations, and explicitly decide public overdue-review policy.
5. Run controlled testnet lifecycles using real intended Safe configurations,
   verified deployed bytecode and the actual application integration.
6. Obtain independent review of the release candidate and signer operations.

Verdict: stronger engineering and suitable for further controlled testnet work,
but not a security-approved production release. No percentage safety score is
justified by these results.
