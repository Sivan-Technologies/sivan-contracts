# Five-testnet validation

Updated 2026-10-07. Scope: Celo Sepolia, Base Sepolia, Arbitrum Sepolia,
BNB Smart Chain Testnet and Arc Testnet. No mainnet activation.

## Implemented in this pass

- Registered Arc Testnet chain ID 5042002; retained its pending deployment gate.
- Added `npm run evm:check-rpcs`, using environment-provided endpoints only.
- Added a public endpoint reference in `.env.network-checks.example`.
- Added local diagnostic regression tests. These use simulated responses to
  exercise failure handling, and are not evidence of remote settlement.
- Kept all mainnet guards and contract business logic unchanged.

The checker only calls `eth_chainId` and `eth_getBlockByNumber`. It validates
identity and recent block timestamps, times out requests, and avoids printing
URLs, raw provider errors or credentials. No signer is constructed, and no
transaction is submitted. One failed target makes the command exit nonzero.

## Observed public RPC results

Read-only run: 2026-10-07T13:54:01Z. Public endpoints are listed in the example
file. These are observations, not permanent availability guarantees.

| Profile | Chain ID | Observed block | Identity/freshness | Deployment gate |
| --- | ---: | ---: | --- | --- |
| celoSepolia | 11142220 | 38097251 | Passed | Candidate |
| baseSepolia | 84532 | 47806476 | Passed | Candidate |
| arbitrumSepolia | 421614 | 316729933 | Passed | Candidate |
| bscTestnet | 97 | 135409495 | Passed | Pending |
| arcTestnet | 5042002 | 65975633 | Passed | Pending |

## Run the checks

Merge the desired values from `.env.network-checks.example` into your existing
`.env.testnet`, without overwriting credentials. Then:

```bash
npm run evm:check-rpcs
# Or select individual targets:
npm run evm:check-rpcs -- bscTestnet arcTestnet
```

No token addresses or production credentials are required for this command.
It does NOT certify Cancun compatibility, token behavior, deployment, Safe
support, explorer verification, indexing or an application lifecycle.

## Remaining gates before Arc/BNB promotion

Local validation: **263 Hardhat tests passed**, including eight new diagnostic
tests. The first sandboxed run could not bind localhost for the existing HTTP
transport test; the full rerun with localhost permission passed. This does not
replace remote lifecycle evidence. Foundry and static analysis were not rerun
in this tooling-only pass.

1. Select and independently verify settlement tokens for each testnet. Do not
   assume a BNB token named USDC is Circle-native USDC or uses six decimals.
2. Verify compiler/opcode compatibility and simulate both vault deployments on
   the actual chain or a suitable fork; record source block and build hashes.
3. Verify multisig deployment/version, owners, threshold and code hashes.
4. Configure separate deployer, treasury, attester/reviewer and funding-admin
   roles, including the milestone-specific policy and control proof.
5. Review evidence before changing pending to candidate. Candidate status is
   permission for controlled testnet work, not production certification.
6. With explicit deployment approval and test-only funds, deploy and verify both
   vaults, complete required handovers and test both full application lifecycles.

Arc uses USDC for native gas, while its ERC-20 USDC interface exposes six-decimal
amounts. Native gas balance and ERC-20 accounting must not be confused or counted
twice. Both must be validated in integration before deployment approval.
See [Arc network settings](https://docs.arc.io/arc/references/connect-to-arc) and
[Arc token event documentation](https://docs.arc.io/integrate/infrastructure/indexing-events).
For BNB testnet network settings see [BNB Chain RPC documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/).

The existing GitHub fork job still covers Celo only. No new CI coverage, remote
contract deployment or production approval is claimed by this document.
