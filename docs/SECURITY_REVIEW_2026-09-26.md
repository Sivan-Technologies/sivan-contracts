# Sivan contracts: local end-to-end and security review

Date: 2026-09-26. Verdict: **NOT cleared for production**.

Historical pre-remediation findings below are retained as evidence. For current
fixes, regression coverage and remaining gates, see
[the remediation report](SECURITY_REMEDIATION_2026-09-26.md).

Scope: `sivan-contracts`, baseline `ed8714c` plus the uncommitted EVM tooling and
documentation in this working tree. This is an internal, scoped code/security
review, not an independent audit certificate, formal verification or complete
frontend/backend/remote-chain validation. No production Solidity or deployment
code was changed during this review. Two test files and this report were added.

## Results and evidence

- Full Hardhat run: **161 passing**, zero failures. This includes five new positive
  deployment-to-settlement scenarios and **three passing issue reproductions**.
  Those three deliberately confirm limitations; they are not fixes or safety claims.
- Foundry: **25 passing**, zero failed/skipped. Eight fuzz tests used 2,048 cases
  each; seven invariants used 512 runs × 100 handler calls each. Seed:
  `0x0000000000000000000000000000000000000000000000000000000020260926`.
  Handler invocations are not distinct successful settlements or remote transactions.
- New positive local scenarios: deploy/journal/seed/readback/fund followed by
  delivered release, deadline refund, primary ruling, independent ruling after
  escalation, and signed bilateral split. Balance conservation and replay rejection
  are asserted. The independent path also changes the global collector to the
  reviewer and verifies the existing case still pays its original collector.
- Existing tests cover unauthorized access, stale acceptance, signature domains,
  reentrancy, atomic rollback, fee recipient conflicts and timeout/refund protections.
- Runtime bytecode: 20,503 bytes, below the 24,576-byte limit checked by tooling.
- Dependency advisory query succeeded: npm reported 46 affected dependency entries
  (17 high, 10 moderate, 19 low, zero critical). These counts include transitive
  inheritance; they are not 46 independently demonstrated exploitable defects.
- Pattern-based redacted scan of 55 tracked/non-ignored working-tree files found
  no matching private-key assignments, credential markers or PEM private keys.
  A history filename check found no tracked `.env`, `.pem` or `.key` additions.
  This was not exhaustive Git-blob entropy analysis and does not prove no secret
  ever existed. Local `.env` values were not printed or uploaded.
- Slither was not available locally; no new Slither result is claimed. Existing
  CI configuration is not evidence that static analysis passed on this worktree.

## Confirmed findings

### R1 — Medium: accepted agreement IDs can be occupied by another pair

Location: `contracts/SivanAgreementVault.sol:545` and the buyer-scoped proposal
mapping versus globally scoped `agreements[agreementId]`.

Reproduction: buyer and contractor accept terms for an ID. Before their deposit,
an attacker and accomplice accept their own terms and deposit one token base unit
under that same ID. The legitimate deposit reverts with `Agreement already exists`.
The legitimate buyer retains their funds; no theft is demonstrated. The attack
requires observing/knowing the ID and winning transaction ordering, then paying
gas for the attacker's own acceptance/funding flow. Once accepted terms are public,
random IDs alone do not remove this opportunity.

Impact: targeted funding denial of service and a risk of incorrect off-chain
association if applications trust only the ID instead of also validating parties.

Recommendation: for a future deployment, enforce a buyer-bound ID derivation
(buyer plus a client nonce) or use buyer-scoped agreement storage with corresponding
signature/API changes. Do not simply reserve arbitrary IDs at proposal time, which
would move the squatting opportunity earlier. Clients must validate parties,
chain and vault in all cases. This needs a coordinated compatibility decision.

Test: `security-review-2026-09-26.test.js`, globally shared ID reproduction.
Confidence: locally reproduced, 10/10. Status: open.

### R2 — Medium: preflight does not prove attester signing capability

Location: `scripts/helpers/evm-deployment.js:17` and `:46`; delivered release uses
ECDSA recovery in `contracts/SivanAgreementVault.sol:819`.

Reproduction: use the local ERC-20 contract address as `AGENT_ATTESTER`. Configuration,
preflight, deployment and role readback all pass. After delivery, a validly encoded
attestation signed by an available EOA cannot satisfy the configured token-contract
address. Correcting the attester to that EOA makes the identical signature work.
The local token has no signing capability; merely reading its address back proves
configuration, not control or ability to attest.

Impact: the delivered happy path can be unavailable after an apparently successful
deployment. This is not proven theft or permanent lock: authorized attester rotation,
eligible refunds and dispute mechanisms remain available under their rules.

Recommendation: require evidence of control from the intended signer over a
deployment-specific challenge and validate it against the contract's actual ECDSA
requirements. Do not require production attester secrets on the deployer machine;
use the protected signing service. If contract-wallet attesters are desired, plan
and audit explicit signature-checker support rather than assuming it exists.

Test: `security-review-2026-09-26.test.js`, non-signing attester with positive control.
Confidence: locally reproduced, 10/10. Status: open.

### R3 — Medium: the existing fork CI job is incompatible with the new config

Location: `hardhat.config.cjs:21` and `.github/workflows/ci.yml:138`.

The configuration creates `celofork` only when `CELO_FORK_RPC_URL` is supplied.
The committed workflow still invokes `--network celofork` without supplying it.
On a clean runner, that profile is absent. This was verified through configuration
and workflow assertions; GitHub Actions itself was not remotely executed.

Impact: the fork verification job cannot provide its promised deployment/allowlist
coverage until the workflow is migrated. Local unit success does not resolve this.
The workflow also retains a hardcoded public fork RPC, contrary to the new settings
policy, and obsolete comments describing uninitialized vaults as permissive.

Recommendation: explicitly configure fork endpoints from the appropriate CI
settings, retain fork-only controls, and add coverage for the actual new runner.
Test the complete workflow on a clean runner before treating CI as a release gate.

Test: `security-review-2026-09-26.test.js`, missing fork profile reproduction.
Confidence: configuration mismatch confirmed, 9/10. Status: open.

### R4 — Dependency/CI hardening gate: known advisories and mutable tools

`npm audit --json` returned the counts above. Installed versions include Hardhat
2.29.1, ethers 6.17.0 and OpenZeppelin contracts 5.6.1. npm's high-severity entries
include development-tool dependency chains; impact on the actual signing/build
process requires reachability analysis. No token theft or signing-key compromise
was reproduced. Do not label all transitives as independent on-chain vulnerabilities.

The workflow uses mutable action tags, Foundry `stable`, and an unpinned
`forge install foundry-rs/forge-std --no-git`. It has no explicit workflow token
permissions block. Repository/organization defaults and branch protections were
not inspected. npm's lockfile exists; three packages have install scripts
(`fsevents`, `keccak`, `secp256k1`), which is an execution surface, not proof of malware.

Recommendation: triage advisory reachability, update compatible dependencies in a
separate reviewed change, pin action/tool revisions, set minimum CI permissions
and run the full suite after changes. Do not blindly use `npm audit fix --force`.
The npm audit is confirmed; exploitability within this application is unverified.

References: [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[one reported Undici advisory](https://github.com/advisories/GHSA-vxpw-j846-p89q).

## Trust model and residual operational risks

| Surface | Existing protection | Residual risk / gate |
| --- | --- | --- |
| Buyer/contractor signatures | Domain, expiry, nonce and agreed terms checks | Wallet compromise and off-chain deal quality are not established by a signature. |
| Reviewers | Fixed case reviewers, timed authority handover, fee-conflict checks | Unfair rulings or indefinite independent-reviewer inactivity remain possible. |
| Administration | Owner access control; existing fee destination snapshots | Current attester and token/fee settings still have explicit administrative powers; immutable is not ownerless. |
| RPC / deployment | Chain ID checks, HTTPS, confirmation, journal, readback | A malicious RPC can lie; no independent multi-provider comparison or remote validation performed. |
| Token allowlist | Explicit address/code/metadata checks | Symbol/decimals do not establish issuer authenticity; token upgrade, blacklist or pause risks remain. |
| Journal | Exclusive record creation, atomic replacement, transaction intents | Not a distributed lock or power-loss durability guarantee; back up records and avoid concurrent nonce use. |
| Build supply chain | npm lockfile, local tests | Advisory triage, immutable CI pins and independent release review outstanding. |

Data classification: private keys and credential-bearing URLs are secrets; public
wallet/transaction addresses are operational records. Source, ABI and hashes are
release evidence. There is no HTTP server, user database, inbound webhook or LLM
runtime in this repository; those surfaces belong to separate integration audits.
The security skill's telemetry and unrelated global skill scans were not run.

## End-to-end coverage boundary

Verified here: local Solidity execution and the deployment helper through the
settlement paths described above, using explicit local test tokens and simulated
time. No remote-chain transactions, token approvals, production accounts, wallet
movements or deployments were performed. No production credentials were printed.

Not verified: real Celo/Base/Arbitrum deployment, frontend wallet UX, backend
signing/indexing, production infrastructure, explorer source verification, network
finality/reorg recovery, reviewer availability, or additional chain compatibility.
The CLI's remote HTTPS-to-signer path was not exercised end to end. Local helper
tests must not be presented as that result.

Current network-prefixed preflight settings are incomplete. Celo Sepolia lacks
deployer public address, role/agent/version/token metadata settings; Base and
Arbitrum additionally lack their RPC settings. Existing legacy variables are not
implicitly copied into the new names. Stop before remote writes until these are
reviewed, signing control is established and a testnet run is explicitly approved.

## Reproduce locally

```sh
npm test -- --network hardhat
npx hardhat test --network hardhat test/security-review-2026-09-26.test.js
npm audit --json

FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=100 \
DYLD_LIBRARY_PATH="$PWD/lib/foundry-tooling/libusb/1.0.30/lib" \
  lib/foundry-tooling/package/bin/forge test \
  --use "$PWD/lib/foundry-tooling/solc-0.8.24" \
  --offline --cache-path cache_forge --fuzz-runs 2048 \
  --fuzz-seed 0x0000000000000000000000000000000000000000000000000000000020260926 \
  --summary
```

Foundry paths above are machine-local tooling, not installed by this report.
The optional missing signature-cache warning did not prevent successful execution.
The issue reproductions should become rejection regressions after remediation;
passing them in their present form must never be interpreted as clearing findings.

## Recommended order

1. Repair CI integration and pin the security-critical build inputs.
2. Add attester proof-of-control preflight and resolve buyer-bound agreement IDs.
3. Triage dependency advisories and rerun tests/static analysis on the reviewed revision.
4. Complete candidate environment settings and run explicitly authorized testnet
   deployment plus real application integration tests.
5. Obtain independent contract review before enabling any mainnet profile.

No production-readiness percentage is assigned: the remaining gates are substantive,
and passing local tests is not a substitute for them.
