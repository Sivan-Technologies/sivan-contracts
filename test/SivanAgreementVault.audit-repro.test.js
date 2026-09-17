const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue: anyVal } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

/**
 * THE FIVE AUDIT FINDINGS, NOW ASSERTED AS FIXED.
 *
 * Each test first reproduced the broken behaviour, was confirmed passing
 * against the old contract, and was then inverted. The originals are in the
 * commit history; these assert the corrected behaviour.
 *
 * F1  a late dispute re-locked a vested refund, permanently
 * F2  widening the review window retroactively revoked an available refund
 * F3  the owner could renounce mid-dispute and strand the funds
 * F5  deliveryRecorded was indistinguishable from agent-verified delivery
 * F6  a fresh vault accepted any ERC-20 until the allowlist was seeded
 */
describe("Audit findings: fixes", function () {
  const ID = ethers.id("audit-fixed");
  const AMOUNT = ethers.parseUnits("1000", 6);
  const HOURS = 24 * 7;

  let vault, token, owner, buyer, contractor, attester, outsider;

  beforeEach(async () => {
    [owner, buyer, contractor, attester, outsider] = await ethers.getSigners();
    const M = await ethers.getContractFactory("MockERC20");
    token = await M.deploy("USD Coin", "USDC", 6);
    await token.waitForDeployment();
    const V = await ethers.getContractFactory("SivanAgreementVault");
    vault = await V.deploy(owner.address, attester.address, 9827, owner.address);
    await vault.waitForDeployment();
    // F6: the vault now refuses deposits until it is initialised.
    await vault.connect(owner).setSupportedToken(await token.getAddress(), true);
    await token.mint(buyer.address, AMOUNT * 10n);
    await token.connect(buyer).approve(await vault.getAddress(), AMOUNT * 10n);
    await vault
      .connect(buyer)
      .deposit(ID, contractor.address, await token.getAddress(), AMOUNT, HOURS, ethers.ZeroAddress);
  });

  // ── F1 ──────────────────────────────────────────────────────────────

  describe("F1: a vested refund cannot be revoked by a late dispute", () => {
    it("refuses a contractor dispute filed after the grace period", async () => {
      await time.increase(HOURS * 3600 + 60);
      await vault.connect(buyer).refundBuyer.staticCall(ID); // vested

      const grace = await vault.DISPUTE_FILING_GRACE();
      await time.increase(Number(grace) + 60);

      await expect(
        vault.connect(contractor).raiseDispute(ID, "too late")
      ).to.be.revertedWith("Dispute filing period has closed");

      // The refund the buyer earned is still theirs.
      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });

    it("still allows a contractor dispute inside the grace period", async () => {
      await time.increase(HOURS * 3600 + 60);
      await expect(vault.connect(contractor).raiseDispute(ID, "genuine objection")).to.emit(
        vault,
        "AgreementDisputed"
      );
    });

    it("lets the BUYER dispute at any time, since the unlock is theirs to forfeit", async () => {
      await time.increase(HOURS * 3600 + 365 * 24 * 3600);
      await expect(vault.connect(buyer).raiseDispute(ID, "I want arbitration")).to.emit(
        vault,
        "AgreementDisputed"
      );
    });

    it("bounds the total delay: even a disputed agreement always exits", async () => {
      await time.increase(HOURS * 3600 + 60);
      await vault.connect(contractor).raiseDispute(ID, "stalling");

      // Was permanent. Now the freeze lifts after ARBITRATION_PERIOD.
      //
      // The timeout RESTORES the pre-dispute position rather than paying the
      // buyer. An earlier version of this fix always refunded, and testing it
      // showed that let a buyer steal genuinely delivered work by stalling an
      // absent owner. Nobody may profit from arbitration failing.
      const period = await vault.ARBITRATION_PERIOD();
      await time.increase(Number(period) + 60);
      await vault.connect(buyer).claimArbitrationTimeout(ID);

      // Undelivered, so it returns to Funded and the ordinary deadline refund
      // is available: the funds do exit, which is the actual guarantee.
      expect((await vault.getAgreement(ID)).state).to.equal(1n); // Funded
      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });
  });

  // ── F2 ──────────────────────────────────────────────────────────────

  describe("F2: settings changes cannot reach into live agreements", () => {
    it("keeps the refund available after the owner widens the window", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://claimed");
      const { deliveredAt, reviewWindowSnapshot } = await vault.getAgreement(ID);
      expect(reviewWindowSnapshot).to.equal(7n * 24n * 3600n);

      await time.increaseTo(Number(deliveredAt) + 7 * 24 * 3600 + 1);
      await vault.connect(buyer).refundBuyer.staticCall(ID); // vested

      // The exact move that used to revoke it.
      await vault.connect(owner).setDeliveryReviewWindow(30 * 24 * 3600);

      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });

    it("applies a new window only to agreements funded afterwards", async () => {
      await vault.connect(owner).setDeliveryReviewWindow(30 * 24 * 3600);
      const ID2 = ethers.id("after-repricing");
      await vault
        .connect(buyer)
        .deposit(ID2, contractor.address, await token.getAddress(), AMOUNT, HOURS, ethers.ZeroAddress);

      expect((await vault.getAgreement(ID2)).reviewWindowSnapshot).to.equal(30n * 24n * 3600n);
      expect((await vault.getAgreement(ID)).reviewWindowSnapshot).to.equal(7n * 24n * 3600n);
    });

    it("narrowing the window also cannot shorten a live agreement", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://x");
      const min = await vault.MIN_DELIVERY_REVIEW_WINDOW();
      await vault.connect(owner).setDeliveryReviewWindow(min);

      // Snapshot is still 7 days, so the contractor keeps the review period
      // they were promised rather than losing it to a later re-pricing.
      await time.increase(Number(min) + 60);
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith(
        "Refund is not yet unlocked"
      );
    });
  });

  // ── F3 ──────────────────────────────────────────────────────────────

  describe("F3: arbitration does not depend on an owner who may vanish", () => {
    it("refuses to renounce ownership at all", async () => {
      await expect(vault.connect(owner).renounceOwnership()).to.be.revertedWith(
        "Renouncing ownership is disabled"
      );
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("returns disputed funds even if the owner never rules", async () => {
      await vault.connect(buyer).raiseDispute(ID, "contested");
      const period = await vault.ARBITRATION_PERIOD();
      await time.increase(Number(period) + 60);

      // Permissionless on purpose: survives a lost key or an absent operator.
      // It unfreezes rather than awarding, so the buyer's refund comes from
      // the ordinary path afterwards.
      await vault.connect(outsider).claimArbitrationTimeout(ID);
      expect((await vault.getAgreement(ID)).state).to.equal(1n); // Funded
      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });

    it("does not let the timeout pre-empt a live arbitration", async () => {
      await vault.connect(buyer).raiseDispute(ID, "contested");
      await expect(
        vault.connect(outsider).claimArbitrationTimeout(ID)
      ).to.be.revertedWith("Arbitration period still running");
    });

    it("works while paused, because a pause must not trap funds", async () => {
      await vault.connect(buyer).raiseDispute(ID, "contested");
      await time.increase(Number(await vault.ARBITRATION_PERIOD()) + 60);
      await vault.connect(owner).pause();
      await expect(vault.connect(buyer).claimArbitrationTimeout(ID)).to.not.be.reverted;
      // And the restored refund path is also exempt from pause.
      await expect(vault.connect(buyer).refundBuyer(ID)).to.not.be.reverted;
    });

    it("still lets the owner rule inside the period", async () => {
      await vault.connect(buyer).raiseDispute(ID, "contested");
      await expect(
        vault.connect(owner).resolveDispute(ID, false, "buyer is right")
      ).to.changeTokenBalance(token, buyer, AMOUNT);
    });
  });

  // ── F5 ──────────────────────────────────────────────────────────────

  describe("F5: the settlement route is explicit", () => {
    it("tags a buyer release as BuyerAuthorised", async () => {
      await expect(vault.connect(buyer).releasePayment(ID, "0x", "0x", 0))
        .to.emit(vault, "AgreementReleased")
        .withArgs(ID, buyer.address, contractor.address, anyVal, anyVal, anyVal, false, 0);
    });

    it("tags an arbitrated release as Arbitrated, even with a delivery on record", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://claimed");
      await vault.connect(buyer).raiseDispute(ID, "contested");

      const tx = await vault.connect(owner).resolveDispute(ID, true, "contractor is right");
      const rc = await tx.wait();
      const ev = rc.logs
        .map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "AgreementReleased");

      // deliveryRecorded is true, but NO attestation was verified on this path.
      // The route is what tells them apart.
      expect(ev.args.deliveryRecorded).to.equal(true);
      expect(ev.args.route).to.equal(1n); // Arbitrated
    });
  });

  // ── F6 ──────────────────────────────────────────────────────────────

  describe("F6: an uninitialised vault is closed, not open", () => {
    it("refuses every deposit before the allowlist is seeded", async () => {
      const V = await ethers.getContractFactory("SivanAgreementVault");
      const fresh = await V.deploy(owner.address, attester.address, 9827, owner.address);
      await fresh.waitForDeployment();
      expect(await fresh.tokenAllowlistEnforced()).to.equal(false);

      await token.connect(buyer).approve(await fresh.getAddress(), AMOUNT);
      await expect(
        fresh
          .connect(buyer)
          .deposit(ethers.id("early"), contractor.address, await token.getAddress(), AMOUNT, 48, ethers.ZeroAddress)
      ).to.be.revertedWith("Vault not initialised: no tokens listed");
    });

    it("refuses an unlisted token after seeding", async () => {
      const M = await ethers.getContractFactory("MockERC20");
      const junk = await M.deploy("Worthless", "JUNK", 18);
      await junk.waitForDeployment();
      const amt = ethers.parseUnits("500", 18);
      await junk.mint(buyer.address, amt);
      await junk.connect(buyer).approve(await vault.getAddress(), amt);

      await expect(
        vault
          .connect(buyer)
          .deposit(ethers.id("junk"), contractor.address, await junk.getAddress(), amt, 48, ethers.ZeroAddress)
      ).to.be.revertedWith("Token not supported");
    });
  });
});

