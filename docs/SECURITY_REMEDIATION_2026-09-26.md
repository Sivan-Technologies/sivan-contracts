# Security remediation: 2026-09-26

Scope: the local `sivan-contracts` working tree on `staging`, based on `ed8714c`.
No commit, push, deployment, remote account change or live fund movement was made.
This is remediation with local regression evidence, **not production clearance**.
The [original review](SECURITY_REVIEW_2026-09-26.md) is historical evidence.

## Fixes

### R1: agreement-ID interference — fixed for new deployments

IDs now contain the buyer's 20-byte address followed by a unique 12-byte nonce.
Both proposal and deposit enforce the buyer namespace before accepting the ID.
Another wallet cannot occupy the ID, including after the intended contractor's
acceptance. Same nonce, different buyers produces different IDs.

`deriveAgreementId(buyer, nonce)` is in the contract/interface;
`scripts/helpers/agreement-id.js` provides matching client derivation. Lifecycle
scripts and all JS/Foundry fixtures use it. New-funding lifecycle preflight checks
this capability before approval/funding; old-vault refund recovery is unchanged.

**Integration change:** raw hash/UUID IDs are no longer accepted for new funding
against this source. Persist a fresh nonce/ID per buyer, and identify orders by
chain, vault and ID while checking both parties. Existing immutable deployments
cannot acquire this fix; clients must explicitly target a newly reviewed vault.
Do not change addresses for users with funded agreements on an older vault.

### R2: attester signing capability — fixed in the remote deployment runner

Preflight requires an EIP-191 signature over a separate deployment-control
challenge, binding chain, deployer, role addresses, agent ID, release version,
token metadata, creation-bytecode hash and an expiry within 24 hours.

Missing/wrong/expired/altered proofs are refused. Contract-code attester addresses
are refused because delivered release currently uses ECDSA rather than ERC-1271.
The proof is checked again immediately before journaling deployment intent and
broadcasting. Its distinct purpose cannot authorize a vault payout.

The attester signs through its protected signer; its private key is not copied
onto the deployment host. See [setup instructions](EVM_TOOLING.md).
This establishes current key control, not reviewer independence, future signer
availability or trust in off-chain judgments. Owner-authorized later attester
rotation still requires protected operational controls.

### R3: missing fork CI configuration — fixed in workflow

The fork job explicitly passes its local transaction endpoint to Hardhat and
validates that it is loopback-only. The read-only fork source is separate.
Missing settings fail with an actionable message rather than silently skipping.
RPC startup logs are withheld because they can contain endpoint credentials.

Repository administrators must configure:

- Variable `CELO_FORK_RPC_URL`: the runner's HTTP loopback endpoint, host
  `127.0.0.1`, port `8545`, root path, no credentials/query/fragment.
- Secret `CELO_FORK_SOURCE_RPC_URL`: an authorized Celo fork-source RPC endpoint.

No runtime RPC URL or API key was embedded in the workflow. Fork PRs without
access to the source secret will fail this required configuration check; use a
trusted branch run to obtain fork evidence. Do not expose secrets to untrusted PRs.
Workflow YAML and regression guards were checked locally. GitHub Actions and the
remote-source fork job have **not** been executed during this remediation.

### R4: dependencies and CI supply chain — hardened; low advisory remains

- Replaced the toolbox aggregate with pinned, actually used Hardhat plugins.
- Pinned direct dependencies and regenerated the lockfile; a clean
  `npm ci --ignore-scripts` succeeded.
- Patched transitive archive, HTTP, serialization, temporary-file, UUID, cookie,
  diff and lodash dependencies using explicit overrides. These cross some
  upstream dependency ranges, so they have compatibility tests and must be
  reconsidered when changing Hardhat. No forced major framework update was used.
- All workflow actions use full commit SHAs verified against their official
  repositories. Foundry is pinned to `v1.7.1` and forge-std to
  `77041d2ce690e692d6e03cc812b57d1ddaa4d505`.
- Workflow token permissions are read-only; dependency lifecycle scripts are
  disabled. CI rejects moderate-or-higher npm advisories.

Final npm advisory gate: **0 critical, 0 high, 0 moderate, 15 low affected package
entries**, inherited from `elliptic` through the Hardhat 2 dependency graph.
The upstream latest queried release, `elliptic@6.6.1`, is still affected by
[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84).
This is one underlying advisory with inherited entries, not 15 Solidity flaws.
It is **not fixed or suppressed**. Removing it requires a separately reviewed
Hardhat/toolchain migration or an upstream patch; blind major-version overrides
of cryptographic internals are not an acceptable substitute. Do not claim a
zero-advisory or fully audited release.

## Verification

- Full Hardhat suite after the clean install: **171 passed, 0 failed**.
  The HTTP compatibility test required loopback-listening permission; the first
  sandboxed run refused the bind, and the permitted rerun passed all tests.
- Foundry: **25 passed, 0 failed/skipped**. Eight fuzz tests ran 2,048 cases each;
  seven invariants ran 512 sequences of depth 100. Handler calls are not all
  successful transactions. Seed:
  `0x0000000000000000000000000000000000000000000000000000000020260926`.
- Local EVM end-to-end scenarios still cover deploy/journal/seed/readback/fund,
  delivered release, ordinary refund, primary ruling, independent ruling and
  bilateral settlement with balance conservation and replay rejection.
- New regressions cover buyer-ID interference, proof absence/tampering/expiry,
  non-signing attesters and zero broadcasts on refusal, protected local fork
  endpoint selection, action pins, and patched dependency API compatibility.
- Solidity 0.8.24, Cancun, optimizer 200, via-IR: runtime **20,837 bytes**,
  below the 24,576-byte limit.
- Naming guard and `git diff --check` passed. New helpers are not ignored by Git.
- Slither was not installed locally; no new static-analysis pass is claimed.

The remaining production gates are the low toolchain advisory, actual CI/static
analysis, per-chain testnet lifecycle and RPC/source-verification evidence,
frontend/backend integration of the new ID scheme, and independent security
review. Mainnets remain disabled. Arbitration still intentionally stays disputed
if the independent reviewer never acts and parties cannot agree; this policy
has not been silently replaced with an automatic payout.
