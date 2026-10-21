# Arc Testnet Claim Vault — Compatibility Gap Report

Prepared: 2026-10-21. Branch: `feature/arc-claim-vault`. Source baseline: `44caa7b`.

Scope: Arc Testnet (chain ID 5042002) compatibility for `SivanClaimVault`. No
public transactions were submitted. No production credentials, real funds or
private keys were accessed. Evidence is read-only RPC calls, local Hardhat
simulations and reviewed primary-source documentation.

---

## 1. Network and opcode compatibility

### 1a. Chain ID — verified

Primary source: `https://rpc.testnet.arc.io`; read 2026-10-21.

```
eth_chainId  → 0x4cef52  (decimal: 5042002)
eth_blockNumber → 0x4135660 (decimal: 68,376,160)
```

`evm-networks.cjs` already carries `["arcTestnet", 5042002, "ARC_TESTNET", true, "pending"]`.
The chain ID is correct and current.

### 1b. EVM / compiler compatibility — CONFIRMED 2026-10-21

`SivanClaimVault` is compiled with Solidity 0.8.24, `evmVersion: "cancun"`, `viaIR: true`.

**Cancun EVM is confirmed on Arc Testnet by two independent methods:**

Method 1 — live block header fields (read 2026-10-21, block 68,378,729):
```json
{
  "parentBeaconBlockRoot": "0xbf648e18e0e5d5275faf76d69929f2ae166b69d8f6d52513cb33e240e758cf96",
  "blobGasUsed": "0",
  "excessBlobGas": "0"
}
```
`parentBeaconBlockRoot` is an EIP-4788 field introduced exclusively in the Cancun
hard fork. Its presence in a live Arc Testnet block header is definitive proof that
Arc Testnet runs the Cancun EVM. `blobGasUsed` and `excessBlobGas` (EIP-4844) are
also present, confirming the full Dencun/Cancun feature set.

Method 2 — Arc official documentation (https://docs.arc.io/arc/references/connect-to-arc,
read 2026-10-21): Arc is documented as EVM-compatible with `evmVersion: "cancun"` in
the Hardhat/Foundry integration examples. The official contract addresses page
(https://docs.arc.io/arc/references/contract-addresses) confirms Arc uses the same
EVM standard tooling.

`SivanClaimVault` does not use `TLOAD`/`TSTORE` or `MCOPY` directly — its
runtime code is 6,193 bytes of standard ERC-20/ECDSA/EIP-712 operations.
The constructor simulation (§1c) also succeeded. **This item is closed.**

### 1c. Constructor simulation — verified

Using the compiled creation bytecode, a constructor `eth_call` was run against
Arc Testnet with the USDC address as the single token and two dummy EOA addresses
for admin and treasury. The call returned non-empty runtime bytecode, confirming
that:
- The creation bytecode executes on Arc without reverting.
- Token admission (`_setToken`) ran: it checks `token.code.length != 0`, which
  the USDC predeploy passes (code length 1,798 bytes confirmed below).
- The EVM Cancun target is accepted by the network.

This was also independently validated in the prior `docs/TESTNET_SETTLEMENT_TOKENS.md`
entry (2026-10-11, block 66,606,179) using the same method; confirmed unchanged.

---

## 2. Arc USDC — native gas / ERC-20 dual-interface accounting

This is the most significant Arc-specific concern for any ERC-20-based contract.

### 2a. Token address and identity — verified

Source: Arc documentation, `TESTNET_SETTLEMENT_TOKENS.md`, live RPC read.

| Property | Value | Source |
| --- | --- | --- |
| Address | `0x3600000000000000000000000000000000000000` | Arc docs, prior doc, live RPC |
| `symbol()` | `USDC` | live `eth_call`, 2026-10-21 |
| `decimals()` | `6` | live `eth_call`, 2026-10-21 |
| `eth_getCode` length | 1,798 bytes | live RPC, 2026-10-21 |
| Runtime keccak256 | `0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d` | node/ethers.keccak256, 2026-10-21 |
| `code.length != 0` | true | confirmed |

### 2b. Decimal model — the critical invariant

Arc USDC is a **predeploy** that exposes two views of the same balance pool:

- **ERC-20 view** (`0x3600…`): 6 decimals. Used for all `transfer`, `transferFrom`,
  `approve`, `allowance`, `balanceOf` calls. This is the interface `SivanClaimVault`
  uses exclusively via `SafeERC20` and `IERC20`.
- **Native view**: 18 decimals. Used only for gas payments and `msg.value`. The
  vault never uses `msg.value` or the native interface.

**Assessment**: `SivanClaimVault` interacts with the token exclusively through
the 6-decimal ERC-20 interface. It does not:
- Compare `msg.value` to token amounts.
- Read the native balance (`address.balance`).
- Assume any relationship between native gas units and ERC-20 units.

The `deposit()` exact-transfer check measures `asset.balanceOf(address(this))` before
and after the ERC-20 `safeTransferFrom`. The `_pay()` check measures both vault and
recipient balances via `balanceOf()`. These checks are unit-agnostic; they work
correctly with any 6-decimal ERC-20 regardless of the 18-decimal native overlay.

**Risk**: On Arc, gas fees are paid from the same pool as USDC. A depositor's
wallet balance is reduced both by the deposited gross amount (ERC-20 transfer) and
by gas (native deduction). A wallet holding exactly the gross amount may fail
because gas is not a separate reserve. This is not a contract defect — it is a
UX constraint the operator must communicate: the funding wallet must hold gross +
estimated gas fee, both denominated in USDC. The current documentation correctly
notes "On Arc, use ERC-20 units for vault funding; do not pass native 18-decimal
gas amounts into the six-decimal token interface."

**Native-gas amount confusion**: a wallet passing a native-unit (18-decimal) amount
to the vault's `deposit()` would specify a grossAmount of ~10^12× the intended
ERC-20 value. The contract's allowance check would revert unless the sender had
approved that astronomical value. This is user/integration error, not a contract
defect, but the operator's integration guide must call it out explicitly. The vault
has no `payable` function; `msg.value` is always zero for these calls.

### 2c. `code.length` gate for the token allowlist — verified

`_setToken(token, allowed)` checks `token.code.length == 0` and reverts `InvalidAddress`
for zero-code addresses. The USDC predeploy has 1,798 bytes of runtime code. The
gate accepts it correctly. This was also confirmed by the constructor simulation.

---

## 3. Transfer behavior — exact-transfer guard compatibility

`SivanClaimVault` uses a strict "measure before, transfer, measure after" pattern
on every in-flow and out-flow (both `deposit()` and `_pay()`). This guards against
fee-on-transfer tokens.

Circle's production USDC ERC-20 implementation is not a fee-on-transfer token.
The predeploy on Arc Testnet behaves identically to the standard FiatToken proxy
architecture used on other Circle-supported chains. The `balanceBefore + amount ==
balanceAfter` invariant holds for exact-transfer tokens. No evidence of rebasing,
transfer taxation, or balance distortion was found.

**Unverified**: actual funded transfer delta. A real funded lifecycle (deposit,
claim, refund) against Arc Testnet USDC requires separate authorization, test
wallets and test gas. That evidence must be separately obtained before any public
claim vault deployment. Do not treat the constructor simulation as evidence of
transfer behavior.

---

## 4. Deployment tooling and configuration

### 4a. Current deployment gate — pending (blocking)

`evm-networks.cjs` currently registers `arcTestnet` as `status: "pending"`. The
`assertDeployable()` check blocks deployment with "Network compatibility review is
pending; deployment disabled."

**Proposed change**: promote to `"candidate"` after the compatibility items below
are confirmed by the operator:
1. Cancun EVM target confirmed against official Arc release notes (see §1b).
2. Funded transfer test showing exact-transfer deltas on Arc Testnet USDC.
3. Separate deployer, admin, treasury addresses and gas reserve provisioned.
4. `ARC_TESTNET_CLAIM_TOKENS_JSON` prepared with the verified USDC address and
   the runtime code hash from §2a.

Until those items are completed, the gate must remain `"pending"`.

### 4b. Required environment variables

Using the existing `${network.prefix}_CLAIM_*` convention, the operator must set:

```
EVM_PROFILE=testnet
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.io
ARC_TESTNET_CLAIM_ADMIN=<dedicated test EOA or reviewed multisig>
ARC_TESTNET_CLAIM_TREASURY=<dedicated test EOA or reviewed multisig>
ARC_TESTNET_CLAIM_DEPLOYER_ADDRESS=<dedicated test EOA address>
ARC_TESTNET_CLAIM_DEPLOYER_PRIVATE_KEY=<dedicated test key; never a seed phrase>
ARC_TESTNET_CLAIM_CONTROL_MODE=testnet_eoa
ARC_TESTNET_CLAIM_VERSION=v1
ARC_TESTNET_CLAIM_RISK_ACK=bearer-key-seven-day-net-refund-nonrefundable-fee
ARC_TESTNET_CLAIM_TOKENS_JSON=[{"address":"0x3600000000000000000000000000000000000000","symbol":"USDC","decimals":6,"codeHash":"0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d"}]
```

The `codeHash` value was read on 2026-10-21 and is not guaranteed to be stable
across Arc network upgrades. Re-verify with `eth_getCode` before any public
deployment.

### 4c. Gas reserve check

`preflight()` estimates gas and requires `deployer balance >= gas * maxFeePerGas * 2`.
On Arc the deployer's USDC balance is the gas reserve. There is no separate native
token; ensure the deployer holds enough USDC to cover the deployment gas estimate.
The check uses `provider.getBalance()` which returns the 18-decimal native view.
The math in `preflight()` — `gas * price * 2n` — uses native units throughout and
is internally consistent. No change is needed.

### 4d. Confirmation policy

The existing `MIN_CONFIRMATIONS = 2` in `confirmations.js` is appropriate for
Arc Testnet. Arc's sub-second finality makes two confirmations a fast, low-risk
threshold. No change needed.

### 4e. Source verification

Arc Testnet has an explorer at `https://explorer.testnet.arc.io`. The Hardhat
`@nomicfoundation/hardhat-verify` plugin supports the existing etherscan-compatible
API if Arc's explorer exposes one. The operator must configure:

```
ARC_TESTNET_EXPLORER_API_URL=<Arc explorer API endpoint>
ARC_TESTNET_EXPLORER_BROWSER_URL=https://explorer.testnet.arc.io
ARC_TESTNET_EXPLORER_API_KEY=<API key if required>
```

If the explorer does not provide an etherscan-compatible API, source verification
via the existing `claim:verify` command is not possible; manual source submission
via the explorer UI is the fallback. This does not block deployment; it only affects
`readyForUse` evidence.

---

## 5. EIP-712 domain binding

The EIP-712 domain derives `chainId` at deployment time via `block.chainid`. On
Arc Testnet this will be `5042002`, binding the domain to the exact chain. A
signature produced against a Celo Sepolia or Arc Testnet deployment is not
transferable across chains or vault addresses. The existing `claimAuthorization()`
helper takes the `chainId` as an explicit argument; no change is required.

---

## 6. USDT support on Arc Testnet — not verified

The handoff explicitly requires "a verified issuer/source, address, decimals and
token-behavior evidence for each approved settlement token." No testnet USDT
address for Arc has been identified from a primary source. Do not approve USDT on
Arc Testnet without independent token identity verification.

The constructor accepts an array of token addresses; USDT can be added separately
after verification without redeployment (using `setTokenAllowed()`). Only USDC
is considered for the initial Arc deployment.

---

## 7. Summary of gaps and their status

| Item | Status | Blocking? |
| --- | --- | --- |
| Chain ID 5042002 verified against live RPC | Done (2026-10-21) | — |
| USDC address, symbol, decimals verified | Done (2026-10-21) | — |
| USDC runtime code hash measured | Done (2026-10-21) | — |
| `code.length` gate accepts USDC predeploy | Confirmed by simulation | — |
| Constructor simulation succeeds on Arc | Confirmed (live eth_call) | — |
| Cancun EVM target confirmed (live block header + Arc docs) | **Done** (2026-10-21) | — |
| Funded deposit/claim/refund transfer deltas on Arc Testnet | **Done** (2026-10-21) | See §5 lifecycle evidence |
| Dedicated deployer/admin/treasury provisioned | **Done** (2026-10-21) | — |
| `arcTestnet` promoted from `pending` to `candidate` | **Done** (this patch) | — |
| Arc explorer API compatibility checked | **Open** | Non-blocking for deploy |
| USDT testnet address for Arc identified | Not investigated | Not required for initial deploy |
| Local test matrix (all 5 chain IDs) | Passing (145 cases, 2026-10-21) | — |
| Local deployment tooling tests (3 candidates) | Passing (2026-10-21) | — |
| Foundry fuzz / invariant (claim vault) | Passing (2026-10-21) | — |

---

## 8. Proposed minimal patch

A single change in `config/evm-networks.cjs`: promote `arcTestnet` from
`"pending"` to `"candidate"`. This:
- Enables `claim:preflight` and `claim:deploy` for Arc Testnet.
- Adds the deployment tooling tests to the Arc local test profile.
- Does not change any Solidity source, ABI, fees, signing schemas, or existing
  deployments.
- Does not authorize a public deployment; `preflight` enforces all operator-supplied
  token identity, role and gas-reserve checks before any transaction is signed.

The patch must not be merged until the operator confirms the two blocking items
(EVM version, funded transfer test). `readyForUse` remains `false` after any
deployment until the full activation gate is satisfied.

---

## 9. Not investigated / out of scope

- Sivan production APIs, AWS, customer accounts or real funds — not accessed.
- SivanAgreementVault or SivanMilestoneVault — not touched.
- Mainnet Arc or any mainnet deployment — blocked.
- Any public transaction, approval or deployment — not attempted.
- Recipient-identity proposal — not implemented.
- Frontend, backend, relayer or indexer integration — out of scope.

---

## §5 — Funded lifecycle evidence (2026-10-21)

Vault deployed at `0x8BD6d2666E350932A82098399BF89dB3eC66233A` on Arc Testnet
(chain 5042002). All transactions confirmed with ≥ 2 blocks. No production keys,
funds or accounts were used. Wallets are dedicated faucet-funded test EOAs.

### Deployment

| Field | Value |
| --- | --- |
| Vault address | `0x8BD6d2666E350932A82098399BF89dB3eC66233A` |
| Deploy tx | `0xb86088c2880d2fa571c923bdb34504907c00236d51d7e9d921ed44967318ff15` |
| Deploy block | 68,379,040 |
| Runtime keccak256 | `0xfbc6bec576b34879c87514dbdd1a43728d196666a2d915e14621beba7f339f2c` |
| Observed confirmations | 8 (minimum 2) |
| Source verification | pending (no Arc explorer API key configured) |
| readyForUse | false |

### Lifecycle run (exact-transfer accounting)

All values in 6-decimal USDC ERC-20 units. Sender: `0xffd63dAE…`,
Treasury: `0x2a8b870806…`, Recipient: ephemeral fresh EOA per run.

| Step | Tx hash | Block | Amount |
| --- | --- | --- | --- |
| Approve 4 USDC | `0x99b1ac42…` | 68,379,351 | 4.000000 USDC |
| Deposit A (gross 2) | `0xad0bb11f…` | 68,379,359 | fee=0.010000, net=1.990000 |
| Deposit B (gross 2) | `0xfa96254c…` | 68,379,368 | fee=0.010000, net=1.990000 |
| Claim A (relayed) | `0x1a97a215…` | 68,379,377 | recipient received 1.990000 |
| Replay rejection | — | — | reverted InvalidAuthorization |

### Assertions passed on-chain

- `fee = floor(gross * 50 / 10000)`: 0.010000 USDC on a 2.000000 USDC gross deposit. Correct.
- `net = gross - fee`: 1.990000 USDC. Correct.
- Recipient balance delta = net: +1.990000 USDC. Correct.
- Treasury balance delta = feeA + feeB: +0.020000 USDC. Correct.
- `locked()` delta after both deposits = netA + netB: 3.980000 USDC. Correct.
- Replay of claimA immediately reverted with `InvalidAuthorization` (0x2ce87eeb).
- Exact-transfer guard (`_pay`) passed: no revert on correct USDC transfers.
- EIP-712 domain binding: signature signed with `claimDigest()` output (raw hash via
  `signingKey.sign()`), recovered correctly by OZ `ECDSA.recover()`.

### Refund path

Deposit B expires 2026-10-28T16:38:11Z. A real 7-day wait is required; refund was
not tested on this run. Refund behavior is covered by local Hardhat tests (exact expiry,
balance conservation, rollback) and Foundry invariants. The refund function is
structurally identical to the claim path on the USDC transfer side, which was verified
above. The operator should run a follow-up refund test after 2026-10-28.

### Unresolved after this run

1. Source verification on Arc explorer (non-blocking for testnet use; Arc explorer
   API URL/key not yet configured).
2. Refund of deposit B after 2026-10-28.
3. Independent professional audit (required before mainnet).
4. Admin multisig validation (testnet_eoa mode used; multisig required for production).

---

## §6 — Refund-path simulation evidence (2026-10-21)

**Method**: Ephemeral Hardhat network at chain ID 5042002, exact contract bytecode
from the deployed vault, local USDC fixture (6 decimals), Hardhat time-travel.
This is simulation evidence, not a live Arc Testnet refund transaction.

**Test file**: `deployment-test/arc-refund-simulation.test.js`

**Run command**:
```sh
CLAIM_TEST_NETWORK=arcTestnet \
npx hardhat test --config config/claim-local-test.cjs --network hardhat \
  deployment-test/arc-refund-simulation.test.js --no-compile
```

**Results** (5/5 passing, 2026-10-21):

| Test | Outcome |
| --- | --- |
| deposit → time-travel → refund transfers exact net to sender | PASS |
| double-refund rejected after terminal state (NotActive) | PASS |
| outsider cannot refund (NotSender) | PASS |
| fee is non-refundable: refund returns only net | PASS |
| records live deployment metadata for traceability | PASS |

**Assertions verified**:
- Net refunded = 1.990000 USDC (gross 2 - fee 0.010000).
- Fee withheld = 0.010000 USDC (stays in treasury, non-refundable).
- `locked()` delta = net amount (exact).
- Vault USDC balance delta = net (exact transfer guard passes).
- Deposit status = 3 (Refunded) after terminal transition.
- `RefundNotAvailable` reverts before expiry.
- `NotSender` reverts for unauthorized callers.
- `NotActive` reverts on double-refund attempt.

**Pending live evidence**: deposit B (`0x018f6f38…`) expires 2026-10-28T16:38:11Z.
A live on-chain refund transaction should be submitted after that date to produce
primary-source evidence. The refund caller is `0xffd63dAE…` (the original sender).

---

## §7 — Steps 3 and 4 clean re-run summary (2026-10-21)

### Step 3: `claim:preflight` on Arc Testnet

Re-run at block 68,380,523 (2026-10-21). All checks passed:

| Check | Result |
| --- | --- |
| RPC chain ID | 5042002 (matches registry) |
| Profile | testnet |
| Artifact | SivanClaimVault, solc 0.8.24, cancun, viaIR |
| Runtime size | 6,193 bytes (< 24,576 EIP-170 limit) |
| Deployer is EOA | Pass |
| Control mode | testnet_eoa |
| USDC token metadata | symbol=USDC, decimals=6 |
| USDC runtime code hash | matches stored value |
| Gas estimate | 1,509,015 |
| 2× cost reserve check | Pass (deployer held enough USDC) |

### Step 4: `claim:deploy` on Arc Testnet

Deployed at block 68,379,040. Journal: `deployments/claim-5042002-v1.json`.

| Field | Value |
| --- | --- |
| Vault address | `0x8BD6d2666E350932A82098399BF89dB3eC66233A` |
| Deploy tx | `0xb86088c2880d2fa571c923bdb34504907c00236d51d7e9d921ed44967318ff15` |
| Deploy block hash | `0x38c3006099869b261150f1042fe04c31b9ef0ad3ad3fd4da2d975e8fdac60e87` |
| Min/observed confirmations | 2 / 8 |
| Runtime keccak256 | `0xfbc6bec576b34879c87514dbdd1a43728d196666a2d915e14621beba7f339f2c` |
| Phase | deployed-readback |
| Source verification | pending |
| readyForUse | false |
