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

## BNB selection remains blocked

Circle's reviewed list contains no BNB Chain testnet USDC address. BNB's
[faucet documentation](https://docs.bnbchain.org/bnb-opbnb/developers/network-faucet/)
mentions test tokens, but that is not proof of a particular contract address or
Circle issuance. Obtain the intended faucet-issued token address and verify its
source, code and decimals before configuring it. No arbitrary token or locally
deployed mock is substituted as proof of a real BNB settlement integration.

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
