# Sivan Claim Vault — Testnet Frontend

Standalone Vite + React + TypeScript UI for **SivanClaimVault v1** on Arc Testnet.
For testing only — no real funds. Connects directly to the deployed vault and Arc Testnet USDC.

## Quick start

```sh
cd frontend
bun install
bun run dev       # http://localhost:5174
```

## Structure

```
frontend/
  src/
    lib/
      constants.ts    Arc Testnet chain def, vault + USDC address, full ABIs
      wagmiConfig.ts  wagmi + ConnectKit config targeting Arc Testnet
      format.ts       USDC formatting, fee math, countdown helpers
    pages/
      VaultStatus.tsx  Live vault config, balances, locked liabilities
      DepositPage.tsx  Approve + deposit flow with bearer key generation
      ClaimPage.tsx    Load deposit, sign claimDigest, relay claim
      RefundPage.tsx   Load expired deposit, execute refund
      ApiDocsPage.tsx  Full connected-API reference (all reads, writes, events, EIP-712)
    App.tsx           Sidebar nav, topbar, ConnectKit, wrong-chain guard
    main.tsx          Wagmi + QueryClient + ConnectKit + Sonner providers
    index.css         Arc Light design tokens, layout, cards, buttons
```

## Vault details

| Field                | Value |
| -------------------- | ----- |
| Contract             | `0x8BD6d2666E350932A82098399BF89dB3eC66233A` |
| Chain                | Arc Testnet — chain ID 5042002 |
| RPC                  | `https://rpc.testnet.arc.io` |
| Explorer             | `https://explorer.testnet.arc.io` |
| USDC                 | `0x3600000000000000000000000000000000000000` (6-decimal ERC-20 predeploy) |
| Fee                  | 50 bps (0.5%), non-refundable, taken on deposit |
| Claim window         | 7 days from deposit block timestamp |
| Source verified      | Blockscout (2026-10-21) |

## Signing note

The `claim()` function uses `ECDSA.recover(claimDigest, signature)` with no `eth_sign` prefix.
`claimDigest` is the full EIP-712 typed-data hash (domain + struct). The frontend reads it
from the contract via `claimDigest()` and signs the raw bytes using `account.sign({ hash })`.
Never pass the link private key in calldata or to any server.

## Environment

Optional WalletConnect project ID (MetaMask and injected wallets work without it):

```sh
echo "VITE_WC_PROJECT_ID=your_id_here" > .env.local
```

## Refund of deposit B (live)

Deposit `0x018f6f38…` from the lifecycle test expires **2026-10-28T16:38:11Z**.
The Refund page pre-fills this ID. Connect the sender wallet (`0xffd63dAE…`) after that date.
