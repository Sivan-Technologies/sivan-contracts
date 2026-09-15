# SIVAN CELO X402: DEVELOPER INTEGRATION & AFFILIATE REVENUE GUIDE

Document ID: DEVELOPER_INTEGRATION_GUIDE
Protocol: Sivan Agreement Settlement Facility on Celo
Target Network: Celo Mainnet (Chain ID 42220) & Alfajores Testnet (Chain ID 44787)
Registered Attestation Agent: Sivan AI (ERC-8004 Agent #9827, Registry: https://8004scan.io/agents/celo/9827)
Official Attribution Tag: celo_bafcc2e56bd7
Founder: Samson Micheal (Abuja, Nigeria)
Co-Founder: Jonathan Hart

1. Overview for External Developers & AI Builders

SivanAgreementVault is an open, non-custodial milestone settlement primitive on Celo. Any developer, freelance platform, gig economy dApp, or autonomous AI agent can interact with this contract directly.

Key Benefits for Integrating Developers:
- Instant Non-Custodial Architecture: You do not need to write, deploy, or secure your own settlement contracts.
- Developer Revenue Share: Pass your partnerAddress in deposit() and earn up to 30% to 50% of the Sivan protocol fee on every settled deal.
- Dual Attestation Security: Sivan AI (registered ERC-8004 Agent #9827) provides autonomous verification of delivery conditions and deadlines.
- Celo Gas Efficiency: Micro-transactions from 5 USDC to 50 USDC incur less than $0.0003 USD in on-chain gas friction.
- Direct Fiat Off-Ramp Compatibility: Once released, contractors can cash out into Nigerian bank accounts in 1 to 2 minutes via integrated NIBSS / NIP rails.

2. Contract Addresses

Celo Mainnet (Chain ID 42220):
- SivanAgreementVault: TBD (Deploying Phase 2)
- Celo Native USDC: 0xcebA97Fcedaa310E7D988936b9741FA007a9C05c
- Celo Dollar (cUSD): 0x765DE816845861e75A25fCA122bb6898B8B1282a
- Celo Nigerian Naira (cNGN): 0xD994AE75470763bb53e7E41a99859f5b61C8B49b

Celo Alfajores Testnet (Chain ID 44787):
- SivanAgreementVault: Configured via deploy.js
- Sivan Registered Attester: 0x4a1A9cf30A86b2b333D1a743181aAE71a50BAFBc

3. How to Integrate in Your dApp or AI Agent

Step 1: Approve Token Spend
Before funding an agreement, have the user wallet or agent approve SivanAgreementVault:

await usdcContract.approve(vaultAddress, totalAmount);

Step 2: Deposit and Lock Funds
Call deposit() specifying your developer address as partnerAddress to claim your revenue share:

const agreementId = ethers.keccak256(ethers.toUtf8Bytes("deal_custom_id_123"));
const contractor = "0xContractorAddress...";
const token = "0xcebA97Fcedaa310E7D988936b9741FA007a9C05c"; // USDC
const amount = ethers.parseUnits("50", 6); // 50 USDC
const deadlineHours = 48;
const partnerAddress = "0xYourDeveloperWallet..."; // Earn up to 30% of platform fee

await vaultContract.deposit(
  agreementId,
  contractor,
  token,
  amount,
  deadlineHours,
  partnerAddress
);

Step 3: Submit Deliverables
When work is complete, the contractor calls markDelivered():

await vaultContract.connect(contractor).markDelivered(
  agreementId,
  "https://github.com/project/commit/abc123"
);

Step 4: Release Payment
The buyer signs an EIP-712 release authorization. Sivan AI Agent #9827 signs the attestation. The transaction is submitted:

await vaultContract.releasePayment(
  agreementId,
  buyerSignature,
  agentAttestation
);

The contractor receives 99% net funds, Sivan receives 70% of the platform fee, and your partnerAddress receives 30% of the platform fee automatically on-chain.

4. Autonomous Timeout Protection

If a contractor fails to deliver and the deadline timestamp passes:
The buyer can call refundBuyer(agreementId) directly. 
100% of the deposit is returned to the buyer wallet immediately without requiring Sivan AI permission or developer intervention.
