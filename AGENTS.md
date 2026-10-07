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
