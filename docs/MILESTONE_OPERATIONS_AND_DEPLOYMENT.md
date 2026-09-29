# Milestone operations review and guarded testnet deployment

2026-09-29. Updated for [implemented safeguards](MILESTONE_SAFEGUARDS.md).
No deployment performed. Existing single-job Solidity, interface, deployment helper
and CLI are unchanged. This is not independent audit approval.

## Hosted CI at commit 1d2d913

Run 36452284793: Hardhat, Foundry fuzz/invariants, static analysis and naming guard
passed. The Celo fork job failed because its RPC settings were absent. The repository
variable `CELO_FORK_RPC_URL` has now been set to `http://127.0.0.1:8545`.
`CELO_FORK_SOURCE_RPC_URL` still needs to be supplied as a GitHub Actions secret by
the operator. No private local endpoint was copied to GitHub. Until supplied and
the fork job passes, CI is not fully green. Do not skip this gate or substitute a
synthetic chain for the requested real-state fork.

## Operational review: unresolved release decisions

| Risk | Current behavior | Recommendation before production |
| --- | --- | --- |
| Incident response | Admin can pause new funding only; existing exits stay available | Reviewed dedicated 2-of-3 funding-admin multisig; monitor pause/unpause events |
| Primary reviewer lost | Deadline expires and anyone can escalate; no replacement is needed to reach independent review | Use a reviewed primary-reviewer multisig with independent key custody; operate a deadline-monitoring keeper |
| Independent reviewer unavailable | Both parties can replace the case reviewer after the agreed recovery wait; no automatic award | Disclose that either party can refuse; mutual settlement remains available |
| Immutable role addresses | No vault-level rotation of treasury or primary reviewer | A deployed Safe can rotate its own signers at the same address; verify policies per chain and monitor later changes |
| Treasury transfer blocked | Settlement reverts atomically, not partially | Test intended token issuer restrictions and treasury implementation; no admin drain or forced payout workaround |
| Token contract changes | Metadata alone cannot prove safe token behavior | Independently approve exact-transfer, non-rebasing issuers/implementations; token pause/blacklist remains external risk |

Funding pause and bilateral reviewer recovery are implemented, not global role
rotation or administrative settlement powers. Mainnet remains blocked.

## Separate milestone tooling

Commands (no transactions for challenge/preflight):

```sh
npm run milestone:challenge -- celoSepolia
npm run milestone:preflight -- celoSepolia
```

Only after explicit deployment approval, reviewed committed code and completed
configuration:

```sh
npm run milestone:deploy -- celoSepolia
```

Copy relevant fields from `.env.milestone.example` into the existing testnet profile.
It is not an automatically loaded profile. Use `BASE_SEPOLIA` or
`ARBITRUM_SEPOLIA` prefixes for the other two currently allowed testnet candidates.
RPCs use existing `<NETWORK>_RPC_URL`; no RPC or API key is hardcoded in the runner.

Required protections:

- Production profile, mainnet and pending chain profiles are rejected.
- Dedicated `<NETWORK>_MILESTONE_DEPLOYER_ADDRESS/PRIVATE_KEY` for testnet; no shared
  single-job signing-key fallback. Production signing integration remains pending.
- Collector priority: milestone-specific override → network collector → shared
  `SIVAN_FEE_COLLECTOR`. Invalid nonempty overrides fail rather than falling back.
- Explicit primary reviewer, fee rate (0–300 bps), release version, token metadata,
  control mode and `funding-pause-bilateral-reviewer-recovery` risk acknowledgement.
- Dedicated `FUNDING_ADMIN` and reviewed `ADMIN_*` 2-of-3 policy are mandatory even
  in testnet_eoa mode. Admin is separate from deployer, treasury and primary reviewer.
- Deployer, treasury and reviewer must be distinct. `multisig` mode checks reviewed
  2-of-3 treasury/reviewer policies using the existing read-only Safe checks.
  Contract wallets cannot masquerade as the `testnet_eoa` mode.
- The primary reviewer signs the **exact printed challenge string** using EIP-191
  personal-message semantics, with expiry within 24 hours. ERC-1271 reviewer proofs
  are supported. Use the Safe's message-signing flow with matching digest semantics,
  not an ordinary Safe transaction signature. Never put reviewer private keys on the
  deployment host. The proof binds chain, deployer, roles, fees, tokens, policies,
  code hash, release version, risk acknowledgement and expiry, not a payout.
- Actual chain ID, artifact identity, compiler target, token code/metadata, gas
  reserve and proof are checked before deployment and again before broadcast.
- Explicit `MILESTONE_DEPLOY_CONFIRM=milestone:<network>:<chainId>:<version>`;
  the single-job confirmation variable is not accepted. Keep blank normally.
- Exclusive `deployments/milestone-<chainId>-<version>.json` record, separate from
  single-job records. Persist nonce/predicted address before broadcasting; refuse
  partial-run restarts. Investigate interrupted broadcasts; never delete a journal
  and blindly redeploy. Each journal is local ignored evidence, not source control.
- Read back roles, fee and allowlist at the deployment receipt block. Record ABI,
  compiler settings, commit, constructor args, transaction and runtime hash.
  Readback does not establish source verification or application readiness.

The milestone contract has no owner or ownership handover. The immutable funding
admin may pause new deposits, but deployment currently starts unpaused. It cannot
honestly report “paused pending acceptance.” Do not advertise
or wire its address into the application until verification and review complete.
The journal always reports `readyForUse:false` and `sourceVerification:pending`.

## Initial tooling verification (before safeguard extension)

All **225 Hardhat tests passed**, including 11 new milestone deployment-tooling
tests: policy/role/configuration guards, wrong-chain/artifact rejection, bound and
expired reviewer proofs, ERC-1271 proof verification, token metadata/gas failures,
confirmation isolation, failed-journal no-broadcast, partial-run refusal, and a
local deploy → readback → funding → delivery → settlement lifecycle. Existing
multisig readback regressions also passed. ERC-1271 fixtures are test-only wallets,
not proof of a live Safe signing integration. No RPC testnet deployment was run.

That tooling-only revision did not alter either vault. The subsequent safeguard
extension modifies only the milestone vault; see [current checks](MILESTONE_SAFEGUARDS.md).
The original `scripts/evm.js` and `scripts/helpers/evm-deployment.js` remain unchanged.

## Source verification and release gates

Use the journal's five constructor arguments in order: treasury, primary reviewer,
fee bps, token address array, funding admin. Verify against `contracts/SivanMilestoneVault.sol` with
the journal's exact compiler settings. Do not use the single-vault constructor or
hand-over instructions. Independent source verification, protected production
signing, governance decisions and full application testnet integration remain
separate release gates. No automatic verification or mainnet activation is claimed.
