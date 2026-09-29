# Release-candidate adversarial review: c907f20

Historical baseline report: the subsequent overdue-review fix restricts initiation
to project parties. See [the remediation note](MILESTONE_OVERDUE_REVIEW_REMEDIATION.md).
The original findings below describe c907f20, not the changed working tree.

Date: 2026-09-29

## Independence and release decision

This is a second internal adversarial review, not an independent third-party
audit. The reviewing assistant participated in implementation. Re-running tools,
adding tests, or adopting an auditor's checklist does not remove that conflict.
The independent-audit release gate remains OPEN and needs a separate qualified
reviewer who did not implement this code.

No new critical/high-severity exploit has been confirmed in the paths examined.
That is not proof that none exists. Production approval is WITHHELD pending the
release gates below; no certificate or percentage safety score is issued.

## Fixed scope

Repository: Sivan-Technologies/sivan-contracts, staging.
Candidate commit: `c907f20009988adc207d40a1fe1ac38b728c54b0`.

Primary scope:

- `SivanAgreementVault.sol` and its interface: terms, funding, delivery, ordinary
  and delegated release, refund consent, disputes, fee routing and owner controls.
- `SivanMilestoneVault.sol`: allocation accounting, independent milestone exits,
  funding-only pause, arbitration and bilateral reviewer replacement.
- EIP-712 / ERC-1271 boundaries, nonce use, expiry and terminal-state checks.
- Deployment/environment/multisig-checking helpers and CI configuration.
- Existing test suites, new adversarial scenarios and dependency advisories.

No implementation files were changed for this review. Supplemental tests and this
report are working-tree review artifacts, not modifications to the frozen candidate.
No commit, push, deployment or live fund movement was performed.

Candidate source SHA-256 fingerprints:

| File | SHA-256 |
| --- | --- |
| `contracts/SivanAgreementVault.sol` | `7fd4426c1fa359bbcc3a19f785667dec6b35668d89679800aa13372abb164510` |
| `contracts/SivanMilestoneVault.sol` | `3e79542f921400addab6fcf2bb03cc4675f66e4bca24f0b1346784912bd946fa` |
| `package-lock.json` | `9b09c419211fd262624f0b684ce01aeebd2747eb957aea5854190d39fe3d5604` |

## Threat model

Considered adversaries include dishonest buyers/contractors, unrelated relayers,
signature replay/tampering, reentrant or reverting token callbacks and unauthorized
attempts to pause, adjudicate or replace reviewers. Reviewer compromise and issuer
controls are distinguished from unauthorized contract-level access.

Reviewers can make unfair authorized rulings; the contract cannot establish the
truth of off-chain work. Accepted token behavior, reviewed multisig implementations,
secure keys and accurate client signing prompts remain trusted boundaries. This
review does not establish their production configuration.

## Findings and observations

### RC-L01: Outsiders can force overdue milestone arbitration

Severity: Low process-disruption/griefing risk. Status: reproduced, not changed.
Location: `contracts/SivanMilestoneVault.sol:259`.

After the delivery-review window expires, any caller can execute
`requestOverdueReview`. This changes Delivered to Disputed and makes ordinary
buyer `releaseMilestone` fail. An outsider can submit this before a late buyer's
release and require arbitration or a fresh bilateral settlement instead.

The new test reproduces the state change and failed ordinary release, then proves
the outsider cannot rule, receives no tokens, and cannot withdraw escrow. An
authorized primary ruling still settles normally. This is therefore not an
unauthorized fund-transfer finding. It can impose delay and operational work.

Recommendation: explicitly accept and disclose permissionless keeper escalation,
or restrict initiation to parties/authorized keepers. Preserve a workable exit
for an honest contractor when the buyer does not respond. Do not implement an
automatic payout merely to avoid this process risk. No policy change is made here.

### RC-O01: Current deployment-on-fork CI evidence is missing

Classification: release-blocking verification gap, not a Solidity vulnerability.

For the exact candidate, GitHub run
[36595649113](https://github.com/Sivan-Technologies/sivan-contracts/actions/runs/36595649113)
reports:

| Job | Result |
| --- | --- |
| Hardhat unit tests | Passed |
| Fuzz and invariants | Passed |
| Static analysis | Passed |
| USDm naming guard | Passed |
| Deploy script against a Celo fork | Failed before deployment |

The failed step is `Start a Celo mainnet fork`. The actual error requires the
repository Actions secret `CELO_FORK_SOURCE_RPC_URL`. The local-runner URL variable
is not the reported missing setting. No inference of a contract failure is drawn.

Recommendation: an authorized operator supplies the read-only, fork-capable RPC
endpoint through GitHub Actions secrets and reruns the job. Do not paste it into
source or chat, and do not replace the local fork destination with a live network.
No secret or GitHub setting was changed during this review.

### RC-O02: Recovery and authority remain conditional

- Milestone reviewer replacement requires both parties after the agreed wait.
  With an unavailable reviewer and a noncooperating party, a dispute may remain
  unresolved indefinitely. The single-job vault has no corresponding replacement
  mechanism. This is an acknowledged policy limitation, not a newly found bypass.
- The single-job owner can pause ordinary release and rotate the live agent
  attester. The milestone funding admin cannot pause existing exits. Interfaces
  and incident procedures must not present those controls as identical.
- Address separation does not prove independent people or keys. Actual Safe
  implementation, owners, threshold, modules and fallback configuration must be
  separately verified and monitored after preflight.
- Issuer blacklisting, token upgrades or nonstandard outbound transfer behavior
  are not solved by SafeERC20. Supported-token identity and behavior must be
  reviewed on each intended chain.

### RC-O03: Signing and integration requirements need deployment-specific proof

The new refund-consent schema is expiry-bearing and has a separate nonce. Old
relayed refund signatures are intentionally rejected. The new ABI, signing
builder, cancellation confirmation and contract address must be used together.
These source fixes do not modify existing immutable deployments.

An expiry range is checked at execution, not the unknowable time an offline
signature was created. Clients must choose short expiries from current chain time
and must not describe future-dated signatures as automatically expiring one day
after signing. Cancellation only takes effect when mined; it cannot undo a refund
that executes first. The current remediation notes disclose these semantics.

No deployed frontend/backend signing flow or real production Safe was exercised.
Test wallets demonstrate API behavior, not production custody assurance.

## Remediation recheck

The original three findings were rechecked against the candidate:

| Original issue | Current result |
| --- | --- |
| Buyer self-delivery shortens refund protection | Contractor-only delivery; rejection and deadline preservation tests pass |
| Permanent legacy contractor refund signature | Legacy relay rejected; expiry, dedicated nonce, cancellation and lifecycle invalidation tested |
| `undici@6.28.0` moderate advisory | Lockfile and installed dependency use 6.28.1; fresh scan has no moderate/high/critical advisory |

The existing consent tests also exercise ERC-1271, wrong signer/agreement/nonce/
chain/vault, expiry boundary, replay, invalidation, failed-transfer rollback and
reentrant callbacks. Passing these tests is not formal verification of all inputs.

## Additional adversarial evidence

`test/release-candidate-adversarial.test.js` contains two supplemental tests:

1. Outsider-forced overdue arbitration, with rejection of outsider adjudication
   and no outsider payout.
2. Three simultaneously funded projects sharing a token, while funding is paused:
   one receives a bilateral reviewer replacement and ruling; one receives an
   undelivered refund; one closes through signed bilateral settlement. A recovery
   signature for the first project is rejected on the third. The old reviewer
   loses authority only on the replaced case.

The second test checks liabilities, remaining project allocations and actual
vault balance after every settlement. Of 450 test USDC, the buyer receives 175,
the contractor 272.25 and the treasury 2.75. The vault ends at zero liability and
balance; the unrelated caller receives zero. No cross-project leakage or double
settlement occurred in this tested sequence.

## Tool results

- Existing candidate Hardhat suite: 251 passed.
- Supplemental adversarial tests: 2 passed, separately from the candidate suite.
- Final combined Hardhat rerun: all 253 tests passed together.
- Fresh Slither run: medium/high gate passed with the repository's documented
  exact triage; 37 low/informational results remain. No new suppression was added.
- Fresh npm audit: 0 critical, 0 high, 0 moderate, 15 low advisories. Low findings
  still require assessment; a zero-total-vulnerabilities claim would be incorrect.
- Expanded Foundry campaign: 31 passed, 0 failed, 0 skipped. The 13 fuzz tests
  used 4,096 cases each; eight invariants used 1,024 runs at depth 150. The
  milestone handler made 153,600 calls, including 120,321 rejected invalid
  transitions; these are not 153,600 successful payouts. No invariant failure
  was reported by this campaign.

Temporary evidence: `/tmp/candidate-audit-hardhat.log`,
`/tmp/candidate-audit-final-hardhat.log`,
`/tmp/candidate-audit-foundry.log`, `/tmp/candidate-audit-slither.log`, and
`/tmp/candidate-audit-dependencies.json`. Temporary logs are not durable audit
artifacts; archive reviewed, nonsecret evidence for a formal release.

## Limitations

No independent assessor participated. There was no formal proof, production
penetration test, historical secret audit, live chain deployment, actual Safe
signing exercise or issuer-controlled-token failure simulation on a live fork.
Backend, frontend, Vera, cloud permissions and key custody are outside this
contract-repository review. Tracked environment filenames were checked and only
example templates were listed; that is not proof that secrets never entered Git.

The invariant handlers cover bounded action sets. More random calls do not add
missing actions to a handler. The additional cross-project test addresses one
combination, not an exhaustive proof over all recovery/settlement interleavings.

## External audit handoff and release gates

Give an independent reviewer:

1. The exact candidate SHA and source/lockfile fingerprints above; freeze the
   implementation while they review, or disclose and separately review changes.
2. Both vaults, their interfaces, deployment/signing helpers and tests. Include
   these findings, the prior remediation report and exact Slither triage.
3. The accepted business policies: delivery versus acceptance, single-job versus
   milestone refunds, fees on partial settlement, arbitration authority,
   deadlines, reviewer replacement and permissionless escalation.
4. Public intended deployment/role/token addresses and verified Safe versions,
   but NEVER private keys, seed phrases or production credentials.
5. CI and local test evidence, a proposed threat model, and explicit requests to
   independently examine cross-project solvency, signing/replay, privileged-role
   changes, token assumptions and recovery availability.

Before production: resolve or explicitly accept the process-risk observation;
obtain a successful fork job; complete a fresh verified testnet deployment using
the actual intended wallet configuration and application; establish monitoring
and incident operations; and obtain an independent report plus remediation retest.
This internal report does not close those gates.
