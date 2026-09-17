# Sivan contract ↔ Vera API integration specification

Status: **design only; no adapter is deployed or implemented by this document**.
Scope: staging, review-only integration. Vera remains unchanged. No automatic
settlement, new production accounts, wallet movement, or mainnet writes.

## 1. Authority boundaries

1. The chain is authoritative for escrow state, amounts, parties and deadlines.
2. Vera stores evidence and generates neutral review material. Its SHA-256/Merkle
   commitments prove integrity, not the truth of a delivery claim.
3. An authenticated Sivan human reviewer records the outcome.
4. A future, separately approved execution service may submit an approved ruling.
   This phase exposes **no execution endpoint** and gives Vera no wallet keys.

Vera is not an independent arbitrator merely because it is a separate service.
Sivan currently provides human review. Final fallback, independent backup control,
and deadlines need explicit product approval before changing Solidity arbitration.
The current timeout → restored Delivered → refund path remains a production blocker.

## 2. Canonical identity and local records

Case key: `eip155:<chainId>:<lowercase-vault>:<lowercase-agreementId>`.
Validate chain ID, 20-byte vault and 32-byte agreement ID before normalization.
Require a trusted deployment registry (chain, vault, ABI/version, deployment block).
Never accept an arbitrary contract address supplied by the browser as trusted.

Future Sivan backend tables (not Solidity storage, not yet implemented):

| Record | Required fields / constraints |
| --- | --- |
| case_links | unique case_key; Vera UUID; chain/vault/agreement; adapter state; expected parties; policy version |
| event_inbox | unique chain + transaction hash + log index; block number/hash; confirmation/reorg status |
| sync_outbox | case_key; operation; request hash; pending/submitted/unknown/completed; attempts; Vera response ID |
| review_snapshots | case_key; evidence root; summary hash; full canonical payload; retrieval time |
| reviewer_decisions | case_key; decision UUID/version; human subject; structured outcome; reviewed hashes; reason; timestamp |

Store token amounts as base-unit integer strings with token address and decimals.
Do not use floating point. Do not label arbitrary tokens as USD or sum currencies.
Store wallet-to-user identity binding separately; a wallet address is not a Vera
participant identity. Bind verified Sivan users to Vera-recognized token subjects.

## 3. Existing Vera API (verified from local source)

Base URL: server-only `VERA_API_BASE_URL`; no hardcoded service URL or credentials.
All requests use `Authorization: Bearer <token>`. Exact role and participant access
must follow Vera's existing route checks; do not invent a new accepted `service` role.

| Purpose | Existing Vera route | Handling |
| --- | --- | --- |
| Create case | `POST /v1/disputes` | Persist returned `id`; see exact payload below |
| Read case | `GET /v1/disputes/{id}` | Check resource identity and domain against link |
| Reconcile uncertain creation | `GET /v1/disputes?limit=...&cursor=...` | Paginate accessible cases; compare exact resource_id |
| Assign reviewer | `PATCH /v1/disputes/{id}/workspace` | reviewer_assignee / reviewer_notes; admin/dao |
| Add evidence | `POST /v1/disputes/{id}/evidence` | Strict EvidenceCreate schema; never send arbitrary extra fields |
| Read evidence | `GET /v1/disputes/{id}/evidence` | Paginated; enforce local case authorization too |
| Managed upload | `POST /v1/evidence/upload-url` | Use existing dispute-scoped storage schema; never fetch untrusted URLs server-side |
| Finalize file evidence | `POST /v1/evidence/{evidence_id}/finalize` | Privileged integrity workflow, not participant self-certification |
| Close evidence | `POST /v1/disputes/{id}/close-evidence` | May return completed root OR queued task_id |
| Generate summary | `POST /v1/disputes/{id}/summary` | May return completed summary OR queued task_id |
| Read latest summary | `GET /v1/disputes/{id}/summary/latest` | 404 may mean not ready; never fabricate summary |
| Reviewer brief | `POST /v1/disputes/{id}/reviewer-brief` | May generate a summary; not a read-only GET |
| Inclusion proof | `GET /v1/disputes/{id}/evidence/{evidence_id}/proof` | Verify proof against captured root |
| Human decision record | `POST /v1/disputes/{id}/decision` | Free-text reference only; not settlement authorization |
| Audit history | `GET /v1/disputes/{id}/audit-logs` | Review record; not a payment confirmation |

Queued work is not completion. Poll the resource with bounded backoff and timeouts;
only show ready after a nonempty evidence root / actual summary is returned. Honor
429 retry guidance. Treat 401/403 as authorization failures, not retryable outages.

### Create-case payload

Illustrative placeholders, not a real case. Only use verified identities and data:

```json
{
  "resource_id": "eip155:<chainId>:<vault>:<agreementId>",
  "resource_type": "deal",
  "domain": "freelance_escrow",
  "source_surface": "freelance_ui",
  "participants_json": {
    "client": { "participant_id": "<verified-buyer-subject>", "label": "Client" },
    "freelancer": { "participant_id": "<verified-contractor-subject>", "label": "Freelancer" }
  },
  "amount": "10.000000",
  "asset": "USDC"
}
```

`amount` is an exact decimal string derived from the escrow base units; 10 is
illustrative only. Do not send chain/vault fields at the top level: Vera forbids
unknown create fields. Preserve them in Sivan's case link and validated evidence.
Do not send `source_surface: sivan`: it is not a known Vera value. Use an explicit
supported domain, because unknown domain values currently fall back to P2P.

EvidenceCreate accepts `type`, `content_json`, `file_uri`, `sha256`. Use
`resource_metadata`, not retired `trade_metadata`. Freelance metadata must satisfy
the existing domain validator; implementation must fixture-test its exact shape
before enabling writes. Chain receipts, scope, acceptance criteria and participant
messages must carry provenance. Do not mistake user assertions for confirmed facts.

### Decision compatibility

Current Vera payload is just `{ "decision": "<human-authored reference text>" }`.
`decided_by` comes from the authenticated subject, not the request body. Do not
parse free text into a payout or impersonate the reviewer with a service token.
If forwarding the actual reviewer token is not authorized, record the structured
decision in Sivan and leave Vera decision mirroring disabled.

Sivan's proposed immutable decision record contains: `decisionId`, `caseKey`,
`version`, `outcome` (`refund_buyer` or `release_contractor`), `reason`, `reviewerSub`,
`evidenceRoot`, `summaryHash`, `policyVersion`, and `createdAt`. Partial payouts
are unsupported by the current contract and must be rejected, not rounded/mapped.
Decision recording, local audit and outbox enqueue belong in one DB transaction.
Vera's existing separate decision/audit commits are not changed by this design;
ambiguous failures require reconciliation, not blind retries.

## 4. Proposed Sivan API (not existing routes)

These are reserved design names for a future backend implementation, not claims
that an endpoint exists in this Solidity repository.

| Proposed route | Access | Behavior |
| --- | --- | --- |
| `POST /api/admin/contract-disputes/sync` | authorized operator | Queue import of confirmed on-chain dispute; no chain transaction |
| `GET /api/admin/contract-disputes/{caseId}` | assigned reviewer/admin | Local chain snapshot, Vera link, sync health and review status |
| `POST /api/admin/contract-disputes/{caseId}/review-package` | reviewer | Request evidence close/summary only after both parties had a submission opportunity |
| `POST /api/admin/contract-disputes/{caseId}/decisions` | authenticated human reviewer | Versioned decision with optimistic concurrency and reviewed hashes; no settlement |
| `GET /api/contract-disputes/{caseId}` | verified case participant | Redacted case status, deadlines and permitted evidence information |

No `execute`, `release`, `approve-payment` or `refund` HTTP endpoint is included.
Errors: 400 invalid shape; 401/403 access; 404 missing case; 409 stale state/root,
duplicate decision or ambiguous sync; 422 unsupported outcome; 503 Vera unavailable.
Return explicit `queued`, `sync_unknown`, `review_ready`, `human_decision_recorded`
states. None means that escrow is settled.

## 5. Event synchronization and idempotency

Read `AgreementDisputed` from configured vaults. Verify receipt success, address,
decoded ABI and chain ID; wait a configured confirmation threshold. Store block
hash and rewind/quarantine on reorgs. Re-read agreement state at a recorded block.
Import all relevant events from deployment block, not just the newest dispute.

Use a local unique case key and serialized per-case outbox operations. Vera's
create route does not implement a demonstrated idempotency key or unique resource
constraint. Therefore **exactly-once remote creation cannot be guaranteed** by
an adapter alone. After timeout/connection loss, mark `sync_unknown`, search exact
resource_id across paginated accessible records, and require operator resolution
if missing/ambiguous. Never automatically repeat an uncertain create request.

Duplicate chain logs must not create duplicate Vera cases. A terminal on-chain
event ends execution eligibility even if Vera remains open. Vera outages must
not hide chain deadlines or prevent ordinary on-chain exits.

## 6. Authentication and configuration

Vera already supports optional service JWT authentication (`token_use: service`,
HS256, configured issuer/audience/secret). Provisioning/configuration of that
service is out of scope; if not enabled, report blocked rather than using dev auth.
Send short-lived tokens with `exp`, `iat`, service `sub`, configured `iss`/`aud`,
and the necessary existing role. Existing admin/dao privileges are broad: keep
this credential server-side and constrain the Sivan adapter to review operations.
Never expose it to the browser or give Vera blockchain signing credentials.

Proposed Sivan env names: `VERA_API_BASE_URL`, `VERA_SERVICE_JWT_SECRET`,
`VERA_SERVICE_JWT_ISSUER`, `VERA_SERVICE_JWT_AUDIENCE`, `VERA_SERVICE_SUBJECT`,
`VERA_SYNC_ENABLED=false`, `CONTRACT_DISPUTE_CHAIN_ID`, `CONTRACT_DISPUTE_VAULT`,
`CONTRACT_DISPUTE_CONFIRMATIONS`. No secrets are supplied in this specification.

Evidence must be treated as untrusted input, including prompt-injection text.
Use private managed storage and participant authorization; do not put private
documents or personal details in on-chain dispute reasons or public logs.

## 7. Future execution boundary (disabled)

Current contract call: `resolveDispute(agreementId, releaseToContractor, reason)`
is owner-only. Vera's bundle hashes are not the `AgentAttestation` EIP-712 signature
used by the ordinary delivered-release path. Never interchange these mechanisms.

Before any later execution feature: require human approval, verify current owner,
chain, vault code/version, state `Disputed`, decision version and evidence binding;
simulate the exact call, record submitted hash, then reconcile receipt/events and
balances. Do not declare completion from a decision response or transaction hash.
Handle timeout/owner resolution races by re-reading state; never resubmit blindly.

## 8. Acceptance gates and outstanding decisions

- API fixture tests against Vera's exact current schemas (offline first).
- Participant isolation, expired tokens, forbidden roles, injection-safe evidence.
- Duplicate/reordered/reorged chain events and ambiguous remote POST failures.
- Asynchronous summary readiness, outage recovery, root/version mismatch rejection.
- No route or worker submits any chain transaction in review-only mode.
- Explicitly agreed arbitration fallback and backup reviewer identity/control.
- New ABI handling: agreement fields and settlement-route events have changed.
- Remote testnet deployment and end-to-end test only with separate authorization.

The old Sepolia vault is immutable and lacks newer fixes. Do not point a new ABI
at it and assume it upgraded. No production-readiness claim is made here.

## Source basis

Read-only inspection of Vera commit `93fb239`: routes/disputes.py, summary.py,
decision.py, evidence.py; schemas/evidence.py; services/participants.py,
decision.py, disputes.py; core/security.py. Sivan staging base: `7ce9c2a` plus
local lifecycle safeguards. Paths are relative to the respective repositories.
Deployment availability and credentials were not tested; no Vera files changed.
