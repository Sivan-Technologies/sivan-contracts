# Arc Testnet deployments

## SivanClaimVault v2 (Arc Studio deploy, 2026-10-21)
- Address: `0x7f1e5a0e096840337c671904b7a099b07d06a539`
- Chain: Arc Testnet (5042002)
- Deploy tx: `0xa73b026fc9539c883a36aa747dcd6656fafd2e7fec92984b07c150029e7507d5`
- Deployed at: 2026-10-21T17:43:49Z
- Explorer: https://explorer.testnet.arc.io/address/0x7f1e5a0e096840337c671904b7a099b07d06a539
- Admin/Owner: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer)
- Treasury: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer)
- Allowed token: `0x3600000000000000000000000000000000000000` (Arc Testnet USDC)
- Testnet frontend: `frontend/` — run `cd frontend && bun run dev` (port 5174)
- Contract metadata: `contracts/contract-metadata/SivanClaimVault.json`

## SivanClaimVault v1 (manual deploy, 2026-10-21)
- Address: `0x8BD6d2666E350932A82098399BF89dB3eC66233A`
- Chain: Arc Testnet (5042002)
- Deploy tx: `0xb86088c2880d2fa571c923bdb34504907c00236d51d7e9d921ed44967318ff15`
- Deploy block: 68,379,040
- Runtime keccak256: `0xfbc6bec576b34879c87514dbdd1a43728d196666a2d915e14621beba7f339f2c`
- Source verified: Blockscout (2026-10-21) — https://explorer.testnet.arc.io/address/0x8BD6d2666E350932A82098399BF89dB3eC66233A
- Deposit B (live, expires 2026-10-28T16:38:11Z): `0x018f6f38f053645e1e65b759f9c48ac594eb8bc911444a2dbbfbfac38c565022`
- USDC (Arc Testnet predeploy): `0x3600000000000000000000000000000000000000`

---

# Contract integration documentation policy

- Preserve unrelated working-tree changes. Never submit live transfers, create
  live accounts or provision payment accounts as part of documentation checks.
- Read `integration/README.md` before changing production contracts, interfaces,
  network configuration, deployment/signing helpers or their dependencies.
- In the same change, review and update affected integration action mappings,
  state/fee/deadline semantics, consent schemas, capabilities, error handling,
  token behavior and old-deployment compatibility. Do not silently change the UI
  meaning of an existing adapter action.
- Record the impact, evidence and remaining gaps in `integration/REVIEW_NOTES.md`.
  A no-impact assessment must explain why; do not merely refresh hashes.
- Compile, then run `npm run integration:refresh` to regenerate the ABI reference
  and source/documentation baseline. Review generated diffs, and run
  `npm run integration:check` and the relevant tests before handoff.
- The baseline is a drift alarm, not proof of semantic correctness or an external
  audit. Never report proposed adapters/API routes as implemented.
- Keep existing deployment versions supported; new immutable deployments do not
  migrate old escrow. Never bypass pending-network or production gates to make
  documentation or tests appear complete.
