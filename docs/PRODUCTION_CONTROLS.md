# Production control baseline

Updated 2026-09-27. This is an implemented local hardening baseline, **not a
production-ready certification**. No wallet was created and nothing was deployed,
committed or pushed during this work. Mainnet execution remains disabled.

## Configuration and secrets

- `.env.testnet.example`: public candidate network/token settings and clearly
  labelled signer, treasury/admin, proof and verification configuration.
- `.env.production.example`: public reference configuration only. It does not
  enable mainnet or contain a production signing-key field.
- Select `EVM_PROFILE=production` in the process environment to select production.
  It never falls back to `.env`. Raw private keys, mnemonics and seed phrases are
  refused even if another environment entry would override the file value.
  Production file-based API credentials and RPC endpoints are refused; inject
  those through a protected runtime because RPC URLs can themselves contain keys.
- Testnet loads `.env.testnet` if present, otherwise the existing `.env` for
  compatibility. Injected values take precedence. A file/profile mismatch fails.
- `.env`, `.env.*`, isolated security tools and release evidence are ignored;
  example templates remain trackable. Existing developer keys were preserved,
  not copied into production or other network signer slots.

The production signing backend is **not integrated**. Choose and validate an
AWS KMS/HSM or hardware/protected signer before implementing it. No code claims
that putting a raw private key in an environment variable makes it secure.
The production profile fails closed even if pointed at a testnet candidate.

## Treasury and administration

Every new runner configuration explicitly specifies `ADMIN_ADDRESS` and
`CONTROL_MODE`. `testnet_eoa` is an explicit testing relaxation, not production
approval. `multisig` enforces the following read-only checks for both the separate
treasury and admin addresses before deployment and again before broadcast:

- Four distinct addresses: deployer, treasury, admin, automated attester.
- Deployed proxy and implementation code match independently reviewed hashes.
- Exactly the configured three distinct owners and an on-chain threshold of two.
- Neither deployer nor automated attester is one of those owner addresses.
- No enabled modules (modules can bypass the normal signature quorum).
- No guard in the reviewed Safe guard storage slot; custom guards require review.
- Fallback handler code matches the reviewed hash. Use the zero hash only when
  the deployed wallet actually has no fallback handler.

Do not copy hashes from an untrusted address and call that a review. Obtain the
expected code from audited Safe releases, verify the actual deployed proxy and
singleton, and confirm the storage layout for that specific version. The checks
cannot prove signer identity, key independence, recovery procedures, absence of
collusion or future configuration safety. Treasury/admin wallets may have common
signers; assess that correlated risk explicitly. Reviewers must remain independent
of treasury control, not merely have a different address. These are deployment
checks, not a mechanism that freezes or continuously monitors Safe settings.

The collector receives ERC-20 fees directly; it needs no private key in this
repository. The attester remains an ECDSA signer, not the treasury Safe.
New collector settings do not redirect fees for already-funded agreements.

Sources: [Safe account model](https://docs.safe.global/advanced/smart-account-concepts),
[guard layout](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/GuardManager.sol),
[fallback layout](https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/base/FallbackManager.sol).

## Ownership handover

Future vaults use OpenZeppelin `Ownable2Step`:

1. Current owner proposes `transferOwnership(newAdmin)`.
2. Only that pending admin can call `acceptOwnership()`.
3. The old owner loses privileges only on acceptance. A zero-address proposal
   cancels a pending handover; renouncing actual ownership remains prohibited.

When the runner's intended admin differs from the temporary deployer, it pauses
the fresh, unseeded vault **before** allowlisting any token, then seeds and proposes
the handover. Its journal stops at `awaiting-admin-acceptance`; it does not
impersonate the multisig, automatically accept or unpause. Before activation,
operators must verify `owner()`, empty `pendingOwner()`, runtime/source identity,
treasury/attester configuration and the release evidence. The multisig executes
acceptance itself, and unpauses only after release approval.

The temporary deployer retains owner powers until acceptance; do not advertise
handover as complete before the chain confirms it. These changes require a new
immutable deployment. They do not patch old deployed contracts or migrate funds.

## Controlled release evidence

`npm run release:reproducible` forces two local compilations and compares creation
bytecode, runtime template and ABI. It is a same-host repeatability check, not an
independent clean-room compiler certification. CI now repeats it too.

`npm run release:manifest` writes a draft to ignored `release-evidence/`, recording
commit/dirty state, lockfile hash, compiler input/settings and bytecode hashes.
Every external gate starts pending; it does not fabricate testnet, audit or explorer
evidence. The deployment runner still requires a clean committed tree and explicit
network/version confirmation, and journals broadcast intent before sending.

Before activation, collect and independently check:

- Passing tests/fuzz, triaged static analysis and dependency-risk signoff tied to
  the exact commit/compiler input/lockfile.
- Source verification with the actual constructor arguments, including the
  **initial deployer owner**, not the later admin address. Explorer compatibility
  and successful verification must be checked per chain; readback is not source
  verification. The journal's `sourceVerification` remains pending until this is
  done. Do not populate a success value without external evidence.
- Actual test-token end-to-end lifecycle, frontend/backend indexing and recovery
  against the new buyer-bound ID scheme on each intended testnet.
- Protected signer integration and key-rotation/recovery drill, actual multisig
  acceptance, monitoring, incident handling and an independent security review.

No boolean environment flag bypasses the hard mainnet prohibition. Enabling
production is a separately reviewed code/config release, not part of this change.

## Verification and findings from this pass

- **179 Hardhat tests passed**; after an additional env-override assertion,
  **26 targeted security/deployment tests passed** again.
- **25 Foundry tests passed**, including eight fuzz tests at 2,048 cases and seven
  invariants at 512 runs × 100 calls. Seed ends `20260927`. Handler calls are not
  all successful settlements or live transactions.
- Two forced builds matched creation hash
  `0xb27b3ccf16546fd0e45515754cd07062a2f1997dae254ee69cb2d0b9a3e84258`.
  Runtime size: **20,975 bytes**.
- Slither 0.11.5 analyzed 34 contracts with 101 detectors. Raw output: one medium,
  12 low and 11 informational results. The medium was enum-state equality in
  `acceptArbitrationTerms`, not balance/timestamp equality; a regression confirms
  funding forbids subsequent consent edits even after a balance/time change.
  `slither.db.json` records only that exact finding ID with internal reasoning.
  The medium/high gate passed after triage; low timestamp warnings and naming
  notices remain visible. No detector-wide exclusion was added. Timing depends
  on chain timestamps/sequencer liveness; boundary tests do not eliminate those
  chain assumptions. This is internal assessment, not an independent audit.
- The previous CI comment referred to a nonexistent divide-before-multiply
  triage database. It was removed. Slither/compiler versions and Hardhat framework
  selection are now explicit. Actual GitHub Actions execution remains unverified.
- npm audit: no critical/high/moderate entries; 15 inherited low entries remain
  from `elliptic` in Hardhat 2. Scope: development/deployment toolchain, not a
  linked Solidity component. No patched elliptic release was available in the
  prior verified package line. Mainnet remains blocked; production key material
  must not enter this toolchain. This is a documented exposure assessment, **not
  risk acceptance on behalf of the owner**. Obtain signoff or migrate/review the
  toolchain before production.

Residual design risks remain: trusted admin/attester behavior, token issuer
blacklisting or upgrades, chain/RPC failures, off-chain delivery ambiguity, and
indefinite disputed funds if independent review and bilateral agreement both fail.
No claim is made that all possible security vulnerabilities have been eliminated.
