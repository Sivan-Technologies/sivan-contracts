# Sivan frontend and contract adapter integration

Status: proposed integration specification, not an implemented SDK or API.
Reviewed against the local single-agreement and milestone contracts on 2026-10-07.
No frontend, backend, deployed contract or signing workflow is changed by this file.

## Reading order and authoritative references

1. This guide: architecture, UI behavior and the proposed adapter contract.
2. [Contract reference](CONTRACT_REFERENCE.md): generated exact ABI signatures,
   events, errors, constructors and getter output tuples for both current vaults.
3. [Review notes](REVIEW_NOTES.md): reviewed changes, evidence and open gaps.
4. `source-baseline.json`: machine-checked source and documentation fingerprints.

The deployed bytecode and its matching release ABI govern actual execution.
Current source documentation must not be applied blindly to older deployments.
TypeScript/API examples here are specifications, not an installed SDK. Do not
copy them into production without action-specific schemas and implementation tests.

## 1. Objective and limits

Keep product screens independent of Solidity ABIs, RPC providers, raw enum values
and deployment addresses. A versioned adapter translates stable product actions
into the exact operations supported by a particular deployed vault.

An adapter can absorb ABI and infrastructure changes. It cannot make changes to
business meaning invisible. New consent requirements, fees, asset risks, signing
steps or recovery limitations must be shown to users and may require a UI update.
Unknown versions fail closed; never silently route to a similar ABI.

Sivan vaults are immutable deployments, not upgradeable proxies. A future v2 is
a new address. Existing agreements remain attached to their original deployment
until settled; changing the default deployment does not migrate escrow.

## 2. Architecture and responsibility

```text
Product pages / partner apps
        |
Stable application service (queries, actions, recovery)
        |
Trusted adapter registry + versioned deployment catalog
        |
Single-agreement adapter OR milestone adapter
        |
Wallet signer / protected relayer + environment-configured RPC
        |
Specific immutable vault + approved token on one chain

Payment backend / indexer -> persistent operation journal -> product read models
```

| Layer | Owns | Must not own |
| --- | --- | --- |
| UI | Forms, amounts, clear terms, wallet prompts, statuses | ABIs, raw calldata, signer secrets |
| Application service | Session identity, request validation, persistent workflow | Invented finality or automatic retries of writes |
| Adapter | ABI encoding, domain/signature schemas, reads, simulation, event decoding | Arbitrary remote executable code |
| Deployment catalog | Chain/address/version/artifact identity, rollout policy | Unreviewed addresses supplied by browser requests |
| Wallet/relayer | Explicitly authorized signing and submission | Authority to bypass contract consent |
| Backend/indexer | Durable discovery, receipts, reorg-aware projections | Declaring payout complete from an HTTP 200 |
| Vault | Escrow, authorization and settlement rules | Off-chain evidence truth or fiat settlement |

The payment backend remains the product's backend integration point. Third-party
apps may use the same stable contract adapter interface with their own transport
and indexer, subject to the same checks. Admin/arbitrator actions are separate
protected services, not hidden buttons in the ordinary customer UI.

## 3. Proposed frontend layout

Adapt paths to the frontend's existing framework; this is not a scaffolding command.

```text
src/
  features/agreements/       # single-job forms, details and actions
  features/milestones/       # project terms and per-milestone controls
  features/wallet/           # connection, chain switching and confirmations
  integrations/sivan/
    types.ts                # stable DTOs and error/action vocabulary
    client.ts               # typed payment API client, configured base URL
    service.ts              # prepare/submit/reconcile coordination
    queries.ts              # cache keys, polling, cancellation
    adapters/
      registry.ts
      single/<adapter-id>.ts
      milestone/<adapter-id>.ts
    deployments.ts          # validated public catalog reader
    amounts.ts              # integer arithmetic and display formatting
    transactions.ts         # hashes, replacements, recovery
    errors.ts               # safe normalized errors
```

ABIs should be packaged in a reviewed shared integration library, not duplicated
inside pages. Backend and frontend consume compatible versions of shared DTOs and
ABI manifests. Do not ship server-only signing code in the browser bundle.

## 4. Stable data contract (illustrative TypeScript)

These types define the integration boundary, not existing exports. Generate
contract-specific bindings from the exact release artifacts.

```typescript
type Address = `0x${string}`;
type Hex = `0x${string}`;
type Units = string; // validated unsigned base-unit integer; bigint internally
type VaultKind = "single" | "milestone";

interface AgreementRef {
  chainId: number;
  vault: Address;
  kind: VaultKind;
  agreementId: Hex;
  milestoneIndex?: number;
}

interface AssetRef {
  chainId: number;
  address: Address;
  symbol: string;       // display only, never identity
  decimals: number;
  issuerClassification: "issuer-native" | "bridged" | "test-only";
}

type Action =
  | "proposeTerms" | "acceptTerms" | "fund" | "deliver" | "release"
  | "refund" | "dispute" | "escalate" | "mutualSettlement"
  | "replaceReviewer" | "invalidateRefundConsent";

interface AvailableAction {
  action: Action;
  enabled: boolean;
  reason?: string;
}

interface AgreementView {
  ref: AgreementRef;
  asset: AssetRef;
  phase: "draft" | "awaitingAcceptance" | "awaitingFunding" | "funded"
       | "delivered" | "disputed" | "released" | "refunded" | "closed";
  reviewStage?: "primary" | "independent";
  grossUnits: Units;
  remainingUnits: Units;
  refundedUnits: Units;
  contractorPaidUnits: Units;
  feePaidUnits: Units;
  observedBlock: string;
  observedBlockHash: Hex;
  observedAt: string;
  actions: AvailableAction[];
}
```

Use discriminated single/project/milestone DTO extensions in implementation.
A project view contains every milestone, not one flattened state. A partially
refunded and partially released project is closed with a settlement breakdown,
not falsely labeled fully released. Keep unavailable reads as unavailable,
not zero balances or completed states.

Cache identity includes chain ID, vault address, agreement ID, optional milestone
index, connected account and relevant session identity.

## 5. Deployment catalog and adapter versioning

Each approved catalog record must include:

- Network/environment, expected chain ID and immutable vault address.
- Vault kind, release commit, contract release label and adapter ID/version.
- ABI digest, runtime-code identity and deployment block/transaction.
- Exact EIP-712 domain name/version; contract release label is a different field.
- Reviewed token identities, decimals and issuer/bridge classification.
- Capability map and finality policy for that specific network.
- Source-verification evidence and activation status.
- Whether new funding is allowed; separately whether existing-position
  servicing remains supported.

Catalog authenticity must come from a controlled release channel (for example,
a reviewed build artifact or signed configuration with a pinned verification key).
Do not accept an arbitrary catalog URL, ABI or adapter URL supplied by a caller.
No dynamically downloaded JavaScript plugins.

Keep previous adapters available for old agreements. Store adapter/deployment
identity when the agreement is created, and resolve it from that identity later.
Never infer a deployment version from token symbol, current network default or
the value of a global environment variable.

Current source uses EIP-712 domain names:
- Single: `Sivan Celo Settlement Facility`, version `1`.
- Milestone: `SivanMilestoneVault`, version `1`.

Despite the single-vault name, do not rewrite its domain for a different EVM chain.
Derive the chain ID and verifying contract from the actual selected deployment.
A deployment labeled v2 does not automatically mean signature domain version 2.

## 6. Adapter interface and transaction plans

Expose read, prepare, simulate and reconcile operations; signing stays with the
user wallet or an explicitly authorized protected service. Avoid a single
opaque method that silently signs and sends.

```typescript
interface ActionIntent {
  action: Action;
  ref: AgreementRef;
  actor: Address;
  requestId: string;
  payload: unknown; // replace with an action-specific validated union
}
interface PreparedPlan {
  operationId: string;
  adapterId: string;
  ref: AgreementRef;
  actor: Address;
  basedOnBlock: string;
  termsHash?: Hex;
  expiresAt: string;
  summary: {
    title: string;
    grossUnits?: Units;
    feeUnits?: Units;
    recipient?: Address;
  };
  steps: Array<
    | { kind: "transaction"; chainId: number; to: Address;
        data: Hex; value: Units }
    | { kind: "typedSignature"; schemaId: string;
        domain: unknown; types: unknown; message: unknown }
  >;
}
interface VaultAdapter {
  id: string;
  kind: VaultKind;
  read(ref: AgreementRef, actor: Address): Promise<AgreementView>;
  prepare(intent: ActionIntent): Promise<PreparedPlan>;
  simulate(plan: PreparedPlan): Promise<{ ok: boolean; reason?: string }>;
  reconcile(ref: AgreementRef, txHash: Hex): Promise<AgreementView>;
}
```

Validate all illustrative `unknown` fields with versioned schemas before use.
Plans must bind the caller, deployment, amount, recipient, token and terms.
Reject expired or tampered plans. Simulate with the actual sender and intended
chain; simulation is useful but cannot guarantee later success.

Re-read/reprepare after each prerequisite transaction or signature when state,
allowance, nonce or terms may have changed. A multi-step plan is not atomic.
Backend-prepared calldata is still untrusted at the wallet boundary: check its
target, selector, decoded arguments, value and chain against the selected intent.

## 7. Map stable actions to the current source

Use current generated ABIs for full arguments. Names below are guidance, not a
substitute for ABI validation or contract-enforced role checks.

| Product action | Single agreement | Milestone project |
| --- | --- | --- |
| Read | `getAgreement`, arbitration terms/case getters | `getProject`, `getMilestone` |
| Derive buyer-bound ID | `deriveAgreementId` | `deriveProjectId` |
| Propose terms | `proposeArbitrationTerms` | `proposeProject` |
| Accept exact terms | `acceptArbitrationTerms` | `acceptProject` |
| Fund | token approval then `deposit` | token approval then `fundProject` |
| Contractor delivery | `markDelivered` | `markDelivered` with index |
| Buyer release | `releasePayment` | `releaseMilestone` |
| Eligible timeout refund | `refundBuyer` | `refundUndelivered` |
| Open dispute | `raiseDispute` | `disputeMilestone` |
| Escalate after deadline | `claimArbitrationTimeout` | `escalateMilestone` |
| Bilateral settlement | `settleDisputeByAgreement` | `settleByAgreement` |
| Contractor-authorized refund | `mutualRefund` / `mutualRefundWithConsent` | Bilateral settlement; not an identical unilateral API |
| Cancel refund signature | `invalidateRefundConsent` | Unsupported as the same operation |
| Replace independent reviewer | Unsupported as the same operation | `replaceIndependentReviewer`, bilateral consent and recovery wait |
| Overdue review request | No identical entry point | `requestOverdueReview`, project parties only |

Do not reuse raw enums: single Disputed=5, Released=3, Refunded=4; milestone
Disputed=3, Released=4, Refunded=5. Map each version independently.

Read arbitration state separately: an escalation is not payout or refund.
Single `disputeResolvedByTimeout` is a legacy field, not proof of resolution.
Contract terminal state alone may not describe a partial ruling accurately;
reconcile payout events and amounts.

### Critical differences adapters must preserve

| Concern | Single agreement | Milestone project |
| --- | --- | --- |
| Ordinary release | Buyer may release Funded; Delivered additionally needs the current attestation checks | Requires Delivered; buyer only; sequential projects require prior milestones settled |
| Reviewer ruling | `resolveDispute`: binary contractor payout or buyer refund | `resolveMilestone`: reviewer specifies buyer refund up to milestone amount |
| Bilateral partial settlement | `settleDisputeByAgreement`, requires disputed state | `settleByAgreement`, applicable to funded/delivered/disputed milestones |
| Receipt amount | Deposit records actual positive token balance increase | Funding requires the exact project total balance increase |
| Delivery deadline | Contractor delivery on/before `deadlineTimestamp` | Contractor delivery on/before `fundedAt + duration` |
| Undelivered refund | Read `refundUnlockAt` and current state/contract checks | Strictly after `fundedAt + duration + DISPUTE_GRACE`; Funded only |
| Delivery review expiry | Read actual single refund rules; do not apply milestone rules | Does not grant unilateral refund of Delivered work |
| Token list and fee controls | Owner configuration exists, with accepted/snapshotted funding policy | Constructor-selected token set and immutable fee/treasury roles; no equivalent setters |

Reviewer resolution is a separate protected adapter/service capability, not part
of the ordinary customer `Action` union. Funding-admin controls likewise require
a distinct authorized interface. Do not let a normal client infer permission
from an action label. Chain simulation and on-chain checks remain authoritative.

Terms documents and proof documents require a canonical encoding/hash convention
agreed by both clients and the backend. Store the exact original bytes and digest;
do not hash a newly reformatted JSON object. Validate proof URLs/content types,
escape rendered content and avoid exposing private evidence on-chain. On-chain
hashes prove commitment to bytes, not that the work is correct.

## 8. What to build in the frontend

### Shared controls

- Environment/network badge, wallet identity and explicit network switching.
- Asset selector showing chain, token identity/classification and available amount.
- Human-readable fee, gross, net and gas estimates; gas is separate from Sivan fees.
- Operation tracker with transaction links from approved explorer configuration.
- Refresh/recovery action that loads durable backend records and reconciles chain
  state. Closing a tab must not lose the only copy of a pending operation.
- Clear unavailable/read-error states with no synthetic balances or success metrics.

### Single-job page

Show deliverables, acceptance criteria, contractor, token, gross amount, exact fee
policy, deadlines, primary/independent review rules and refund conditions before
consent. Persist the accepted terms digest and its human-readable source.

The contractor accepts the exact current funding terms before the buyer funds.
Changing amount, token, partner or fee policy can invalidate acceptance: re-read
the hash and obtain fresh consent rather than retrying old calldata.

Only the contractor marks delivery. Buyer release can be available from Funded
as well as Delivered; in the Delivered path the current single vault also checks
agent attestation. Do not present an unconditional release button without the
required evidence/signature. Direct and delegated release have different signing
requirements; adapters must represent them explicitly.

### Milestone project page

Collect milestone scopes, exact base-unit amounts, durations, order policy,
review windows, reviewer and recovery wait before both parties accept.
Fund the project total once. Render each milestone's individual amount, reserved
fee, delivery, dispute and settlement state.

Fees are reserved within the funded amount and paid on settlement under the
current milestone rules. Do not display them as collected at project funding.
Partial settlement charges the fee on the paid portion; full-refund handling
must follow actual contract results.

A milestone duration is not automatically a calendar deadline measured from
completion of the previous milestone. Read the current contract's fundedAt and
duration semantics; do not invent a sequential schedule.

### Disputes and recovery

Show deadlines, current authorized reviewer, evidence submission and settlement
breakdown. Vera may assist evidence preparation; it must not be given an admin,
treasury or reviewer key by this integration.

No automatic refund when arbitration times out. Stalled disputed funds may remain
locked if reviewers fail and the parties do not cooperate. Explain that limitation.

For milestone reviewer replacement, require the waiting period and both parties'
case-specific signatures. Admin approval alone cannot replace the reviewer.

Milestone funding pause stops new funding while existing servicing remains.
The single vault has different pause behavior, including a pause check on ordinary
release. Do not flatten both into one promise that every action remains enabled.

## 9. USDC and USDT token adapter rules

Assets are keyed by chain ID and contract address, never ticker alone. Preserve
USDC and USDT entries separately. Use exact integer arithmetic; parse decimal
inputs against verified token decimals, reject excess precision, and never use
JavaScript floating-point arithmetic for amounts or fees.

Check allowance for the exact vault. Approval is not funding:
1. Prepare the required bounded allowance.
2. For a reviewed zero-first token, reset existing nonzero allowance to zero and
   wait for confirmation before approving the new amount.
3. Confirm approval and re-read allowance.
4. Simulate and submit the funding call.
5. Confirm funding from its own successful receipt and vault state.

Do not assume USDT returns booleans, uses six decimals everywhere, supports permit,
or is issuer-native on every chain. Use reviewed per-token capabilities, not a
ticker-based guess. Do not grant unlimited approval by default.

On Arc, native gas and the ERC-20 USDC view have different unit conventions;
avoid double-counting the same underlying balance. A gas estimate must identify
its native asset instead of always displaying ETH.

See [USDT validation](../docs/USDT_SETTLEMENT_VALIDATION.md) and
[testnet token selection](../docs/TESTNET_SETTLEMENT_TOKENS.md). Local fixture
results do not certify the intended live token on all networks.

## 10. Signing, authentication and role isolation

- Wallet connection is not backend authentication. Bind the authenticated session
  to verified wallet control and authorize every action/resource server-side.
- Do not trust an email, frontend role flag or caller-supplied user ID as authority.
- Generate typed-data schemas from the pinned adapter/release; bind chain, vault,
  agreement, milestone where applicable, exact amount/terms, nonce and expiry.
- Read nonces and deadlines just before preparing consent. Do not reuse signatures
  across domains, versions, vaults or chains, or extend expiry without re-signing.
- EOA and ERC-1271 support varies by action. Do not assume a Safe can act as the
  automated attester: the current single-vault attester path requires ECDSA.
- Store any necessary unconsumed signatures securely and briefly. Do not put them
  in analytics, URLs, public logs or browser history.
- Never expose deployer, attester, reviewer or service keys through frontend env.
- Backend service-to-service access must be authenticated, scoped, audited and
  protected against replay. Rate-limit preparation and signature requests.

## 11. Persistent operation lifecycle

Keep payment submission state separate from agreement business state:

```text
prepared -> awaitingSignature -> submitted -> mined -> confirmed -> reconciled
                         rejection/revert -> failed
                  timeout/disconnection -> unknown (recover by hash)
```

Persist operation ID, intent digest, actor, deployment reference, step, transaction
hash, submission time, replacement hashes and receipt block/hash. Use backend
idempotency scoped to actor + action + deployment + request ID; reject reuse with
a different payload. Idempotency does not make a blockchain transaction atomic.

A submitted hash, approval receipt, wallet popup dismissal or provider HTTP 200
is not payment completion. Require successful execution plus the expected
vault/event/amount result. Apply the chain's reviewed finality policy and handle
replacement, cancellation and reorgs. An unrelated successful transaction is not
proof that this operation completed.

On transport timeout, reconcile before permitting a replacement submission.
Do not blindly resend deposits, approvals or settlements. Distinguish unknown
broadcast outcome from an explicit user rejection.

## 12. Backend read model and proposed API surface

The following operations are recommendations, not routes currently implemented:

| Logical operation | Purpose |
| --- | --- |
| deployment catalog | Public approved deployment and adapter capabilities |
| agreement list/detail | Authorized durable discovery and reconciled state |
| prepare action | Validate intent and return human-readable signing plan |
| record submission | Persist operation/step/hash after ownership validation |
| operation status | Recover pending/replaced/reverted/reconciled operations |
| evidence submission | Access-controlled off-chain evidence and content digest |

Keep these behind the existing environment-configured payment API client; do not
hardcode a new service URL or create a second independent source of user identity.
Use decimal strings for amounts and explicit schema versions for every response.

Index from each deployment's creation block with durable block/hash checkpoints.
Deduplicate logs by chain, transaction hash and log index and track block hashes
for reorg handling. Validate event emitter, ABI and agreement identity before
updating projections. Webhooks are hints to reconcile, not settlement authority.
A scheduled backfill/read path must recover missed events and out-of-order updates.

Maintain ledger conservation by token and deployment:
funded amount = outstanding escrow + buyer refunds + contractor payments +
protocol/partner payments, accounting for the actual contract's fee policy.
Do not count approvals, proposals or duplicate logs as volume/revenue.

## 13. Frontend async behavior and error contract

Cancel polling and pending reads on unmount/account/chain change. Use one polling
owner per operation, bounded backoff and freshness checks. After any awaited
wallet/RPC/API response, confirm the current actor and network still match before
rendering details or requesting another signature.

Normalize failures into stable codes such as:
`WRONG_NETWORK`, `UNSUPPORTED_DEPLOYMENT`, `TOKEN_NOT_ALLOWED`,
`INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS`, `ALLOWANCE_REQUIRED`,
`TERMS_CHANGED`, `CONSENT_EXPIRED`, `NOT_AUTHORIZED`,
`ACTION_NOT_AVAILABLE`, `USER_REJECTED`, `TRANSACTION_REVERTED`,
`RPC_UNAVAILABLE`, `INDEXER_LAGGING`, `UNKNOWN_SUBMISSION`.

Expose a safe explanation and operation ID. Keep sanitized diagnostic details
server-side. Do not discard the distinction between validation errors and provider
outages; never display raw credential-bearing RPC messages.

## 14. Third-party adapters and plugin compatibility

An external integrator supplies a reviewed implementation of the stable adapter
interface, versioned schemas, capability declarations and conformance tests.
Transport/wallet libraries can differ; authorization and accounting cannot.

Register adapters statically by ID and supported deployment fingerprints. Reject
plugins that target arbitrary contracts, request hidden approvals, alter terms or
claim capabilities absent from the deployed contract. A capability map is a UI
aid, not an authorization mechanism.

Keep optional extensions namespaced. Unsupported actions return explicit errors.
A third-party plugin must not reinterpret a single agreement as a milestone
project or silently choose a new fee recipient.

## 15. Changing contracts without breaking existing screens

1. Freeze and publish a release manifest with ABI, code identity and semantics.
2. Add a new adapter; retain old adapters and contract-address mappings.
3. Run conformance tests against both adapters and existing UI DTOs.
4. Update the catalog for testnet only, with new funding disabled initially.
5. Complete wallet, indexer and full settlement/recovery integration tests.
6. Enable new funding only after approval; keep servicing old deployments.
7. For rollback, disable new funding on the affected deployment but preserve its
   history and all safe exit/settlement functionality. Do not redirect old IDs.
8. If semantics change, increment the appropriate API/schema version and require
   explicit UX/consent updates. Never disguise breaking changes as adapter patches.

## 16. Acceptance tests before frontend release

- Both vaults: proposal/acceptance, approval, funding, delivery, release and receipts.
- USDC and each reviewed USDT variant: amounts, decimals, allowance reset,
  rejected/blocked transfers, exact fees, refund and retry after rollback.
- Disputes: deadlines, escalation, partial payout, bilateral settlement,
  replay rejection and unavailable-reviewer behavior.
- Milestones: one total funding, independent/order-constrained release, no
  double settlement, funding pause and case-scoped reviewer replacement.
- UI: mobile layout, wallet rejection, account/network switching during requests,
  tab-close recovery, stale terms, expired signatures and no duplicate polling.
- Backend: idempotency, missed/duplicate/reordered logs, reorg rollback,
  transaction replacement, access control and ledger conservation.
- Versioning: old/new deployments side by side, unsupported adapter, tampered
  manifest/calldata, chain mismatch and unchanged old-agreement routing.
- Real integration: test-token receipts on each intended network and actual
  frontend/backend reconciliation. Local fixtures are a separate evidence class.

Record release commit, chain, vault, token, test actor roles, transaction hashes,
expected/observed balances and failures. Never claim production readiness from
green local tests alone.

## 17. Implementation order and current boundaries

1. Agree stable DTOs, error vocabulary and approved deployment manifest format.
2. Build shared typed bindings and separate single/milestone adapters.
3. Implement backend operation persistence, indexing and recovery.
4. Add wallet/signer orchestration and bounded token approval handling.
5. Wire UI pages to the application service, never directly to contract ABIs.
6. Run conformance/local tests, then controlled public-testnet application E2E.
7. Complete protected production operations and independent release approval.

Current evidence is documented in the repository's test reports. This guide does
not create API endpoints, activate pending networks, verify token addresses,
upgrade deployed contracts or override production deployment guards.

## 18. Mandatory maintenance workflow

Whenever production Solidity, deployment/signature tooling, network registry or
dependency/build settings change:

1. Compare behavior and ABI against the previous release. Update this guide's
   affected sections and assess old adapters, callers, indexers and consent.
2. Update `REVIEW_NOTES.md` with the change, actual evidence and unresolved gates.
   If no frontend impact exists, explain that explicitly.
3. Run `npm run compile`, then `npm run integration:refresh`.
4. Review `CONTRACT_REFERENCE.md` and `source-baseline.json` diffs. Never accept
   an unexplained ABI or dependency change just because generation succeeds.
5. Run `npm run integration:check` plus affected local/integration tests.
6. Commit source, guide, review notes and generated baseline together.

CI runs the check after compilation. A mismatch fails the job. The refresh command
is deliberate and local; CI never silently refreshes stale documentation.
Hash matching cannot judge prose accuracy or prevent someone from refreshing
without review. Human review remains mandatory; this is not a promise that every
future semantic change will be detected automatically.
