// Supplemental audit regressions, including the overdue-review authorization fix.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const DAY = 86400;
const amount = value => ethers.parseUnits(value, 6);

describe("Release candidate: supplemental adversarial review", function () {
  async function fixture() {
    const [buyer, contractor, treasury, primary, independent, replacement, admin, outsider] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const vault = await (await ethers.getContractFactory("SivanMilestoneVault")).deploy(treasury.address, primary.address, 100, [token.target], admin.address);
    const domain = { name: "SivanMilestoneVault", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: vault.target };
    async function project(label, value, duration = 7 * DAY) {
      const id = ethers.concat([buyer.address, ethers.dataSlice(ethers.id(label), 0, 12)]);
      await vault.proposeProject(id, contractor.address, token.target, independent.address,
        [{ amount: amount(value), duration, scopeHash: ethers.id(label) }], false, DAY, DAY, (await time.latest()) + DAY, DAY);
      const terms = (await vault.getProject(id)).termsHash;
      await vault.connect(contractor).acceptProject(id, terms);
      await token.approve(vault.target, amount(value));
      await vault.fundProject(id, terms);
      return id;
    }
    return { buyer, contractor, treasury, primary, independent, replacement, admin, outsider, token, vault, domain, project };
  }

  it("rejects unrelated callers after review expires and preserves ordinary buyer release", async function () {
    const c = await loadFixture(fixture), id = await c.project("overdue", "100");
    await c.vault.connect(c.contractor).markDelivered(id, 0, ethers.id("proof"));
    await time.increase(DAY + 1);
    const before = await c.vault.getMilestone(id, 0);
    for (const caller of [c.outsider, c.admin, c.primary, c.independent, c.treasury]) {
      await expect(c.vault.connect(caller).requestOverdueReview(id, 0)).revertedWith("Only parties");
    }
    expect(await c.vault.getMilestone(id, 0)).deep.eq(before);
    expect(await c.token.balanceOf(c.outsider.address)).eq(0);
    expect(await c.token.balanceOf(c.vault.target)).eq(amount("100"));
    await c.vault.releaseMilestone(id, 0);
    expect(await c.token.balanceOf(c.contractor.address)).eq(amount("99"));
  });

  for (const role of ["buyer", "contractor"]) {
    it(`allows overdue review by the ${role} while paused, but only after the review deadline`, async function () {
      const c = await loadFixture(fixture), id = await c.project(`overdue-${role}`, "100");
      await c.vault.connect(c.contractor).markDelivered(id, 0, ethers.id("proof"));
      const delivered = await c.vault.getMilestone(id, 0);
      await c.vault.connect(c.admin).setFundingPaused(true);
      await time.setNextBlockTimestamp(delivered.deliveredAt + BigInt(DAY));
      await expect(c.vault.connect(c[role]).requestOverdueReview(id, 0)).revertedWith("Review not overdue");
      await expect(c.vault.connect(c[role]).requestOverdueReview(id, 0)).emit(c.vault, "MilestoneDisputed");
      expect((await c.vault.getMilestone(id, 0)).state).eq(3);
      await expect(c.vault.connect(c[role]).requestOverdueReview(id, 0)).revertedWith("Review not overdue");
      expect(await c.token.balanceOf(c.vault.target)).eq(amount("100"));
      await time.increase(DAY + 1);
      await c.vault.connect(c.outsider).escalateMilestone(id, 0);
      await c.vault.connect(c.independent).resolveMilestone(id, 0, 0);
      expect(await c.token.balanceOf(c.contractor.address)).eq(amount("99"));
      expect(await c.vault.tokenLiability(c.token.target)).eq(0);
    });
  }

  it("isolates three projects across reviewer recovery, timeout refund and bilateral settlement while paused", async function () {
    const c = await loadFixture(fixture);
    const a = await c.project("reviewer-recovery", "200");
    const b = await c.project("undelivered-refund", "150", 3600);
    const d = await c.project("bilateral-settlement", "100");
    const buyerAfterFunding = await c.token.balanceOf(c.buyer.address);
    const backed = async expected => {
      expect(await c.vault.tokenLiability(c.token.target)).eq(amount(expected));
      expect(await c.token.balanceOf(c.vault.target)).eq(amount(expected));
      const projects = await Promise.all([a, b, d].map(id => c.vault.getProject(id)));
      expect(projects.reduce((sum, p) => sum + p.remaining, 0n)).eq(amount(expected));
    };
    await backed("450");
    await c.vault.disputeMilestone(a, 0);
    await c.vault.disputeMilestone(d, 0);
    await c.vault.connect(c.admin).setFundingPaused(true);
    await time.increase(DAY + 1);
    await c.vault.connect(c.outsider).escalateMilestone(a, 0);
    await c.vault.connect(c.outsider).escalateMilestone(d, 0);
    await time.increase(DAY + 1);
    const types = { ReviewerReplacement: [
      { name: "projectId", type: "bytes32" }, { name: "index", type: "uint256" }, { name: "termsHash", type: "bytes32" },
      { name: "currentReviewer", type: "address" }, { name: "replacement", type: "address" },
      { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" },
    ] };
    const value = { projectId: a, index: 0, termsHash: (await c.vault.getProject(a)).termsHash,
      currentReviewer: c.independent.address, replacement: c.replacement.address, nonce: 0, expiry: (await time.latest()) + 3600 };
    const sigs = [await c.buyer.signTypedData(c.domain, types, value), await c.contractor.signTypedData(c.domain, types, value)];
    await expect(c.vault.replaceIndependentReviewer(d, 0, c.replacement.address, value.expiry, ...sigs)).revertedWith("Buyer consent required");
    await c.vault.connect(c.outsider).replaceIndependentReviewer(a, 0, c.replacement.address, value.expiry, ...sigs);
    await backed("450");
    expect((await c.vault.getMilestone(d, 0)).activeReviewer).eq(c.independent.address);
    await expect(c.vault.connect(c.independent).resolveMilestone(a, 0, 0)).revertedWith("Only independent reviewer");
    await c.vault.connect(c.replacement).resolveMilestone(a, 0, 0);
    await backed("250");

    const pb = await c.vault.getProject(b);
    await time.increaseTo(pb.fundedAt + 3600n + BigInt(2 * DAY) + 1n);
    await c.vault.refundUndelivered(b, 0);
    await backed("100");
    const settlementTypes = { MilestoneSettlement: [
      { name: "projectId", type: "bytes32" }, { name: "index", type: "uint256" }, { name: "termsHash", type: "bytes32" },
      { name: "buyerRefund", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" },
    ] };
    const settlement = { projectId: d, index: 0, termsHash: (await c.vault.getProject(d)).termsHash,
      buyerRefund: amount("25"), nonce: 0, expiry: (await time.latest()) + 3600 };
    await c.vault.connect(c.outsider).settleByAgreement(d, 0, settlement.buyerRefund, settlement.expiry,
      await c.buyer.signTypedData(c.domain, settlementTypes, settlement), await c.contractor.signTypedData(c.domain, settlementTypes, settlement));
    await backed("0");
    expect(await c.token.balanceOf(c.buyer.address) - buyerAfterFunding).eq(amount("175"));
    expect(await c.token.balanceOf(c.contractor.address)).eq(amount("272.25"));
    expect(await c.token.balanceOf(c.treasury.address)).eq(amount("2.75"));
    expect(await c.token.balanceOf(c.outsider.address)).eq(0);
    expect(await c.vault.fundingPaused()).eq(true);
    await expect(c.vault.connect(c.replacement).resolveMilestone(a, 0, 0)).revertedWith("Not disputed");
  });
});
