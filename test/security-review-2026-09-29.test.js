// Regression tests for the reproduced audit findings and their remediation.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { fund } = require("./helpers/fund");
const { testAgreementId } = require("./helpers/agreement-id");
const DAY = 86400;

describe("Security review 2026-09-29: regression protections", function () {
  async function fixture() {
    const [owner, buyer, contractor, collector, agent, outsider] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address, agent.address, 9827, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);
    const amount = 100000000n, id = testAgreementId("audit-2026-09-29");
    await token.transfer(buyer.address, amount);
    await token.connect(buyer).approve(await vault.getAddress(), amount);
    await fund(vault.connect(buyer), id, contractor.address, await token.getAddress(), amount, 720, ethers.ZeroAddress);
    return { owner, buyer, contractor, collector, agent, outsider, token, vault, amount, id };
  }

  async function consent(c, overrides = {}, domainOverrides = {}, signer = c.contractor) {
    const domain = { name: "Sivan Celo Settlement Facility", version: "1", chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await c.vault.getAddress(), ...domainOverrides };
    const types = { ContractorRefundConsent: [{ name: "agreementId", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }] };
    const value = { agreementId: c.id, nonce: await c.vault.refundConsentNonces(c.id), expiry: (await time.latest()) + 3600, ...overrides };
    return { expiry: value.expiry, signature: await signer.signTypedData(domain, types, value) };
  }
  const submit = (c, s) => c.vault.connect(c.outsider).mutualRefundWithConsent(c.id, s.expiry, s.signature);

  it("rejects buyer/outsider delivery and preserves the original 30-day refund deadline", async function () {
    const c = await loadFixture(fixture);
    const original = await c.vault.getAgreement(c.id);
    for (const caller of [c.buyer, c.outsider]) {
      await expect(c.vault.connect(caller).markDelivered(c.id, "false claim")).revertedWith("Only contractor can mark delivery");
    }
    expect((await c.vault.getAgreement(c.id)).refundUnlockAt).eq(original.deadlineTimestamp);
    await time.increase(7 * DAY + 1);
    await expect(c.vault.connect(c.buyer).refundBuyer(c.id)).revertedWith("Refund is not yet unlocked");
    await time.increaseTo(original.deadlineTimestamp + 1n);
    await expect(c.vault.connect(c.buyer).refundBuyer(c.id)).to.changeTokenBalances(c.token, [c.buyer, c.contractor], [c.amount, 0]);
  });

  it("preserves contractor-authorized early delivery and buyer direct release from Funded", async function () {
    const c = await loadFixture(fixture);
    await expect(c.vault.connect(c.contractor).markDelivered(c.id, "ipfs://proof"))
      .emit(c.vault, "DeliverableSubmitted").withArgs(c.id, c.contractor.address, "ipfs://proof");
    const a = await c.vault.getAgreement(c.id);
    expect(a.refundUnlockAt).eq(a.deliveredAt + a.reviewWindowSnapshot);
    const fresh = await loadFixture(fixture);
    await expect(fresh.vault.connect(fresh.buyer).releasePayment(fresh.id, "0x", "0x", 0)).emit(fresh.vault, "AgreementReleased");
  });

  it("refuses the legacy signature route even after delivery, dispute and a year", async function () {
    const c = await loadFixture(fixture);
    const domain = { name: "Sivan Celo Settlement Facility", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await c.vault.getAddress() };
    const types = { ContractorRefundConsent: [{ name: "agreementId", type: "bytes32" }, { name: "nonce", type: "uint256" }] };
    const signature = await c.contractor.signTypedData(domain, types, { agreementId: c.id, nonce: 0 });
    await c.vault.connect(c.contractor).markDelivered(c.id, "ipfs://subsequent-delivery");
    await c.vault.connect(c.contractor).raiseDispute(c.id, "payment now disputed");
    await time.increase(365 * DAY);
    await expect(c.vault.connect(c.outsider).mutualRefund(c.id, signature)).revertedWith("Use expiring refund consent");
    await expect(submit(c, { expiry: (await time.latest()) + 3600, signature })).revertedWith("Contractor refund consent required");
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(c.amount);
  });

  for (const state of ["Funded", "Delivered", "Disputed"]) {
    it(`accepts fresh bounded consent from ${state} once, including while paused`, async function () {
      const c = await loadFixture(fixture);
      if (state !== "Funded") await c.vault.connect(c.contractor).markDelivered(c.id, "proof");
      if (state === "Disputed") await c.vault.connect(c.buyer).raiseDispute(c.id, "dispute");
      const s = await consent(c), nonce = await c.vault.refundConsentNonces(c.id);
      await c.vault.pause();
      await expect(submit(c, s)).to.changeTokenBalances(c.token, [c.buyer, c.contractor, c.collector], [c.amount, 0, 0]);
      expect(await c.vault.refundConsentNonces(c.id)).eq(nonce + 1n);
      await expect(submit(c, s)).revertedWith("Cannot refund in current state");
    });
  }

  it("rejects expired and excessively distant expiry without consuming consent", async function () {
    const c = await loadFixture(fixture), s = await consent(c);
    await time.increaseTo(s.expiry + 1);
    await expect(submit(c, s)).revertedWith("Invalid refund consent expiry");
    await expect(submit(c, await consent(c, { expiry: (await time.latest()) + 2 * DAY }))).revertedWith("Invalid refund consent expiry");
    expect(await c.vault.refundConsentNonces(c.id)).eq(0);
  });

  it("accepts the exact expiry boundary and rejects one second later", async function () {
    const c = await loadFixture(fixture), s = await consent(c);
    await time.setNextBlockTimestamp(s.expiry);
    await expect(submit(c, s)).emit(c.vault, "AgreementRefunded");
    const fresh = await loadFixture(fixture), expired = await consent(fresh);
    await time.setNextBlockTimestamp(expired.expiry + 1);
    await expect(submit(fresh, expired)).revertedWith("Invalid refund consent expiry");
  });

  it("only contractor can revoke outstanding consent, and can issue fresh consent afterward", async function () {
    const c = await loadFixture(fixture), s = await consent(c);
    for (const caller of [c.buyer, c.owner, c.outsider]) {
      await expect(c.vault.connect(caller).invalidateRefundConsent(c.id)).revertedWith("Only contractor can cancel consent");
    }
    await c.vault.pause();
    await expect(c.vault.connect(c.contractor).invalidateRefundConsent(c.id)).emit(c.vault, "RefundConsentInvalidated").withArgs(c.id, 1);
    await expect(submit(c, s)).revertedWith("Contractor refund consent required");
    expect(await c.vault.agreementNonces(c.id)).eq(0);
    await expect(submit(c, await consent(c))).emit(c.vault, "AgreementRefunded");
  });

  it("delivery and dispute each invalidate previously issued, still-unexpired refund consent", async function () {
    const c = await loadFixture(fixture), beforeDelivery = await consent(c);
    await c.vault.connect(c.contractor).markDelivered(c.id, "proof");
    await expect(submit(c, beforeDelivery)).revertedWith("Contractor refund consent required");
    const beforeDispute = await consent(c);
    await c.vault.connect(c.buyer).raiseDispute(c.id, "dispute");
    await expect(submit(c, beforeDispute)).revertedWith("Contractor refund consent required");
    expect(await c.vault.refundConsentNonces(c.id)).eq(2);
  });

  it("binds contractor, agreement, expiry, nonce, chain and vault; rejects malformed signatures", async function () {
    const c = await loadFixture(fixture), good = await consent(c);
    const invalid = [
      await consent(c, {}, {}, c.buyer),
      await consent(c, { agreementId: testAgreementId("other agreement") }),
      await consent(c, { nonce: 1 }),
      await consent(c, {}, { chainId: 1 }),
      await consent(c, {}, { verifyingContract: c.token.target }),
      { ...good, expiry: good.expiry + 1 },
      { ...good, signature: "0x1234" },
    ];
    for (const s of invalid) await expect(submit(c, s)).revertedWith("Contractor refund consent required");
    expect(await c.vault.refundConsentNonces(c.id)).eq(0);
    await expect(submit(c, good)).emit(c.vault, "AgreementRefunded");
  });

  it("keeps direct contractor refunds available and rejects consent after other terminal outcomes", async function () {
    const c = await loadFixture(fixture), s = await consent(c);
    await expect(c.vault.connect(c.contractor).mutualRefund(c.id, "0x")).emit(c.vault, "AgreementRefunded");
    await expect(submit(c, s)).revertedWith("Cannot refund in current state");
    const fresh = await loadFixture(fixture), freshSig = await consent(fresh);
    await fresh.vault.connect(fresh.buyer).releasePayment(fresh.id, "0x", "0x", 0);
    await expect(submit(fresh, freshSig)).revertedWith("Cannot refund in current state");
  });

  async function customFixture(contractWallet = false, adversarialToken = false) {
    const c = await fixture();
    if (adversarialToken) {
      c.token = await (await ethers.getContractFactory("MilestoneAdversarialToken")).deploy();
      await c.vault.setSupportedToken(c.token.target, true);
    }
    const wallet = contractWallet ? await (await ethers.getContractFactory("MilestoneTestWallet")).deploy(c.contractor.address) : null;
    const contractorAddress = wallet ? wallet.target : c.contractor.address;
    c.id = testAgreementId("audit-custom-fixture");
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256", "uint256", "address"], [c.token.target, c.amount, 720, ethers.ZeroAddress]));
    await c.vault.connect(c.buyer).proposeArbitrationTerms(c.id, contractorAddress, (await ethers.getSigners())[9].address, 3 * DAY, hash, (await time.latest()) + 3600);
    const args = [c.buyer.address, c.id, await c.vault.arbitrationTermsHash(c.buyer.address, c.id), true];
    if (wallet) await wallet.connect(c.contractor).execute(c.vault.target, c.vault.interface.encodeFunctionData("acceptArbitrationTerms", args));
    else await c.vault.connect(c.contractor).acceptArbitrationTerms(...args);
    await c.token.mint(c.buyer.address, c.amount);
    await c.token.connect(c.buyer).approve(c.vault.target, c.amount);
    await c.vault.connect(c.buyer).deposit(c.id, contractorAddress, c.token.target, c.amount, 720, ethers.ZeroAddress);
    return { ...c, wallet };
  }

  it("supports ERC-1271 contractor consent and cancellation through the contractor wallet", async function () {
    const c = await customFixture(true), s = await consent(c);
    await c.wallet.connect(c.contractor).execute(c.vault.target, c.vault.interface.encodeFunctionData("invalidateRefundConsent", [c.id]));
    await expect(submit(c, s)).revertedWith("Contractor refund consent required");
    await expect(submit(c, await consent(c))).to.changeTokenBalance(c.token, c.buyer, c.amount);
  });

  it("rolls back nonce/state on transfer failure, then allows the same consent to succeed", async function () {
    const c = await customFixture(false, true), s = await consent(c);
    await c.token.setBlocked(c.buyer.address);
    await expect(submit(c, s)).revertedWith("Recipient blocked");
    expect(await c.vault.refundConsentNonces(c.id)).eq(0);
    expect((await c.vault.getAgreement(c.id)).state).eq(1);
    await c.token.setBlocked(ethers.ZeroAddress);
    await expect(submit(c, s)).to.changeTokenBalance(c.token, c.buyer, c.amount);
  });

  it("cannot pay twice through a malicious token callback", async function () {
    const c = await customFixture(false, true), s = await consent(c);
    await c.token.setCallback(c.vault.target, c.vault.interface.encodeFunctionData("mutualRefundWithConsent", [c.id, s.expiry, s.signature]));
    await expect(submit(c, s)).to.changeTokenBalance(c.token, c.buyer, c.amount);
    expect(await c.token.callbackAttempted()).eq(true);
    expect(await c.token.callbackSucceeded()).eq(false);
    expect(await c.vault.refundConsentNonces(c.id)).eq(1);
  });
});
