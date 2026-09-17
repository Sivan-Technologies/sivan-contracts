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

sivan-contracts is the core on-chain settlement layer for Sivan AI on Celo Mainnet and MiniPay. It enables fully non-custodial milestone Service Agreements settling in Celo native USDC, cUSD, and cNGN.

### Key Features
- Zero Custody: Sivan AI never holds user private keys. All funds are locked directly in an immutable smart contract on Celo Mainnet.
- Dynamic Volume Fees: Automatic tiered platform fees from 1.0% down to 0.50% based on deal size, with a hardcoded safety cap of 3.0% (MAX_FEE_BPS = 300).
- Open Developer Revenue Share: Any external dApp, freelance marketplace, or AI agent can integrate the contract and earn up to 30% to 50% of the platform fee by supplying their partnerAddress.
- Dual Cryptographic Attestation: Payments release only when both the buyer (via MiniPay EIP-712 signature) and Sivan AI (registered ERC-8004 Agent #9827) attest that milestones are satisfied.
- Automated Timeout Auto-Refund: If milestone deadlines pass without delivery, buyers autonomously claim 100% of their funds with zero admin intervention.
- Ultra-Low Celo Gas Friction: Sub-cent settlement costs (< $0.0003 USD per deal) and support for paying gas directly in USDC or cUSD.

---

## 2. Repository Structure

- contracts/SivanAgreementVault.sol: Primary settlement contract.
- contracts/interfaces/ISivanAgreementVault.sol: Standard integration interface for external developers.
- contracts/test/MockERC20.sol: Mock token contract for automated testing.
- test/SivanAgreementVault.test.js: Comprehensive unit test suite.
- scripts/deploy.js: Deployment and verification script for Celo Alfajores and Mainnet.
- docs/: Complete architecture, specification, and integration documentation.

---

## 3. Installation & Testing

Requirements: Node.js v20+, npm

1. Install dependencies:
   npm install

2. Compile contracts:
   npx hardhat compile

3. Run test suite:
   npx hardhat test

---

## 4. Deployment

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

### Deploy to Celo Alfajores Testnet:
npx hardhat run scripts/deploy.js --network alfajores

### Deploy to Celo Mainnet:
npx hardhat run scripts/deploy.js --network celo

---

## 5. Security Architecture

- Re-Entrancy Protection: OpenZeppelin ReentrancyGuard on all state-mutating functions.
- Safe Transfers: OpenZeppelin SafeERC20 ensuring non-standard token transfers never get stuck.
- Signature Replay Prevention: EIP-712 typed data hashing including chainId (42220), verifying contract, unique agreementId, and nonces.
- Strict Protocol Fee Separation: On-chain transfer fees (Sivan Transfer Fee) are completely decoupled from fiat bank dispersal fees (Sivan Off-Ramp Fee).

---

## 6. Founder & Team

- Founder & CEO: Samson Micheal (Abuja, Nigeria)
- Co-Founder & Head of Operations: Jonathan Hart
- Organization: Sivan Technology (https://github.com/Sivan-Technologies)
- Inquiries: sivantechnology@gmail.com | airspexta@gmail.com
