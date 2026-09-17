# Lifecycle safety update

Scope: test tooling only. The arbitration contract remains unchanged pending an
explicit decision on the final fallback and independent backup arbitrator.

- Remote lifecycle requires the `celoSepolia` alias and RPC chain ID `11142220`.
- `RESUME` runs before new-lifecycle prerequisites. It uses the agreement's buyer
  and token, requires refund gas but no spare tokens, and simulates the refund.
- Refunded agreements are a no-op; disputed/released/nonexistent agreements fail
  explicitly rather than triggering a new deposit.
- New runs check distinct actors, owner authority, pause state, attester address,
  token metadata/allowlist, token balance and nonzero gas balances before sending.
  Nonzero gas is not a guarantee that every transaction can be funded.
- Optional `BUYER_PRIVATE_KEY`, `CONTRACTOR_PRIVATE_KEY`, and
  `ATTESTER_PRIVATE_KEY` are read locally by this script, not added to mainnet
  Hardhat accounts. Never commit or paste those values.
- Set `LIFECYCLE_TOKEN` or `CELO_SEPOLIA_USDC`. Explorer links optionally use
  `CELO_SEPOLIA_EXPLORER_URL`; no provider credentials are printed.
- Agreement IDs are journaled before approvals and transaction hashes before
  waiting for receipts. Progress records live in ignored `deployments/`.
  A broadcast/network failure can still require manual reconciliation; do not
  blindly rerun a fresh lifecycle after any partial execution.

No automatic retry resends transactions. Resume is only for an existing ordinary
timeout refund, not automatic completion of arbitrated or delivered payments.
These safeguards do not repair the outstanding arbitration policy in Solidity.
