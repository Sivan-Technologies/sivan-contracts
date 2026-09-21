# Redeploy checklist, 18 days to submission

Colosseum final submission opens **6 October**. Treat that as the date everything
must already be done, not the date to start.

This is the critical path. Everything else on the list is optional; this is not,
because the currently deployed vault carries a bug that lets a delivery claim
lock a buyer's funds permanently.

---

## Why the existing vault cannot be used

`0x0592edf36Ec65A809f5230cEd5BadBe472787CAf` was deployed before five audit
findings were fixed. Three were High:

1. a late dispute could re-lock a refund the buyer had already earned
2. re-pricing the review window retroactively revoked an available refund
3. the owner could renounce ownership mid-dispute and strand the funds forever

It is not a proxy, so none of this can be patched in place. **Do not verify it on
Blockscout and do not link it anywhere.** A verified vulnerable contract is worse
than an unverified one, because verification is what invites people to trust and
integrate it.

---

## Budget

Measured against a fork of live Celo Sepolia at 52.5 gwei, not estimated:

| Step | Gas | CELO |
| --- | --- | --- |
| Deploy vault | 3,684,688 | 0.193 |
| Seed allowlist (3 assets) | 120,503 | 0.006 |
| **Deploy total** | **3,805,191** | **0.200** |
| Lifecycle, 15 transactions | ~2,240,385 | ~0.118 |

Budget **0.35 CELO** for everything. The faucet gives more than enough.

Three funded wallets are needed, because `deposit()` rejects an agreement where
the contractor is the buyer:

- **deployer**, which becomes the vault owner and the dispute arbiter
- **buyer**, which needs test USDC as well as CELO
- **contractor**, which needs only gas

---

## Step 1: get the code

```bash
git clone -b staging https://github.com/Sivan-Technologies/sivan-contracts.git
cd sivan-contracts
npm install
npx hardhat test
```

Expect **107 passing**. If it is lower, stop and say so rather than deploying.

## Step 2: generate three keys

```bash
for i in 1 2 3; do
  node -e "const w=require('ethers').Wallet.createRandom();console.log(w.address, w.privateKey)"
done
```

Fresh keys only. The deployer ends up owning a contract that can pause settlement
and adjudicate disputes.

## Step 3: fund them

CELO from `https://faucet.celo.org/celo-sepolia`, for all three addresses.

The buyer also needs test USDC at
`0x01C5C0122039549AD1493B8220cABEdD739BC44E`. At least 30 USDC covers the
lifecycle with room to spare.

Confirm before continuing:

```bash
RPC=https://forno.celo-sepolia.celo-testnet.org
for A in 0xDEPLOYER 0xBUYER 0xCONTRACTOR; do
  echo -n "$A CELO: "
  curl -s -X POST $RPC -H 'Content-Type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$A\",\"latest\"],\"id\":1}"
done
```

## Step 4: fill in `.env`

```
DEPLOYER_PRIVATE_KEY=0x...
BUYER_PRIVATE_KEY=0x...
CONTRACTOR_PRIVATE_KEY=0x...

SIVAN_FEE_COLLECTOR=0x...
SIVAN_AGENT_ATTESTER=0x...
```

On testnet the fee collector and attester default to the deployer if left blank,
which is fine. On mainnet the script refuses to run without them, because
defaulting there would put protocol revenue and attestation authority on a hot
deploy key.

**The attester must be a key you hold.** It is the only address that can sign a
delivery attestation, and `releasePayment` requires one whenever an agreement has
reached `Delivered`. If that key is lost, every delivered agreement becomes
unreleasable, and the failure only surfaces when a real contractor tries to get
paid.

## Step 5: deploy

```bash
npm run deploy:sepolia
```

Expected output, matching the fork rehearsal apart from the addresses:

```
Vault deployed: 0x...
  deploy tx: 0x... (block ...)
  gas used : 3684688

Verifying tokens on chain before listing:
  USDC  0x01C5C0122039549AD1493B8220cABEdD739BC44E  symbol=USDC decimals=6
  USDm  0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b  symbol=USDm decimals=18
  USDT  0xd077A400968890Eacc75cdc901F0356c943e4fDb  symbol=USD-T decimals=6

Listed 3 assets in one transaction.
Allowlist enforced and every listed asset confirmed on chain.

Roles read back from the deployed contract:
  owner              0x... OK
  feeCollector       0x... OK
  agentAttester      0x... OK
  registeredAgentId  9827  OK
```

Every hash is written to `deployments/celoSepolia-<address>.json`. The last
deployment finished without recording them and they had to be recovered from a
block explorer afterwards.

## Step 6: verify the source

Copy the `npx hardhat verify ...` line the script prints. Constructor order is
`(feeCollector, agentAttester, registeredAgentId, initialOwner)`, and
transposing those is the usual reason verification fails on a correct contract.

No API key is needed; verification goes to Blockscout. Then open
`https://celo-sepolia.blockscout.com/address/<VAULT>` and confirm the Contract
tab shows green source.

## Step 7: prove you control the attester key

```bash
ATTESTER_PRIVATE_KEY=0x... VAULT=0x... \
  npx hardhat run scripts/check-attester.js --network celoSepolia
```

Read only, no gas. It signs a probe attestation over an agreement id that will
never exist, then recovers it against the domain separator read back from the
contract itself. A local check with ethers would only prove ethers agrees with
itself and would pass even with a wrong domain.

Without the key it exits non-zero and says UNPROVEN rather than reporting
success.

## Step 8: run the live lifecycle

```bash
VAULT=0x... npx hardhat run scripts/lifecycle-live.js --network celoSepolia
```

Every precondition is checked before the first transaction: three distinct
funded signers, the deployer actually owning the vault, the token allowlisted,
the attester key present, and the buyer holding enough USDC. It refuses to
fabricate balances on a live network.

It runs three scenarios that complete in one sitting, then opens a fourth that
depends on a real deadline:

1. deposit, markDelivered, releasePayment against a live agent attestation
2. deposit, raiseDispute, resolveDispute to the buyer, with no fee taken
3. a timeout agreement opened now, resumed later

Finish the third once its printed deadline passes:

```bash
VAULT=0x... RESUME=0x<agreementId> \
  npx hardhat run scripts/lifecycle-live.js --network celoSepolia
```

Recovery needs **only the buyer's key**. It works with the vault paused, the
token delisted and the buyer holding no free tokens, which was tested
explicitly, so a stuck agreement can always be exited.

---

## What this produces

A verified contract plus roughly a dozen real transactions on a public explorer,
covering deposit, release, dispute resolution and timeout refund.

That replaces "two settlements" as the traction evidence. It is checkable by a
judge in one click, and it costs only testnet gas. Two settlements invites
scepticism; a verified contract with a full lifecycle on chain invites reading
the code.

Send me the deploy output and I will verify bytecode, roles, allowlist, fee
tiers and the dispute constants. All read only, so it costs nothing.
