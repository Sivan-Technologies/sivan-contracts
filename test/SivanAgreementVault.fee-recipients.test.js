const { expect } = require("chai");
const { ethers } = require("hardhat");
const { fund } = require("./helpers/fund");

describe("Vault-self fee recipient guards", () => {
  let vault, token, owner, buyer, contractor, agent, collector, partner;
  const ID = ethers.id("fee-recipient-guard"), amount = 100000000n;
  beforeEach(async () => {
    [owner, buyer, contractor, agent, collector, partner] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address, agent.address, 9827, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);
    await token.mint(buyer.address, amount);
    await token.connect(buyer).approve(await vault.getAddress(), amount);
  });

  it("rejects its predicted deployment address as the initial fee collector", async () => {
    const predicted = ethers.getCreateAddress({ from: owner.address, nonce: await ethers.provider.getTransactionCount(owner.address) });
    const factory = await ethers.getContractFactory("SivanAgreementVault", owner);
    await expect(factory.deploy(predicted, agent.address, 9827, owner.address)).to.be.revertedWith("Vault cannot receive fees");
  });
  it("rejects changing the fee collector to the vault, without changing configuration", async () => {
    await expect(vault.setFeeCollector(await vault.getAddress())).to.be.revertedWith("Vault cannot receive fees");
    expect(await vault.feeCollector()).to.equal(collector.address);
    await expect(vault.setFeeCollector(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
  });
  for (const zeroFees of [false, true]) {
    it(`rejects a vault partner before transferring the deposit (zero fees=${zeroFees})`, async () => {
      if (zeroFees) await vault.setFeePolicy(0, 0, false);
      await expect(fund(vault.connect(buyer), ID, contractor.address, await token.getAddress(), amount, 24, await vault.getAddress()))
        .to.be.revertedWith("Vault cannot receive fees");
      expect(await token.balanceOf(buyer.address)).to.equal(amount);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
      expect((await vault.getAgreement(ID)).state).to.equal(0);
    });
  }
  for (const withPartner of [false, true]) {
    it(`preserves normal release accounting (partner=${withPartner})`, async () => {
      await fund(vault.connect(buyer), ID, contractor.address, await token.getAddress(), amount, 24,
        withPartner ? partner.address : ethers.ZeroAddress);
      const a = await vault.getAgreement(ID);
      await expect(vault.connect(buyer).releasePayment(ID, "0x", "0x", 0))
        .to.changeTokenBalances(token, [contractor, collector, partner], [a.netAmount, a.feeAmount - a.partnerFeeAmount, a.partnerFeeAmount]);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
    });
  }
  it("allows zero-fee settlement without a partner", async () => {
    await vault.setFeePolicy(0, 0, false);
    await fund(vault.connect(buyer), ID, contractor.address, await token.getAddress(), amount, 24, ethers.ZeroAddress);
    await expect(vault.connect(buyer).releasePayment(ID, "0x", "0x", 0)).to.changeTokenBalance(token, contractor, amount);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
  });

  for (const zeroFees of [false, true]) {
    it(`rejects a reviewer partner before funding (zero fees=${zeroFees})`, async () => {
      if (zeroFees) await vault.setFeePolicy(0, 0, false);
      const reviewer = (await ethers.getSigners())[9];
      await expect(fund(vault.connect(buyer), ID, contractor.address, await token.getAddress(), amount, 24, reviewer.address))
        .to.be.revertedWith("Independent reviewer fee conflict");
      expect(await token.balanceOf(buyer.address)).to.equal(amount);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
      expect(await vault.agreementFeeCollectors(ID)).to.equal(ethers.ZeroAddress);
    });
  }

  it("locks the accepted collector while new agreements use the new setting", async () => {
    await fund(vault.connect(buyer), ID, contractor.address, await token.getAddress(), amount, 24, ethers.ZeroAddress);
    await vault.setFeeCollector(partner.address);
    const second = ethers.id("second collector");
    await token.mint(buyer.address, amount);
    await token.connect(buyer).approve(await vault.getAddress(), amount);
    await fund(vault.connect(buyer), second, contractor.address, await token.getAddress(), amount, 24, ethers.ZeroAddress);
    expect(await vault.agreementFeeCollectors(ID)).to.equal(collector.address);
    expect(await vault.agreementFeeCollectors(second)).to.equal(partner.address);
    const a = await vault.getAgreement(ID);
    await expect(vault.connect(buyer).releasePayment(ID, "0x", "0x", 0))
      .to.changeTokenBalances(token, [collector, partner], [a.feeAmount, 0]);
    await expect(vault.connect(buyer).releasePayment(second, "0x", "0x", 0))
      .to.changeTokenBalances(token, [collector, partner], [0, a.feeAmount]);
  });

  it("requires fresh acceptance if the collector changes after terms are accepted", async () => {
    const reviewer = (await ethers.getSigners())[9];
    const fundingHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "uint256", "address"], [await token.getAddress(), amount, 24, ethers.ZeroAddress]));
    const expiry = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await vault.connect(buyer).proposeArbitrationTerms(ID, contractor.address, reviewer.address, 86400, fundingHash, expiry);
    await vault.connect(contractor).acceptArbitrationTerms(buyer.address, ID, await vault.arbitrationTermsHash(buyer.address, ID), true);
    await vault.setFeeCollector(reviewer.address);
    await expect(vault.connect(buyer).deposit(ID, contractor.address, await token.getAddress(), amount, 24, ethers.ZeroAddress))
      .to.be.revertedWith("Fee policy changed: accept new terms");
    await expect(vault.connect(buyer).proposeArbitrationTerms(ID, contractor.address, reviewer.address, 86400, fundingHash, expiry))
      .to.be.revertedWith("Independent reviewer conflict");
    expect(await token.balanceOf(buyer.address)).to.equal(amount);
    expect(await vault.agreementFeeCollectors(ID)).to.equal(ethers.ZeroAddress);
  });
});
