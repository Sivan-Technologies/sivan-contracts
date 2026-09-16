const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * MULTI-ASSET, FEE-ON-TRANSFER, AND CONFIGURABLE TIERS
 *
 * Three things under test, each written to FAIL on the pre-fix contract:
 *
 *  1. Fee-on-transfer tokens. deposit() credited `amount` while the vault
 *     actually received less. The last agreement to be released drains the
 *     shortfall out of an unrelated agreement's locked funds.
 *
 *  2. Batch token listing. Adding USDT, cNGN and cEUR cost one transaction
 *     each, and the deploy script seeded nothing.
 *
 *  3. Tier schedule was compile-time constant. Changing the price of the
 *     product required redeploying the vault that holds customer money.
 */
describe("SivanAgreementVault · assets and dynamic fees", function () {
  const ID = (s) => ethers.id(s);
  const U6 = (n) => ethers.parseUnits(n.toString(), 6);

  async function agentSig(vault, signer, agreementId, agentId, proof, ts) {
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
      timestamp: ts,
    });
  }

  async function deploy() {
    const [owner, buyer, contractor, partner, feeCollector] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USD Coin", "USDC", 6);
    const usdt = await Mock.deploy("Tether", "USDT", 6);
    const cngn = await Mock.deploy("Celo Naira", "cNGN", 18);

    // A token that skims 2% on every transfer. Plenty of real tokens do this.
    const Fot = await ethers.getContractFactory("MockFeeOnTransferERC20");
    const fot = await Fot.deploy("Skim", "SKIM", 6, 200);

    const Vault = await ethers.getContractFactory("SivanAgreementVault");
    const vault = await Vault.deploy(feeCollector.address, owner.address, 9827, owner.address);

    for (const t of [usdc, usdt, cngn, fot]) {
      const dec = await t.decimals();
      await t.mint(buyer.address, ethers.parseUnits("1000000", dec));
      await t.connect(buyer).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    return { vault, usdc, usdt, cngn, fot, owner, buyer, contractor, partner, feeCollector };
  }

  /* ────────────────────────────────────────────────────────────────
   * 1. THE DANGEROUS ONE.
   *
   * With a 2% fee-on-transfer token, a deposit of 1000 lands 980 in the
   * vault. Pre-fix the contract recorded totalAmount = 1000 and would later
   * try to pay out 1000. Fund two agreements and release both: the second
   * release must not fail, and must not pay itself from the first
   * agreement's money.
   * ──────────────────────────────────────────────────────────────── */
  it("credits only what the vault actually received, for fee-on-transfer tokens", async () => {
    const { vault, fot, owner, buyer, contractor } = await deploy();
    const vaultAddr = await vault.getAddress();

    const a = ID("fot-a");
    await vault.connect(buyer).deposit(a, contractor.address, await fot.getAddress(),
      U6(1000), 24, ethers.ZeroAddress);

    const received = await fot.balanceOf(vaultAddr);
    const stored = (await vault.getAgreement(a)).totalAmount;

    expect(stored).to.equal(
      received,
      "the agreement was credited more than the vault actually received"
    );

    // And the accounting must hold end to end: release must empty the vault.
    const agr = await vault.getAgreement(a);
    const sig = await agentSig(vault, owner, a, 9827n, "", agr.deadlineTimestamp);
    await vault.connect(buyer).releasePayment(a, "0x", sig, 0);

    expect(await fot.balanceOf(vaultAddr)).to.equal(
      0n, "shortfall left behind, or paid out of another agreement's funds"
    );
  });

  it("a second fee-on-transfer agreement cannot be drained by the first", async () => {
    const { vault, fot, owner, buyer, contractor } = await deploy();
    const addr = await fot.getAddress();

    const a = ID("drain-a");
    const b = ID("drain-b");
    await vault.connect(buyer).deposit(a, contractor.address, addr, U6(1000), 24, ethers.ZeroAddress);
    await vault.connect(buyer).deposit(b, contractor.address, addr, U6(1000), 24, ethers.ZeroAddress);

    const ag = await vault.getAgreement(a);
    const bg = await vault.getAgreement(b);

    await vault.connect(buyer).releasePayment(a, "0x", await agentSig(vault, owner, a, 9827n, "", ag.deadlineTimestamp), 0);

    // If the first release over-paid, this one has nothing left to pay with.
    await expect(
      vault.connect(buyer).releasePayment(b, "0x", await agentSig(vault, owner, b, 9827n, "", bg.deadlineTimestamp), 0)
    ).to.not.be.reverted;

    expect(await fot.balanceOf(await vault.getAddress())).to.equal(0n);
  });

  /* ────────────────────────────────────────────────────────────────
   * 2. Batch listing. Adding a new asset should be one transaction.
   * ──────────────────────────────────────────────────────────────── */
  it("lists several assets in one transaction", async () => {
    const { vault, usdc, usdt, cngn, owner } = await deploy();

    await vault.connect(owner).setSupportedTokens(
      [await usdc.getAddress(), await usdt.getAddress(), await cngn.getAddress()],
      true
    );

    for (const t of [usdc, usdt, cngn]) {
      expect(await vault.supportedTokens(await t.getAddress())).to.equal(true);
    }
  });

  it("accepts USDT and cNGN once listed, and still refuses anything else", async () => {
    const { vault, usdc, usdt, cngn, fot, owner, buyer, contractor } = await deploy();

    await vault.connect(owner).setSupportedTokens(
      [await usdc.getAddress(), await usdt.getAddress(), await cngn.getAddress()], true);

    await expect(vault.connect(buyer).deposit(
      ID("usdt-ok"), contractor.address, await usdt.getAddress(),
      U6(100), 24, ethers.ZeroAddress)).to.not.be.reverted;

    await expect(vault.connect(buyer).deposit(
      ID("cngn-ok"), contractor.address, await cngn.getAddress(),
      ethers.parseUnits("50000", 18), 24, ethers.ZeroAddress)).to.not.be.reverted;

    await expect(vault.connect(buyer).deposit(
      ID("skim-no"), contractor.address, await fot.getAddress(),
      U6(100), 24, ethers.ZeroAddress)).to.be.revertedWith("Token not supported");
  });

  /* ────────────────────────────────────────────────────────────────
   * 3. Tier schedule must be settable without redeploying a vault that
   *    is holding customer money.
   * ──────────────────────────────────────────────────────────────── */
  it("the tier schedule is configurable at runtime", async () => {
    const { vault, owner } = await deploy();

    // Default: 10 USDC is tier 1 at 100 bps.
    expect(await vault.calculateFeeForToken(U6(10), 6)).to.equal(100n);

    // Re-price: tier 1 up to 20 units at 150 bps, tier 2 to 200 at 90 bps.
    await vault.connect(owner).setFeeTiers(20, 150, 200, 90, 40);

    expect(await vault.calculateFeeForToken(U6(10), 6)).to.equal(150n);
    expect(await vault.calculateFeeForToken(U6(100), 6)).to.equal(90n);
    expect(await vault.calculateFeeForToken(U6(5000), 6)).to.equal(40n);

    // Scaling must still follow the token's decimals.
    expect(await vault.calculateFeeForToken(ethers.parseUnits("10", 18), 18)).to.equal(150n);
  });

  it("refuses a tier schedule above the hard fee cap", async () => {
    const { vault, owner } = await deploy();
    // MAX_FEE_BPS is 300. Anything above it must be refused, or the owner can
    // quietly raise fees past the advertised ceiling.
    await expect(
      vault.connect(owner).setFeeTiers(20, 500, 200, 90, 40)
    ).to.be.revertedWith("Tier fee exceeds cap");
  });

  it("refuses a non-monotonic tier schedule", async () => {
    const { vault, owner } = await deploy();
    // Upper boundary below the lower one is incoherent and would make the
    // middle tier unreachable.
    await expect(
      vault.connect(owner).setFeeTiers(500, 100, 50, 75, 50)
    ).to.be.revertedWith("Tier bounds not ascending");
  });
});
