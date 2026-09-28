# Single and milestone agreements together — local E2E

Date: 2026-09-28. Local Hardhat/Foundry EVMs and test tokens only. No live network
deployment, live fund movement or application integration was performed.

## Combined-vault scenarios

`test/single-and-milestone-end-to-end.test.js` deploys both vault types using the
same buyer, contractor, treasury, token and intentionally identical buyer-owned
agreement/project ID. The single job locks 100 test USDC; the milestone project
locks 500 test USDC, split 100/250/150. The five scenarios passed:

1. Interleaved delivery and release: milestone 2, the single job, then milestones
   0 and 1. All 600 units reconcile, including the single vault's existing fee and
   partner split and the milestone vault's independently configured fee. Both
   vault balances finish at zero; repeat payouts fail. Delivered single-job
   release still requires its existing agent attestation.
2. Single-job refund while milestone arbitration remains active. The milestone
   dispute escalates to independent review and settles with a partial refund;
   the other undelivered milestones refund later. Final totals are 540 buyer,
   59.4 contractor and 0.6 treasury; both vault balances finish at zero.
3. A token allowance for the single vault cannot fund the milestone vault. Failed
   milestone funding leaves single-job escrow unchanged; correct funding succeeds
   once and duplicate funding fails.
4. Bilateral settlement signatures cannot cross vaults, despite identical parties,
   ID, nominal refund and token. Correct signatures remain usable after rejected
   cross-vault attempts. Each vault maintains its own lifecycle and nonce state.
5. Pausing the single vault and changing its future fee-collector setting cannot
   mutate milestone terms, fee recipient or payout capability. Unpausing restores
   the single job's normal release path.

No production Solidity or deployment changes were needed for these tests. The
single-agreement contract, interface and deployment entry points remain unchanged.

## Interpretation

Full regression rerun: **214 Hardhat tests passed** (including these five combined
scenarios). **27 Foundry tests passed**, none failed or skipped, with 2,048 cases
per fuzz test and 512 runs at depth 100 per invariant test. The Foundry suites
exercise each contract's properties; the five Hardhat scenarios specifically
exercise the two vaults side by side.

Passing confirms coexistence and isolation in the tested local contract paths.
It does not prove backend routing, frontend wallet prompts, live token behavior,
indexer recovery or deployment configuration. The new milestone integration still
needs those components and a separately authorized testnet lifecycle. Both job
types must be routed by chain + vault address + job type + ID, never by ID alone.

Fee policies remain intentionally separate: tests read the single job's actual
stored fee rather than assuming it equals the milestone fee. No change to the
existing single-agreement business rules is implied.
