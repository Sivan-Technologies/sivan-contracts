// Audit reproductions: passing assertions demonstrate current risks, not fixes.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { fund } = require("./helpers/fund");
const { testAgreementId } = require("./helpers/agreement-id");
const DAY = 86400;

describe("Security review 2026-09-29: behavioral reproductions", function () {
  async function fixture() {
    const [owner, buyer, contractor, collector, agent, outsider] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address, agent.address, 9827, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);
    const amount = 100000000n, id = testAgreementId("audit-2026-09-29");
    await token.transfer(buyer.address, amount);
    await token.connect(buyer).approve(await vault.getAddress(), amount);
    await fund(vault.connect(buyer), id, contractor.address, await token.getAddress(), amount, 720, ethers.ZeroAddress);
    return { owner, buyer, contractor, outsider, token, vault, amount, id };
  }

  it("buyer self-reports delivery and refunds before the agreed 30-day work deadline", async function () {
    const c = await fixture();
    const original = await c.vault.getAgreement(c.id);
    await c.vault.connect(c.buyer).markDelivered(c.id, "buyer supplied claim; no contractor delivery");
    const delivered = await c.vault.getAgreement(c.id);
    expect(delivered.refundUnlockAt).lessThan(original.deadlineTimestamp);
    await time.increaseTo(delivered.refundUnlockAt + 1n);
    expect(BigInt(await time.latest())).lessThan(original.deadlineTimestamp);
    await expect(c.vault.connect(c.buyer).refundBuyer(c.id)).to.changeTokenBalances(c.token, [c.buyer, c.contractor], [c.amount, 0]);
  });

  it("an old contractor refund signature remains executable by a third party after delivery and dispute", async function () {
    const c = await fixture();
    const domain = { name: "Sivan Celo Settlement Facility", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await c.vault.getAddress() };
    const types = { ContractorRefundConsent: [{ name: "agreementId", type: "bytes32" }, { name: "nonce", type: "uint256" }] };
    const signature = await c.contractor.signTypedData(domain, types, { agreementId: c.id, nonce: 0 });
    await c.vault.connect(c.contractor).markDelivered(c.id, "ipfs://subsequent-delivery");
    await c.vault.connect(c.contractor).raiseDispute(c.id, "payment now disputed");
    await time.increase(365 * DAY);
    expect(await c.vault.agreementNonces(c.id)).eq(0);
    await expect(c.vault.connect(c.outsider).mutualRefund(c.id, signature)).to.changeTokenBalances(c.token, [c.buyer, c.contractor], [c.amount, 0]);
  });
});
