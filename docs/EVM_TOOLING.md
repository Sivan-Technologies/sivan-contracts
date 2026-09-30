# EVM tooling: first implementation

For all ten planned network families, see the [RPC, environment and GitHub CI
configuration guide](EVM_RPC_AND_GITHUB_CONFIGURATION.md). Published endpoints
do not activate pending profiles or override deployment gates.

2026-09-26. Updated after security remediation. Future deployments require
buyer-namespaced agreement IDs; existing immutable vaults are not modified.
The settlement signature domain is unchanged.

2026-09-27 update: see [production controls](PRODUCTION_CONTROLS.md). New runner
configurations require `ADMIN_ADDRESS` and `CONTROL_MODE`. A distinct admin receives
a two-step handover while the vault remains paused; role readback is not handover
completion. The production profile remains disabled.

## What is implemented

- `config/evm-networks.cjs` records the ten planned network families. Only Celo
  Sepolia, Base Sepolia and Arbitrum Sepolia are controlled testnet candidates.
  A candidate is not a verified production deployment. Other profiles are pending;
  unverified chain IDs are deliberately unset. Every mainnet is blocked in code.
- `scripts/evm.js` provides network listing, a read-only preflight and explicitly
  confirmed testnet deployment. No implicit mainnet execution or batch deployment.
- Preflight checks the real chain ID, compiler target, token code/metadata,
  explicit role separation, attester proof-of-control and estimated native gas reserve. An estimate is not
  proof of all runtime instruction compatibility or final transaction cost.
- Deployment journals creation intent, expected address/nonce, transaction hashes
  and progress before proceeding. It seeds the allowlist and reads roles/tokens
  back at the seed receipt block. No automatic rebroadcast/redeployment on errors.
- Records include the source commit, ABI, compiler settings, creation bytecode hash
  and actual runtime hash. Explorer source verification remains a separate gate.
- Runtime RPC URLs and explorer URLs/keys come from environment settings only.
  RPC error objects are not printed because they can expose credentials.

## Setup and commands

See [the testnet configuration template](../.env.evm.example). Copy only needed
fields into your existing `.env`; do not overwrite it or commit real credentials.
The template includes public testnet RPCs, chain IDs, explorer browser URLs and
Circle-listed test USDC addresses. It is not loaded automatically. Existing
private RPC configuration should be preserved. There are no default role addresses,
agent IDs, token lists or RPC URLs in the new runner.

## Fee collector choice

The fee collector setting is a receiving **address**, not a private key. A single
dedicated test wallet is suitable for testnet. For production, a recommended
starting setup is a 2-of-3 Safe treasury with independently secured signer keys;
two approvals authorize outgoing treasury transactions. Receiving ERC-20 fees
does not require collecting signatures for each incoming transfer. No treasury
private key belongs in this repository's environment file.

The current vault transfers earned fees in the agreement's token to its locked
collector; it does not convert all fees to one token. A collector can receive
multiple supported tokens on its chain. Use a verified collector deployment for
each chain: the same displayed address does not prove the Safe exists or has the
same owners/threshold elsewhere. Balances remain chain-specific.

Keep deployer, attester, treasury and independent reviewer roles separate.
The attester currently requires ECDSA and cannot be replaced by a treasury Safe.
Also check reviewer independence from the treasury's signers: the vault's address
checks cannot discover common control behind different wallets. Changing the
global collector does not redirect fees from already-funded agreements, whose
collector was snapshotted at funding.

Sources for the public template and wallet model:

- [Celo network information](https://docs.celo.org/build-on-celo/network-overview)
- [Base public testnet RPC](https://docs.base.org/cookbook/use-case-guides/finance/access-real-time-asset-data-pyth-price-feeds/)
- [Arbitrum network information](https://docs.arbitrum.io/arbitrum-bridge/quickstart)
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Safe owners and thresholds](https://docs.safe.global/advanced/smart-account-concepts)

## Configuring signer roles

For each candidate, fill its prefix: `CELO_SEPOLIA`, `BASE_SEPOLIA`, or
`ARBITRUM_SEPOLIA`. Set RPC URL, deployer public address, fee collector, attester,
agent ID, version (e.g. `v1`) and the explicitly reviewed token metadata array.
Preflight needs the public deployer address and the attester's signed control
proof, but no deployer or attester private key. A deployer private key is required
only for an explicitly authorized deployment and must match that address.

Set `<PREFIX>_ATTESTER_PROOF_EXPIRY` to a Unix timestamp within the next 24 hours,
then run `npm run evm:challenge -- baseSepolia` (substitute your candidate).
Have the protected attester signer review and EIP-191 `signMessage` the **exact
single-line JSON challenge**, without the command's build logs or a trailing
newline. Set `<PREFIX>_ATTESTER_PROOF_SIGNATURE` to that returned signature.
The proof binds the chain, deployer, role addresses, agent ID, version, token
metadata, expiry and creation-bytecode hash. Changing any requires a fresh proof.
It proves ECDSA key control, not permission to pay out, agent independence or
continued signer availability. Contract-wallet attesters are refused because
the delivered-release path currently requires ECDSA. Proof is checked in
preflight and again immediately before deployment intent is journaled.

```sh
npm run compile
npm test -- --network hardhat
npm run evm:list
npm run evm:preflight -- baseSepolia
```

Do not interpret metadata matching as proof of token authenticity. Compare each
address with official issuer records first. Use a dedicated test key whose control
and test-only provenance you have verified; configuration cannot establish that.

Only after explicit deployment approval, set `EVM_DEPLOY_CONFIRM` to exactly
`<network>:<chainId>:<version>` for the reviewed target and execute:

```sh
npm run evm:deploy -- baseSepolia
```

The runner requires a clean, committed worktree before sending. It does not commit
changes for you. It creates `deployments/<chainId>-<version>.json` exclusively and
refuses to overwrite a record. Back up deployment journals across machines; this
local record lock is not a distributed deployment coordinator. Remove the
confirmation setting after use. Never share the deployer nonce concurrently with
another transaction sender.

If any phase fails after broadcast intent, inspect the recorded address, nonce and
transaction on that same chain. Do not delete the record and rerun. A seed/readback
failure is not evidence that deployment failed. The unseeded contract rejects
deposits; it is not ready for users. No automated repair or fund movement is added.

Configure network-prefixed explorer API/browser URLs and key before using
`hardhat verify`. Verification service compatibility still needs validation per
chain. Successful readback is not explorer source verification.

## Migration from old tooling

- `DEPLOYER_PRIVATE_KEY` is no longer shared between remote Hardhat networks.
  Remote Hardhat entries contain no unlocked accounts; the new runner reads only
  the selected network's private key after deployment confirmation.
- Existing `.env` values are preserved; there is no automatic key copying.
- `deploy:sepolia` now invokes the guarded Celo Sepolia runner. Legacy direct
  remote use of `scripts/deploy.js` is rejected; its local/fork path is retained.
- `deploy:celo` is deliberately blocked pending production approval.
- Local fork endpoints require explicit `CELO_FORK_RPC_URL` or
  `CELO_SEPOLIA_FORK_RPC_URL`. Missing remote URLs produce no configured Hardhat
  network; the new preflight command gives a configuration error instead.
- The existing remote lifecycle script remains **Celo Sepolia only**, not a
  multichain test runner. Its deployer now comes from
  `CELO_SEPOLIA_DEPLOYER_PRIVATE_KEY`; existing buyer, contractor and attester
  lifecycle key variables remain unchanged. No remote lifecycle was run here.

## Validation and remaining work

The initial Hardhat run passed 153 tests, including 11 new tooling tests. Each of the
three candidate configuration paths was exercised against a local Hardhat chain:
deploy → journal → seed → readback → accepted funding → release → balance checks.
These tests use explicit local token fixtures, not real testnet or user funds.
No remote deployment, live transaction or frontend/backend end-to-end validation
was performed. Subsequent source/tooling remediation and fresh test results are
tracked in [the remediation report](SECURITY_REMEDIATION_2026-09-26.md).

Remaining gates: review/configure the other network profiles; verify chain-specific
gas/opcode behavior; implement and execute remote testnet lifecycle coverage;
integrate per-chain frontend/backend routing and indexing; verify sources;
independently review the release and operational controls before any mainnet enablement.

Official references used for the first candidate network identifiers:

- [Base chain IDs](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId)
- [Arbitrum network information](https://docs.arbitrum.io/arbitrum-bridge/quickstart)
- Celo Sepolia: existing repository chain guard and read-only RPC evidence in
  [the implementation plan](EVM_MULTICHAIN_IMPLEMENTATION_AND_TEST_PLAN.md).
# Shared treasury configuration

`SIVAN_FEE_COLLECTOR` provides the fee recipient default within the selected
environment profile. A nonempty `<NETWORK>_FEE_COLLECTOR` takes precedence;
blank overrides inherit the shared address. Invalid explicit overrides fail
validation rather than silently falling back. Missing, zero and conflicting
addresses remain rejected.

Use separate testnet and production profiles and treasury addresses. This fallback
does not apply to admin, attester, signing keys, RPCs or multisig policies.
Multisig deployments, owners, threshold and reviewed code hashes are still checked
on each chain. Sharing an address does not consolidate balances across chains.
