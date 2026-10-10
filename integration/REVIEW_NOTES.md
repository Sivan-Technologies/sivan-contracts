# Integration review log

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
