# SIVAN CELO X402 SMART CONTRACT ARCHITECTURE SPECIFICATION

Document ID: FUTURE_BUILD_CELO_X402_SMART_CONTRACT_SPECIFICATION
Category: Smart Contract Architecture & Protocol Specification
Status: Specification Complete (Phase 2 Multi-Chain Architecture)
Target Network: Celo Mainnet (Chain ID 42220) and Celo Alfajores Testnet (Chain ID 44787)
Author: Samson Micheal (Founder & CEO, Sivan Technology)
Team: Jonathan Hart (Co-Founder & Head of Operations)
Registered Agent: Sivan AI (ERC-8004 Token ID 9827, Registry: https://8004scan.io/agents/celo/9827)
Official Attribution Tag: celo_bafcc2e56bd7
Registered Agent Address: 0x4a1A9cf30A86b2b333D1a743181aAE71a50BAFBc
Official Links: https://sivantech.online | https://app.sivantech.online

1. Executive Summary

This document specifies the complete architecture, data models, state machine, and technical implementation for the Sivan AI Celo x402 Smart Contract (SivanAgreementVault.sol). 

The contract establishes a 100% non-custodial, autonomous settlement facility on Celo Mainnet that natively implements the x402 payment standard for AI agents and human users. Under this architecture:
- Sivan AI holds zero private keys to user funds.
- Buyer funds are locked directly inside an immutable, audited smart contract on Celo Mainnet.
- Settlement release requires dual cryptographic authorization: the buyer connected wallet signature (e.g. via MiniPay) and the Sivan AI registered ERC-8004 agent attestation.
- Both human contractors and AI subagents can accept Service Agreements and settle instantly in USDC, cUSD, or local fiat (NGN).

2. The Two Layers of x402 on Celo

x402 is an open Internet standard for machine-to-machine and human-to-machine payments, rooted in HTTP Status 402 (Payment Required). The Sivan implementation pairs an off-chain AI coordination layer with an on-chain smart contract facility:

Layer 1: Off-Chain HTTP 402 AI Agent Coordination
- When a user or AI agent initiates a transaction, Sivan AI issues an HTTP 402 Payment Required response containing the settlement parameters: token address, amount, deadline, and destination facility contract.
- Sivan AI monitors delivery deadlines, tracks milestone submissions, inspects deliverable proof URLs, and prepares EIP-712 release payloads.

Layer 2: On-Chain Settlement Facility (SivanAgreementVault.sol)
- An immutable Solidity smart contract deployed directly to Celo Mainnet.
- Holds deposited ERC-20 tokens (USDC / cUSD) in contract storage.
- Enforces cryptographic permissions, platform fee routing, and automated deadline refunds without relying on any trusted intermediary.

3. Complete Protocol Workflow

Step 1: Agreement Initialization
- Buyer defines the terms: contractor address, deliverable description, milestone deadline (e.g. 24 hours, 48 hours), and payment amount (realistic amounts between 5 USDC and 50 USDC).
- Sivan AI records the agreement intent and assigns a unique agreement ID (bytes32).

Step 2: On-Chain Deposit (Funding)
- Buyer MiniPay wallet approves the token transfer and calls deposit() on the SivanAgreementVault contract.
- The contract pulls tokens directly into its address, records the deposit block timestamp, calculates delivery deadline timestamp, and emits AgreementFunded.
- Sivan AI never touches or holds the funds.

Step 3: Milestone Work & Delivery
- Contractor performs the agreed work.
- Contractor submits deliverable proof (URL, IPFS hash, or commit hash) via MiniPay or Sivan AI chat interface.
- Contract state moves to Delivered.

Step 4: Cryptographic Settlement & Dual-Attestation Release
- Buyer inspects the deliverable and signs an EIP-712 release authorization with their MiniPay private key.
- Sivan AI (registered ERC-8004 Agent #9827) validates that agreement terms and deadlines have been respected and signs an agent attestation.
- Either party or a relayer submits the dual signatures to releasePayment().
- The contract verifies both signatures on-chain and atomically executes:
  1. Platform Transfer Fee (e.g. 1%) sent to Sivan protocol fee wallet.
  2. Net amount (e.g. 99%) sent to contractor wallet, or to Textile / Busha liquidity rails for near-instant NGN bank cashout (typically under 1 to 2 minutes via NIBSS / NIP rails).
- Contract state transitions to Released.

Step 5: Automated Safety Refund (No-Show Protection)
- If the contractor fails to deliver work before the deadline timestamp expires, the buyer can trigger autoRefund().
- The contract verifies block.timestamp > deadlineTimestamp and atomically refunds 100% of the deposit back to the buyer address.
- No agent permission or admin intervention is required to claim a legitimate timeout refund.

4. Smart Contract Technical Specification

4.1 Contract Name and Standards
- Contract Name: SivanAgreementVault
- Solidity Version: ^0.8.24
- Core Standards: OpenZeppelin SafeERC20, ReentrancyGuard, EIP-712, Pausable

4.2 Supported Tokens on Celo Mainnet
- Celo Native USDC: 0xcebA97Fcedaa310E7D988936b9741FA007a9C05c
- Celo Dollar (cUSD): 0x765DE816845861e75A25fCA122bb6898B8B1282a
- Celo Nigerian Naira (cNGN): 0xD994AE75470763bb53e7E41a99859f5b61C8B49b

4.3 Data Structures

enum AgreementState {
    Uninitialized,
    Funded,
    Delivered,
    Released,
    Refunded,
    Disputed
}

struct Agreement {
    bytes32 agreementId;
    address buyer;
    address contractor;
    address token;
    uint256 totalAmount;
    uint256 feeAmount;
    uint256 netAmount;
    uint256 deadlineTimestamp;
    AgreementState state;
    string deliverableProof;
}

4.4 Key Smart Contract Functions

function deposit(
    bytes32 agreementId,
    address contractor,
    address token,
    uint256 amount,
    uint256 deadlineHours
) external nonReentrant;

function markDelivered(
    bytes32 agreementId,
    string calldata proofUrl
) external;

function releasePayment(
    bytes32 agreementId,
    bytes calldata buyerSignature,
    bytes calldata agentAttestation
) external nonReentrant;

function refundBuyer(
    bytes32 agreementId
) external nonReentrant;

function mutualRefund(
    bytes32 agreementId,
    bytes calldata contractorConsentSignature
) external nonReentrant;

4.5 EIP-712 Dual-Attestation Schema
Domain Separator:
- name: Sivan Celo Settlement Facility
- version: 1
- chainId: 42220 (Celo Mainnet)
- verifyingContract: SivanAgreementVault address

Release Authorization TypeHash:
keccak256("ReleaseAuthorization(bytes32 agreementId,address contractor,uint256 netAmount,uint256 nonce,uint256 expiry)")

Agent Attestation TypeHash:
keccak256("AgentAttestation(bytes32 agreementId,uint256 agentId,bytes32 deliverableHash,uint256 timestamp)")

5. Protocol Fee Architecture Separation

In accordance with Sivan core principles, fees are strictly decoupled:
- Sivan Transfer Fee: Managed directly inside SivanAgreementVault.sol. When an agreement is released, the contract deducts the protocol fee (1%) and transfers it to the designated Sivan fee collection wallet on Celo.
- Sivan Off-Ramp Fee: Managed during fiat RFQ quoting (e.g. via Textile Credit / Busha rails) when contractor requests conversion of crypto into Nigerian Naira. This fee is settled through fiat rails and never conflated with the on-chain transfer fee.

6. Gas Economics on Celo Mainnet

Celo offers substantial economic advantages for x402 settlement:
- Contract Deployment: ~1,100,000 gas (~0.0055 CELO = approx $0.003 USD)
- Agreement Deposit: ~85,000 gas (~0.0004 CELO = approx $0.0002 USD)
- Agreement Release: ~65,000 gas (~0.0003 CELO = approx $0.00015 USD)
- Total transaction friction per deal is less than one-tenth of a Nigerian Naira, making sub-50 USDC micro-transactions highly profitable and viable.
- Native Fee Currency: Gas fees can be paid directly in USDC or cUSD, meaning users never need to hold native CELO to use Sivan AI on MiniPay.

7. Security and Vulnerability Analysis

7.1 Re-Entrancy Prevention
All token transfers strictly follow the Checks-Effects-Interactions pattern and are guarded by OpenZeppelin ReentrancyGuard. Agreement state transitions to Released or Refunded before any token transfer is executed.

7.2 Signature Replay Protection
Each EIP-712 signature includes:
- Unique agreementId
- Nonce specific to the agreement
- Expiry block timestamp
- Celo Mainnet chainId (42220)
Signatures cannot be replayed across different agreements, chains, or contracts.

7.3 Dead-End Protection (Unresponsive Parties)
If a contractor never delivers, the buyer can autonomously reclaim 100% of funds immediately after deadlineTimestamp without needing contractor or Sivan AI approval.

7.4 Immutable Logic
The vault does not contain proxy upgrade backdoors that could alter release rules or seize user deposits.

8. Step-by-Step Deployment and Integration Plan

Step 1: Test Suite Development (contracts/test/)
- Write full Foundry test suite validating all 6 states, edge cases, signature verifications, and deadline timeouts.

Step 2: Celo Alfajores Testnet Deployment
- Deploy contract to Celo Alfajores (Chain ID 44787) using deployer key.
- Verify source code on Celoscan Alfajores.
- Conduct simulated test agreements using 5 to 50 testnet USDC.

Step 3: Celo Mainnet Deployment
- Deploy verified contract to Celo Mainnet (Chain ID 42220).
- Register contract address in celo.config.ts.

Step 4: MiniPay Integration
- Update sivan-minipay-app CreateAgreementView.ts to point deposit transactions to the SivanAgreementVault contract address.
- Wire miniPayService.signReleaseAuthorization to produce standard EIP-712 signatures consumed by the contract.

Step 5: Hackathon and Grant Showcase
- Present the live contract on Celoscan as proof of non-custodial milestone architecture in Celo Builders and grant applications.
- Highlight Sivan AI ERC-8004 Agent #9827 as the autonomous on-chain verifier.
