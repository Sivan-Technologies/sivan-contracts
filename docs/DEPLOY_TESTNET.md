# Deploying the vault to Celo testnet

> **The first Sepolia vault `0x0592edf36Ec65A809f5230cEd5BadBe472787CAf` is
> superseded and must not be used.** It carries the delivery lockup bug, where
> a false delivery claim filed after the deadline permanently blocked the
> buyer's refund. The contract is not proxied, so it cannot be upgraded.
> Redeploy from `staging` and treat the old address as a throwaway. Do not
> verify the old address on Blockscout: a verified vulnerable contract is worse
> than an unverified one, because verification is what invites people to trust
> and integrate it. See [the delivery and dispute policy](DELIVERY_DISPUTE_POLICY.md).

**Read this first: the testnet changed.** Alfajores (chain 44787) was sunset on
30 September 2025 together with Ethereum Holesky, which it was anchored to. Its
RPC endpoints no longer answer. Celo's testnet is now **Celo Sepolia, chain
11142220**, anchored to Ethereum Sepolia. It started from a clean slate, so no
Alfajores contract or token address carries over.

Everything below was rehearsed end to end against a local fork of live Celo
Sepolia before being written down. The numbers are measured, not estimated.

| | |
|---|---|
| Network name in hardhat | `celoSepolia` |
| Chain ID | 11142220 |
| RPC | `https://forno.celo-sepolia.celo-testnet.org` |
| Explorer | `https://celo-sepolia.blockscout.com` |
| Faucet | `https://faucet.celo.org/celo-sepolia` |
| Backup faucet | `https://cloud.google.com/application/web3/faucet/celo/sepolia` |
| Cost of a full deploy | 3,539,101 gas = **0.186 CELO** at 52.5 gwei |

---

## Before you start: the key

You said you have a private key in a new wallet. Two things matter.

**Never paste it into a chat, an issue, a commit, or a screenshot.** It only
ever goes in `.env`, which is gitignored. Three GitHub tokens were already
revoked mid-session this month, most likely by secret scanning, which is a good
reminder of how fast a leaked credential gets caught and how much faster it gets
used.

**Confirm it is genuinely a throwaway.** The deployer becomes the vault's
initial owner, which can pause settlement and re-price fees. On testnet that is
fine. Do not reuse this key on mainnet later, and do not use a wallet that holds
real funds on any chain. If you generated it inside MetaMask as a fresh account,
that is fine; if it is your everyday wallet, generate a new one:

```bash
node -e "const w=require('ethers').Wallet.createRandom();console.log('addr',w.address);console.log('key ',w.privateKey)"
```

---

## Step 1: get the code

```bash
git clone https://github.com/Sivan-Technologies/sivan-contracts.git
cd sivan-contracts
git checkout staging
npm install
```

## Step 2: prove the tests pass before spending anything

```bash
npx hardhat test
```

Expect **75 passing**. If that number is lower, stop and say so. Deploying a
contract whose tests do not pass wastes the deploy and, worse, produces an
address you will be tempted to treat as real.

## Step 3: fund the wallet

Go to `https://faucet.celo.org/celo-sepolia`, paste your wallet **address**
(the `0x...` public one, never the key), and request CELO. Confirm it landed:

```bash
curl -s -X POST https://forno.celo-sepolia.celo-testnet.org \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'
```

A non-zero hex result means you are funded. You need 0.186 CELO; the faucet
gives considerably more.

## Step 4: fill in `.env`

```bash
cp .env.example .env
```

Then edit it. The minimum for testnet is one line:

```
DEPLOYER_PRIVATE_KEY=0xyour_key_here
```

Leave `SIVAN_FEE_COLLECTOR` and `SIVAN_AGENT_ATTESTER` empty on testnet and they
default to the deployer, which is what you want while testing. On **mainnet**
the script refuses to run unless both are set to separate addresses, because
defaulting them there would put protocol revenue and the attestation authority
on a hot deploy key.

There are no token addresses to fill in. All three Celo Sepolia assets are
hardcoded in `scripts/deploy.js` and were each read back off chain with
`symbol()` and `decimals()` before being committed.

## Step 5: deploy

```bash
npx hardhat run scripts/deploy.js --network celoSepolia
```

Expected output, matching the fork rehearsal exactly except for the addresses:

```
Deploying SivanAgreementVault
  network : celoSepolia (chainId 11142220)
  deployer: 0x...
  fee collector : 0x...
  agent attester: 0x... (ERC-8004 #9827)

Vault deployed: 0x...

Verifying tokens on chain before listing:
  USDC  0x01C5C0122039549AD1493B8220cABEdD739BC44E  symbol=USDC decimals=6
  cUSD  0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b  symbol=USDm decimals=18
  USDT  0xd077A400968890Eacc75cdc901F0356c943e4fDb  symbol=USD₮ decimals=6

Listed 3 assets in one transaction.
Allowlist enforced and every listed asset confirmed on chain.

Fee tiers (whole token units, scaled per token decimals):
  <= 50 units : 100 bps
  <= 500 units : 75 bps
   > 500 units : 50 bps
```

**Three things in that output are the point of it**, not decoration:

- Each token is re-verified on chain at deploy time. A token that stops
  answering `symbol()` is skipped with a message rather than silently listed.
- `Allowlist enforced` is asserted by reading `tokenAllowlistEnforced()` back.
  The vault starts permissive and only begins enforcing once a first token is
  listed, so a deploy that seeded nothing would accept arbitrary ERC-20s
  forever. Without this assertion the script could report success while leaving
  that hole open.
- USDC is listed **first**. It is the primary settlement asset, and it is also
  the only one of the three that can settle x402 on Celo, because Mento's
  StableTokenV2 implements EIP-2612 permit but not the EIP-3009
  `transferWithAuthorization` that x402's gas-sponsored flow requires.

## Step 6: verify the source on the explorer

Copy the `npx hardhat verify ...` line the script prints and run it. It already
has the constructor arguments filled in, in the right order.

```bash
npx hardhat verify --network celoSepolia <VAULT_ADDRESS> <feeCollector> <agentAttester> 9827 <owner>
```

No API key is needed. Verification goes to Blockscout, not Celoscan: Celoscan's
V1 API now rejects every request with "You are using a deprecated V1 endpoint"
and its V2 replacement requires an Etherscan key.

Then open `https://celo-sepolia.blockscout.com/address/<VAULT_ADDRESS>` and
confirm the Contract tab shows green source.

## Step 7: send me the output

Paste the deploy log and the vault address. Everything worth checking after
that is read-only, so it costs nothing and needs no key:

- bytecode at the address is non-empty and matches the local artifact
- `tokenAllowlistEnforced()` is `true`
- all three tokens return `true` from `supportedTokens()`
- `owner()`, `feeCollector()`, `agentAttester()` are the addresses you intended
- fee tiers read back as 100 / 75 / 50 bps

---

## Rehearsing without spending anything

You can run the entire deployment against a local fork of live Celo Sepolia,
using the real token contracts and a throwaway anvil key. Nothing touches the
public chain.

```bash
anvil --fork-url https://forno.celo-sepolia.celo-testnet.org --port 8546 --chain-id 11142220
# in another terminal
npx hardhat run scripts/deploy.js --network celosepoliafork
```

This is how the gas figure above was measured and how every claim in this
document was checked.

---

## If something goes wrong

**`Alfajores was sunset on 30 Sep 2025`**. You passed `--network alfajores`.
Use `celoSepolia`. The script fails fast here on purpose; the alternative was
watching a DNS lookup time out and guessing why.

**`DEPLOYER_PRIVATE_KEY is empty`**. `.env` is missing or the variable is
blank. This is checked before any network call, so a config mistake does not
arrive disguised as a DNS error.

**`is not a 32-byte hex key`**. Expected 64 hex characters, `0x` optional. A truncated
paste is the usual cause.

**`insufficient funds`**. The faucet has not landed yet. Re-check the balance.

**`No tokens verified. Refusing to leave the vault permissive.`** The RPC is
unreachable or all three token addresses stopped answering. Do not work around
this. It is the guard doing its job: finishing the deploy would leave a vault
that accepts any ERC-20.
# Branch synchronization note (2026-09-17)

The existing deployed vault and its verified USDC-only allowlist are recorded in
[CELO_SEPOLIA_DEPLOYMENT.md](CELO_SEPOLIA_DEPLOYMENT.md). Do not redeploy it merely
to follow this runbook. Configure `CELO_SEPOLIA_RPC_URL`, `CELO_SEPOLIA_CHAIN_ID`,
and `CELO_SEPOLIA_USDC` in `.env`, plus explicit fee collector and attester
addresses, before any new remote Sepolia deployment. Remote deployments seed
USDC only; the three-token rehearsal below applies to `celosepoliafork`.
Blockscout verification configuration is now included, but source verification
of the recorded vault has not been performed by this synchronization.
