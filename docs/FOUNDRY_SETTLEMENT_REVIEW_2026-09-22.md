# Foundry and settlement-path review — 2026-09-22

## Follow-up: vault-self fee recipients

Finding 1 is addressed in the local contract code: the constructor and fee-collector
setter reject the vault itself; funding rejects a vault-self collector or partner
before transferring tokens; all positive fee disbursements validate their recipients.
This covers buyer-authorized release, primary/independent rulings and bilateral
settlements. A rejected payout rolls back balances, agreement state and nonce.
Fee-free refunds remain available, and an optional zero-address partner remains valid.

Follow-up verification: **138 Hardhat tests passed** and **24 Foundry tests passed**,
zero failures/skips. The seeded Foundry run below used 2,048 inputs for each of seven
fuzz tests and 512 runs × 100 calls for each of seven invariants. These are local
test executions, not live transactions. Compiled Hardhat vault runtime: 20,010 bytes.

The two original stranded-fee probes below have been replaced with rejection
regressions. `test/SivanAgreementVault.fee-recipients.test.js` covers configuration,
funding and normal release accounting. `forge-test/FeeRecipientGuards.t.sol` injects
invalid storage through a **test-only** harness to exercise settlement-time defenses
and atomic retry; the production contract has no such mutators.

## Follow-up: independent reviewer fee conflicts

Finding 2 is now addressed in local code as well. Funding rejects a partner or
protocol fee collector matching the independent reviewer. The accepted collector
is locked in `agreementFeeCollectors` at funding; later global configuration changes
cannot change that agreement's payout destination. Every positive fee disbursement
also checks its recipient against that case's independent reviewer. Fee rates and
fee-free refunds are unchanged. The partner-conflict probe is now a rejection test.

Regression coverage includes old versus new agreement destinations, stale acceptance
after collector changes, all four paid routes (release, primary ruling, independent
ruling, bilateral settlement), zero-fee partner conflicts, and atomic rollback/retry
with invalid state injected only by a test harness. Separate addresses do not prove
separate beneficial ownership; operational conflict checks remain necessary.

Neither fix recovers previously stranded fees or changes deployed immutable vaults.
No deployment or live transaction was performed.

Combined verification: **142 Hardhat tests passed**, **25 Foundry tests passed**,
zero failures/skips. Eight fuzz tests ran 2,048 cases each; seven invariants ran
512 × 100 handler calls each using the same recorded seed and command below.
Hardhat-compiled vault runtime is 20,503 bytes. These checks cover the scoped
fixes; they are not an independent security audit or live deployment validation.

## Original review (historical evidence)

Scope: local review of staging commit `e4851c5`, plus the test-harness changes in
this working tree. No production Solidity changes, deployment, RPC fork, signing
with real keys, live funds, commit or push was performed during this review.

## Results

- Hardhat: **131 passed**, zero failures.
- Foundry default run: **21 passed**, zero failed/skipped. Six fuzz tests at 512
  inputs each; seven invariants at 256 runs × 50 calls (12,800 handler calls per
  invariant).
- Foundry larger seeded run: **21 passed**, zero failed/skipped. Six fuzz tests
  at 2,048 inputs each; seven invariants at 512 runs × 100 calls (51,200 handler
  calls per invariant), using the seed in the command below.
- The larger run's selector statistics include 5,729 escalation and 5,792 signed
  settlement handler invocations. These are invocations, not necessarily successful
  settlements: handlers deliberately return when a selected agreement is in an
  inapplicable state. They must not be presented as distinct real transactions.

These results support the normal settlement paths but do not clear the two
confirmed findings below. Recommendation: fix those before production deployment.

## Findings requiring fixes before production

### 1. Medium — a settlement can finish while fees remain in the vault

The funding path accepts `partnerAddress == address(vault)`. The fee-collector
setter also accepts the vault itself, even after an agreement is funded. A normal
ERC-20 transfer to the sending vault leaves its balance unchanged, but settlement
still marks the agreement Released. There is no agreement-level exit for those
remaining fees once the agreement is terminal.

Confirmed with two executable probes in `forge-test/SettlementPathsReview.t.sol`:

- `test_review_partnerVaultLeavesFeeBehind`: 100 test USDC funded; settlement
  finishes with 0.225 USDC of partner fees still in the vault.
- `test_review_feeCollectorCanBeChangedToVaultAfterFunding`: the same amount with
  a normal partner; changing the fee collector to the vault leaves 0.525 USDC
  behind after completion.

These are configuration/recipient-validation issues, not a demonstrated theft of
another user's principal. Related existing release paths use the same recipient
settings. Recommended fix: reject vault-self recipients at every configuration
and funding entry point and add regressions for every settlement path. Consider
pinning the accepted fee destination per agreement so later settings cannot
change an existing agreement's fee routing.

### 2. Medium — the independent reviewer can be a fee beneficiary

Proposal validation excludes the current fee collector from the independent role,
but it does not validate the partner encoded in the funding hash. Deposit accepts
`partnerAddress == independentReviewer`. Consequently, the independent reviewer
can rule in favor of the contractor and receive an outcome-dependent referral fee.

`test_review_independentReviewerCanBePaidAsPartner` confirms this: on a 100 test
USDC agreement, that reviewer receives 0.225 USDC when awarding the contractor.

Recommended fix: reject an independent-reviewer/partner overlap at funding and
preserve separation from the effective fee destination throughout the agreement.
Check subsequent fee-collector changes as part of that fix. Different addresses
alone still cannot prove independent beneficial ownership; an operational
conflict-of-interest check remains necessary.

At the original review, three `test_review_*` tests intentionally asserted these
unsafe outcomes. Their passing status confirmed findings, not safety. In the
follow-ups, all three have become rejection regressions as described above.

## Paths reviewed

- Pre-funding acceptance, period snapshots and timed transfer of reviewer authority.
- Timeout followed by immediate refund: rejected, funds remain disputed.
- Full refund, full contractor payout and partial bilateral settlement.
- Variable amounts, fee rates, partner shares and base-unit rounding.
- EOA and ERC-1271 settlement signature validation.
- Callback reentrancy cannot trigger a second settlement.
- A failed token transfer rolls back earlier transfers, state and nonce; retry
  succeeds after the test token's restriction is removed.
- Paused-vault settlement, terminal-state replay protection and signature domains
  (with the existing Hardhat regression suite).

The new stateful harness actions are `escalate` and `settleByAgreement`. Test actors
use known local-only keys for actual typed-data signatures. Setup seeds funded and
disputed agreements and asserts their creation, avoiding an empty-state pass.
The refund handler now reads the agreement's snapshotted refund deadline.

## Reproduction and tools

Pinned tools, installed only under the ignored `lib/` directory:

- Forge 1.7.1, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, official
  `@foundry-rs/forge-darwin-amd64` package; published SHA-512 integrity verified.
- Solidity 0.8.24, commit `e11b9ed9`; official native compiler SHA-256:
  `cc2d44c706905ccc382f484625dff61d741e0c24232d226f139a6835fc644f3f`.
- forge-std v1.9.7, commit `77041d2ce690e692d6e03cc812b57d1ddaa4d505`.
- libusb 1.0.30, Homebrew bottle downloaded and extracted locally. It was not
  installed globally. Needed by the official macOS Forge executable.

The larger Foundry bundle download was incomplete and was never executed.
The Forge-only package and compiler were checksum-verified before execution.

From the repository root on this machine:

```sh
DYLD_LIBRARY_PATH="$PWD/lib/foundry-tooling/libusb/1.0.30/lib" \
  lib/foundry-tooling/package/bin/forge test \
  --use "$PWD/lib/foundry-tooling/solc-0.8.24" \
  --offline --cache-path cache_forge --summary

FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=100 \
DYLD_LIBRARY_PATH="$PWD/lib/foundry-tooling/libusb/1.0.30/lib" \
  lib/foundry-tooling/package/bin/forge test \
  --use "$PWD/lib/foundry-tooling/solc-0.8.24" \
  --offline --cache-path cache_forge --fuzz-runs 2048 \
  --fuzz-seed 0x0000000000000000000000000000000000000000000000000000000020260922 \
  --summary

npm test -- --network hardhat
```

Foundry warns that its optional signature-name cache is absent; compilation and
execution do not depend on it. The tool dependencies are ignored and must be
installed separately on another machine. Testing is local EVM execution with test
tokens, not remote testnet or mainnet validation and not an independent audit.
