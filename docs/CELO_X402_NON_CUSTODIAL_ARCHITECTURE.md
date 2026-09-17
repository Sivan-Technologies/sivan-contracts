# FUTURE BUILD: CELO AND MINIPAY X402 NON-CUSTODIAL SERVICE AGREEMENT ARCHITECTURE

Document ID: FUTURE_BUILD_CELO_X402_NON_CUSTODIAL
Status: Planned Roadmap (Phase 2 Multi-Chain Architecture)
Target Network: Celo Mainnet (Chain ID 42220) and MiniPay Ecosystem
Author: Samson Micheal (Founder & CEO, Sivan Technology)
Team: Jonathan Hart (Co-Founder & Head of Operations)
Registered Agent: Sivan AI (ERC-8004 Token ID 9827, Registry: https://8004scan.io/agents/celo/9827)
Official URLs: https://sivantech.online | https://app.sivantech.online

1. Executive Summary

Sivan AI operates as an intelligent payment orchestration agent powering cross-border trade, freelance contracts, and local African business settlements. In Phase 1, Sivan AI established autonomous, non-custodial milestone vaults on Solana via x402 / PayAI facilities, where Sivan AI acts strictly as an AI coordinator instructing independent protocols without holding custody of user private keys.

On Celo Mainnet and MiniPay, Phase 1 enabled instant, low-friction Service Agreements settling directly between MiniPay wallets. To achieve 100% non-custodial parity across the entire Sivan stack (Solana, Stellar, Base, and Celo), this document details the implementation of an autonomous, non-custodial x402 facility router on Celo.

Under this target architecture, buyer funds are locked directly into an autonomous x402 facility or smart contract on Celo. Sivan AI never takes possession of private keys or intermediate funds; rather, Sivan AI and the buyer provide cryptographic milestone release instructions to disburse settlement funds directly to the seller or into fiat off-ramp settlement rails.

2. Architecture Comparison

Current Phase 1 Flow (Direct Agent Orchestration on Celo):
- Buyer creates a Service Agreement in MiniPay or Web App.
- Buyer approves and sends USDC / USDm on Celo Mainnet to the registered Sivan Agent address (0x4a1A9cf30A86b2b333D1a743181aAE71a50BAFBc).
- The transaction hash is recorded as funding proof.
- Upon deliverable verification and buyer cryptographic authorization, the agent triggers settlement transfer or fiat cashout.

Target Phase 2 Flow (100% Non-Custodial x402 Facility on Celo):
- Buyer initiates a Service Agreement in MiniPay or Web App.
- Sivan AI derives or requests a dedicated x402 facility deposit contract on Celo Mainnet.
- Buyer deposits USDC or USDm directly into the autonomous facility on Celo. Sivan AI holds zero private keys to the locked funds.
- Deliverables are submitted with cryptographic or URL proof.
- Sivan AI Agent #9827 verifies milestones against agreement criteria.
- Buyer signs an EIP-712 release authorization within MiniPay.
- The x402 facility contract validates the signatures and autonomously disperses funds:
  - Contractor receives net USDC or USDm directly, or
  - Dispersal rail forwards to regulated off-ramp liquidity partners (Textile / Busha) for near-instant NGN settlement (typically under 1 to 2 minutes via NIBSS / NIP rails).
  - Sivan Transfer Fee is routed to protocol fee collection wallet.

3. Core Technical Specifications

3.1 Autonomous Facility Contract on Celo
The x402 Celo Facility Contract provides standard state-machine enforcement:
- Pending Funding: Facility initialized with agreement terms, deadline timestamp, buyer address, and contractor payout address.
- Funded: Locked on-chain upon receipt of specified ERC-20 token amount (USDC: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C, USDm: 0x765DE816845861e75A25fCA122bb6898B8B1282a).
- In Delivery: Milestone period running with countdown timer.
- Delivered: Contractor submits verifiable proof URL or hash.
- Released: Autonomous on-chain payout executed upon valid dual-attestation (buyer wallet signature plus Sivan AI Agent #9827 attestation).
- Disputed: Mutual hold triggered pending structured resolution.
- Refunded: Autonomous refund back to buyer address if mutually agreed or deadline expires with no deliverable.

3.2 Agent Verification and Attestation (ERC-8004 Standard)
Sivan AI is registered as an on-chain agent on Celo Mainnet (ERC-8004 Token ID 9827).
Verification workflow:
- The agreement creation emits an OnChainAgreementRegistered event.
- Sivan AI listens via Celo RPC, validating that deposit amounts match quoted terms.
- At release time, Sivan AI issues an EIP-712 AgentApproval attestation with its registered identity key (0x4a1A9cf30A86b2b333D1a743181aAE71a50BAFBc).
- The facility contract verifies the agent signature against the official registry before releasing funds.

4. Fee Separation and Financial Isolation

Sivan adheres strictly to protocol fee separation:
- Sivan Transfer Fee (Celo & Stellar): Handled on-chain at point of release via the facility router, deducting platform fee (e.g. 1%) to protocol fee wallets.
- Sivan Off-Ramp Fee (Celo & Stellar): Evaluated during fiat RFQ quotes for Nigerian bank cashouts, settled via Textile Credit / Busha NIP rails.
- Both fees remain decoupled and independently auditable.

5. Realistic Settlement Timelines

- Smart Account and On-Chain Settlement: Sub-second (0.15s) block confirmation on Celo Mainnet.
- Nigerian Bank Account Settlement: Near-instant fiat dispersal (typically under 1 to 2 minutes via NIBSS / NIP rails).
- Realistic Test Amounts: 5 USDC to 50 USDC (or 2,000 NGN to 50,000 NGN).

6. Implementation Roadmap

Step 1: Protocol Interface Definition
- Define standard IX402CeloFacility interface compatible with existing x402 Solana client abstractions.
- Ensure seamless multi-chain adapter support in IChainAdapter on multichain branch.

Step 2: Smart Contract Deployment & Audit
- Deploy autonomous facility contract to Celo Alfajores Testnet, then Celo Mainnet.
- Integrate contract verification with Celoscan.

Step 3: MiniPay Client Adaptation
- Update agreementsService in sivan-minipay-app to interact with the autonomous facility deposit address.
- Support EIP-712 milestone release signing directly in MiniPay.

Step 4: Verification and Hackathon Showcase
- Conduct end-to-end multi-chain verification across Celo and Solana.
- Document zero-custody guarantees in public hackathon materials and grant applications.
