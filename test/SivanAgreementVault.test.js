const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SivanAgreementVault", function () {
  let vault;
  let usdc;
  let owner;
  let buyer;
  let contractor;
  let feeCollector;
  let agentAttester;
  let partnerDeveloper;

  const REGISTERED_AGENT_ID = 9827; // Celo ERC-8004 Agent #9827

  beforeEach(async function () {
    [owner, buyer, contractor, feeCollector, agentAttester, partnerDeveloper] =
      await ethers.getSigners();

    // Deploy Mock USDC (6 decimals)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    // Deploy SivanAgreementVault
    const SivanAgreementVault = await ethers.getContractFactory("SivanAgreementVault");
    vault = await SivanAgreementVault.deploy(
      feeCollector.address,
      agentAttester.address,
      REGISTERED_AGENT_ID,
      owner.address
    );
    await vault.waitForDeployment();

    // The vault fails CLOSED until initialised, so seed the allowlist before
    // any deposit. A fresh vault that accepted arbitrary ERC-20s was an audit
    // finding; every fixture now mirrors a real deployment, which seeds in the
    // same run as the deploy.
    await vault.setSupportedToken(await usdc.getAddress(), true);

    // Fund buyer with 1,000 USDC and approve vault
    const depositAmount = ethers.parseUnits("1000", 6);
    await usdc.transfer(buyer.address, depositAmount);
    await usdc.connect(buyer).approve(await vault.getAddress(), depositAmount);
  });

  describe("Deployment & Configuration", function () {
    it("should set initial parameters correctly", async function () {
      expect(await vault.feeCollector()).to.equal(feeCollector.address);
      expect(await vault.agentAttester()).to.equal(agentAttester.address);
      expect(await vault.registeredAgentId()).to.equal(REGISTERED_AGENT_ID);
      expect(await vault.defaultFeeBps()).to.equal(100); // 1%
      expect(await vault.partnerRevenueShareBps()).to.equal(3000); // 30%
    });

    it("should calculate dynamic tiered fees accurately", async function () {
      // Tier 1: <= 50 USDC -> 1.00% (100 bps)
      const microAmount = ethers.parseUnits("25", 6);
      expect(await vault.calculateFee(microAmount)).to.equal(100);

      // Tier 2: 50 to 500 USDC -> 0.75% (75 bps)
      const mediumAmount = ethers.parseUnits("200", 6);
      expect(await vault.calculateFee(mediumAmount)).to.equal(75);

      // Tier 3: > 500 USDC -> 0.50% (50 bps)
      const largeAmount = ethers.parseUnits("1000", 6);
      expect(await vault.calculateFee(largeAmount)).to.equal(50);
    });
  });

  describe("Core Deposit Lifecycle", function () {
    it("should lock funds non-custodially on deposit", async function () {
      const agreementId = ethers.keccak256(ethers.toUtf8Bytes("deal_001"));
      const amount = ethers.parseUnits("50", 6); // 50 USDC (realistic testing amount)
      const deadlineHours = 24;

      await expect(
        vault.connect(buyer).deposit(
          agreementId,
          contractor.address,
          await usdc.getAddress(),
          amount,
          deadlineHours,
          partnerDeveloper.address
        )
      ).to.emit(vault, "AgreementFunded");

      const agr = await vault.getAgreement(agreementId);
      expect(agr.buyer).to.equal(buyer.address);
      expect(agr.contractor).to.equal(contractor.address);
      expect(agr.totalAmount).to.equal(amount);
      expect(agr.netAmount).to.equal(ethers.parseUnits("49.5", 6));
      expect(agr.state).to.equal(1); // Funded
      expect(agr.partnerAddress).to.equal(partnerDeveloper.address);

      // Verify funds are held by contract, not Sivan wallet
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(amount);
    });
  });

  describe("Delivery & Settlement Release", function () {
    it("should allow contractor to mark milestone as delivered", async function () {
      const agreementId = ethers.keccak256(ethers.toUtf8Bytes("deal_002"));
      const amount = ethers.parseUnits("20", 6);

      await vault.connect(buyer).deposit(
        agreementId,
        contractor.address,
        await usdc.getAddress(),
        amount,
        48,
        ethers.ZeroAddress
      );

      await expect(
        vault.connect(contractor).markDelivered(agreementId, "https://ipfs.io/ipfs/QmDeliverable123")
      )
        .to.emit(vault, "DeliverableSubmitted")
        .withArgs(agreementId, contractor.address, "https://ipfs.io/ipfs/QmDeliverable123");

      const agr = await vault.getAgreement(agreementId);
      expect(agr.state).to.equal(2); // Delivered
      expect(agr.deliverableProof).to.equal("https://ipfs.io/ipfs/QmDeliverable123");
    });

    it("should release payment with protocol fee and developer partner revenue share", async function () {
      const agreementId = ethers.keccak256(ethers.toUtf8Bytes("deal_003"));
      const amount = ethers.parseUnits("100", 6); // Tier 2: 0.75% fee = 0.75 USDC

      await vault.connect(buyer).deposit(
        agreementId,
        contractor.address,
        await usdc.getAddress(),
        amount,
        24,
        partnerDeveloper.address
      );

      const agr = await vault.getAgreement(agreementId);

      // Generate Sivan AI Agent EIP-712 Attestation
      const domain = {
        name: "Sivan Celo Settlement Facility",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vault.getAddress(),
      };

      const agentTypes = {
        AgentAttestation: [
          { name: "agreementId", type: "bytes32" },
          { name: "agentId", type: "uint256" },
          { name: "deliverableHash", type: "bytes32" },
          { name: "timestamp", type: "uint256" },
        ],
      };

      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(""));
      const agentValue = {
        agreementId: agreementId,
        agentId: REGISTERED_AGENT_ID,
        deliverableHash: deliverableHash,
        timestamp: agr.deadlineTimestamp,
      };

      const agentSignature = await agentAttester.signTypedData(domain, agentTypes, agentValue);

      // Buyer releases directly
      const initialContractorBal = await usdc.balanceOf(contractor.address);
      const initialFeeCollectorBal = await usdc.balanceOf(feeCollector.address);
      const initialPartnerBal = await usdc.balanceOf(partnerDeveloper.address);

      await expect(
        vault.connect(buyer).releasePayment(agreementId, "0x", agentSignature, 0)
      ).to.emit(vault, "AgreementReleased");

      // Verify contractor received net 99.25 USDC
      const finalContractorBal = await usdc.balanceOf(contractor.address);
      expect(finalContractorBal - initialContractorBal).to.equal(ethers.parseUnits("99.25", 6));

      // Total Fee = 0.75 USDC. Partner gets 30% (0.225 USDC), Sivan gets 70% (0.525 USDC)
      const finalFeeCollectorBal = await usdc.balanceOf(feeCollector.address);
      expect(finalFeeCollectorBal - initialFeeCollectorBal).to.equal(ethers.parseUnits("0.525", 6));

      const finalPartnerBal = await usdc.balanceOf(partnerDeveloper.address);
      expect(finalPartnerBal - initialPartnerBal).to.equal(ethers.parseUnits("0.225", 6));
    });
  });

  describe("Safety & Timeout Auto-Refund", function () {
    it("should allow buyer to autonomously reclaim 100% funds after deadline expires", async function () {
      const agreementId = ethers.keccak256(ethers.toUtf8Bytes("deal_004"));
      const amount = ethers.parseUnits("30", 6);
      const deadlineHours = 12;

      await vault.connect(buyer).deposit(
        agreementId,
        contractor.address,
        await usdc.getAddress(),
        amount,
        deadlineHours,
        ethers.ZeroAddress
      );

      // Trying to refund before deadline fails
      await expect(vault.connect(buyer).refundBuyer(agreementId)).to.be.revertedWith(
        "Refund is not yet unlocked"
      );

      // Fast-forward time past deadline
      await time.increase(13 * 3600);

      // Now buyer claims 100% refund without requiring any agent or contractor permission
      const initialBuyerBal = await usdc.balanceOf(buyer.address);
      await expect(vault.connect(buyer).refundBuyer(agreementId))
        .to.emit(vault, "AgreementRefunded")
        .withArgs(agreementId, buyer.address, amount, "Deadline expired without delivery");

      const finalBuyerBal = await usdc.balanceOf(buyer.address);
      expect(finalBuyerBal - initialBuyerBal).to.equal(amount);
    });
  });
});
