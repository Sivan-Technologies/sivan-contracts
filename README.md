# Sivan Celo Smart Contracts (sivan-contracts)

Autonomous, Non-Custodial Service Agreement Settlement Facility on Celo for Sivan AI and Web3 Builders.

Where this sits: Sivan's x402 stack has two layers. Layer 1 is off-chain:
the backend answers HTTP 402 Payment Required with settlement terms and prepares
EIP-712 payloads. Layer 2 is this contract: the on-chain facility those payments
settle into, holding locked agreement funds and enforcing release, attestation and
deadline refunds.

This repository is Layer 2 only. It contains no HTTP 402 handling, because that
is not something a Solidity contract can do. See
[the specification](docs/CELO_X402_SMART_CONTRACT_SPECIFICATION.md#2-the-two-layers-of-x402-on-celo).

Official Links:
- Website: https://sivantech.online
- Payment App: https://app.sivantech.online
- Telegram: https://t.me/Sivan_Ai
- Registered Celo Agent: https://8004scan.io/agents/celo/9827 (ERC-8004 Agent #9827)
- Official Attribution Tag: celo_bafcc2e56bd7

---

## 1. Overview

sivan-contracts is the core on-chain settlement layer for Sivan AI on Celo Mainnet and MiniPay. It enables fully non-custodial milestone Service Agreements settling in Celo native USDC (primary), USDm (Mento Dollar, formerly cUSD), and USDT.

### Key Features
- Zero Custody: Sivan AI never holds user private keys. All funds are locked directly in an immutable smart contract on Celo Mainnet.
- Dynamic Volume Fees: Automatic tiered platform fees from 1.0% down to 0.50% based on deal size, with a hardcoded safety cap of 3.0% (MAX_FEE_BPS = 300).
- Open Developer Revenue Share: Any external dApp, freelance marketplace, or AI agent can integrate the contract and earn up to 30% to 50% of the platform fee by supplying their partnerAddress.
- Dual Cryptographic Attestation: Payments release only when both the buyer (via MiniPay EIP-712 signature) and Sivan AI (registered ERC-8004 Agent #9827) attest that milestones are satisfied.
- Automated Timeout Auto-Refund: If milestone deadlines pass without delivery, buyers autonomously claim 100% of their funds with zero admin intervention.
- Ultra-Low Celo Gas Friction: A release costs roughly 65,000 gas, and Celo supports paying that gas directly in USDC or USDm via CIP-64. The dollar figure moves with gas price and the CELO price, so the gas number is quoted instead.

---

## 2. Repository Structure

- contracts/SivanAgreementVault.sol: Primary settlement contract.
- contracts/interfaces/ISivanAgreementVault.sol: Standard integration interface for external developers.
- contracts/test/MockERC20.sol: Mock token with configurable decimals, so 6dp and 18dp assets are both exercised.
- contracts/test/MockFeeOnTransferERC20.sol: Skims a percentage on transfer, to prove deposits record what actually arrived.
- test/: Five Hardhat suites, 75 tests. Core lifecycle, security, assets, delegated release, release matrix, and the delivery lockup.
- forge-test/VaultInvariant.t.sol: Foundry handler with 7 invariants over 12,800 calls, plus 4 fuzz tests.
- scripts/deploy.js: Deployment for Celo Sepolia and Mainnet, with on-chain token verification and block-pinned post-deploy assertions.
- docs/: Architecture, specification, integration, the delivery and dispute policy, and the testnet runbook.

---

## 3. Installation & Testing

Requirements: Node.js v20+, npm

1. Install dependencies:
   npm install

2. Compile contracts:
   npx hardhat compile

3. Run test suite:
   npx hardhat test --network hardhat
   forge test            # 7 invariants over 12,800 calls, plus 4 fuzz tests

---

## 4. Deployment

### Proposed community arbitration pilot

The current local implementation is documented in [Agreed arbitration](docs/AGREED_ARBITRATION.md):
bilateral acceptance of 24/72/168-hour primary review, a fixed independent reviewer,
and no automatic payout on timeout. If independent review stalls, funds can remain
disputed indefinitely without voluntary settlement. This is not deployed; clients
must integrate the new acceptance flow.

See [Community arbitration pilot](docs/COMMUNITY_ARBITRATION_PILOT.md) for the
human-review and three-person appeal-panel design. Parameters and exhausted-panel
behavior require approval. This policy is not implemented and is not a production
readiness claim. Vera and all deployed contracts are unchanged by the proposal.

### Review-only Vera integration plan

See [Sivan–Vera API mapping](docs/SIVAN_VERA_API_INTEGRATION.md) for the current
Vera routes, proposed Sivan adapter, authentication, idempotency limitations and
human-review boundary. This is a specification, not a deployed integration.
See [local lifecycle safeguards](docs/LIFECYCLE_SAFETY_UPDATE.md) for test tooling.
Production remains blocked on independent security review, client integration,
reviewer operational setup and controlled remote validation.

### Current Celo Sepolia deployment

See the [Sepolia deployment record and next steps](docs/CELO_SEPOLIA_DEPLOYMENT.md)
for the deployed testnet vault, confirmed allowlist state, deployment verification
warning, and remaining checks. Do not redeploy the existing vault to resolve that warning.

The current Sepolia network reads `CELO_SEPOLIA_RPC_URL` and
`CELO_SEPOLIA_CHAIN_ID` from `.env`; deployment reads `CELO_SEPOLIA_USDC`.
For an explicitly intended new testnet deployment, use `npm run deploy:sepolia`.
Legacy network commands below are not the Sepolia deployment command.

Configure your environment variables in .env (see .env.example):
- DEPLOYER_PRIVATE_KEY
- SIVAN_FEE_COLLECTOR
- SIVAN_AGENT_ATTESTER
- CELOSCAN_API_KEY

### Deploy to Celo Sepolia Testnet:
npm run deploy:sepolia

Alfajores (chain 44787) was sunset on 30 September 2025 with Ethereum Holesky.
Celo Sepolia (chain 11142220) replaced it. The deploy script refuses the
alfajores network rather than timing out against an RPC that no longer answers.

### Deploy to Celo Mainnet:
npm run deploy:celo

---

## 5. Security Architecture

- Re-Entrancy Protection: OpenZeppelin ReentrancyGuard on all state-mutating functions.
- Safe Transfers: OpenZeppelin SafeERC20 ensuring non-standard token transfers never get stuck.
- Signature Replay Prevention: EIP-712 typed data hashing including the chain ID, the verifying contract address, a unique agreementId, and per-agreement nonces. The chain ID is bound from block.chainid at construction rather than hardcoded, so the same source deploys correctly to mainnet (42220) and Celo Sepolia (11142220). Hardcoding it would make every signature on the other network invalid.
- Strict Protocol Fee Separation: On-chain transfer fees (Sivan Transfer Fee) are completely decoupled from fiat bank dispersal fees (Sivan Off-Ramp Fee).
- Dispute safeguards: primary nonresponse escalates to the agreed independent reviewer, never to an automatic buyer refund. If independent review and voluntary settlement both fail, disputed funds can remain locked indefinitely. See [the current arbitration policy](docs/AGREED_ARBITRATION.md).

---

## 6. Founder & Team

- Founder & CEO: Samson Micheal
- Co-Founder & Head of Operations: Jonathan Hart
- Organization: Sivan Technology (https://github.com/Sivan-Technologies)
- Inquiries: sivantechnology@gmail.com | airspexta@gmail.com
