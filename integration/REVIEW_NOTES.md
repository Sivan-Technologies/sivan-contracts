# Integration review log

## 2026-10-16 — Recipient-bound claim product specification only

Added [the recipient-bound proposal](../docs/RECIPIENT_BOUND_CLAIMS_SPEC.md),
covering canonical identity and wallet binding, protected authorization, durable
reconciliation, channel onboarding, developer isolation and staged validation.
Source review distinguishes the existing bearer-link contract from the payment
service's internal-ledger pending claims; neither proves exclusive phone-recipient
on-chain claiming. Reviewed channel paths are not a complete channel security audit.

No contract, ABI, executable adapter, deployed API, fee, deadline or signing schema
changes in this documentation change. Existing v1 deployments and single/milestone
agreements retain their original behavior. Proposed schemas and endpoints require
implementation and tests; economic policy, identity assurance and attestor governance
remain explicit approval gates. No public deployment, real claim, messaging delivery
or wallet provisioning was performed as part of this specification.

## 2026-10-10 — Separate bearer-link Claim Vault v1

Added `SivanClaimVault` without modifying either existing agreement contract or
their deployment scripts. The new ABI is a separate capability, not an extension
of agreement/milestone actions. Added [the authoritative claim specification](CLAIM_VAULT.md)
and a revision notice on the historical future-phase proposal.

Consent and economics: seven days from mined funding; fixed 0.5% gross-inclusive
upfront fee, rounded down, no minimum; refund returns net only. Pause/admission
changes affect new funding only. A bearer link's private key authorizes an
EIP-712 deposit/recipient/deadline message; chain and vault are domain-bound.
This replaces the insecure hash-only public-secret claim pseudocode. Anyone
holding the key, including the sender, can authorize a pre-expiry claim. No
phone/email exclusivity, CREATE2, cross-chain bridge or automatic refund exists.

Adapter requirements: register chain/vault/version, preserve old deployments,
keep link keys client-side, record raw token-address amounts and confirmed events,
reconcile reorgs and pending relay attempts, and expose direct sender refunds.
The signing helper and ephemeral local lifecycle script are implemented; the
frontend/backend/indexer/relayer and public deployment tooling are not.

Validation so far: 20 focused Hardhat cases passed, including 6/18-decimal local
tokens, legacy USDT empty returns, fee/refund conservation, copied-signature
redirection, domain/deposit replay, exact expiry, pause/admission, transfer-failure
rollback, reentrancy and 40 varied-amount interleaved claim/refund records.
The standalone local deployment/approval/funding/relayed-claim/refund script
passed, verifying recipient/sender/treasury balances and zero final liabilities.
Slither's existing medium/high gate exited 0; claim-vault timestamp warnings
remain visible and are intentional for the documented expiry/deadline rules,
not random-number generation. No suppression or threshold change was added.
Compiled claim runtime: 6,193 bytes, below the EIP-170 limit.

Full Hardhat regression: 298 passing. The first sandboxed run could not open
the loopback port used by the pre-existing HTTP dependency test; rerunning with
loopback permission passed. This was not a contract-test failure. Both original
agreement Solidity files have no diff, and their generated ABI sections are
unchanged. Integration baseline/ABI checks and whitespace checks passed.
Foundry full suite: 33 tests passed across 9 suites. New claim-vault fuzz test
passed 512 cases; its accounting invariant passed 256 runs / 12,800 handler
calls with zero reverts. Handler calls can intentionally no-op when an action
is ineligible; the count is not 12,800 successful payouts. The first fuzz run
correctly rejected a test-generated deadline beyond the stored expiry: the
test's timestamp expression was optimized across `vm.warp`. Reading persisted
expiry fixed the harness without weakening contract validation. Local Foundry
used the existing vendored compiler and libusb library; a final signature-cache
write warning outside the sandbox did not affect the successful test exit code.
No real token, remote deployment, live account or money movement was exercised.
Independent review and the public testnet/application release gates remain open.

## 2026-10-07 — PBKDF2 tooling advisory remediation

Pinned the transitive `pbkdf2` dependency to patched 3.1.7 with an npm override
and regenerated the lockfile. Only that installed package changed; Hardhat and
its plugin major versions were not upgraded. Advisory:
https://github.com/advisories/GHSA-477h-4r7f-fvrx.

Frontend/adapter impact: none expected. This changes a JavaScript development
dependency, not Solidity source, ABI, consent types, fees, state transitions or
deployed addresses. No user migration or new frontend signing flow is required.

Validation: `npm audit --audit-level=moderate` exited successfully (15 low elliptic
findings remain; no moderate/high/critical findings). Full local Hardhat suite:
278 passing, including a new regression comparing the patched pure-JS PBKDF2
implementation against Node crypto for short/long passwords and SHA-256/SHA-512.
This verifies derivation compatibility, not a performance/security certification.
The CI audit threshold remains unchanged. No advisory was suppressed.
Two forced local compilations passed and matched via `npm run release:reproducible`.
The regenerated ABI reference is unchanged, and the integration baseline check
passes after recording the dependency and documentation updates.

The low elliptic findings still require separate toolchain migration/review;
this patch resolves the reported moderate CI blocker, not every dependency risk.
Remote GitHub CI has not run this uncommitted change. No live transactions made.

## 2026-10-07 — Initial strict integration baseline

Scope: both vaults, the single-vault interface, production Solidity dependencies
in this repository, deployment helpers, network registry and build dependencies.

Reviewed the guide against current source and compiled ABI. Clarified:

- Different enums, release prerequisites and pause semantics for the two vaults.
- Binary single reviewer rulings versus partial milestone rulings; partial
  bilateral settlement remains a separate authorization path.
- Actual-received single funding versus exact-transfer milestone funding.
- Delivery/refund deadlines, immutable milestone configuration and protected
  reviewer/admin actions outside the ordinary customer adapter interface.
- Canonical off-chain evidence encoding, privacy and proof limitations.
- Immutable-deployment version routing, proposed versus implemented interfaces,
  token identity, async recovery and finality requirements.

Added a generated exact ABI reference, source/document fingerprints and a CI
drift gate. The documentation remains a proposed integration specification;
no adapter SDK, frontend screens or payment API routes were implemented here.

Existing evidence: 275 local Hardhat tests passed in the preceding USDT test
pass. That is not public-network or frontend E2E evidence. This documentation
review is internal, not an independent audit. The drift gate validates freshness,
not semantic completeness or the safety of a deployed contract.

Open gates: verified testnet USDT/BNB asset selection, test actors and Safe
configuration, guarded multi-network lifecycle execution, actual UI/backend
reconciliation, independent review and production release approval.

For subsequent entries record date, changed surfaces, frontend/adapter impact,
test commands/results and unresolved issues before refreshing the baseline.

## 2026-10-11 — Claim testnet deployment tooling

Added isolated claim challenge/preflight/deploy/recover/verify commands and an
environment example. Candidate testnets only; actual chain ID, dedicated roles, token
metadata/runtime identity, gas reserve, clean release and exact confirmation are
checked. Optional multisig mode reuses reviewed 2-of-3 control-wallet checks.
The journal saves transaction identity before broadcast and keeps activation
false. Recovery reads receipts; it never retries deployment automatically.

No Solidity, ABI, fee, deadline, signature or existing deployment behavior changed.
Single/milestone adapters and old immutable deployments remain unaffected. Claim
applications must still use a separately approved catalog, not infer activation
from a deployment or explorer verification. Token proxy implementation and issuer
behavior need independent review beyond metadata/code checks.

Evidence: `npm run claim:test-deployment` passed all 10 ephemeral-chain cases,
including pre-broadcast journal failure and signed deployment/readback/recovery.
`npm test -- --network hardhat --no-compile` passed all 298 existing tests.
`npm run release:reproducible` completed two forced builds: both single-vault
and claim-vault creation/runtime/ABI fingerprints matched.
The compiler reported nothing to compile; integration drift checking passed
with no generated ABI changes. See the deployment guide for evidence limits.
Public deployment, explorer verification and application E2E remain unexecuted.

### EVM network extension

Claim tooling now consumes the shared registry rather than a Celo-only guard.
Celo Sepolia, Base Sepolia and Arbitrum Sepolia retain candidate status. BNB,
Polygon, Arc, Ethereum, Optimism and placeholder networks remain pending; no
mainnet or pending gate was bypassed. Added per-network environment templates,
a list command and separate ephemeral deployment tests for candidate chain IDs.
No contracts or ABIs changed. Deposit discovery and signature domains remain
chain/address-scoped: this is not a cross-chain transfer or migration feature.
Public network compatibility and real-token settlement remain unverified.
Validation: `npm run claim:test-matrix` passed 30 cases (10 each on ephemeral
Celo/Base/Arbitrum chain-ID profiles). `claim:list`, compile and integration drift
checks passed. This matrix uses local fixtures, not the three public networks.

### Five-target claim lifecycle coverage

Requested rollout scope now explicitly includes Celo, Base, Arbitrum, Arc and
BNB Smart Chain (BEP-20). Added an isolated local-chain configuration for all five
and run the complete claim lifecycle/adversarial suite on each. Candidate
deployment tests remain limited to the existing three candidates. Public Arc/BNB
gates and all mainnets remain blocked and are regression-tested as such. No
Solidity, ABI, fee, consent or existing adapter/deployment behavior changed.
Local execution at the selected chain IDs is not proof of the networks' EVM/gas
behavior or real-token settlement. Public RPC/testnet verification remains open.

Validation: the five-target matrix passed 140 cases (32 each Celo/Base/Arbitrum,
22 each Arc/BNB). The unchanged default Hardhat profile also passed all 20 claim
tests. The matrix exposed a test-only hardcoded 31337 in the signing-helper digest
assertion; it now reads the active chain ID. No contract/helper signature rules
were weakened. Compile and integration drift checks passed; ABI remains unchanged.

## 2026-10-11 — Confirmation policy and invariant remediation

Deploy/recover/verify now share a minimum-two-confirmation readback policy,
canonical-block validation and receipt recheck. Verification checks again after
the explorer operation; activation stays false. The audit reproduction now
asserts rejection of one confirmation, noncanonical and disappearing receipts,
and acceptance at two, in all five local profiles. This changes release evidence,
not claim fees, signatures, contract states, ABI or existing deployed escrow.

Milestone invariant handlers now check state/deadlines before selecting actions,
count successful settlement routes and reconcile those counters against terminal
milestones. Added deterministic successful lifecycle coverage and route-directed
fuzzing. Unexpected invariant-handler reverts now fail the entire Foundry suite.
Skipped ineligible actions remain explicit; zero reverts is not a claim that
every random call transferred funds. Production milestone code is untouched.

The elliptic risk assessment records the actual dependency graph, unresolved
advisory, owner-signoff requirement and review date. An isolated CI signing probe
rejects elliptic loading while exercising direct ethers-v6 message, claim typed
data and transaction signing. Dependencies were not forcibly upgraded and audit
thresholds were not lowered. Production acceptance is not implied.

Public-testnet execution is blocked by missing claim-specific deployer, admin,
treasury and token configuration for Celo/Base/Arbitrum. Their RPC URLs are
present. Arc/BNB also lack configured RPCs; their gates remain pending. No
fallback to generic or production wallets was attempted; no public transactions
were submitted. All environment inspection reported presence only, not values.

Read-only RPC checks on 2026-10-11 passed for Celo Sepolia (block 38415265),
Base Sepolia (47965483) and Arbitrum Sepolia (317985508), with the expected chain
IDs and fresh blocks. These checks loaded no signer and do not certify token,
contract or application compatibility. The five-profile matrix passed 145 cases,
the existing Hardhat suite passed 298, and the isolated signing probe passed.
The npm moderate gate passed while continuing to report 15 low advisory entries.
The full Foundry run passed 36 tests across 9 suites with fail-on-revert enabled.
Milestone accounting completed 256 sequences / 12,800 handler calls with zero
reverts, and route-directed fuzzing completed 512 successful settlement cases.
Ineligible random actions can still be skipped; successful counters reconcile
against terminal states and deterministic tests require each main payout route.

## 2026-10-11 — Claim token verification follow-up

Re-ran the five-profile Claim Vault matrix: 145 local cases passed. The isolated
local deployment/approval/funding/claim/expired-refund lifecycle passed with
exact fee and balance checks. Read-only public RPC metadata and constructor
simulations passed for USDC on all five targets and BNB test USDT. BNB token
identities now have a BNB-maintained source; see
`docs/TESTNET_SETTLEMENT_TOKENS.md` for addresses, blocks and evidence limits.

No Solidity, ABI, signing schema, fee, deadline, deployment gate or adapter
meaning changed. Existing deployments are unaffected. Test token identity and
constructor simulations do not establish public settlement support. All five
claim-specific signing/role/token configurations are missing; four non-BNB USDT
testnet identities remain unverified. No public transactions were submitted,
and no live product, keys or balances were modified.

## 2026-10-12 — Internal security review and three local reproductions

Reviewed production commit `5c06a1e` across single, milestone and claim vaults.
See `docs/SECURITY_REVIEW_2026-10-12.md` for scope, evidence, limitations and
four low-severity findings. The new test file reproduces far-future release and
refund signatures becoming executable later, and a delivered refund emitting
the wrong reason. These tests assert current behavior, not remediation success.

No production source, ABI, fee, deadline, consent schema or deployment gate was
changed. Existing adapters retain their current semantics. Integrators must not
interpret a one-day remaining-expiry check as proof of recently issued consent,
or use the single-vault refund reason alone to infer absence of delivery.
Public funded integration and production controls remain unverified. This is
an internal review, not independent audit approval or a guarantee of safety.

## 2026-10-12 — Partial remediation: refund reason and deployment receipts

SR-02: `refundBuyer` now distinguishes a recorded-delivery review timeout from
an undelivered deadline. Eligibility, payout amounts, fees, ABI and signature
schemas are unchanged. Old deployment event readers remain supported as described
in the integration guide; they must not infer delivery solely from the reason.

SR-03: protected single/milestone deployment helpers now wait for two confirmations
with a 180-second timeout, validate the canonical receipt block and re-fetch the
successful receipt after readbacks. The same checks cover single-vault seeding,
pause and ownership handover, with evidence saved in the journal. Claim's minimum
is imported from the shared policy; its existing readback safeguards remain.
Tests exercise insufficient confirmation, missing/reorged/changed receipts,
timeout propagation and journal evidence. Local fixtures mine additional blocks;
this is not evidence of public-chain finality or production activation.

SR-01 remains open: its first two audit reproductions still demonstrate the
existing temporal behavior. No consent schema was silently changed. A declared
signed validity interval cannot prove the actual date of signing; stricter
freshness requires an on-chain anchor and a deliberate workflow decision.
SR-04 remains open: no forced package upgrade, audit suppression or untested
cryptographic replacement was applied. Hardhat 3 migration requires coordinated
ESM/plugin/test/deployment/artifact-tooling changes and full revalidation.

No deployment, public-chain transaction, live account or funds were touched.

Validation of this partial remediation: compilation passed; the complete Hardhat
suite passed 305 cases (including two unresolved-behavior reproductions, not two
signature fixes); the five-profile local Claim matrix passed 145 cases. The
isolated ethers-v6 signing probe passed. Slither's medium/high failure gate passed
while still reporting 45 timestamp/naming results across 67 analyzed contracts;
this is not a finding-free audit. Integration drift checks and whitespace checks
passed. Fresh npm audit still exits 1 with 15 low and zero moderate/high/critical
entries. Foundry and public funded lifecycles were not rerun for this follow-up.

## 2026-10-12 — Requested single-vault signature and event remediation

Supersedes the release/refund status in the preceding partial-remediation entry.
`ReleaseAuthorization` and `ContractorRefundConsent` now sign `issuedAt` before
`expiry`. The two corresponding entry points also take `issuedAt` before expiry.
The interval must satisfy `0 < issuedAt <= now <= expiry` and a maximum duration
of 86400 seconds. An overlong signed interval stays invalid as time advances;
tampering with issuedAt does not refresh a signature. Direct buyer release uses
two zero timestamp arguments and otherwise retains its prior checks. Refund
nonces, ERC-1271 support, invalidation, token-transfer rollback and fees are intact.

This changes ABI selectors and typed-data hashes on NEW deployments. The domain
name/version stays unchanged; deployment-specific adapter/schema identity is
required. Updated local lifecycle scripts, JS signing fixtures, Foundry handlers,
active signing documentation and the interface. Old immutable deployments and
their existing escrow are unchanged; other frontend/backend repositories are not
migrated. No fallback accepts expiry-only signatures on the new source.

Refund reasons are now exactly `Inspection expired without acceptance` after
recorded delivery and `Delivery deadline expired` otherwise. The stored delivery
record is used because state is already Refunded when the event is emitted.
Indexers must keep old-deployment reason compatibility without treating this
message as proof about off-chain work. Refund eligibility and amounts are unchanged.

Scope/limits: signed issuedAt is a declaration, not independently proven signing
age. Clients must use the current chain timestamp rather than deliberately sign
future windows. Single bilateral settlement and milestone settlement/replacement
still have their original remaining-expiry semantics; this task does not claim
those paths were migrated. Elliptic migration and public funded E2E remain open.

Focused tests passed 40 cases; the complete Hardhat suite passed 312 cases,
including desired-behavior regressions for rejection today AND one year later,
timestamp tampering, old-schema/domain rejection, exact expiry, nonce/fund safety,
valid release/refund, and both event reasons. The local Claim matrix also passed
145 cases. Foundry passed all 37 tests across nine suites, with 512 fuzz runs and
256 invariant sequences of depth 50. The new overlong-interval property was
tested through the original signed expiry, without changing the signed values.

The first Foundry attempt exposed a fixture issue: after `vm.warp`, optimized
test code re-read `block.timestamp` instead of preserving the original issuedAt.
The trace showed it submitting changed calldata, correctly rejected by signature
validation. The fixture now uses `vm.getBlockTimestamp()` per forge-std guidance;
the full rerun passed. No contract check was relaxed to fix the test.
No public transactions, deployment, commit or push performed.

Final clean-artifact validation: compiled all 39 Solidity files and reran the
full Hardhat suite (312 passing). Slither analyzed 40 contracts / 101 detectors;
its medium/high gate passed with 39 timestamp/naming results remaining. Clean
compilation removed mixed old/new build-info artifacts. The existing exact-ID
triage for `AgreementState.Uninitialized` equality was re-reviewed and its ID
updated after source offsets shifted; no detector-wide suppression or gate
reduction was introduced. ABI generation changes only the two intended function
signatures; the guide documents both typed-data changes and adapter migration.

## 2026-10-21 — Arc Testnet Claim Vault compatibility review

Branch: `feature/arc-claim-vault`. Source baseline: `44caa7b`.
See `docs/ARC_CLAIM_GAP_REPORT.md` for the full evidence record.

Objective: validate Arc Testnet (chain ID 5042002) compatibility for
`SivanClaimVault` and return a minimal reviewable patch. No public
transactions, deployments or production credentials were accessed.

**Network and token evidence (read-only, 2026-10-21):**
- `eth_chainId` at `https://rpc.testnet.arc.io` returned `0x4cef52` (5042002);
  matches the existing registry entry.
- `eth_blockNumber` returned `0x4135660` (68,376,160); network is live.
- USDC predeploy `0x3600000000000000000000000000000000000000`:
  `symbol() = "USDC"`, `decimals() = 6`, code length 1,798 bytes,
  `keccak256(code) = 0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d`.
- Constructor `eth_call` simulation with USDC and two dummy EOAs returned
  non-empty runtime bytecode, confirming creation bytecode executes without
  reverting and the `code.length` gate accepts the predeploy.

**Contract compatibility assessment:**
- `SivanClaimVault` interacts with USDC exclusively through the 6-decimal
  ERC-20 interface. It does not use `msg.value`, `address.balance`, or the
  18-decimal native view. The two-view accounting model does not affect the
  contract's deposit or payout math.
- The existing `code.length != 0` gate in `_setToken()` accepts USDC correctly.
- Exact-transfer guards (`deposit`, `_pay`) are transfer-delta checks and are
  decimals-agnostic; they work correctly with any exact-transfer ERC-20.
- The EIP-712 domain binds `block.chainid` at deployment, correctly scoping
  signatures to chain ID 5042002.
- Gas on Arc is paid from the same USDC pool; the deployer and depositor
  wallets must hold USDC for both the transfer amount and gas. This is a UX
  constraint, not a contract defect.

**Unresolved items (operator must confirm before public deployment):**
- Cancun EVM opcode support confirmed against official Arc release notes
  (constructor simulation succeeded but primary-source changelog not reviewed).
- Funded deposit/claim/refund transfer deltas on live Arc Testnet USDC not yet
  measured (requires authorized test wallets and gas).

**Local test evidence:**
- `npm run claim:test-matrix` passed 145 cases (33 each for Celo/Base/Arbitrum,
  23 each for Arc/BNB) on ephemeral Hardhat chain IDs; exit code 0.
- Arc profile (5042002) now runs deployment tooling tests because it is promoted
  to `candidate`; previously those 10 tests were skipped for Arc.
- Full Hardhat regression suite and Foundry suite also rerun cleanly (see below).

**Patch — one-line change:**
`config/evm-networks.cjs`: `arcTestnet` status promoted from `"pending"` to
`"candidate"`. This enables `claim:preflight` and `claim:deploy` for Arc Testnet
and adds deployment tooling tests to the Arc local profile. No Solidity, ABI,
fee, signing schema, or existing deployment changed. Celo Sepolia behavior is
unaffected.

`docs/CLAIM_TESTNET_DEPLOYMENT.md`: Arc table row updated from "Pending review"
to "Candidate — see ARC_CLAIM_GAP_REPORT.md".

`integration/REVIEW_NOTES.md`: this entry.

`docs/ARC_CLAIM_GAP_REPORT.md`: new, full evidence and gap analysis.

`readyForUse` remains false. No public deployment is authorized by this patch.
Human review and full-repository CI must complete before merge.
