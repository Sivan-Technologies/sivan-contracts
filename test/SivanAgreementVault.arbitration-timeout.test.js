const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Arbitration timeout: restores position, never awards", function () {
  const ID = ethers.id("grief");
  const AMOUNT = ethers.parseUnits("1000", 6);
  let vault, token, owner, buyer, contractor, attester;

  beforeEach(async () => {
    [owner, buyer, contractor, attester] = await ethers.getSigners();
    const M = await ethers.getContractFactory("MockERC20");
    token = await M.deploy("USD Coin","USDC",6); await token.waitForDeployment();
    const V = await ethers.getContractFactory("SivanAgreementVault");
    vault = await V.deploy(owner.address, attester.address, 9827, owner.address);
    await vault.waitForDeployment();
    await vault.setSupportedToken(await token.getAddress(), true);
    await token.mint(buyer.address, AMOUNT*10n);
    await token.connect(buyer).approve(await vault.getAddress(), AMOUNT*10n);
    await vault.connect(buyer).deposit(ID, contractor.address, await token.getAddress(), AMOUNT, 24*7, ethers.ZeroAddress);
  });

  const TO = async () => { await time.increase(14*24*3600 + 60); await vault.connect(buyer).claimArbitrationTimeout(ID); };

  it("a buyer CANNOT steal delivered work by stalling arbitration", async () => {
    await vault.connect(contractor).markDelivered(ID, "ipfs://real-work");
    await vault.connect(buyer).raiseDispute(ID, "bogus");
    const bBefore = await token.balanceOf(buyer.address);
    await TO();
    // No money moved. State returned to Delivered.
    expect((await token.balanceOf(buyer.address)) - bBefore).to.equal(0n);
    expect((await vault.getAgreement(ID)).state).to.equal(2n);
  });

  it("and the contractor can still be paid afterwards", async () => {
    const proof = "ipfs://real-work";
    await vault.connect(contractor).markDelivered(ID, proof);
    await vault.connect(buyer).raiseDispute(ID, "bogus");
    await TO();

    const agr = await vault.getAgreement(ID);
    const sig = await attester.signTypedData(
      { name:"Sivan Celo Settlement Facility", version:"1",
        chainId:(await ethers.provider.getNetwork()).chainId, verifyingContract: await vault.getAddress() },
      { AgentAttestation:[{name:"agreementId",type:"bytes32"},{name:"agentId",type:"uint256"},
        {name:"deliverableHash",type:"bytes32"},{name:"timestamp",type:"uint256"}] },
      { agreementId: ID, agentId: 9827n,
        deliverableHash: ethers.keccak256(ethers.toUtf8Bytes(proof)), timestamp: agr.deadlineTimestamp });

    await expect(vault.connect(buyer).releasePayment(ID, "0x", sig, 0))
      .to.changeTokenBalance(token, contractor, agr.netAmount);
  });

  it("an undelivered agreement returns to Funded and the buyer still gets their refund", async () => {
    await vault.connect(contractor).raiseDispute(ID, "contractor stalls");
    await TO();
    expect((await vault.getAgreement(ID)).state).to.equal(1n);
    await time.increase(24*7*3600 + 60);
    await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(token, buyer, AMOUNT);
  });

  it("the dispute cannot be re-raised to loop the clock forever", async () => {
    await vault.connect(buyer).raiseDispute(ID, "first");
    await TO();
    await expect(vault.connect(buyer).raiseDispute(ID, "second"))
      .to.be.revertedWith("Dispute already used for this agreement");
    await expect(vault.connect(contractor).raiseDispute(ID, "second"))
      .to.be.revertedWith("Dispute already used for this agreement");
  });

  it("funds ALWAYS still escape: delivered path exits after the restored window", async () => {
    await vault.connect(contractor).markDelivered(ID, "ipfs://x");
    await vault.connect(buyer).raiseDispute(ID, "bogus");
    await TO();
    // The restored unlock is already in the past: 14 days of arbitration
    // outlasted the 7 day review window. So the buyer's exit is immediate,
    // which is correct. The delay cost them time, not their right to refund.
    const { refundUnlockAt } = await vault.getAgreement(ID);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    expect(Number(refundUnlockAt)).to.be.lessThan(now);
    await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(token, buyer, AMOUNT);
  });
});
