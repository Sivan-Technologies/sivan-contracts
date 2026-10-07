# Integration review log

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
