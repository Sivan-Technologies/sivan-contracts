# Claim vault: controlled EVM testnet deployment

Requested rollout scope: **Celo, Base, Arbitrum, Arc and BNB Smart Chain
(BEP-20 assets)**. `config/claim-targets.cjs` defines the five local test profiles.
Polygon and the other registry entries remain future/pending profiles, not part
of this five-network matrix.

This is a separate immutable `SivanClaimVault` release, not an agreement-vault
upgrade. Public deployment has **not** been performed by this tooling change.
Every mainnet remains blocked. The environment profile must be `testnet`, and
the actual RPC chain ID must match the selected shared network-registry entry.
No chain-specific Solidity fork is needed; each deployment has its own address,
token allowlist, treasury and EIP-712 domain chain ID.

| Chain family | Testnet command name | Chain ID | Deployment gate |
| --- | --- | --- | --- |
| Celo | `celoSepolia` | 11142220 | Candidate |
| Base | `baseSepolia` | 84532 | Candidate |
| Arbitrum | `arbitrumSepolia` | 421614 | Candidate |
| BNB Smart Chain (BEP-20 assets) | `bscTestnet` | 97 | Pending review |
| Polygon | `polygonAmoy` | 80002 | Pending review |
| Arc | `arcTestnet` | 5042002 | Pending review |
| Ethereum | `ethereumSepolia` | 11155111 | Pending review |
| Optimism | `optimismSepolia` | 11155420 | Pending review |
| Linea / Sonic | registry placeholders | Not configured | Pending review |

These identifiers describe the repository registry, not a fresh public-RPC
verification. `npm run claim:list` reports current gates. Candidate means the
tooling permits controlled testnet deployment, not certification of remote E2E.
Pending networks require compiler/opcode compatibility review, reviewed settlement
tokens, configured roles/gas and network evidence before a separately reviewed
registry promotion. This change does not promote pending networks or change the
single/milestone gates. BEP-20 names the token standard, not another chain.

## Configuration and approval

Use `.env.claim.example` for Celo and `.env.claim-networks.example` for the other
registered profiles as checklists; merge values into the ignored
`.env.testnet` or inject them at runtime. Do not overwrite existing env files.
No endpoint, token or key is supplied automatically. Use dedicated test wallets,
test tokens and test gas, never production credentials. The example is not loaded
automatically. Existing single and milestone deployment commands are unchanged.

Set separate claim deployer, admin and treasury addresses. `testnet_eoa` explicitly
permits test EOAs; `multisig` checks both control wallets using the existing
reviewed 2-of-3 Safe policy (owners, proxy/implementation/fallback code hashes,
no modules/guard). The deployer cannot be an owner in those policies. These
checks do not prove independent key custody. Owner is assigned directly by the
constructor: **no deployment ownership acceptance transaction is necessary**.
Subsequent ownership transfers use the contract's two-step process.

Each token entry requires exact address, symbol, decimals and runtime code hash
(`keccak256(eth_getCode(address))`). Establish the intended token independently
before filling these values. Matching a proxy code hash does not pin its
implementation or certify issuer identity, transfer behavior, freeze risk or
upgrade safety. The claim vault supports exact-transfer, non-rebasing assets;
metadata matching alone does not establish this. USDT needs its own review.

Before any public deployment, review the bearer-key policy: whoever has the link
key can authorize a claim, including the sender. Seven-day expiry permits only
the original sender's net refund; the 0.5% funding fee is nonrefundable. Refund
requires a transaction, wallet control and a transferable token; it is not an
automatic guarantee against issuer freezes.

```sh
npm run compile
npm run claim:test-deployment
npm run integration:check
npm run claim:challenge -- celoSepolia
npm run claim:preflight -- celoSepolia
# Same commands for other candidate profiles; use that network's env prefix:
npm run claim:preflight -- baseSepolia
npm run claim:preflight -- arbitrumSepolia
```

Challenge is offline after compilation. Preflight is read-only RPC inspection
and deployment simulation, not a transaction. Review its output and exact env
configuration. Only after explicit approval, commit the release (clean worktree),
set `CLAIM_DEPLOY_CONFIRM` to the printed hash and run:

```sh
# This command DOES broadcast a testnet deployment; do not run just to check setup.
npm run claim:deploy -- celoSepolia
```

The hash binds chain, roles, token metadata/policies, version and creation
bytecode. It is an operator confirmation, not an admin signature or independent
release approval. Use one deployment process per dedicated signer; do not send
concurrent transactions from that signer. The command estimates gas and checks
a 2x cost reserve, then repeats preflight before signing.

## Durable evidence and recovery

An exclusive `deployments/claim-<chainId>-<version>.json` record prevents accidental
overwrite. It records commit, constructor args, ABI, compiler/settings/input hash,
lockfile and creation bytecode hashes. Before broadcast it persists the nonce,
predicted address and signed transaction hash, **not** the private key/raw signed
transaction. A successful deployment waits two confirmations and records receipt
block/hash, runtime hash and owner/treasury/fee/window/token readbacks.
Two confirmations are evidence, not a universal finality guarantee. Receipt
waiting times out after three minutes; use recovery rather than resubmission.
Deploy, recover and verify share the same minimum-two-confirmation readback
policy. A receipt below that threshold is pending, not accepted. Readback also
checks the canonical block hash and rechecks that the receipt did not disappear
or change during state inspection. Verification repeats readback after explorer
submission. Evidence records minimum and observed confirmation counts.

After timeout or interruption, do not delete the record, change version or retry
deployment blindly. Restore the original config/build and use:

```sh
npm run claim:recover -- celoSepolia
```

Recovery never broadcasts. It checks the recorded successful receipt and state.
If no receipt exists, manually reconcile the recorded hash and sender nonce;
absence of a receipt does not prove that a transaction was never broadcast.
If failure happened before recording a hash, inspect that preflight journal and
confirm no broadcast occurred before any operator-approved restart.
Keep a backed-up copy of the journal: ignored local files are not durable off-host
storage. Journal files are trusted release artifacts, not user-supplied input.

## Source verification and activation

Configure the selected network's explorer API/browser URL and API key using the
existing Hardhat settings. Then:

```sh
npm run claim:verify -- celoSepolia
```

This submits source to the configured explorer, not a chain transaction. It
requires the matching build/config/journal and verifies the full contract name
and constructor arguments. Failed verification leaves `sourceVerification`
pending; inspect explorer evidence before retrying. Do not publish RPC credentials
or `.env` with release artifacts.

`readyForUse` remains false even after source verification. Publish an approved
versioned catalog only after application integration, claim/refund journeys,
token review, operational review and independent security review. Do not route
old deposits to a new address. No frontend/backend/relayer is implemented here.

## Local evidence scope

`claim:test-matrix` runs the complete claim-contract suite on five separate
ephemeral Hardhat chains using Celo, Base, Arbitrum, Arc and BNB testnet chain IDs.
It includes 6/18-decimal and legacy USDT fixtures, funding, relayed claim, expiry
refund, balance conservation, wrong-domain signatures and adversarial cases.
It also tests rollout gates for all profiles. Deployment-tooling tests run for
the three candidates only; Arc/BNB remain blocked in the actual public CLI.
`claim:test-deployment` runs the Celo deployment tests by default. They exercise signing,
broadcast, journal sequencing and readbacks plus failure guards. It is **not** a
public RPC, issuer-token or public explorer test. Merely using a chain's ID does
not reproduce its execution rules or fee model. Arc's native-gas/token accounting
and BNB's actual settlement token still need network-specific verification.
CI runs the matrix separately from the
existing agreement-vault fork job. Repeated compilation now fingerprints both
the existing single vault and the claim vault without changing either contract.
