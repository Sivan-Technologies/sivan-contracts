# Single-agreement security remediation and integration notes

Scope: the three findings in [the internal review](SECURITY_REVIEW_2026-09-29.md).
The milestone contract and its business rules are unchanged. No live deployment,
production transaction or account operation was performed for this work.

## 1. Delivery cannot be self-reported by the buyer

Only the agreement's contractor can call `markDelivered`. This prevents a buyer
from replacing a 30-day work deadline with a shorter delivery-review window.
Failed buyer/outsider calls leave the state and refund deadline unchanged.

Contractor-authorized early delivery still starts the agreed review window.
The buyer can still pay directly from Funded using `releasePayment`; recording
delivery is not necessary to voluntarily pay a contractor. Existing deadline,
dispute, fee and arbitration policies are otherwise unchanged.

## 2. Expiring and cancellable contractor refund consent

### Direct contractor call

`mutualRefund(agreementId, "0x")` remains available to the contractor directly,
including a contractor smart wallet calling the vault. The old signature argument
must be empty. Relayers cannot use this function with an old permanent signature.

### Relayed call

Use `mutualRefundWithConsent(agreementId, expiry, signature)`.

Read `refundConsentNonces(agreementId)` immediately before preparing consent.
Do **not** use `agreementNonces`: release and bilateral-settlement authorizations
have a separate nonce namespace and are unaffected by refund cancellation.

EIP-712 domain:

```javascript
const domain = {
  name: "Sivan Celo Settlement Facility",
  version: "1",
  chainId,                 // actual selected deployment chain
  verifyingContract,       // new, verified vault deployment
};
const types = {
  ContractorRefundConsent: [
    { name: "agreementId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};
const value = { agreementId, nonce: refundConsentNonce, expiry };
```

The contractor signs. EOA and ERC-1271 contractor wallets are supported by the
relayed path. A third party may submit the signature, but cannot alter the
agreement, nonce, expiry, domain or full-refund destination.

Choose a short expiry from the current chain timestamp, such as one hour. At
execution, the vault requires `block.timestamp <= expiry <= block.timestamp +
1 days`. This is an execution-time bound, not proof of when an offline signature
was created; clients must not ask users to sign far-future expiries. At expiry
itself consent is valid; one second later it is rejected.

### Cancellation and lifecycle invalidation

- `invalidateRefundConsent(agreementId)` is contractor-only and works while
  paused in Funded, Delivered or Disputed.
- Contractor delivery and either party opening a dispute increment the refund
  nonce automatically. Earlier consent cannot cross either transition.
- A successful direct or relayed refund increments the refund nonce and sets the
  terminal Refunded state before transferring tokens.
- A failed token transfer rolls back state, nonce and events atomically.
- Invalid signatures do not consume a nonce.
- An invalidation emits `RefundConsentInvalidated(agreementId, newNonce)`.

Cancellation takes effect when its transaction executes. It cannot reverse a
refund that executes first. Clients must wait for confirmation, refresh state and
nonce, and communicate transaction-ordering risk rather than promise off-chain
instant cancellation. Fresh consent can be issued for the new active state.

All refund routes still return the full deposit to the recorded buyer without
charging a settlement fee. Terminal states reject replay and repeat payouts.

### Migration requirement

The typehash now includes expiry, so old two-field signatures are intentionally
incompatible. Updating an ABI alone does not secure an already-deployed immutable
vault. Deploy a reviewed new version, verify bytecode/source, and configure clients
for its address. Do not direct new signatures to an old vault or accept a fallback
to the legacy relayed-refund method. Existing agreements remain governed by their
original deployed contract and require a separately planned migration, if any.

Update frontend/backend/relayer ABI and signing builders before using the new
deployment. Other repositories were not changed in this task. Never automatically
retry a failed submission with different parameters or a different vault.

## 3. Dependency patch

The `undici` override and lockfile were updated from `6.28.0` to `6.28.1`.
The patch addresses
[GHSA-3wwx-pv8p-q78v](https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v).
No blanket dependency upgrade or `npm audit fix --force` was used.

Fresh audit results: 0 critical, 0 high, 0 moderate, 15 low advisories. The remaining
low advisories are not described as fixed by this change.

## Regression coverage

`test/security-review-2026-09-29.test.js` converts the original reproductions into
rejection tests and adds positive/negative coverage for:

- Buyer/outsider delivery rejection and the original work-deadline refund.
- Contractor early delivery, event attribution and buyer release from Funded.
- Legacy signatures after delivery, dispute and a simulated year.
- Successful refunds in each active state, including while paused.
- Expired, overlong, malformed, wrong-signer and tampered consent.
- Exact expiry boundary, wrong agreement/nonce/chain/vault, and terminal replay.
- Authorized cancellation, unauthorized cancellation and fresh reauthorization.
- Independent delivery/dispute invalidation of still-unexpired consent.
- ERC-1271 contractor authorization/cancellation (test wallet, not production Safe).
- Blocked token transfers with atomic rollback and same-signature retry.
- Reentrant token callbacks failing to pay twice.

`forge-test/RefundConsentSecurity.t.sol` adds four fuzz tests covering deadline
protection, active-state refunds/conservation, expired/revoked consent and lifecycle
invalidation over varying amounts, deadlines and signature lifetimes.

## Validation status

- Full Hardhat suite: 251 passing.
- Fresh dependency scan: no moderate/high/critical advisories; 15 low remain.
- Clean `npm ci --ignore-scripts`: passed.
- Two forced Solidity builds produced identical single-vault creation bytecode,
  runtime bytecode and ABI. Single-vault runtime: 21,753 bytes; milestone runtime:
  14,847 bytes, both below the 24,576-byte EVM runtime limit.
- Extended Foundry suite: 31 passed, 0 failed, 0 skipped. All four new security
  fuzz tests passed with 2,048 runs each. Existing fuzz tests used the same count;
  invariants ran 512 runs with depth 100.
- Slither medium/high gate: passed after the exact-ID triage maintenance below;
  37 low/informational findings remain. This is not a claim of zero findings.
- `git diff --check`: passed. `SivanMilestoneVault.sol` is unchanged from HEAD.

Local command logs: `/tmp/security-fixes-final-hardhat.log`,
`/tmp/security-fixes-forge.log`, `/tmp/security-fixes-install.log`,
`/tmp/security-fixes-reproducible.log`, `/tmp/security-fixes-slither-final.log`,
and `/tmp/security-fixes-audit.json`. These temporary files are not durable release
evidence. No commit, push or deployment was performed as part of this remediation.

Static-analysis triage maintenance: inserting the refund-consent declarations
shifted source locations and changed the detector ID of an already-reviewed
`acceptArbitrationTerms` enum-state equality. The guard still compares a discrete
state to Uninitialized, not a balance or timestamp. It was rechecked, and only that
exact finding ID was refreshed in `slither.db.json`; no detector-wide suppression
or weakened severity gate was added.

These are local contract tests, not live application end-to-end validation,
independent audit approval or permission to deploy mainnet.
