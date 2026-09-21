const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Agreed arbitration and independent escalation", function () {
  const ID = ethers.id("arbitration"), AMOUNT = ethers.parseUnits("100", 6), DAY = 86400;
  let vault, token, owner, buyer, contractor, agent, independent, outsider, partnerAddress;
  beforeEach(async () => {
    partnerAddress = ethers.ZeroAddress;
    [owner, buyer, contractor, agent, independent, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(owner.address, agent.address, 9827, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);
    await token.mint(buyer.address, AMOUNT);
    await token.connect(buyer).approve(await vault.getAddress(), AMOUNT);
  });
  async function propose(period = 3 * DAY, reviewer = independent.address) {
    const fundingHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "address"], [await token.getAddress(), AMOUNT, 24, partnerAddress]
    ));
    await vault.connect(buyer).proposeArbitrationTerms(ID, contractor.address, reviewer, period, fundingHash, await time.latest() + DAY);
    return vault.arbitrationTermsHash(buyer.address, ID);
  }
  async function accept() {
    return vault.connect(contractor).acceptArbitrationTerms(buyer.address, ID, await vault.arbitrationTermsHash(buyer.address, ID), true);
  }
  async function deposit(amount = AMOUNT) {
    return vault.connect(buyer).deposit(ID, contractor.address, await token.getAddress(), amount, 24, partnerAddress);
  }
  async function dispute(period = 3 * DAY, delivered = true) {
    await propose(period); await accept(); await deposit();
    if (delivered) await vault.connect(contractor).markDelivered(ID, "ipfs://work");
    await vault.connect(buyer).raiseDispute(ID, "Review requested");
    return (await vault.arbitrationCases(ID)).primaryDeadline;
  }
  async function settlement(refund, overrides = {}) {
    const domain = { name: "Sivan Celo Settlement Facility", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await vault.getAddress(), ...overrides };
    const types = { DisputeSettlement: [
      { name: "agreementId", type: "bytes32" }, { name: "buyerRefund", type: "uint256" },
      { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }
    ] };
    const value = { agreementId: ID, buyerRefund: refund, nonce: await vault.agreementNonces(ID), expiry: await time.latest() + 3600 };
    return { value, buyerSig: await buyer.signTypedData(domain, types, value), contractorSig: await contractor.signTypedData(domain, types, value) };
  }
  it("refuses funding without both parties accepting, without moving funds", async () => {
    await expect(deposit()).to.be.revertedWith("Arbitration terms not accepted");
    await propose();
    await expect(deposit()).to.be.revertedWith("Arbitration terms not accepted");
    expect(await token.balanceOf(buyer.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
  });
  for (const days of [1, 3, 7]) {
    it(`snapshots the agreed ${days}-day primary review period`, async () => {
      const deadline = await dispute(days * DAY);
      expect(deadline - (await vault.getAgreement(ID)).disputedAt).to.equal(days * DAY);
      expect((await vault.arbitrationCases(ID)).primaryReviewPeriod).to.equal(days * DAY);
    });
  }
  it("rejects arbitrary review periods", async () => {
    await expect(propose(14 * DAY)).to.be.revertedWith("Review period must be 1, 3 or 7 days");
  });
  it("rejects conflicting and zero independent reviewer addresses", async () => {
    for (const address of [ethers.ZeroAddress, owner.address, buyer.address, contractor.address, agent.address])
      await expect(propose(DAY, address)).to.be.revertedWith("Independent reviewer conflict");
  });
  it("requires the contractor and rejects stale acceptance hashes", async () => {
    const oldHash = await propose();
    await expect(vault.connect(outsider).acceptArbitrationTerms(buyer.address, ID, oldHash, true)).to.be.revertedWith("Only proposed contractor");
    await propose(DAY);
    await expect(vault.connect(contractor).acceptArbitrationTerms(buyer.address, ID, oldHash, true)).to.be.revertedWith("Terms changed");
  });
  it("clears acceptance when buyer changes terms", async () => {
    await propose(); await accept(); await propose(DAY);
    await expect(deposit()).to.be.revertedWith("Arbitration terms not accepted");
  });
  it("allows contractor to revoke before funding", async () => {
    const hash = await propose(); await accept();
    await vault.connect(contractor).acceptArbitrationTerms(buyer.address, ID, hash, false);
    await expect(deposit()).to.be.revertedWith("Arbitration terms not accepted");
  });
  it("rejects expired terms and changed funding amount", async () => {
    await propose(); await accept();
    await expect(deposit(AMOUNT - 1n)).to.be.revertedWith("Funding terms changed");
    await time.increase(DAY);
    await expect(deposit()).to.be.revertedWith("Terms expired");
  });
  it("requires fresh acceptance after fee settings change", async () => {
    await propose(); await accept();
    await vault.setFeePolicy(200, 3000, false);
    await expect(deposit()).to.be.revertedWith("Fee policy changed: accept new terms");
    await propose(); await accept(); await deposit();
    expect((await vault.getAgreement(ID)).feeAmount).to.equal(AMOUNT * 200n / 10000n);
  });
  it("cannot rewrite terms once funds are locked", async () => {
    await propose(); await accept(); await deposit();
    await expect(propose(DAY)).to.be.revertedWith("Agreement already exists");
    await expect(accept()).to.be.revertedWith("Agreement already exists");
  });
  it("pins accepted delivery terms and reviewers through settings and ownership changes", async () => {
    await propose(); await accept();
    await vault.setDeliveryReviewWindow(30 * DAY);
    await vault.transferOwnership(outsider.address);
    await deposit();
    expect((await vault.getAgreement(ID)).reviewWindowSnapshot).to.equal(7 * DAY);
    expect((await vault.arbitrationCases(ID)).primaryReviewer).to.equal(owner.address);
    await vault.connect(buyer).raiseDispute(ID, "Review");
    await expect(vault.connect(outsider).resolveDispute(ID, false, "Override")).to.be.revertedWith("Only primary reviewer");
    await vault.connect(owner).resolveDispute(ID, false, "Original reviewer ruling");
  });
  it("blocks escalation and independent rulings before the primary deadline", async () => {
    await dispute();
    await expect(vault.claimArbitrationTimeout(ID)).to.be.revertedWith("Arbitration period still running");
    await expect(vault.connect(independent).resolveDispute(ID, false, "Too early")).to.be.revertedWith("Only primary reviewer");
    await expect(vault.resolveDispute(ID, false, "")).to.be.revertedWith("Reason required");
  });
  for (const delivered of [true, false]) {
    it(`blocks timeout then immediate refund (${delivered ? "delivered" : "undelivered"})`, async () => {
      const deadline = await dispute(3 * DAY, delivered); await time.increaseTo(deadline);
      await expect(vault.connect(outsider).claimArbitrationTimeout(ID)).to.emit(vault, "ArbitrationEscalated");
      expect((await vault.getAgreement(ID)).state).to.equal(5);
      expect((await vault.getAgreement(ID)).disputeResolvedByTimeout).to.equal(false);
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith("Cannot refund in current state");
      await expect(vault.connect(buyer).releasePayment(ID, "0x", "0x", 0)).to.be.revertedWith("Cannot release in current state");
      expect(await token.balanceOf(await vault.getAddress())).to.equal(AMOUNT);
      expect(await token.balanceOf(buyer.address)).to.equal(0);
      expect(await token.balanceOf(contractor.address)).to.equal(0);
    });
  }
  it("expires primary authority exactly at the deadline without needing a keeper", async () => {
    const deadline = await dispute(); await time.setNextBlockTimestamp(deadline);
    await expect(vault.resolveDispute(ID, false, "Late ruling")).to.be.revertedWith("Only independent reviewer");
    await expect(vault.connect(independent).resolveDispute(ID, true, "Independent ruling")).to.emit(vault, "ArbitrationEscalated");
    expect(await token.balanceOf(contractor.address)).to.equal((await vault.getAgreement(ID)).netAmount);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
    await expect(vault.connect(independent).resolveDispute(ID, false, "Again")).to.be.revertedWith("Agreement is not disputed");
  });
  it("keeps stalled cases disputed indefinitely without resetting the clock", async () => {
    const deadline = await dispute(); await time.increaseTo(deadline); await vault.claimArbitrationTimeout(ID);
    await time.increase(365 * DAY);
    await expect(vault.claimArbitrationTimeout(ID)).to.be.revertedWith("Arbitration already escalated");
    await expect(vault.connect(buyer).raiseDispute(ID, "Again")).to.be.revertedWith("Cannot dispute in current state");
    await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith("Cannot refund in current state");
    expect((await vault.arbitrationCases(ID)).primaryDeadline).to.equal(deadline);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(AMOUNT);
  });
  it("permits escalation and independent refund while paused", async () => {
    const deadline = await dispute(); await vault.pause(); await time.increaseTo(deadline); await vault.claimArbitrationTimeout(ID);
    await expect(vault.connect(independent).resolveDispute(ID, false, "Refund ruling")).to.changeTokenBalance(token, buyer, AMOUNT);
  });
  it("preserves contractor-consented refunds after escalation", async () => {
    const deadline = await dispute(); await time.increaseTo(deadline); await vault.claimArbitrationTimeout(ID);
    await expect(vault.connect(contractor).mutualRefund(ID, "0x")).to.changeTokenBalance(token, buyer, AMOUNT);
  });
  for (const refund of [0n, AMOUNT / 2n, AMOUNT]) {
    it(`supports bilateral settlement of ${refund} buyer units without dust`, async () => {
      const deadline = await dispute(); await time.increaseTo(deadline); await vault.claimArbitrationTimeout(ID); await vault.pause();
      const s = await settlement(refund), agr = await vault.getAgreement(ID);
      const fee = agr.feeAmount * (AMOUNT - refund) / AMOUNT;
      await expect(vault.connect(outsider).settleDisputeByAgreement(ID, refund, s.value.expiry, s.buyerSig, s.contractorSig))
        .to.changeTokenBalances(token, [buyer, contractor, owner], [refund, AMOUNT - refund - fee, fee]);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
      await expect(vault.settleDisputeByAgreement(ID, refund, s.value.expiry, s.buyerSig, s.contractorSig)).to.be.revertedWith("Agreement is not disputed");
    });
  }
  it("rejects missing consent, altered amounts and cross-chain signatures without consuming nonce", async () => {
    await dispute(); const s = await settlement(AMOUNT / 2n);
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT / 2n, s.value.expiry, s.buyerSig, "0x")).to.be.revertedWith("Contractor settlement consent required");
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT, s.value.expiry, s.buyerSig, s.contractorSig)).to.be.revertedWith("Buyer settlement consent required");
    const cross = await settlement(AMOUNT, { chainId: 42220 });
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT, cross.value.expiry, cross.buyerSig, cross.contractorSig)).to.be.revertedWith("Buyer settlement consent required");
    expect(await vault.agreementNonces(ID)).to.equal(0);
  });
  it("rejects expired settlement signatures", async () => {
    await dispute(); const s = await settlement(AMOUNT); await time.increase(3601);
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT, s.value.expiry, s.buyerSig, s.contractorSig)).to.be.revertedWith("Invalid settlement expiry");
  });
  it("conserves split settlement including partner fees and odd base-unit rounding", async () => {
    partnerAddress = outsider.address;
    await dispute();
    const refund = 33333333n, s = await settlement(refund), agr = await vault.getAgreement(ID);
    const fee = agr.feeAmount * (AMOUNT - refund) / AMOUNT;
    const partnerFee = agr.partnerFeeAmount * (AMOUNT - refund) / AMOUNT;
    await expect(vault.settleDisputeByAgreement(ID, refund, s.value.expiry, s.buyerSig, s.contractorSig))
      .to.changeTokenBalances(token, [buyer, contractor, owner, outsider], [refund, AMOUNT - refund - fee, fee - partnerFee, partnerFee]);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
  });
  it("rejects cross-vault signatures and excess refunds", async () => {
    await dispute(); const s = await settlement(AMOUNT, { verifyingContract: outsider.address });
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT, s.value.expiry, s.buyerSig, s.contractorSig)).to.be.revertedWith("Buyer settlement consent required");
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT + 1n, s.value.expiry, "0x", "0x")).to.be.revertedWith("Refund exceeds deposit");
    await expect(vault.settleDisputeByAgreement(ID, AMOUNT, await time.latest() + 2 * DAY, "0x", "0x")).to.be.revertedWith("Invalid settlement expiry");
  });
});
