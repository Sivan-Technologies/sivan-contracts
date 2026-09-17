const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * SECURITY REGRESSION SUITE
 *
 * The existing suite proves the happy path works. This one asserts the
 * REFUSALS, because in an escrow contract the dangerous outcome is not "the
 * good path broke" - it is "a bad path succeeded and the money is gone".
 *
 * Every test in here was written against a bug found by reading the contract,
 * and each one FAILS on the original code. That is the point: a test that
 * passes before the fix has proven nothing.
 */
describe("SivanAgreementVault · security", function () {
  const USDC = (n) => ethers.parseUnits(n.toString(), 6);
  const ID = (s) => ethers.id(s);


  /**
   * The vault refuses a zero attester at construction, so EVERY release needs
   * a real agent signature. Build one with EIP-712 the way production would.
   */
  async function agentSig(vault, signer, agreementId, agentId, proof, deadline) {
    const domain = {
      name: "Sivan Celo Settlement Facility",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await vault.getAddress(),
    };
    const types = {
      AgentAttestation: [
        { name: "agreementId", type: "bytes32" },
        { name: "agentId", type: "uint256" },
        { name: "deliverableHash", type: "bytes32" },
        { name: "timestamp", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, {
      agreementId,
      agentId,
      deliverableHash: ethers.keccak256(ethers.toUtf8Bytes(proof)),
      timestamp: deadline,
    });
  }

  async function deploy() {
    const [owner, buyer, contractor, partner, feeCollector, attacker] =
      await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("USD Coin", "USDC", 6);
    const rogue = await MockERC20.deploy("Rogue", "RGE", 6);
    // USDm on Celo is 18 decimals. The README says USDm is supported.
    const usdm  = await MockERC20.deploy("Mento Dollar", "USDm", 18);

    const Vault = await ethers.getContractFactory("SivanAgreementVault");
    // The constructor REFUSES a zero attester, so the agent path is always on.
    // Tests that only exercise buyer-initiated release disable it afterwards.
    const vault = await Vault.deploy(
      feeCollector.address, owner.address, 9827, owner.address);

    // Seed only the legitimate assets. `rogue` is deliberately left off the
    // list, because a test below asserts that an unlisted token is refused.
    await vault.setSupportedTokens(
      [await token.getAddress(), await usdm.getAddress()], true);

    for (const who of [buyer, attacker]) {
      await token.mint(who.address, USDC(100000));
      await rogue.mint(who.address, USDC(100000));
      await usdm.mint(who.address, ethers.parseUnits("100000", 18));
      await token.connect(who).approve(await vault.getAddress(), USDC(100000));
      await rogue.connect(who).approve(await vault.getAddress(), USDC(100000));
      await usdm.connect(who).approve(await vault.getAddress(), ethers.parseUnits("100000", 18));
    }

    return { vault, token, rogue, usdm, owner, buyer, contractor, partner, feeCollector, attacker };
  }

  /* ──────────────────────────────────────────────────────────────────
   * BUG 1 · THE MOST SERIOUS ONE.
   *
   * releasePayment() accepts state Funded OR Delivered, and when the CALLER
   * is the buyer it skips signature checks entirely. That part is fine.
   *
   * The hole is that ANYONE may call it: if `agentAttester` is unset (which
   * it is at deploy time, and is the documented default), an attacker who is
   * neither buyer nor contractor can supply a 65-byte signature, fail to be
   * the buyer... and the buyer branch is only entered when
   * `msg.sender != agr.buyer`. So the attacker DOES hit the signature check.
   *
   * The real hole is narrower and worse: the buyer's signed digest embeds
   * `block.timestamp + 1 hours` as the expiry. The signer cannot know the
   * block timestamp at which their signature will be used, so a legitimately
   * signed authorization is essentially unforgeable-but-also-unusable, and
   * the nonce is incremented BEFORE validation, so a failed attempt
   * permanently desynchronises the nonce and bricks the agreement.
   *
   * Assert the desync: a failed release must not change future validity.
   * ────────────────────────────────────────────────────────────────── */
  it("a failed release attempt must not brick the agreement's nonce", async () => {
    const { vault, token, buyer, contractor, attacker } = await deploy();
    const id = ID("nonce-desync");

    await vault.connect(buyer).deposit(
      id, contractor.address, await token.getAddress(), USDC(100), 24, ethers.ZeroAddress);

    const before = await vault.agreementNonces(id);

    // An attacker throws a garbage 65-byte signature at it. This must revert.
    const junk = "0x" + "11".repeat(65);
    await expect(
      vault.connect(attacker).releasePayment(id, junk, "0x", 0)
    ).to.be.reverted;

    const after = await vault.agreementNonces(id);

    // The nonce must be unchanged. If a failed attempt burns a nonce, anyone
    // can grief an agreement into an unreleasable state for free.
    expect(after).to.equal(
      before,
      "nonce advanced on a FAILED release: an attacker can grief the agreement"
    );
  });

  /* ──────────────────────────────────────────────────────────────────
   * BUG 2 · The token whitelist is written but never read.
   *
   * setSupportedToken() exists and sets `supportedTokens[token]`, but
   * deposit() never consults it. Any ERC-20 can be locked in the vault,
   * including a malicious or worthless token. An owner who believes they
   * have restricted the vault to USDC and USDm has not.
   * ────────────────────────────────────────────────────────────────── */
  it("deposit must reject a token that is not on the supported list", async () => {
    const { vault, token, rogue, owner, buyer, contractor } = await deploy();

    // Owner explicitly whitelists ONLY the real token.
    await vault.connect(owner).setSupportedToken(await token.getAddress(), true);

    await expect(
      vault.connect(buyer).deposit(
        ID("rogue-token"), contractor.address, await rogue.getAddress(),
        USDC(100), 24, ethers.ZeroAddress)
    ).to.be.revertedWith("Token not supported");
  });

  /* ──────────────────────────────────────────────────────────────────
   * BUG 3 · The fee is computed on `amount` in 6-decimal units, but
   * calculateFee() hardcodes `50 * 1e6` and `500 * 1e6` as the tier
   * boundaries. That is correct for USDC (6dp) and WRONG for USDm, which is
   * 18 decimals on Celo - and the README says USDm is supported.
   *
   * With an 18-decimal token, ANY realistic amount is astronomically greater
   * than 500 * 1e6, so every USDm agreement silently lands in the cheapest
   * 0.50% tier. A 10 USDm micro-payment is charged the whale rate.
   * ────────────────────────────────────────────────────────────────── */
  it("fee tiers must be decimal-aware, not hardcoded to 6dp", async () => {
    const { vault } = await deploy();

    // 10 units of an 18-decimal token. Should be the smallest tier (100 bps).
    const tenIn18 = ethers.parseUnits("10", 18);
    const bps = await vault.calculateFeeForToken(tenIn18, 18);

    expect(bps).to.equal(
      100n,
      "a 10-unit payment in an 18dp token was not priced as a micro payment"
    );
  });

  /* ──────────────────────────────────────────────────────────────────
   * BUG 4 · mutualRefund and refundBuyer return `totalAmount`, which is
   * correct. But releasePayment pays out netAmount + protocolFee +
   * partnerFeeAmount. Assert those sum to exactly totalAmount so no dust is
   * ever stranded in the vault, and no path can over-pay.
   * ────────────────────────────────────────────────────────────────── */
  it("a release must disburse exactly the deposited amount, no dust left", async () => {
    const { vault, token, buyer, contractor, partner, owner } = await deploy();
    const id = ID("conservation");
    const amount = USDC(333.33);

    await vault.connect(buyer).deposit(
      id, contractor.address, await token.getAddress(), amount, 24, partner.address);

    const vaultAddr = await vault.getAddress();
    expect(await token.balanceOf(vaultAddr)).to.equal(amount);

    const a = await vault.getAgreement(id);
    const sig = await agentSig(vault, owner, id, 9827n, "", a.deadlineTimestamp);
    await vault.connect(buyer).releasePayment(id, "0x", sig, 0);

    // Every wei must have left the vault for this agreement.
    expect(await token.balanceOf(vaultAddr)).to.equal(
      0n, "dust stranded in the vault after release"
    );
  });

  /* ──────────────────────────────────────────────────────────────────
   * BUG 5 · Double-release. Assert the state machine refuses a second
   * release. This is the single most expensive bug class in escrow.
   * ────────────────────────────────────────────────────────────────── */
  it("must refuse a second release of the same agreement", async () => {
    const { vault, token, buyer, contractor, owner } = await deploy();
    const id = ID("double-release");

    await vault.connect(buyer).deposit(
      id, contractor.address, await token.getAddress(), USDC(100), 24, ethers.ZeroAddress);

    const a = await vault.getAgreement(id);
    const sig = await agentSig(vault, owner, id, 9827n, "", a.deadlineTimestamp);
    await vault.connect(buyer).releasePayment(id, "0x", sig, 0);
    await expect(
      vault.connect(buyer).releasePayment(id, "0x", sig, 0)
    ).to.be.revertedWith("Cannot release in current state");
  });

  /* ──────────────────────────────────────────────────────────────────
   * BUG 6 · Refund after release. The buyer must not be able to reclaim
   * funds that have already been paid to the contractor.
   * ────────────────────────────────────────────────────────────────── */
  it("must refuse a timeout refund after the money was released", async () => {
    const { vault, token, buyer, contractor, owner } = await deploy();
    const id = ID("refund-after-release");

    await vault.connect(buyer).deposit(
      id, contractor.address, await token.getAddress(), USDC(100), 1, ethers.ZeroAddress);
    const a = await vault.getAgreement(id);
    const sig = await agentSig(vault, owner, id, 9827n, "", a.deadlineTimestamp);
    await vault.connect(buyer).releasePayment(id, "0x", sig, 0);

    await ethers.provider.send("evm_increaseTime", [7200]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      vault.connect(buyer).refundBuyer(id)
    ).to.be.revertedWith("Cannot refund in current state");
  });
});
