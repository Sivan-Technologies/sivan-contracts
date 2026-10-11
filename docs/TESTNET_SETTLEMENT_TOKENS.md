# Testnet settlement-token selection

Checked 2026-10-07. Use `.env.settlement-tokens.example` as the public reference
for both single and milestone runners. It is not loaded automatically. Existing
private environment files were not changed.

## Verified metadata, not verified settlement

These four addresses match [Circle's testnet USDC list](https://developers.circle.com/stablecoins/usdc-contract-addresses).
Read-only RPC checks confirmed the intended chain ID, nonempty bytecode and
`symbol() = USDC`, `decimals() = 6` at the following blocks:

| Testnet | Token | Observed block (hex) |
| --- | --- | --- |
| Celo Sepolia | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` | `0x2455311` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x2d978e3` |
| Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0x12e0f10c` |
| Arc Testnet | `0x3600000000000000000000000000000000000000` | `0x3eeb8a3` |

No approval, funding, transfer or settlement transaction was sent. Metadata
alone does not prove transfer behavior, issuer controls or vault compatibility.
On Arc, use ERC-20 units for vault funding; do not pass native 18-decimal gas
amounts into the six-decimal token interface.

## BNB test-token identity checked on 2026-10-11

The [BNB-maintained bridge token list](https://github.com/bnb-chain/opbnb-bridge-tokens#opbnb-testnet-token-list)
identifies these BSC testnet (chain 97) L1 token addresses. Do not confuse them
with the separate opBNB L2 addresses in that list:

| Test token | Address | Observed decimals |
| --- | --- | --- |
| USDT | `0x337610d27c682e347c9cd60bd4b3b107c9d34ddd` | 18 |
| USDC | `0x64544969ed7ebf5f083679233325356ebe738930` | 18 |

Read-only calls confirmed code, symbols and decimals. These are test-only assets;
this is not a claim of native Circle/Tether issuance or production approval.
Actual approval, funding, claim and refund transactions remain unverified.

## Claim verification follow-up: 2026-10-11

Source under test: `34e824f`. The five-profile local Claim Vault matrix passed
145 cases (33 each for Celo/Base/Arbitrum, 23 each for Arc/BNB). It exercises
USDC-like 6/18-decimal and legacy-USDT-like fixtures, successful claim/refund,
fees, replay prevention and rollback. The separate local lifecycle also passed
deployment, approval, two deposits, relayed claim and expired refund with exact
balances. These are local fixtures, not public-token settlement evidence.

Public RPC reads confirmed the following chain IDs and token metadata; read-only
`eth_call` contract-creation simulations with the listed tokens also returned
runtime bytecode successfully on every target. No transaction was broadcast.

| Network | Chain ID | Observed latest block | Tokens checked |
| --- | --- | --- | --- |
| Celo Sepolia | 11142220 | 38416648 | USDC, 6 decimals |
| Base Sepolia | 84532 | 47966175 | USDC, 6 decimals |
| Arbitrum Sepolia | 421614 | 317990957 | USDC, 6 decimals |
| Arc Testnet | 5042002 | 66606179 | USDC, 6 decimals |
| BSC Testnet | 97 | 136119250 | USDC and USDT, both 18 decimals |

The latest block was recorded before metadata/simulation calls; those calls used
latest state, not a pinned historical snapshot. Constructor execution checks
token admission and bytecode execution, not token transfers or settlement.
Arc/BNB public RPC URLs were supplied only to the diagnostic process; no private
environment file or deployment gate was changed.

USDT testnet addresses for Celo/Base/Arbitrum/Arc remain unselected and unverified.
The issuer references reviewed did not establish those four testnet identities;
do not infer token availability from EVM support or use mainnet addresses on
testnet. A separately approved, clearly labeled test fixture can test mechanics,
but cannot certify a production token.

Presence-only environment inspection found missing claim-specific deployer
address/key, admin, treasury and token JSON on all five networks. Public funded
lifecycles cannot proceed from the current configuration. Never use unrelated
keys as a fallback. A public expired-refund test must wait the actual seven-day
window; local time travel is not public refund evidence. Frontend/backend
reconciliation, token controls and issuer/bridge risks also remain unverified.

## Why full remote E2E has not run

The local environment inspection found no network-specific deployer address/key
or admin address for any of these five targets, and no milestone funding-admin
or primary-reviewer configuration. It did not print secret values. External
protected signer configuration, wallet balances and Safe ownership remain
unverified. Arc and BNB deployment gates remain pending.

The current `lifecycle-live.js` is Celo-Sepolia-only and is not a five-network,
two-vault application harness. Do not bypass its chain guard to run elsewhere.

Before claiming a full remote result, prepare:

1. Verified BNB test token and funded test-only buyer wallets on all targets.
2. Test gas, separate signing roles and verified multisig policies; never send
   seed phrases or keys in chat.
3. Reviewed network-specific deployment preflights and guarded lifecycle tooling
   for both vaults, including restart/recovery journals.
4. Verified fresh deployments, source verification and required handovers.
5. Recorded transaction hashes for funding, delivery, release, partial settlement,
   refunds, disputes, escalation, pause and reviewer recovery; wait for actual
   deadlines on public networks rather than using local time travel.
6. Backend/frontend indexing and balance reconciliation against those receipts.

Local tests use test fixtures and are labeled as such. They do not replace
public-testnet transaction evidence or application integration tests.
