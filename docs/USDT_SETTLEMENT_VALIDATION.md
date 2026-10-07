# USDT settlement validation

2026-10-07. Both single-agreement and milestone vaults remain token-address
allowlisted ERC-20 vaults, not USDC-only contracts. USDT requires a reviewed,
chain-specific address and metadata; a token symbol is not proof of issuance.

## Separate local lifecycle coverage

`test/single-and-milestone-end-to-end.test.js` now runs separate groups for USDC,
standard-return six-decimal USDT and legacy-style six-decimal USDT. The latter
uses `contracts/test/LegacyUsdtFixture.sol`, a deliberately local test fixture,
not a Tether contract and not an asset to deploy or add to production allowlists.

The 17 targeted tests passed (five USDC, twelve USDT). The full Hardhat regression
suite also passed: **275 tests**. Foundry and static analysis were not rerun in
this test-only pass. Coverage includes:

- Single-job funding and once-funded three-milestone funding.
- Delivery, attested single release, independent milestone releases, fees and
  partner revenue reconciliation, with no remaining vault balances on closure.
- Full single refund, disputed milestone escalation, partial ruling and remaining
  undelivered milestone refunds.
- Allowance/vault isolation, double-funding/release rejection and cross-vault
  signature rejection followed by valid settlement.
- Single-vault pause and fee changes do not alter milestone funding terms.
- Empty transfer return data, approval reset to zero before changing an allowance,
  and blocked treasury payouts rolling back both vaults before a successful retry.

The fixture is not a complete reproduction of issuer blacklist, pause, proxy,
fees or upgrade semantics. Standard-return USDT tests use a generic local ERC-20
fixture; neither fixture proves behavior of any public-chain token deployment.

Both production vaults already use OpenZeppelin SafeERC20 for token movements;
their Solidity business logic was not changed in this pass. Tether specifically
documents legacy Ethereum USDt transfer return behavior and recommends SafeERC20:
[official integration guidelines](https://tether.to/en/supported-protocols/).
Do not assume every chain's USDT has identical behavior or decimals.

## Remote end-to-end status: NOT RUN

No verified testnet USDT address has been configured for the five target chains.
No faucet token was relabeled as issuer-issued USDT, no mainnet address was copied
into a testnet configuration, and no public-chain transaction was sent.

For each network we still require the intended testnet token's source/address,
metadata and implementation review; funded test-only actors and verified Safes;
reviewed deployment/lifecycle tooling; and real approval, funding and settlement
receipts plus application reconciliation. Some target chains may not have an
official Tether test token. A faucet/synthetic token must be disclosed as such,
or actual-token compatibility must instead be tested on a reviewed isolated fork.

Keep both USDC and USDT as intended settlement assets, but add USDT to each
`TOKENS_JSON` and `MILESTONE_TOKENS_JSON` only after its exact address is verified.
Do not replace USDC entries when adding a verified second token.
