# Arc Studio handoff: Sivan Ai Claim Vault

Prepared: 2026-10-21

Branch: `feature/arc-claim-vault`

Source baseline: `44caa7b`. This document is an additional, uncommitted handoff at preparation time.

## Objective and boundaries

Validate and complete Arc Testnet compatibility for the existing immutable Claim Vault while preserving Celo Sepolia behavior. Arc Testnet is chain ID 5042002; Celo Sepolia is 11142220. The current Arc deployment gate is pending, not evidence of a successful public deployment.

- Work only on this feature branch. Return a reviewable patch, not a replacement repository.
- Do not change SivanAgreementVault, SivanMilestoneVault or their interfaces.
- Do not add upgrade proxies or change existing deployment semantics.
- Do not access Sivan production APIs, AWS, customer accounts or real funds.
- Do not deploy, approve tokens or send public-chain transactions without separate approval and dedicated test wallets.
- Never bypass pending-network, receipt, confirmation, token or role checks to obtain a passing result.
- Keep RPCs, tokens, roles and credentials configuration-driven. Do not embed wallet addresses or secrets in source or reports.

## Existing behavior to preserve

Read `contracts/SivanClaimVault.sol` and `integration/CLAIM_VAULT.md` before proposing changes.

- ERC-20 funding with exact-transfer accounting, not support for arbitrary rebasing or fee-on-transfer assets.
- Upfront 50-basis-point platform fee and immutable treasury.
- Unclaimed net principal refundable after seven days; the upfront fee is not refundable.
- Claim authorization by the bearer-link signing key, bound to the destination and EIP-712 domain.
- Replay protection, expiry checks, pause behavior and existing admin restrictions.
- A recipient-bound signature does not prove ownership of a phone number. The separate recipient-identity proposal is not implemented by this handoff.

## Files and responsibilities

| Files | Purpose |
| --- | --- |
| `contracts/SivanClaimVault.sol` | Claim funding, authorization, claim and refund |
| `contracts/test/` selected fixtures | Local token and control-wallet behavior |
| `config/evm-networks.cjs`, `config/claim-targets.cjs` | Network capabilities and deployment gates |
| `config/claim-local-test.cjs`, `hardhat.config.cjs` | Local chain simulation and compilation |
| `scripts/claim-evm.js`, `scripts/helpers/claim-deployment.js` | Guarded preflight, deployment, recovery and verification |
| `scripts/helpers/confirmations.js`, `control-wallets.js`, `environment.js` | Confirmation, role and environment safeguards |
| `scripts/helpers/claim-authorization.js` | Claim signing payload |
| `test/SivanClaimVault.test.js`, `deployment-test/claim-*.test.js` | Local lifecycle, rejection and deployment tests |
| `scripts/claim-test-matrix.js`, `scripts/claim-local-lifecycle.js` | Local test runners |
| `forge-test/ClaimVaultFuzz.t.sol`, `ClaimVaultInvariant.t.sol` | Fuzz and invariant coverage |
| `integration/CLAIM_VAULT.md`, `docs/CLAIM_TESTNET_DEPLOYMENT.md` | Integration and operational contract |

The export is a selected reference package, not the complete repository. Root package scripts may reference intentionally omitted files. Run only the scoped commands below in the export. Run full-repository CI and integration documentation checks after reintegration. Foundry dependencies are not bundled; obtain and review the repository's pinned dependency setup before running Forge.

## Arc-specific investigation

1. Recheck official network and token documentation. Verify actual RPC chain ID, compiler/opcode compatibility and token implementation on the public testnet.
2. Arc USDC native gas accounting and its ERC-20 interface represent the same underlying funds but use different decimal conventions. Verify native versus ERC-20 units independently; do not assume gas is a separate token balance.
3. Check the ERC-20 interface's runtime code and whether the existing code-length/code-hash gate accepts it correctly. Do not remove these checks speculatively.
4. Measure exact transfer deltas for deposits, claims and refunds, including when sender, recipient or treasury pays gas. Test approvals, insufficient balances and failures without inventing delivery evidence.
5. Validate confirmation policy, receipt rereads, deployment recovery and source verification. Record failures and outstanding limitations.
6. Do not claim Arc USDT support based on a ticker or local fixture. Require a verified issuer/source, address, decimals and token-behavior evidence for each approved settlement token.

Official references to recheck at execution time:

- https://docs.arc.io/arc/references/connect-to-arc
- https://docs.arc.io/arc/references/contract-addresses
- https://studio.arc.io/

## Safe local validation

Use an isolated directory without local environment files or signing secrets. Inspect package scripts before installing dependencies. The lockfile is included for reproducibility.

```sh
npm ci --ignore-scripts
npm run compile
npm run claim:test-matrix
```

These tests use local fixtures and simulated chain IDs. They do not prove public Arc or Celo execution. A full public lifecycle must separately demonstrate fund, claim, replay rejection, invalid authorization rejection and unclaimed refund, with transaction receipts and balance reconciliation. Do not change public-chain time to simulate a seven-day refund; report the waiting period honestly.

After the patch returns to the complete repository, run relevant full tests, fuzz/invariant tests and `npm run integration:check`. If covered sources changed, update affected integration documentation and review notes, compile, refresh the baseline, review the generated changes, then check again.

## Configuration and sharing safety

No environment files, private keys, seed phrases, Git history, deployment journals, customer records or installed dependencies belong in the upload. Use the explicit allowlist accompanying this handoff, not a repository-directory upload.

Read variable names and validation rules from `scripts/helpers/claim-deployment.js` and the network registry. The operator supplies RPC, approved token metadata, separate test roles and signing material outside chat after review. Do not manufacture credentials or use standard development keys on public networks.

Secret scanning is a bounded precaution, not a guarantee that proprietary code is appropriate for a third-party service. Review Arc Studio's access and retention settings before sharing. Rescan every revised export.

## Acceptance checklist

- [ ] Arc network/token behavior verified with dated primary-source and read-only RPC evidence.
- [ ] Compatibility changes minimal, explained and covered by regression tests.
- [ ] Celo local regression tests pass unchanged.
- [ ] Public testnet execution separately authorized and documented, or clearly marked not run.
- [ ] No unsupported network or token enabled without completed checks.
- [ ] Existing v1 fees, refunds and authorization semantics unchanged.
- [ ] Relevant integration docs updated without claiming proposals are implemented.
- [ ] Returned patch contains no secrets, environment files or unrelated contract changes.
- [ ] Human review and full-repository CI complete before merge.

## Prompt to give the Arc agent

```text
Read docs/ARC_STUDIO_HANDOFF.md first. Work on feature/arc-claim-vault
from baseline 44caa7b. Review the provided Claim Vault implementation;
do not regenerate it. Establish Arc Testnet compatibility while retaining
Celo Sepolia behavior and all existing v1 economics and security checks.
Do not touch Service Agreement or milestone contracts. Start with a gap
report and local tests, then return minimal changes and exact test evidence.
No public transactions, deployment, secret access, mainnet enablement or
pending-gate bypass is authorized. Report local and public evidence separately.
Return a patch, documentation updates and an explicit list of unresolved risks.
```
