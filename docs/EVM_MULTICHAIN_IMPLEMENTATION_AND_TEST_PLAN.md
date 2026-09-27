# Sivan immutable EVM contracts: implementation and test plan

Updated: 2026-09-26.

Status: approved architectural direction and planned network scope, not a claim
that multichain deployment tooling or remote end-to-end testing is complete.
Code baseline reviewed: `ed8714c` on `staging`.

Implementation update: the first tooling phase is now implemented locally. See
[EVM tooling](EVM_TOOLING.md) for commands, configuration migration, tests and
remaining gates. Celo/Base/Arbitrum Sepolia have local deployment-path coverage;
other profiles and every mainnet remain disabled for deployment. The original
scope matrix below records baseline evidence, not completed remote validation.

## 1. Contract versioning decision

Sivan will use immutable, separately deployed contract versions. No proxy, UUPS,
delegatecall upgrade mechanism or administrative implementation replacement is
planned. Future changes ship as a new vault version, such as V2.

- Existing agreements and funds remain in their original vault.
- New agreements may use V2 only after its release gates pass.
- There is no automatic migration, sweeping or rewriting of existing agreements.
- Keep V1 monitoring, user access, reviewer operations and indexing active until
  every agreement is terminal and its accounting is reconciled. Disputes may
  remain open indefinitely; do not retire V1 simply because V2 launches.
- Identify every agreement by `(chainId, vaultAddress, agreementId)` and record
  its contract version. An agreement ID alone is not globally unique.
- Maintain an explicit deployment registry with source commit, compiler settings,
  ABI, runtime bytecode hash, chain ID, address, deployment transaction/block,
  authorized roles, supported assets and verification evidence.

Immutability does not remove existing administrative powers such as pausing,
configuring future fees or issuing authorized arbitration rulings. Describe these
powers accurately. It also means bugs cannot be patched in-place.

## 2. EVM network scope and honest status

All networks below are in scope for evaluation and implementation. A row is not
permission to deploy. Each must pass the same release gates independently.

| Network family | Intended testing scope | Current evidence / implementation status |
| --- | --- | --- |
| Celo | Celo Sepolia, local/fork checks, then separately authorized mainnet validation | Existing tooling; Sepolia read-only preflight passed on 2026-09-24. Full remote lifecycle of `ed8714c` is not verified. |
| Ethereum | Sepolia and local/fork checks | Planned; deployment tooling and remote testing pending. |
| Base | Base Sepolia and local/fork checks | Planned; deployment tooling and remote testing pending. |
| Arbitrum | Arbitrum Sepolia and local/fork checks | Planned; deployment tooling and remote testing pending. |
| Optimism | OP Sepolia and local/fork checks | Planned; deployment tooling and remote testing pending. |
| Polygon PoS | Amoy and local/fork checks | Planned; deployment tooling and remote testing pending. |
| BNB Smart Chain | BNB Smart Chain testnet and local/fork checks | Planned; deployment tooling and remote testing pending. |
| Arc | Official active Arc testnet and chain-specific compatibility checks | Planned; verify official network parameters, gas/token behavior and release status before configuration. |
| Linea | Official active Linea testnet and local/fork checks | Planned; verify current network parameters before configuration. |
| Sonic | Official active Sonic testnet and local/fork checks | Planned; verify current network parameters before configuration. |

Confirm every testnet's availability, chain ID and configuration from its official
documentation when implementing it. Do not reuse unverified pasted chain IDs or
RPC addresses. Maintain statuses: **planned → configured → locally tested →
testnet verified → production approved**. A successful compile is not testnet
verification; a configured network is not a supported production deployment.

This plan covers EVM networks only. No universal EVM compatibility
percentage is promised. Additional EVM chains enter through the same validation
process rather than unrestricted RPC-based deployment.

Multichain means independent vault deployments, not cross-chain escrow, shared
balances, bridging or automatic settlement between networks.

## 3. Planned implementation work

### Network and deployment configuration

- Introduce an explicit supported-chain registry with expected chain ID,
  environment classification, compiler/EVM target, supported token metadata,
  explorer verification configuration and documented official sources.
- Read RPC URLs, credentials and explorer API keys from environment/secrets
  configuration. No hardcoded endpoint URLs, API keys or silent RPC fallbacks.
- Chain IDs and verified public token addresses are not secrets; version-control
  reviewed network metadata, separating mainnet from testnet assets.
- Use separate testnet and production signing configuration. Do not implicitly
  reuse a single deployer key across every configured network.
- Require explicit role addresses; no silent deployer fallback for fee collector
  or attester. Confirm independent-reviewer and participant separation.
- Fail closed for unknown chains, missing settings, wrong RPC chain ID, invalid
  token code/metadata, unavailable signers or incomplete allowlist setup.
- Keep mainnet execution behind a deliberate per-network approval. Never deploy
  to all networks as an automatic batch or as a side effect of testing.

### Contract and integration compatibility

- Preserve agreed arbitration, immutable per-agreement fee destinations,
  reviewer conflict checks, vault-self recipient rejection and atomic settlement.
- Select compiler targets only after checking chain opcode support. The current
  project uses Solidity 0.8.24 with optimizer/viaIR and the Cancun EVM target;
  that is not proof that every candidate chain supports its bytecode.
- Validate ERC-20 behavior and decimals per asset. `symbol()` and `decimals()`
  alone do not prove that a token is the issuer's official deployment.
- Configure gas asset, fee estimation, finality and reorganization handling per
  chain. Test chain-specific behavior, including Arc's gas/token model, against
  official specifications rather than assuming Ethereum-identical behavior.
- Preserve chain- and vault-bound signature domains and nonce/replay protection.
  The current domain name is `Sivan Celo Settlement Facility`; any future rename
  needs coordinated client signing changes and versioned test vectors. Never
  change how clients sign for an already-deployed vault.
- Verify attester identity and signing control on each chain. Celo agent ID 9827
  is not automatically an equivalent identity registration on another network.
- Make frontend/backend routing, approvals, signatures, transaction tracking and
  event indexing use the selected chain and the agreement's original vault.
- Index actual settlement events and amounts. Do not treat a submitted transaction
  as confirmed payment or display synthetic success, volume or balances.

## 4. Verification gates for every network

| Gate | Required evidence |
| --- | --- |
| Configuration | Official network/token references, actual RPC chain ID, explicit roles, correct environment and compiler target. |
| Local tests | Full unit, fuzz and invariant suites; negative tests for missing/wrong networks, assets and roles; no live transactions. |
| Read-only preflight | RPC availability, contract metadata, balances, signer-address matching and gas estimates. Never print secrets. |
| Testnet deployment | Explicit authorization; test-only funds; deployment receipt, source/bytecode verification, constructor roles and allowlist readback. |
| Testnet lifecycle | Real testnet transactions and confirmed balance/event/state checks for the scenarios below. |
| App integration | Wallet network switching, EIP-712 signing, backend/indexer reconciliation, reload/recovery and error handling against that deployment. |
| Production approval | Independent review of the exact release, operational readiness, documented residual risks and explicit chain-specific approval. |

Testnet lifecycle scenarios:

1. Both parties accept matching terms; wrong, stale or missing acceptance fails
   before funds move.
2. Deposit records the correct token amount; ordinary and delivered releases pay
   exact contractor/protocol/partner amounts without stranded fee balances.
3. Eligible refunds return the correct amount; disputed or already-settled
   agreements cannot refund or pay twice.
4. Primary rulings and independent escalation respect the agreed authority window.
   A timeout does not move funds or restore unilateral refund eligibility.
5. Bilateral full and partial settlements require both signatures and conserve
   funds; wrong-chain, wrong-vault, expired and replayed authorizations fail.
6. Reviewer/partner conflicts and vault-self fee recipients are rejected. Later
   collector changes cannot redirect an already-funded agreement's fees.
7. Failed transfers leave balances, agreement state and nonce unchanged; retries
   cannot double-pay. Authorized fee-free refunds remain possible.
8. Pausing, delayed RPC responses, transaction replacement, indexer restart and
   wallet/network changes produce accurate recoverable states, not false success.

Local tests may use explicit test fixtures to exercise adversarial cases. These
are not remote end-to-end evidence. Do not fabricate funded balances or provider
responses and report them as a successful live testnet purchase or settlement.
Remote deadline tests must observe actual network time, not local time-warp claims.

Record each run's commit, network/chain ID, vault/version, public role addresses,
token addresses, transaction hashes, timestamps, starting/ending balances,
assertions and failures. Redact secrets and credential-bearing URLs. A gate with
missing evidence remains pending, not passed.

## 5. Existing evidence and remaining blockers

- At `ed8714c`: 142 Hardhat tests and 25 Foundry tests passed locally. Eight fuzz
  tests used 2,048 cases each; seven invariants used 512 runs × 100 handler calls
  each. These counts are recorded history, not a new run on every chain.
- On 2026-09-24: 23 targeted local tests passed. A read-only configured Celo
  Sepolia RPC check returned chain ID 11142220; the configured test USDC had code,
  symbol USDC and six decimals. Deployer test CELO was nonzero at that time.
- That preflight found buyer/contractor/attester signing configuration, independent
  reviewer and primary review hours missing. Blank local `.env` fields were added;
  completion, test-only key provenance and current balances need a fresh check.
- The new fee-safety code is not established as deployed or remotely tested.
  Existing historical Celo deployments do not prove the new version is live.
- No non-Celo network has completed deployment/lifecycle verification in this plan.

See [the settlement review](FOUNDRY_SETTLEMENT_REVIEW_2026-09-22.md),
[agreed arbitration](AGREED_ARBITRATION.md) and
[historical Celo deployment record](CELO_SEPOLIA_DEPLOYMENT.md).

## 6. Rollout order and operating limits

First implement the configurable EVM tooling and finish Celo Sepolia verification.
Then validate Base Sepolia and Arbitrum Sepolia, followed by the remaining network
families one at a time. A chain that fails validation remains disabled.

Before production, establish protected signing, independent reviewer availability,
dispute alerts, incident response and per-version monitoring. An inactive
independent reviewer can leave disputed funds locked unless the parties agree to
settle. Address separation cannot prove separate beneficial ownership; operational
conflict checks remain necessary.

Do not automatically create live accounts, provision accounts, approve assets,
move funds, off-ramp, deploy or migrate users as part of this documentation or
test workflow. Real-network writes require their own explicit authorization.
