# EVM RPC and GitHub configuration

Documentation checked: 2026-09-30. Scope: all 20 profiles in
[the network registry](../config/evm-networks.cjs), across ten network families.

2026-10-07 update: Arc Testnet's registry ID is now 5042002, but deployment
remains pending. See [five-testnet validation](FIVE_TESTNET_VALIDATION.md) for
the read-only RPC results and remaining deployment gates.

This is a configuration reference, not evidence of successful deployments.
Public endpoints were checked against the linked documentation, not load-tested
or certified for historical-state access. No deployment, secret, environment
file, contract or CI workflow was changed by this documentation update.

## 1. Local, public testnet and mainnet are different

| Environment | Purpose | Endpoint |
| --- | --- | --- |
| Local Hardhat | Isolated development and tests; no real funds | In-process, or `http://127.0.0.1:8545` when a node is running |
| Public testnet | Real network integration with test tokens | Each network's testnet RPC below |
| Mainnet | Real assets; explicit release approval required | Each network's mainnet RPC below |
| Local fork | Local simulation reading a public network's state | Remote source RPC plus a separate localhost destination |

Localhost is NOT a public Celo RPC. It means the computer executing the command:
your laptop locally, or the GitHub runner inside CI. It is listed here only for
isolated tests, not as a substitute for a public testnet or mainnet.

A fork can read mainnet state without sending transactions to mainnet.
The existing Celo fork job sends its simulated transactions only to localhost.
Public Hardhat test keys must never hold real funds.

## 2. Public testnets

Each RPC variable is the exact prefix expected by the repository. Source links
contain the network/provider reference. Gas symbols refer to native gas, not the
vault's accepted ERC-20 tokens.

| Repo profile | RPC environment variable | Published chain ID | Gas | Public RPC | Repo deployment status |
| --- | --- | ---: | --- | --- | --- |
| celoSepolia | `CELO_SEPOLIA_RPC_URL` | 11142220 | CELO | `https://forno.celo-sepolia.celo-testnet.org` ([Celo](https://docs.celo.org/build-on-celo/network-overview)) | Candidate |
| baseSepolia | `BASE_SEPOLIA_RPC_URL` | 84532 | ETH | `https://sepolia.base.org` ([Base](https://docs.base.org/get-started/connect-to-base)) | Candidate |
| arbitrumSepolia | `ARBITRUM_SEPOLIA_RPC_URL` | 421614 | ETH | `https://sepolia-rollup.arbitrum.io/rpc` ([Arbitrum](https://docs.arbitrum.io/arbitrum-bridge/quickstart)) | Candidate |
| ethereumSepolia | `ETHEREUM_SEPOLIA_RPC_URL` | 11155111 | ETH | `https://ethereum-sepolia-rpc.publicnode.com` ([PublicNode](https://ethereum.publicnode.com/?sepolia)) | Pending |
| optimismSepolia | `OP_SEPOLIA_RPC_URL` | 11155420 | ETH | `https://sepolia.optimism.io` ([Optimism](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op)) | Pending |
| polygonAmoy | `POLYGON_AMOY_RPC_URL` | 80002 | POL | `https://polygon-amoy.drpc.org` ([Polygon](https://docs.polygon.technology/pos/reference/rpc-endpoints)) | Pending |
| bscTestnet | `BSC_TESTNET_RPC_URL` | 97 | BNB | `https://bsc-testnet-dataseed.bnbchain.org` ([BNB Chain](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)) | Pending |
| arcTestnet | `ARC_TESTNET_RPC_URL` | 5042002 | USDC | `https://rpc.testnet.arc.io` ([Arc](https://docs.arc.io/arc/references/connect-to-arc)) | Pending |
| lineaTestnet | `LINEA_TESTNET_RPC_URL` | 59141 | ETH | `https://rpc.sepolia.linea.build` ([Linea](https://docs.linea.build/get-started/build/network-info/)) | Pending; registry ID unset |
| sonicTestnet | `SONIC_TESTNET_RPC_URL` | 14601 | S | `https://rpc.testnet.soniclabs.com` ([Sonic](https://docs.soniclabs.com/sonic/build-on-sonic/getting-started)) | Pending; registry ID unset |

Candidate means eligible for controlled testnet deployment after preflight,
not production approval or a claim of completed end-to-end integration.
Sonic's documented current testnet is 14601; Blaze 57054 is listed as legacy.
Do not interchange the two.

## 3. Mainnets

**Every mainnet deployment remains blocked by the repository's release guards.**
Published IDs below do not change that. An RPC setting alone is insufficient.

| Repo profile | RPC environment variable | Published chain ID | Gas | Public RPC |
| --- | --- | ---: | --- | --- |
| celo | `CELO_RPC_URL` | 42220 | CELO | `https://forno.celo.org` ([Celo](https://docs.celo.org/build-on-celo/network-overview)) |
| ethereum | `ETHEREUM_RPC_URL` | 1 | ETH | `https://ethereum-rpc.publicnode.com` ([PublicNode](https://ethereum.publicnode.com/)) |
| base | `BASE_RPC_URL` | 8453 | ETH | `https://mainnet.base.org` ([Base](https://docs.base.org/get-started/connect-to-base)) |
| arbitrum | `ARBITRUM_RPC_URL` | 42161 | ETH | `https://arb1.arbitrum.io/rpc` ([Arbitrum](https://docs.arbitrum.io/arbitrum-bridge/quickstart)) |
| optimism | `OP_RPC_URL` | 10 | ETH | `https://mainnet.optimism.io` ([Optimism](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op)) |
| polygon | `POLYGON_RPC_URL` | 137 | POL | `https://polygon.drpc.org` ([Polygon](https://docs.polygon.technology/pos/reference/rpc-endpoints)) |
| bsc | `BSC_RPC_URL` | 56 | BNB | `https://bsc-dataseed.bnbchain.org` ([BNB Chain](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)) |
| arc | `ARC_RPC_URL` | 5042 | USDC | `https://rpc.mainnet.arc.io` ([Arc](https://docs.arc.io/arc/references/connect-to-arc)) |
| linea | `LINEA_RPC_URL` | 59144 | ETH | `https://rpc.linea.build` ([Linea](https://docs.linea.build/get-started/build/network-info/)) |
| sonic | `SONIC_RPC_URL` | 146 | S | `https://rpc.soniclabs.com` ([Sonic](https://docs.soniclabs.com/sonic/build-on-sonic/getting-started)) |

Arc mainnet, plus Linea and Sonic on both environments, have unset registry IDs. Their published
IDs are recorded here for review; their profiles are not activated. The Hardhat
network factory skips profiles without a registry ID even if an RPC is supplied.

Arc documents native USDC gas with 18 decimals. Do not assume native gas metadata
equals the decimals or behavior of an ERC-20 settlement token. Verify each token
interface separately before allowing it into a vault.

## 4. Copyable RPC reference

Select only the networks you need; do not overwrite existing private-provider
configuration. These are public URL examples, not embedded application defaults.

### Testnet reference

```dotenv
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc

# Pending deployment profiles:
ETHEREUM_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
OP_SEPOLIA_RPC_URL=https://sepolia.optimism.io
POLYGON_AMOY_RPC_URL=https://polygon-amoy.drpc.org
BSC_TESTNET_RPC_URL=https://bsc-testnet-dataseed.bnbchain.org

ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io
# Reference only: registry IDs also need a reviewed implementation:
LINEA_TESTNET_RPC_URL=https://rpc.sepolia.linea.build
SONIC_TESTNET_RPC_URL=https://rpc.testnet.soniclabs.com
```

### Mainnet reference (deployment disabled)

```dotenv
CELO_RPC_URL=https://forno.celo.org
ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com
BASE_RPC_URL=https://mainnet.base.org
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
OP_RPC_URL=https://mainnet.optimism.io
POLYGON_RPC_URL=https://polygon.drpc.org
BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
ARC_RPC_URL=https://rpc.mainnet.arc.io
LINEA_RPC_URL=https://rpc.linea.build
SONIC_RPC_URL=https://rpc.soniclabs.com
```

The EVM runner defaults to `EVM_PROFILE=testnet`, loading `.env.testnet` or
falling back to `.env`. The production profile loads `.env.production` without
that fallback. Example files and `.env.evm` are not automatically loaded.
See [environment loader](../scripts/helpers/environment.js).

Keep testnet and production settings separate. Production RPC credentials must
be securely injected at runtime, not committed or stored in a developer env file.
The production profile's secret checks and deployment blockers remain in force.
Full role, token, proof-of-control and admin configuration is still required;
see [EVM tooling](EVM_TOOLING.md) and [production controls](PRODUCTION_CONTROLS.md).

## 5. GitHub Actions: what to configure today

Open the **sivan-contracts** GitHub repository, then:
**Settings → Secrets and variables → Actions**.

| Tab | Name | Value | Current use |
| --- | --- | --- | --- |
| Variables | `CELO_FORK_RPC_URL` | `http://127.0.0.1:8545` | Local destination on the CI runner |
| Secrets | `CELO_FORK_SOURCE_RPC_URL` | Your Celo mainnet fork-capable HTTPS RPC | Reads Celo state to initialize the local fork |

The source should report chain ID **42220**. A public example is
`https://forno.celo.org`, but historical-state support and rate limits must be
tested; use a dedicated fork-capable provider if it cannot support the job.
The existing local fork uses chain ID **31337**. Do not replace its localhost
destination with a public network URL or supply production signing keys.

After saving these settings, rerun the failed Celo fork job. A saved secret is
not evidence of a passing run. Check the actual result and preserve its logs
without exposing credential-bearing URLs.

The current [CI workflow](../.github/workflows/ci.yml) wires **only the Celo fork**.
Normal `<PREFIX>_RPC_URL` secrets are not automatically loaded into Actions;
a workflow must explicitly map any needed secret into its job environment.

### Other chains: proposed fork secrets, not implemented jobs

| Network | Proposed source secret |
| --- | --- |
| Ethereum | `ETHEREUM_FORK_SOURCE_RPC_URL` |
| Base | `BASE_FORK_SOURCE_RPC_URL` |
| Arbitrum | `ARBITRUM_FORK_SOURCE_RPC_URL` |
| Optimism | `OP_FORK_SOURCE_RPC_URL` |
| Polygon | `POLYGON_FORK_SOURCE_RPC_URL` |
| BNB Smart Chain | `BSC_FORK_SOURCE_RPC_URL` |
| Arc | `ARC_FORK_SOURCE_RPC_URL` |
| Linea | `LINEA_FORK_SOURCE_RPC_URL` |
| Sonic | `SONIC_FORK_SOURCE_RPC_URL` |

These names are a future convention, not settings consumed by today's workflow.
Adding them now does not add coverage. Each new job needs explicit secret mapping,
source-chain validation, local-only destination guards, chain-specific fixtures
and token metadata, pinned fork state and recorded results. Do not repurpose the
Celo job with another chain's source URL. Separate jobs can each use localhost
8545 because each runner is isolated.

## 6. Verification before enabling another profile

1. Read `eth_chainId` from the selected RPC and compare its decoded result to
   the intended ID above. This is read-only and requires no wallet key.
2. Check block freshness, required RPC methods, historical state at the fork
   block and rate limits. A successful chain-ID request alone is insufficient.
3. Verify compiler/EVM compatibility (the registry currently targets Cancun),
   gas behavior, token code/decimals and actual contract deployment size.
4. Run single-agreement and milestone tests separately on an isolated fork.
   A Hardhat fork does not fully reproduce a remote chain's consensus or fees.
5. Authorize a controlled public-testnet deployment and test complete application
   integration, roles, signatures, settlement, recovery and source verification.
6. Record commit, chain ID, block, bytecode and transaction evidence. Only then
   consider promoting a pending testnet profile. Mainnet requires a separate
   independent review and protected release approval.

Public endpoints are convenient for development, not an uptime guarantee.
Use authenticated provider access where needed, never log credential-bearing
URLs, and never put signer keys in this guide or unprotected CI jobs.
