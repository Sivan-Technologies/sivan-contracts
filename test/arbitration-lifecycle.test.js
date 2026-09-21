const { expect } = require("chai");
const { ethers } = require("hardhat");
const { arbitrationConfig, acceptArbitrationTerms } = require("../scripts/helpers/arbitration-terms");

describe("Lifecycle arbitration configuration (local only)", () => {
  let vault, token, owner, buyer, contractor, agent, independent;
  beforeEach(async () => {
    [owner, buyer, contractor, agent, independent] = await ethers.getSigners();
    vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(owner.address, agent.address, 9827, owner.address);
    token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    await vault.setSupportedToken(await token.getAddress(), true);
  });
  it("requires explicit non-conflicting reviewer and allowed period", async () => {
    await expect(arbitrationConfig(vault, buyer, contractor, {})).to.be.rejectedWith("Set INDEPENDENT_REVIEWER");
    await expect(arbitrationConfig(vault, buyer, contractor, { INDEPENDENT_REVIEWER: independent.address, PRIMARY_REVIEW_HOURS: "14" })).to.be.rejectedWith("Set PRIMARY_REVIEW_HOURS");
    await expect(arbitrationConfig(vault, buyer, contractor, { INDEPENDENT_REVIEWER: agent.address, PRIMARY_REVIEW_HOURS: "72" })).to.be.rejectedWith("Independent reviewer must be distinct");
  });
  it("runs the actual script acceptance helper and funds only matching terms", async () => {
    const config = await arbitrationConfig(vault, buyer, contractor, { INDEPENDENT_REVIEWER: independent.address, PRIMARY_REVIEW_HOURS: "72" });
    const id = ethers.id("script-acceptance"), amount = 1000000n, recorded = [];
    await acceptArbitrationTerms(vault, buyer, contractor, id, await token.getAddress(), amount, 1, ethers.ZeroAddress, config,
      async (label, tx) => { await tx.wait(); recorded.push(label); });
    expect(recorded).to.deep.equal(["propose arbitration terms", "accept arbitration terms"]);
    await token.mint(buyer.address, amount);
    await token.connect(buyer).approve(await vault.getAddress(), amount);
    await vault.connect(buyer).deposit(id, contractor.address, await token.getAddress(), amount, 1, ethers.ZeroAddress);
    expect((await vault.arbitrationCases(id)).independentReviewer).to.equal(independent.address);
  });
});
