# Milestone end-to-end review — 2026-09-28

## Scope and limits

Local contract deployment and transaction lifecycles only. No live deployment,
customer accounts, real funds or external money movements. The payment backend and
MiniPay source inspected do not yet reference `SivanMilestoneVault`, `proposeProject`
or `fundProject`; existing deployment scripts do not deploy it. Therefore the
user-facing application end-to-end flow is **not yet implemented or verified**.

The existing single-agreement source, interface and deployment entry points are
unchanged. No production business logic was edited during this test expansion.

## Results

- Full Hardhat suite: **209 passed**, including existing single-job regressions.
- New local contract E2E cases: **8 passed**.
- Full Foundry suite: **27 passed, 0 failed, 0 skipped**. Nine fuzz tests each
  ran 2,048 cases; eight invariant tests each ran 512 sequences at depth 100.
- Static analysis: medium/high gate passed with the existing documented triage;
  34 lower-severity/informational findings remain in the analyzed codebase. This
  is not independent audit clearance.
- New milestone stateful invariant: **512 runs, 51,200 calls**, checking conservation,
  remaining balances, backed liabilities, fee cap and single settlement nonces.
  41,159 calls reverted as invalid randomized state transitions; these are not
  counted as successful transactions.

The E2E suite verifies:

1. Deploy → propose → contractor acceptance → approval → one project deposit →
   independent deliveries/releases → exact final balances for 6/18-decimal tokens.
   At illustrative 1% fees, all $500 released means $495 contractor and $5 treasury.
2. Funding receipt has one token transfer and one `ProjectFunded` event. Settlement
   events match gross allocations, actual payout and fee amounts.
3. Maximum 20-milestone project funds and settles; local funding gas is below the
   test's 3,000,000-gas ceiling (not a live-chain fee estimate).
4. ERC-1271 contract-wallet parties can fund, deliver, accept and jointly settle.
5. Cross-chain/vault signatures fail without consuming a settlement nonce.
6. A blocked treasury payout rolls back the contractor transfer, state, nonce and
   liabilities; unblocking permits one safe retry.
7. A token callback with otherwise valid bilateral signatures cannot reenter
   settlement. The later standalone authorized settlement still works.
8. Sequential disputes can settle/refund without an earlier disputed milestone
   preventing recovery, while normal releases retain ordering enforcement.

The existing milestone unit suite additionally covers full refunds, partial
settlements, expired consent, fee-on-transfer rejection, donations, duplicate
funding, project isolation and the timeout → refund regression.

## Before claiming application E2E / launch readiness

- Build backend persistence/event reconciliation and frontend milestone flows.
- Add reviewed milestone deployment/readback tooling without redirecting the
  single-agreement deployment commands.
- Finalize immutable token, fee, treasury and reviewer configuration. Current
  milestone vault has no administrative pause or role rotation; operational
  recovery policy needs explicit review before deployment.
- Run a separately authorized testnet integration with actual intended token and
  wallet implementations, RPC, indexer recovery and signature handling.
- Obtain independent security review. A stalled independent arbitration can still
  lock disputed funds indefinitely without mutual settlement, by the agreed policy.

Commands: `npx hardhat test`; local Foundry with `--fuzz-runs 2048` and invariant
settings `FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=100`; Slither 0.11.5 with
`--compile-force-framework hardhat --hardhat-ignore-compile --fail-medium` and the
repository's dependency/test path filters.
