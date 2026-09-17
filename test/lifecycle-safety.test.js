const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { assertSepolia, recoveryContext, assertActors } = require("../scripts/helpers/lifecycle-safety");

describe("Lifecycle script safety (local only)", function () {
  async function rejects(promise, message) {
    let error;
    try { await promise; } catch (e) { error = e; }
    expect(error, "expected rejection").to.be.instanceOf(Error);
    expect(error.message).to.include(message);
  }
  it("rejects mainnet before accessing its provider", async () => {
    await rejects(assertSepolia("celo", { getNetwork() { throw Error("must not call"); } }), "require celoSepolia");
  });
  it("rejects a Sepolia alias pointing at mainnet", async () => {
    await rejects(assertSepolia("celoSepolia", { getNetwork: async () => ({ chainId: 42220n }) }), "11142220");
  });
  it("accepts only the expected alias and chain", async () => {
    await assertSepolia("celoSepolia", { getNetwork: async () => ({ chainId: 11142220n }) });
  });

  let owner, buyer, contractor, vault, token, id;
  beforeEach(async () => {
    [owner, buyer, contractor] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockERC20")).deploy("Test", "USDC", 6);
    vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(owner.address, owner.address, 9827, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);
    await token.mint(buyer.address, 10000000n);
    await token.connect(buyer).approve(await vault.getAddress(), 10000000n);
    id = ethers.id("recovery-test");
    await vault.connect(buyer).deposit(id, contractor.address, await token.getAddress(), 10000000n, 1, ethers.ZeroAddress);
  });
  async function expire() {
    await network.provider.send("evm_increaseTime", [3601]);
    await network.provider.send("evm_mine");
  }
  it("recovers with buyer only, zero free tokens, paused vault and delisted token", async () => {
    await expire();
    await vault.pause();
    await vault.setSupportedToken(await token.getAddress(), false);
    expect(await token.balanceOf(buyer.address)).to.equal(0n);
    const result = await recoveryContext(vault, id, [buyer], ethers.provider);
    expect(result.agreement.token).to.equal(await token.getAddress());
    await vault.connect(result.buyer).refundBuyer(id);
    expect(await token.balanceOf(buyer.address)).to.equal(10000000n);
  });
  it("already-refunded recovery needs no signers", async () => {
    await expire();
    await vault.connect(buyer).refundBuyer(id);
    expect((await recoveryContext(vault, id, [], ethers.provider)).complete).to.equal(true);
  });
  it("rejects the wrong buyer", async () => {
    await expire();
    await rejects(recoveryContext(vault, id, [contractor], ethers.provider), "buyer's signing key");
  });
  it("rejects recovery before the deadline", async () => {
    await rejects(recoveryContext(vault, id, [buyer], ethers.provider), "not unlocked");
  });
  it("does not silently treat a disputed agreement as a normal refund", async () => {
    await vault.connect(buyer).raiseDispute(id, "test");
    await rejects(recoveryContext(vault, id, [buyer], ethers.provider), "not eligible");
  });
  it("rejects a deployer who no longer owns the vault", async () => {
    await vault.transferOwnership(contractor.address);
    await rejects(assertActors(vault, owner, buyer, contractor), "not the vault owner");
  });
  it("rejects overlapping lifecycle actors", async () => {
    await rejects(assertActors(vault, owner, buyer, buyer), "distinct");
  });
});
