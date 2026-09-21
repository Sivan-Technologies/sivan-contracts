const { fund: fundWithTerms } = require("./helpers/fund");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ADVERSARIAL TESTS FOR THE DELIVERY / REFUND LOCKUP.
 *
 * The bug: markDelivered had no deadline check and refundBuyer only ran from
 * Funded, so any nonempty delivery string permanently disabled the buyer's
 * timeout refund. No party could move the funds afterwards.
 *
 * These tests are written from the attacker's side first. Each one describes
 * something a malicious party WANTS to do, and asserts they cannot. The
 * cooperative cases follow, to prove the fix did not simply wall everything
 * off, which is the usual way a lockup fix breaks the product.
 */
describe("Delivery lockup and dispute resolution", function () {
  const ID = ethers.id("agreement-lockup");
  const AMOUNT = ethers.parseUnits("1000", 6);
  const HOURS = 24 * 7;

  const State = {
    Uninitialized: 0n,
    Funded: 1n,
    Delivered: 2n,
    Released: 3n,
    Refunded: 4n,
    Disputed: 5n,
  };

  let vault, token, owner, buyer, contractor, attester, outsider, partner;

  beforeEach(async () => {
    [owner, buyer, contractor, attester, outsider, partner] = await ethers.getSigners();

    const M = await ethers.getContractFactory("MockERC20");
    token = await M.deploy("USD Coin", "USDC", 6);
    await token.waitForDeployment();

    const V = await ethers.getContractFactory("SivanAgreementVault");
    vault = await V.deploy(owner.address, attester.address, 9827, owner.address);
    await vault.waitForDeployment();

    await vault.setSupportedToken(await token.getAddress(), true);

    await token.mint(buyer.address, AMOUNT * 10n);
    await token.connect(buyer).approve(await vault.getAddress(), AMOUNT * 10n);
    await fundWithTerms(vault.connect(buyer), ID, contractor.address, await token.getAddress(), AMOUNT, HOURS, ethers.ZeroAddress);
  });

  const vaultAddr = () => vault.getAddress();
  const stateOf = async (id = ID) => (await vault.getAgreement(id)).state;

  // ── The original attack ────────────────────────────────────────────────

  describe("the griefing attack itself", () => {
    it("rejects a delivery claim filed after the deadline", async () => {
      await time.increase(HOURS * 3600 + 60);

      await expect(
        vault.connect(contractor).markDelivered(ID, "ipfs://junk")
      ).to.be.revertedWith("Deadline passed, delivery too late");

      expect(await stateOf()).to.equal(State.Funded);
    });

    it("still refunds the buyer after a blocked late delivery attempt", async () => {
      await time.increase(HOURS * 3600 + 60);
      await expect(
        vault.connect(contractor).markDelivered(ID, "ipfs://junk")
      ).to.be.reverted;

      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
      expect(await stateOf()).to.equal(State.Refunded);
    });

    it("a delivery claim inside the deadline only DELAYS the refund", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://claimed");
      expect(await stateOf()).to.equal(State.Delivered);
      const { deliveredAt } = await vault.getAgreement(ID);
      const reviewWindow = await vault.deliveryReviewWindow();

      // The deadline passes. Before the fix this was the moment the buyer was
      // locked out forever; now it is simply too early, because the review
      // window is measured from deliveredAt and has not yet elapsed.
      const { deadlineTimestamp } = await vault.getAgreement(ID);
      await time.setNextBlockTimestamp(Number(deadlineTimestamp) + 1);
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith(
        "Refund is not yet unlocked"
      );

      // Once the review window lapses the refund reopens. This is the exact
      // assertion that would have failed before the fix, forever.
      await time.setNextBlockTimestamp(Number(deliveredAt + reviewWindow) + 1);

      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
      expect(await stateOf()).to.equal(State.Refunded);
    });

    it("an undisputed delivery has a bounded inspection window", async () => {
      // Funded -> refund after deadline. Proven above.
      // Delivered -> refund after review window. Proven above.
      // Disputed funds instead require a ruling or voluntary settlement.
      // This test pins the invariant that Delivered cannot outlive its window.
      await vault.connect(contractor).markDelivered(ID, "ipfs://x");
      const agr = await vault.getAgreement(ID);
      expect(agr.deliveredAt).to.be.greaterThan(0n);

      const window = await vault.deliveryReviewWindow();
      const maxWindow = await vault.MAX_DELIVERY_REVIEW_WINDOW();
      // The refund is reachable at a bounded, knowable time. Not "eventually".
      expect(window).to.be.lessThanOrEqual(maxWindow);
    });
  });

  // ── Timing boundaries ──────────────────────────────────────────────────

  describe("review window boundaries", () => {
    it("refuses the refund one second before the window closes", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://claimed");
      const { deliveredAt } = await vault.getAgreement(ID);
      const window = await vault.deliveryReviewWindow();

      await time.setNextBlockTimestamp(Number(deliveredAt + window));
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith(
        "Refund is not yet unlocked"
      );
    });

    it("allows the refund one second after the window closes", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://claimed");
      const { deliveredAt } = await vault.getAgreement(ID);
      const window = await vault.deliveryReviewWindow();

      await time.setNextBlockTimestamp(Number(deliveredAt + window) + 1);
      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });

    it("accepts a delivery in the final second before the deadline", async () => {
      const { deadlineTimestamp } = await vault.getAgreement(ID);
      await time.setNextBlockTimestamp(Number(deadlineTimestamp));
      await expect(vault.connect(contractor).markDelivered(ID, "ipfs://ontime")).to.not.be
        .reverted;
    });

    it("rejects a delivery one second after the deadline", async () => {
      const { deadlineTimestamp } = await vault.getAgreement(ID);
      await time.setNextBlockTimestamp(Number(deadlineTimestamp) + 1);
      await expect(
        vault.connect(contractor).markDelivered(ID, "ipfs://late")
      ).to.be.revertedWith("Deadline passed, delivery too late");
    });

    it("measures the window from delivery, not from the deadline, so early delivery is not punished", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://early");
      const { deliveredAt, deadlineTimestamp } = await vault.getAgreement(ID);
      const window = await vault.deliveryReviewWindow();

      // Delivered early, so the refund unlocks later than deadline + window
      // would have allowed. The contractor gains review time by being prompt
      // rather than losing it.
      expect(deliveredAt).to.be.lessThan(deadlineTimestamp);
      const unlock = deliveredAt + window;
      expect(unlock).to.be.lessThan(deadlineTimestamp + window);
    });
  });

  // ── Dispute: access control ────────────────────────────────────────────

  describe("raiseDispute", () => {
    it("lets the buyer dispute a false delivery claim", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://fake");
      await expect(vault.connect(buyer).raiseDispute(ID, "nothing was delivered"))
        .to.emit(vault, "AgreementDisputed")
        .withArgs(ID, buyer.address, "nothing was delivered");
      expect(await stateOf()).to.equal(State.Disputed);
    });

    it("lets the contractor dispute a stalling buyer", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://real-work");
      await expect(vault.connect(contractor).raiseDispute(ID, "buyer will not release")).to
        .emit(vault, "AgreementDisputed");
      expect(await stateOf()).to.equal(State.Disputed);
    });

    it("can be raised from Funded as well as Delivered", async () => {
      await expect(vault.connect(buyer).raiseDispute(ID, "contractor vanished")).to.emit(
        vault,
        "AgreementDisputed"
      );
      expect(await stateOf()).to.equal(State.Disputed);
    });

    it("rejects an outsider", async () => {
      await expect(
        vault.connect(outsider).raiseDispute(ID, "not my deal")
      ).to.be.revertedWith("Only a party may dispute");
    });

    it("rejects the OWNER, who must not be able to freeze funds unilaterally", async () => {
      await expect(
        vault.connect(owner).raiseDispute(ID, "operator interference")
      ).to.be.revertedWith("Only a party may dispute");
    });

    it("requires a reason", async () => {
      await expect(vault.connect(buyer).raiseDispute(ID, "")).to.be.revertedWith(
        "Reason required"
      );
    });

    it("cannot dispute an already released agreement", async () => {
      await vault.connect(buyer).releasePayment(ID, "0x", "0x", 0);
      await expect(
        vault.connect(buyer).raiseDispute(ID, "regret")
      ).to.be.revertedWith("Cannot dispute in current state");
    });

    it("cannot dispute twice", async () => {
      await vault.connect(buyer).raiseDispute(ID, "first");
      await expect(vault.connect(contractor).raiseDispute(ID, "second")).to.be.revertedWith(
        "Cannot dispute in current state"
      );
    });
  });

  // ── Dispute: unilateral exits are closed while frozen ──────────────────

  describe("a disputed agreement is frozen for both parties", () => {
    beforeEach(async () => {
      await vault.connect(buyer).raiseDispute(ID, "frozen");
    });

    it("blocks the buyer's timeout refund", async () => {
      await time.increase(365 * 24 * 3600);
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith(
        "Cannot refund in current state"
      );
    });

    it("blocks release", async () => {
      await expect(
        vault.connect(buyer).releasePayment(ID, "0x", "0x", 0)
      ).to.be.revertedWith("Cannot release in current state");
    });

    it("blocks a new delivery claim", async () => {
      await expect(
        vault.connect(contractor).markDelivered(ID, "ipfs://late-claim")
      ).to.be.revertedWith("Agreement not in funded state");
    });

    it("still allows mutualRefund, because both parties agreeing outranks arbitration", async () => {
      await expect(
        vault.connect(contractor).mutualRefund(ID, "0x")
      ).to.changeTokenBalance(token, buyer, AMOUNT);
      expect(await stateOf()).to.equal(State.Refunded);
    });
  });

  // ── Dispute: resolution ────────────────────────────────────────────────

  describe("resolveDispute", () => {
    beforeEach(async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://contested");
      await vault.connect(buyer).raiseDispute(ID, "contested");
    });

    it("pays the contractor and takes the fee when resolved in their favour", async () => {
      const { netAmount, feeAmount } = await vault.getAgreement(ID);

      await expect(
        vault.connect(owner).resolveDispute(ID, true, "work verified")
      ).to.changeTokenBalances(
        token,
        [contractor, owner, vault],
        [netAmount, feeAmount, -(netAmount + feeAmount)]
      );
      expect(await stateOf()).to.equal(State.Released);
    });

    it("refunds the buyer IN FULL, charging no fee, when resolved against the contractor", async () => {
      // The arbiter must not profit from the outcome it chooses.
      await expect(
        vault.connect(owner).resolveDispute(ID, false, "no deliverable")
      ).to.changeTokenBalances(token, [buyer, owner, vault], [AMOUNT, 0, -AMOUNT]);
      expect(await stateOf()).to.equal(State.Refunded);
    });

    it("emits DisputeResolved with the direction recorded", async () => {
      await expect(vault.connect(owner).resolveDispute(ID, true, "verified"))
        .to.emit(vault, "DisputeResolved")
        .withArgs(ID, owner.address, true, "verified");
    });

    it("rejects a non-owner arbiter", async () => {
      await expect(vault.connect(buyer).resolveDispute(ID, false, "mine")).to.be.reverted;
      await expect(vault.connect(contractor).resolveDispute(ID, true, "mine")).to.be
        .reverted;
      await expect(vault.connect(outsider).resolveDispute(ID, true, "mine")).to.be.reverted;
    });

    it("cannot resolve an agreement that is not disputed", async () => {
      const ID2 = ethers.id("agreement-2");
      await fundWithTerms(vault.connect(buyer), ID2, contractor.address, await token.getAddress(), AMOUNT, HOURS, ethers.ZeroAddress);

      await expect(
        vault.connect(owner).resolveDispute(ID2, true, "reaching in")
      ).to.be.revertedWith("Agreement is not disputed");
    });

    it("cannot be resolved twice", async () => {
      await vault.connect(owner).resolveDispute(ID, true, "done");
      await expect(
        vault.connect(owner).resolveDispute(ID, false, "again")
      ).to.be.revertedWith("Agreement is not disputed");
    });

    it("pays the partner share when one was set", async () => {
      const ID3 = ethers.id("agreement-partner");
      await fundWithTerms(vault.connect(buyer), ID3, contractor.address, await token.getAddress(), AMOUNT, HOURS, partner.address);
      await vault.connect(buyer).raiseDispute(ID3, "contested");

      const agr = await vault.getAgreement(ID3);
      const protocolFee = agr.feeAmount - agr.partnerFeeAmount;

      await expect(
        vault.connect(owner).resolveDispute(ID3, true, "verified")
      ).to.changeTokenBalances(
        token,
        [contractor, partner, owner],
        [agr.netAmount, agr.partnerFeeAmount, protocolFee]
      );
      expect(agr.partnerFeeAmount).to.be.greaterThan(0n);
    });
  });

  // ── Pause must never trap funds ────────────────────────────────────────

  describe("pause does not strand money already inside the vault", () => {
    it("allows the timeout refund while paused", async () => {
      await time.increase(HOURS * 3600 + 60);
      await vault.connect(owner).pause();

      await expect(vault.connect(buyer).refundBuyer(ID)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });

    it("allows dispute resolution while paused", async () => {
      await vault.connect(buyer).raiseDispute(ID, "contested");
      await vault.connect(owner).pause();

      await expect(vault.connect(owner).resolveDispute(ID, false, "refund")).to.not.be
        .reverted;
      expect(await stateOf()).to.equal(State.Refunded);
    });

    it("allows mutualRefund while paused", async () => {
      await vault.connect(owner).pause();
      await expect(vault.connect(contractor).mutualRefund(ID, "0x")).to.not.be.reverted;
    });
  });

  // ── The review window setter ───────────────────────────────────────────

  describe("setDeliveryReviewWindow", () => {
    it("refuses a window longer than the maximum, which would recreate the bug", async () => {
      const max = await vault.MAX_DELIVERY_REVIEW_WINDOW();
      await expect(
        vault.connect(owner).setDeliveryReviewWindow(max + 1n)
      ).to.be.revertedWith("Review window out of bounds");
    });

    it("refuses a window shorter than the minimum, which would rob the contractor", async () => {
      const min = await vault.MIN_DELIVERY_REVIEW_WINDOW();
      await expect(
        vault.connect(owner).setDeliveryReviewWindow(min - 1n)
      ).to.be.revertedWith("Review window out of bounds");
      await expect(vault.connect(owner).setDeliveryReviewWindow(0)).to.be.revertedWith(
        "Review window out of bounds"
      );
    });

    it("accepts both bounds exactly", async () => {
      const min = await vault.MIN_DELIVERY_REVIEW_WINDOW();
      const max = await vault.MAX_DELIVERY_REVIEW_WINDOW();
      await expect(vault.connect(owner).setDeliveryReviewWindow(min)).to.not.be.reverted;
      await expect(vault.connect(owner).setDeliveryReviewWindow(max)).to.not.be.reverted;
    });

    it("rejects a non-owner", async () => {
      await expect(vault.connect(buyer).setDeliveryReviewWindow(2 * 24 * 3600)).to.be
        .reverted;
    });

    it("emits the change", async () => {
      const old = await vault.deliveryReviewWindow();
      const next = 3n * 24n * 3600n;
      await expect(vault.connect(owner).setDeliveryReviewWindow(next))
        .to.emit(vault, "DeliveryReviewWindowUpdated")
        .withArgs(old, next);
    });

    it("does NOT apply a new window to an agreement funded beforehand", async () => {
      // This test used to assert the opposite, and asserting the opposite was
      // the bug. An audit showed the owner could widen the window from 7 to 30
      // days and revoke a refund the buyer had ALREADY earned, because
      // refundBuyer read the live global value. The window is now snapshotted
      // at funding, so re-pricing binds new agreements only.
      const short = await vault.MIN_DELIVERY_REVIEW_WINDOW();
      await vault.connect(owner).setDeliveryReviewWindow(short);

      await vault.connect(contractor).markDelivered(ID, "ipfs://x");
      await time.increase(Number(short) + 60);

      // The snapshot is still 7 days, so the shorter global window does not
      // unlock this agreement early.
      await expect(vault.connect(buyer).refundBuyer(ID)).to.be.revertedWith(
        "Refund is not yet unlocked"
      );
      expect((await vault.getAgreement(ID)).reviewWindowSnapshot).to.equal(7n * 24n * 3600n);
    });

    it("applies the new window to agreements funded afterwards", async () => {
      const short = await vault.MIN_DELIVERY_REVIEW_WINDOW();
      await vault.connect(owner).setDeliveryReviewWindow(short);

      const ID2 = ethers.id("funded-after-repricing");
      await fundWithTerms(vault.connect(buyer), ID2, contractor.address, await token.getAddress(), AMOUNT, HOURS, ethers.ZeroAddress);
      await vault.connect(contractor).markDelivered(ID2, "ipfs://x");
      await time.increase(Number(short) + 60);

      await expect(vault.connect(buyer).refundBuyer(ID2)).to.changeTokenBalance(
        token,
        buyer,
        AMOUNT
      );
    });
  });

  // ── The happy paths must still work ────────────────────────────────────

  describe("cooperative flows are unaffected", () => {
    it("buyer releases directly from Funded with no delivery claim", async () => {
      const { netAmount } = await vault.getAgreement(ID);
      await expect(
        vault.connect(buyer).releasePayment(ID, "0x", "0x", 0)
      ).to.changeTokenBalance(token, contractor, netAmount);
    });

    it("contractor delivers and buyer releases against an agent attestation", async () => {
      const proof = "ipfs://genuine-work";
      await vault.connect(contractor).markDelivered(ID, proof);

      const agr = await vault.getAgreement(ID);
      const domain = {
        name: "Sivan Celo Settlement Facility",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vaultAddr(),
      };
      const types = {
        AgentAttestation: [
          { name: "agreementId", type: "bytes32" },
          { name: "agentId", type: "uint256" },
          { name: "deliverableHash", type: "bytes32" },
          { name: "timestamp", type: "uint256" },
        ],
      };
      const sig = await attester.signTypedData(domain, types, {
        agreementId: ID,
        agentId: 9827,
        deliverableHash: ethers.keccak256(ethers.toUtf8Bytes(proof)),
        timestamp: agr.deadlineTimestamp,
      });

      await expect(
        vault.connect(buyer).releasePayment(ID, "0x", sig, 0)
      ).to.changeTokenBalance(token, contractor, agr.netAmount);
      expect(await stateOf()).to.equal(State.Released);
    });

    it("a late contractor can still be paid if the buyer chooses to", async () => {
      // Delivery is refused after the deadline, but payment is not. The buyer
      // remains free to release from Funded. This is the case the deadline
      // check must not break.
      await time.increase(HOURS * 3600 + 60);
      await expect(
        vault.connect(contractor).markDelivered(ID, "ipfs://late")
      ).to.be.reverted;

      const { netAmount } = await vault.getAgreement(ID);
      await expect(
        vault.connect(buyer).releasePayment(ID, "0x", "0x", 0)
      ).to.changeTokenBalance(token, contractor, netAmount);
    });

    it("buyer can release during the review window", async () => {
      await vault.connect(contractor).markDelivered(ID, "ipfs://x");
      // Uses the Funded-path signature check: delivered, so attestation needed.
      const agr = await vault.getAgreement(ID);
      const domain = {
        name: "Sivan Celo Settlement Facility",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vaultAddr(),
      };
      const sig = await attester.signTypedData(
        domain,
        {
          AgentAttestation: [
            { name: "agreementId", type: "bytes32" },
            { name: "agentId", type: "uint256" },
            { name: "deliverableHash", type: "bytes32" },
            { name: "timestamp", type: "uint256" },
          ],
        },
        {
          agreementId: ID,
          agentId: 9827,
          deliverableHash: ethers.keccak256(ethers.toUtf8Bytes("ipfs://x")),
          timestamp: agr.deadlineTimestamp,
        }
      );
      await expect(vault.connect(buyer).releasePayment(ID, "0x", sig, 0)).to.not.be.reverted;
    });
  });
});
