# Claim Vault security and local E2E review — 2026-10-11

Release reviewed: `b57d3f84665c42c89f0099923148bc1b77816a9d` on `main`.
This is an engineering security review by the implementation assistant, **not an
independent third-party audit or production certification**. No public deployment,
wallet transfer, issuer-token transaction or live application operation was made.

## Scope and evidence

Manual review focused on `SivanClaimVault`, typed claim authorization, deployment
configuration, broadcast journaling, recovery/source verification and network
gates. Existing single/milestone vaults received automated regression/static
coverage, not a new exhaustive line-by-line independent audit.

| Check | Result |
| --- | --- |
| Full Hardhat suite | 298 passed |
| Five-profile local claim matrix | 140 passed: 32 each Celo/Base/Arbitrum, 22 each Arc/BNB |
| Local deployment → approval → deposits → claim/refund script | Passed |
| Recovery-confirmation reproduction | Passed, demonstrating the low-severity issue below |
| Integration drift gate | Passed |
| Slither medium/high gate | Exit 0; 39 timestamp/naming results still reported, not a zero-warning claim |
| npm audit, moderate threshold | Exit 0; 15 low dependency-tree findings remain |
| Foundry full fuzz/invariant suite | 33 passed across 9 suites; no failures or skipped tests |

The matrix repeats common scenarios under five local chain IDs; its counts are
not distinct vulnerability classes or evidence of five public networks. Fixture
coverage includes 6/18-decimal transfers, legacy USDT empty returns, blocked
transfers, fees, refund/claim boundaries, replay/wrong-domain signatures,
redirection, reentrancy and accounting conservation.

Foundry claim fuzzing ran 512 inputs. The claim accounting invariant ran 256
sequences / 12,800 handler calls with zero reverts; ineligible handler actions
may return without a transfer, so those are not 12,800 successful payouts.
The milestone sequence invariant tolerated 9,366 reverts in 12,800 attempted
calls under the existing `fail_on_revert=false` setting. Passing therefore does
not establish successful coverage of every milestone action; improve state-aware
handler targeting and success counters as a test-quality follow-up. Targeted
Hardhat milestone lifecycles passed separately.

Foundry rebuilt after an incompatible local cache format and completed normally.
Its final home-directory signature-cache write warning did not fail the tests.

A narrow current-tracked-file scan found no literal 64-hex private-key assignments
or private-key PEM headers. Only env examples are tracked. This is not a full
secret-history scan and does not certify ignored env files or external systems.
CI actions are commit-pinned and workflow repository permissions are read-only.

## Findings

### Low — Recovery does not enforce the deployment confirmation wait

Location: `scripts/helpers/claim-deployment.js:87` and
`scripts/claim-evm.js:49`.

Normal deployment waits for two confirmations before readback. The recovery and
verification paths call `readback` directly; it accepts any successful receipt
with the expected address/state, even at one confirmation. A just-mined deployment
can therefore be recorded as `deployed-readback` through recovery before reaching
the ordinary deployment threshold. A reorg may then invalidate that observation.

Reproduced with `deployment-test/claim-audit.test.js`: immediately after deployment,
`receipt.confirmations()` was 1 and `readback()` succeeded. The test documents
current behavior, not a fix, and is intentionally run separately from CI's normal
regression gate until remediation is selected.

Impact is limited: recovery never broadcasts or moves escrow and keeps
`readyForUse: false`. This is a release-evidence consistency issue, not a reproduced
fund-drain vulnerability. Apply the same minimum confirmation and canonical-block
policy to deploy/recover/verify, and distinguish mined/pending-finality from checked
deployment evidence. Two confirmations alone are not universal chain finality.

### Low — Legacy elliptic dependency advisory remains unresolved

Fresh `npm audit --audit-level=moderate` reported 15 low entries in the dependency
tree, all associated with the legacy elliptic chain shown by npm. These are not
15 demonstrated on-chain exploits. The advisory describes conditional ECDSA
signature/key exposure and lists no patched elliptic version:
[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84).

The claim tooling imports the pinned ethers v6 package. The audit result alone
does not establish an exploit in that signing path or in deployed Solidity.
Keep a documented dependency-risk decision and evaluate a tested toolchain
migration. Do not run `npm audit fix --force` as an unreviewed breaking upgrade.

## Operational limitations, not newly discovered exploits

- Anyone with the bearer key, including the sender, can authorize a pre-expiry
  claim. This is not identity-bound delivery to a phone number/email.
- Refund is sender-initiated after seven days and returns net escrow. The upfront
  0.5% fee is not refundable. Loss of sender/key access and issuer freezes can
  prevent recovery; pausing the vault does not bypass token controls.
- Only reviewed exact-transfer, non-rebasing assets are supported. Runtime hash
  and metadata checks do not certify proxy implementation, issuer identity or
  future token upgrades. Direct donations have no rescue path.
- Deployment journals use exclusive creation and atomic replacement, but no
  explicit file/directory `fsync`. They protect ordinary process-failure recovery,
  not guaranteed persistence across power loss/storage failure. Back up evidence
  and consider an fsynced journal before stronger durability claims.
- Mainnet remains blocked. Arc/BNB public deployment gates remain pending. Local
  chain-ID simulation does not reproduce native gas models, opcode support or
  actual token contracts.

## Release assessment

No new critical/high on-chain exploit was demonstrated in the completed checks.
This is bounded evidence, not proof that the contracts are vulnerability-free.
Before release: address the recovery confirmation inconsistency, assess the
dependency advisory, complete controlled public-testnet real-token lifecycles,
validate backend/frontend/relayer indexing and recovery, and obtain independent
review of the final immutable release. Production logic was not modified here.
