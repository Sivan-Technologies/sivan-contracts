# Sivan Claim Vault v1 — implementation and integration specification

Date: 2026-10-10. Status: local contract implementation; public deployment and
application integration are not complete. This specification supersedes the
claim-hash pseudocode in the original future-phase proposal for the EVM build.

## Scope and isolation

`contracts/SivanClaimVault.sol` is a separate immutable deployment. It does not
inherit from, call, share storage with, or change either existing agreement vault.
Single-job and milestone deployment scripts remain unchanged. No existing funds
or off-chain claim records are migrated automatically.

This implementation is a **bearer-link** system, not identity-restricted payment.
Anyone holding the link key, including its creator, can authorize a claim before
expiry. A phone number/email label is not on-chain identity verification. Never
promise that only the named recipient can claim. Identity-bound delivery needs a
separate reviewed design. No production/frontend/backend integration is implied.

## Economic policy

- Gross deposit includes a fixed 50 basis point (0.5%) fee, rounded down in raw
  token units: `fee = floor(gross * 50 / 10000)`; `net = gross - fee`.
- No fixed minimum fee. This resolves the proposal's ambiguous “0.5% or 0.10”.
- Fee is transferred to the immutable treasury during deposit; both claim and
  refund return only the recorded net amount. The fee is non-refundable.
- Fee rounding permits zero fees on very small deposits. No gas-subsidy promise
  is made; a relayer must impose a separate disclosed sponsorship policy.
- A 20 USDC gross deposit locks 19.90 and sends 0.10 to the treasury.
- Issuer-supported decimals are metadata for UI conversion, not vault math.
- No admin fee, treasury or existing-deposit mutation functions exist.
- Treasury cannot itself fund a deposit in v1 (exact fee accounting restriction).

## Authorization and privacy

The original `claim(id, secret, recipient)` hash-only design did **not** bind the
recipient and exposed the secret in calldata. The EVM implementation does not
use that design.

1. Sender client generates a fresh cryptographically random secp256k1 key per
   link and commits its public address as `claimSigner` during deposit.
2. The private key is carried only in the private link fragment; never in calldata,
   backend logs, analytics, notifications payload logs or contract events.
3. Recipient client reads the confirmed deposit and obtains explicit destination
   consent, then signs the following EIP-712 message with the link key.
4. A direct caller or relayer broadcasts the authorization. A copied signature can
   pay only the signed recipient, not a substituted attacker address.

```text
Domain: name="SivanClaimVault", version="1",
        chainId=<actual chain>, verifyingContract=<specific deployment>
Claim(bytes32 depositId,address recipient,uint256 deadline)
```

The domain binds chain and vault; the message binds deposit, destination and
authorization deadline. Terminal deposit state provides one-time consumption.
Authorization deadline must not exceed deposit expiry. A fresh key per deposit
avoids exposing unrelated links if one link leaks. Short-lived signatures do not
revoke the bearer key: its holder can create another valid authorization.

`scripts/helpers/claim-authorization.js` builds typed data only. It is not a web
SDK, identity service, secret store or relayer. Use a reviewed client-side wallet
library for key generation and signing; do not pass the private key to the backend.

URL fragments are normally excluded from HTTP requests, but browser scripts,
extensions, screenshots, clipboard tools and chat platforms can still expose a
shared link. A relayer sees the signed authorization, not the private link key.
The sending UI must preserve the key safely across a pending deposit; a lost link
key prevents claiming, but the sender can still refund after expiry.

## ABI and state machine

Constructor: `(admin, treasury, tokens[])`; explicit token admission, no wildcard.
Admin uses OpenZeppelin two-step ownership and can pause funding or change token
admission. Admin cannot redirect escrow, approve a claim, refund early or seize
funds. Renouncing ownership makes current admission/pause settings permanent;
claims/refunds remain available. Use a reviewed admin multisig before deployment.

| Action | Authorization | Rules |
| --- | --- | --- |
| `deposit(token,grossAmount,claimSigner)` | Funding wallet | Supported token, funding open, positive amount, nonzero EOA link signer. Requires allowance. |
| `claim(id,recipient,deadline,signature)` | Signature from committed link key; anyone may relay | Active, current time strictly before expiry, signature still valid, destination not zero/vault. |
| `refund(id)` | Original sender wallet | Active and current time greater than or equal to expiry. Always pays original sender. |
| `setFundingPaused(bool)` | Owner | Stops new deposits only. |
| `setTokenAllowed(token,bool)` | Owner | Changes admission for new deposits only. |

Status values: `0=None`, `1=Active`, `2=Claimed`, `3=Refunded`.
Expiry is derived from time; it is not a fifth stored state. Expired does not mean
refunded. Claims use `< expiresAt`, refunds use `>= expiresAt`, with no gap or
overlap. Window is exactly seven days from the mined deposit block timestamp.

IDs are `keccak256(abi.encode(chainId,vault,sender,senderNonce))`; nonce advances
on successful deposits only. Never derive a final ID from a stale client nonce:
read the confirmed deposit event/receipt. Identity is `(chainId,vault,depositId)`.

Events record gross, fee, net, token, sender, signer and expiry at funding;
claim/refund events identify the actual payee and amount. Generated ABI reference
includes this contract. `locked(token)` tracks active net liabilities, including
expired but not refunded deposits.

## Refund availability and token restrictions

- No admin, provider, reviewer or backend approval is required for refunds.
- The sender needs wallet access and transaction gas; refunds are not automatic.
- Pause or token removal cannot block an existing claim/refund.
- State changes and liability reduction roll back if the token transfer fails.
- SafeERC20 supports legacy no-return transfers; exact balance checks reject
  inexact receipt/payout. Only reviewed non-rebasing, exact-transfer ERC20s belong
  on the allowlist. Arbitrary malicious token code cannot be made trustworthy by
  these checks. Issuer freezes, proxy changes and chain outages remain risks.
- Unsupported tokens, native currency and direct donations are not deposits.
  No rescue/owner withdrawal exists. Direct token donations remain stranded;
  the UI must never instruct users to transfer tokens directly to the vault.
- A sender who loses wallet access cannot execute a refund. Smart-wallet recovery
  is a separate dependency. There is no unilateral admin recovery shortcut.
- No early cancellation; possession of the bearer key still permits a claim to
  the sender as recipient. If sender-exclusive pre-expiry recovery must be
  impossible, bearer-link semantics are insufficient and must be redesigned.

## Integration work still required

The payment backend remains the product integration point. These are requirements,
not endpoints implemented by this change:

1. Versioned deployment catalog with chain, address, token allowlist, ABI/artifact
   hashes and explicitly approved rollout status. No user-supplied RPC/contract.
2. Sender gross/fee/net consent, token approval, deposit simulation/submission,
   durable receipt tracking and safe private-link recovery.
3. Recipient screen validating catalog, deposit state, actual amount, expiry,
   recipient wallet and signed authorization before requesting relay.
4. Rate-limited sponsorship with simulation, idempotency, pending transaction
   reconciliation and budget controls. Simulation does not guarantee successful
   mining; claim/refund races and issuer failures can still consume gas.
5. Reorg-aware event indexing keyed by chain/vault/ID. Store token **address** and
   raw amounts, not just symbols; never declare success from an API response alone.
6. Sender refund UI using its original deployment, available without Sivan backend.
7. No credit to a recipient's spendable balance until settlement is confirmed.

CREATE2 is not implemented or required. Each chain may have a different address.
EVM source compatibility does not prove every chain supports the compiler's
Cancun target or each token's behavior. Validate candidate networks independently.
Public-network deployment tooling is deliberately not enabled for this new vault.

## Local verification commands

```sh
npm test -- --network hardhat test/SivanClaimVault.test.js
npm test -- --network hardhat
npx hardhat run scripts/claim-local-lifecycle.js --network hardhat
forge test --match-contract ClaimVaultFuzzTest
npm run integration:refresh
npm run integration:check
```

The lifecycle script requires both the ephemeral Hardhat network name and chain
31337 before deploying. It creates local fixtures, not real USDC. The USDT fixture
models legacy empty returns and blocking, not an issuer-certified deployment.
USDC-like 6 decimals and 18-decimal token tests are local compatibility scenarios.
Record actual results in REVIEW_NOTES; do not imply unexecuted checks passed.

## Release gates

- Local adversarial/unit tests, accounting sequences, Foundry fuzz/invariants and
  static-analysis triage; full existing-vault regression suite.
- Protected testnet deployment tooling and environment-only network/token config.
- Testnet token verification, source verification and real receipt/reorg handling.
- Frontend/backend/relayer integration and controlled testnet claim/refund journeys.
- Independent security review, admin multisig validation and explicit mainnet approval.

No chain is approved for live claim-vault deployment by these local tests alone.
