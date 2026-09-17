# Celo Sepolia deployment record and next steps

Recorded: 2026-09-17. Scope: SivanAgreementVault on testnet only.

## Current deployment

| Setting | Value |
| --- | --- |
| Hardhat network | `celoSepolia` |
| Chain ID | `11142220` |
| Vault | `0x0592edf36Ec65A809f5230cEd5BadBe472787CAf` |
| Owner / deployer | `0xA457959759d5667359d1C333DBdcBEA4285a51Cc` |
| Fee collector supplied at deployment | `0x46eFfe0409BFE99b0435e7bb7219DC6586612345` |
| Agent attester supplied at deployment | `0x4a1A9cf30A86b2b333D1a743181aAE71a50BAFBc` |
| Agent ID supplied at deployment | `9827` |
| Allowed test USDC | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| USDC decimals | `6` |

[View vault on Celo Sepolia Blockscout](https://celo-sepolia.blockscout.com/address/0x0592edf36Ec65A809f5230cEd5BadBe472787CAf).

These are public addresses, not credentials. This record does not establish a
mainnet deployment or verify the agent's registration on Sepolia.

## Work completed

1. Prepared the ignored local `.env` with Sepolia RPC, chain ID, explorer URL,
   and Circle's test USDC address. The user supplied the deployer key and role addresses.
2. Added the environment-backed `celoSepolia` network in `hardhat.config.cjs`.
   The private key is normalized to accept an optional `0x` prefix.
3. Added `npm run deploy:sepolia` and a Sepolia branch in `scripts/deploy.js`.
4. Added pre-deployment checks for the actual RPC chain ID, explicit nonzero
   role/token addresses, positive safe-integer agent ID, USDC symbol and six
   decimals, and nonzero deployer gas balance. Metadata validation alone is not
   proof of token authenticity; use the verified configured address above.
5. Added Sepolia USDC allowlist seeding and retained post-seeding checks.
6. Ran the local Hardhat suite: 34 tests passed. Configuration/syntax checks
   and `git diff --check` also passed. This is not an independent security audit.
7. The user ran deployment from their terminal. The vault deployed and the
   allowlist transaction was reported mined, but the immediate state check failed.
8. A later read-only RPC check confirmed the allowlist and owner (details below).

No assistant-initiated transactions were sent during the follow-up investigation.
No deployment to mainnet, live payment-account provisioning, or live user-fund
movement was performed as part of this work. These configuration changes have
not been committed/pushed by the assistant in this workflow.

## Deployment error and verified recovery state

The terminal reported:

```text
Vault deployed: 0x0592edf36Ec65A809f5230cEd5BadBe472787CAf
Listed 1 assets in one transaction.
Error: Allowlist did not engage after seeding. Investigate before use.
```

The subsequent read-only RPC check returned:

```text
chainId: 11142220
reported head block: 36351135
tokenAllowlistEnforced(): true
supportedTokens(0x01C5C0122039549AD1493B8220cABEdD739BC44E): true
owner(): 0xA457959759d5667359d1C333DBdcBEA4285a51Cc
```

The calls used `latest`; they were not all pinned to the reported head block.
The observed state is consistent with an initially stale RPC read, but that
cause has not been conclusively proven. Deployment and seeding transaction
hashes were not captured in the supplied terminal output and remain to be recorded.

Do not rerun deployment to resolve this message. The existing vault's
allowlist is active. Re-running creates another vault and consumes more test gas.

## Environment and secrets

The local `.env` is Git-ignored. Never commit it or paste its contents into chat.
Relevant public configuration:

```dotenv
CELO_SEPOLIA_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
CELO_SEPOLIA_CHAIN_ID=11142220
CELO_SEPOLIA_EXPLORER_URL=https://celo-sepolia.blockscout.com
CELO_SEPOLIA_USDC=0x01C5C0122039549AD1493B8220cABEdD739BC44E
```

The deployer private key and role addresses are configured locally. Deployer,
fee collector, and attester are distinct addresses. Address validity does not
prove the backend controls the attester's signing key.

`CELOSCAN_API_KEY` was empty at review time. The explorer URL variable is
informational; it does not configure Hardhat source verification. Sepolia
explorer verification support still needs to be configured.

## Remaining work, in order

1. Retrieve and record the deployment and allowlist transaction hashes/receipts.
2. Harden deployment verification: check receipt success, read state at the
   seeding receipt's block, and use bounded retries for RPC propagation failures.
   Keep failures explicit and print transaction hashes and recovery instructions.
   **This hardening has been proposed, not implemented.**
3. Read back fee collector, attester, agent ID, and fee tiers from the deployed
   vault and compare with intended settings. Only owner and USDC allowlist were
   independently checked in the follow-up RPC check.
4. Confirm backend control of the attester key and intended Sepolia agent identity.
5. Configure source verification and verify deployed bytecode/source.
6. Configure the staging integration with chain ID `11142220` and this vault
   through environment settings. Do not change production to use this test vault.
7. With explicit approval, perform a test-token-only lifecycle: deposit,
   delivery/attestation, release/fee accounting, and a separate timeout/refund case.
   Confirm transaction receipts and balances, not merely UI success messages.

End-to-end staging integration, on-chain fee payout behavior, source verification,
and an actual full test purchase/settlement flow remain unverified by this record.

## Commands for reference

Safe local test command:

```bash
npm test -- --network hardhat
```

For a deliberately authorized **new** Sepolia deployment only:

```bash
npm run deploy:sepolia
```

Deployment and allowlisting are separate transactions. A failure after vault
creation must be investigated at the existing address before any retry. A
nonzero CELO preflight balance does not guarantee enough gas for both transactions.

## Sources

- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- Local Hardhat configuration, deployment script, test output, user-provided
  deployment output, and the read-only RPC results recorded above.
