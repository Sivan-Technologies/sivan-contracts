# Contract CI configuration

In GitHub repository Settings → Secrets and variables → Actions, configure:

| Type | Name | Value |
| --- | --- | --- |
| Repository variable | `CELO_FORK_RPC_URL` | `http://127.0.0.1:8545` |
| Repository secret | `CELO_FORK_SOURCE_RPC_URL` | A Celo mainnet RPC endpoint supporting fork state reads |

The first endpoint is the disposable runner-local Hardhat node. Never set it to
a remote network. Deployment transactions run only against that local node;
the source endpoint supplies read-only chain state. No funded wallet or private
key is required. Source RPC credentials must stay in Actions secrets, not files.

Missing settings deliberately fail the fork check. External fork pull requests
do not receive repository secrets; run this integration check only after review
in a trusted branch. Do not use `pull_request_target` to execute untrusted code.

Static analysis runs Slither 0.11.5 in a runner-local Python virtual environment
(Python >=3.10), against Hardhat-compiled artifacts. Medium/high findings still
fail CI; the existing exact-ID triage database remains in effect. The former
Docker action's older Python could not install this Slither version.

After configuring the settings and pushing the workflow correction, inspect the
new run. A local Slither pass does not prove the hosted fork check passed.
