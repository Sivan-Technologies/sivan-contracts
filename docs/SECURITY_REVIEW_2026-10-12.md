# Sivan vault security review — 2026-10-12

## Assessment and scope

Reviewed commit: `5c06a1ed6830b3e2dff61e8f0645541a1adb88bf` on `main`.
The worktree was clean at entry. This review adds reproduction tests and this
report; it does not fix or change production Solidity, deployment logic or ABIs.

**Do not treat this report as production approval or a guarantee of safety.**
It is an internal AI-assisted, source-and-local-execution review, not an
independent audit-company engagement, exhaustive verification or formal proof.
No unauthenticated fund-drain, double-settlement or signature-forgery exploit was
reproduced in the exercised paths. Four low-severity findings remain, alongside
material deployment/integration and operational release gates.

Manual scope: all three production vaults and their public entry points,
authorization/state transitions, EIP-712 schemas, accounting and external token
calls; selected environment, deployment, recovery and confirmation helpers; CI
and dependency controls. Dynamic scope: repository Hardhat and Foundry suites,
the local five-profile Claim Vault matrix and three new focused reproductions.

Out of scope / not verified: deployed bytecode versus release artifacts, actual
production multisigs/owners/signers, key-management systems, live tokens and
issuer upgrades/freezes, public-chain funded lifecycles, frontend/backend/indexer
integration, infrastructure penetration testing, exhaustive git-history secret
scanning and economic/legal adjudication fairness. Merely checking tracked env
filenames is not a secrets audit. No real keys were printed; no live transfer,
account creation, provisioning, approval or contract deployment was performed.

## Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| SR-01 | Low | One-day expiry guard is not proof of fresh or recently issued consent | Two local reproductions |
| SR-02 | Low | Delivered-agreement timeout refund emits an inaccurate reason | Local reproduction |
| SR-03 | Low | Single/milestone deployment confirmation checks are weaker than Claim Vault tooling | Source review; no public reorg induced |
| SR-04 | Low | Legacy elliptic dependency advisory remains in tooling | Fresh npm audit and upstream advisory |

Severity is not a readiness percentage. No finding below demonstrates arbitrary
theft by an unsigned outsider. Trust and liveness assumptions are listed separately.

### SR-01 — Execution window does not enforce consent age

Locations: `contracts/SivanAgreementVault.sol:789-792` (release), `:957-960`
(refund consent); the same expiry pattern is present at `:122` (bilateral
settlement) and `contracts/SivanMilestoneVault.sol:296,313` (replacement/settlement).

The check `expiry <= block.timestamp + 1 days` restricts the time of execution
relative to the signed expiry. It does not record when the signature was issued.
A signature rejected as too far in the future can become valid later.

Reproduced in `test/security-review-2026-10-12.test.js`:

1. Fund a 100-unit fixture single agreement with a 30-day deadline.
2. Obtain a genuine buyer release signature, expiry one year plus one hour ahead.
3. Execution immediately reverts with `Release authorization window too long`.
4. Advance the local clock one year without settling/disputing the agreement.
5. Submit exactly the same signature: the contractor receives the stored net payout.
6. Separately reproduce the same timing with genuine contractor refund consent;
   the buyer receives the full deposit after the year with an unchanged nonce.

Conditions/limits: the signer really authorized the distant expiry; the attacker
cannot extend an existing signature, resurrect a normally expired signature or
bypass revoked/consumed nonces. Refund consent cancellation and invalidation on
delivery/dispute still work. The reproduction is not the earlier legacy-signature
bug; this uses the new expiring schema, with no intervening invalidating transition.
Only release/refund were dynamically reproduced; sibling patterns were traced
in source, not separately exploited. Confidence: high for the observed behavior.

Recommendation: choose and document the intended semantics. If future scheduled
authorizations are allowed, describe a final execution window rather than “fresh
consent.” If the product requires cancellation, expose signer-controlled nonce
invalidation for release/settlement, and reject distant dates in signing clients.
A signed validity interval can explicitly bound execution, but even an off-chain
`issuedAt` field cannot independently prove when the key actually signed. Stronger
freshness requires an on-chain anchor/challenge or appropriately scoped state epoch.
Any schema change needs versioned adapters and compatibility with old deployments.

### SR-02 — Refund reason contradicts recorded delivery

Location: `contracts/SivanAgreementVault.sol:926` (`AgreementRefunded` emission).

`refundBuyer` deliberately accepts both Funded and Delivered states. After the
contractor records delivery and the review deadline passes, refund succeeds but
emits `Deadline expired without delivery`. The reproduced agreement has a nonzero
`deliveredAt` and delivery proof. Payout amounts and authorization remain correct.

Risk: explorers, support tools, analytics or an indexer that trusts this reason
can misclassify a delivered job. No affected downstream implementation was tested.
Confidence: high; exact emitted string asserted by the new test.

Recommendation: distinguish undelivered deadline expiry from delivered review
expiry, or emit a neutral timeout reason and a structured previous-state field.
Keep readers of existing deployment events compatible. Do not silently change
financial state classifications solely based on the old reason string.

### SR-03 — Deployment finality policy is inconsistent

Locations: `scripts/helpers/milestone-deployment.js:110-119`,
`scripts/helpers/evm-deployment.js:127-171`; comparison:
`scripts/helpers/claim-deployment.js:87-108`.

Single/milestone tooling waits for a receipt with default `wait()` semantics and
performs readbacks. It does not apply Claim Vault's explicit minimum-confirmation,
canonical-block and receipt-recheck sequence. A reorg or inconsistent RPC can
leave a deployment journal representing an observation that did not persist.
This is a source-confirmed consistency gap, not a reproduced public-chain attack.

Mitigations: journals retain `readyForUse:false`, source verification is pending,
production gates remain closed, and the tooling does not itself release customer
funds. Therefore assessed Low in the current testnet-only release context.

Recommendation: define reviewed chain-specific finality policies; apply them
consistently to deployment, seeding, handover, recovery and verification before
activation. Claim's two confirmations are not universal economic finality on
every EVM/L2. Preserve broadcast-intent journals and reconcile uncertain outcomes
before retrying. Add deterministic reorg/pending-receipt tests for sibling runners.

### SR-04 — Elliptic advisory persists in the development toolchain

Fresh `npm audit --json`: 15 low affected dependency entries, zero moderate,
high or critical entries. These are propagated dependency entries, not 15 distinct
on-chain exploits. The audit command exits 1 because advisories remain.

[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)
lists affected elliptic versions through 6.6.1 and no patched version. The issue
can expose a key under specified faulty-signature conditions. It is not a
demonstrated vulnerability in Solidity's on-chain signature recovery.

`npm run security:signing-dependency` passed: direct ethers-v6 message, claim
typed-data and transaction signing worked while elliptic loading was blocked.
This mitigates one signing path, not every plugin or future deployment path.

Recommendation: complete a tested toolchain migration or obtain explicit,
time-bounded owner risk acceptance with isolated production signing. Do not use
`npm audit fix --force` as an unreviewed migration. See the existing
`docs/ELLIPTIC_RISK_ASSESSMENT.md`. No packages or audit thresholds changed here.

## Trust, liveness and policy limitations (not newly proven exploits)

- Reviewers can issue an unfair ruling within their accepted authority. On-chain
  code cannot establish the truth of off-chain delivery. Address separation does
  not establish organizational independence; primary-reviewer fee incentives need
  disclosure and operational governance.
- A stalled single-agreement dispute has no unilateral timeout refund. Funds can
  remain locked if the independent reviewer fails and parties do not cooperate.
  Milestone reviewer replacement requires both parties and the agreed wait.
- The single vault's ordinary release is pausable and recorded-delivery release
  needs the current attester. Admin/attester loss can interrupt that path; alternate
  dispute/refund routes have different prerequisites, not guaranteed equivalence.
- Claim links are bearer authorizations. Whoever controls the link signing key,
  including its creator, can authorize a recipient. Link secrecy and frontend
  signing/domain verification were not audited here.
- Token issuer blocklists, pauses, upgrades or rebases can defeat liveness. Claim
  Vault checks exact transfers; milestone/single outgoing settlement uses
  SafeERC20 without equivalent recipient balance-delta checks. Trusted exact-transfer
  token assumptions matter; a mutable/malicious token is not made safe by its ticker.
- Claim fees are upfront and nonrefundable; expiry returns only net funds to the
  original sender. Lost sender keys or issuer restrictions can prevent recovery.
- Direct token donations and unsupported native funds are not funded escrow and
  may be unrecoverable. No upgrade or rescue guarantee exists.

## Executed verification

| Check | Result |
| --- | --- |
| Existing Hardhat regression suite | 298 passed before new reproductions |
| Full Hardhat rerun with reproductions | 301 passed |
| New focused audit reproductions | 3 passed, demonstrating SR-01/SR-02 rather than fixing them |
| Five-profile local Claim Vault matrix | 145 passed; local fixtures, not public-chain E2E |
| Foundry full suite | 36 passed across 9 suites; zero failed/skipped |
| Fuzz settings | 512 runs per fuzz test |
| Invariant settings | 256 runs, depth 50, fail-on-revert enabled |
| Observed invariant execution | 12,800 calls per invariant run; zero reverts in reported runs |
| Slither | 40 contracts, 101 detectors, 39 reported timestamp/naming results; medium/high gate exit 0 |
| Dependency audit | 15 low, no moderate/high/critical; exit 1 expected for remaining advisories |
| Isolated signing dependency probe | Passed; no transaction broadcast |
| Integration baseline before report edits | Passed |

Invariant counts include eligibility checks/no-op handler calls; they are not
12,800 real payouts. Successful-route tests complement the random handlers.
Existing tests exercise replay/domain binding, failed-transfer rollback,
reentrancy, fee conservation, allowance behavior, ERC-1271 consent, arbitration
escalation, pauses, reviewer recovery and the prior timeout→refund regression.

Slither's exact-ID triage file contains one enum-state equality finding; this was
reviewed as a discrete-state guard, not an exploitable balance equality. Inline
suppressions and filtered dependencies/test fixtures mean a passing configured
scan must not be described as “zero warnings” or an audit of all dependencies.

Foundry initially rebuilt after a cache-format warning and completed successfully.
Its final home-directory signature-cache write warning did not fail execution.
No claim of tool-warning-free execution is made.

## Reproduction commands

```sh
npm test -- --network hardhat --no-compile
npx hardhat test --network hardhat --no-compile test/security-review-2026-10-12.test.js
npm run claim:test-matrix
forge test -v
npm audit --json
npm run security:signing-dependency
npm run integration:check
```

Local Foundry used the bundled solc 0.8.24 and libusb runtime, not an arbitrary
system compiler. Static analysis used the local virtualenv, Hardhat artifacts,
`--filter-paths 'node_modules|contracts/test|lib' --fail-medium`.

## Before production

1. Resolve/document SR-01's intended consent semantics and correct SR-02.
2. Align deployment finality and complete dependency-risk treatment.
3. Freeze a release candidate; re-run tests after any change and have an independent
   reviewer audit that exact release, including deployment and signing tooling.
4. Verify real token identities/behavior, source/bytecode and distinct protected
   control wallets; complete public-testnet funding/claim/refund and agreement journeys.
5. Exercise application receipt reconciliation, restart/recovery, incidents and
   monitoring. Obtain explicit activation approval for each chain/token/deployment.

The appropriate conclusion is **strong local evidence with unresolved findings
and release gates**, not “fully safe” or a numerical security certification.

## Remediation follow-up — 2026-10-12 (uncommitted working tree)

The historical observations above describe the reviewed commit. Subsequent
working-tree changes correct SR-02's event reason without changing eligibility
or amounts. SR-03's protected single/milestone deployment routes now enforce the
shared two-confirmation observation floor, bounded waits, canonical block and
receipt rechecks, including single-vault seeding/pause/handover. These are not
universal economic-finality guarantees, and production remains disabled.

SR-01 and SR-04 remain unresolved. The first two reproduction tests intentionally
retain evidence of the signature-window behavior; a passing reproduction is NOT
a passing remediation. The third test is now a desired-behavior regression for
the corrected refund reason. Dependency migration is not complete, and neither
the signing isolation probe nor a low-severity CI threshold removes the advisory.

Follow-up evidence: compilation, 305 Hardhat cases, 145 local Claim matrix cases,
signing isolation and integration drift checks passed. The Hardhat total includes
the two still-open SR-01 reproductions. Slither exited 0 under `--fail-medium`
with 45 timestamp/naming results across 67 analyzed contracts. Fresh npm audit
still reports 15 low entries, zero moderate/high/critical, and exits 1. Foundry
was not rerun in this partial remediation; its earlier results above apply only
to the reviewed baseline, not a newly certified release candidate.

## Subsequent requested fixes — single release/refund consent and refund reason

The preceding partial-remediation status is historical. Current source now adds
signed `issuedAt` to release/refund schemas and their ABI entry points. Execution
checks the signed interval's duration (at most one day), not only the time
remaining. Tests now assert that an overlong signed interval fails both today
and a year later, with unchanged balances/nonces; changing issuedAt cannot repair
the old signature. Normal release/refund and inclusive expiry still work. The
focused suite passed 40 cases and full Hardhat suite passed 312 cases.

The event reasons now match the requested wording: `Inspection expired without
acceptance` after recorded delivery; `Delivery deadline expired` otherwise.

This remediates the two dynamically reproduced release/refund cases and SR-02
on new deployments. It does NOT certify actual off-chain signature creation age:
a signer can intentionally declare a future bounded interval. Signing clients
must use a current chain timestamp. Single bilateral settlement and milestone
settlement/replacement are outside this narrow ABI migration and retain their
original expiry semantics. SR-01's broader sibling-path review is not closed.
SR-04 remains open. Existing immutable vaults are not patched by source changes;
retain their original adapters. See `integration/README.md` section 10.

Additional validation: 145 local Claim matrix cases and all 37 Foundry tests
across nine suites passed (512 fuzz runs; 256 invariant runs at depth 50).
The new interval fuzz test initially used an optimizer-sensitive timestamp read
across `vm.warp`; after replacing that fixture read with `vm.getBlockTimestamp`,
the same signed calldata stayed invalid at its original expiry as intended.
No production check was weakened. This is local execution evidence, not public
testnet/production deployment or an independent audit certification.

Final clean Hardhat compilation and rerun passed (39 compiled files; 312 tests).
Static analysis passed the unchanged medium/high gate after refreshing the
existing exact-ID triage of the unchanged enum-state equality guard. There are
39 remaining timestamp/naming results across 40 contracts / 101 detectors; this
is not a finding-free audit. The initial incremental build contained mixed old
artifacts; the reported final result uses clean current-source artifacts.
