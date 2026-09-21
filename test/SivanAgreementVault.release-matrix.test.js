const { fund: fundWithTerms } = require("./helpers/fund");
const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * THE RELEASE MATRIX
 *
 * One rule: the buyer's word is final, and the agent verifies a deliverable
 * when one exists. That produces exactly four paths, and all four are asserted
 * here because the interesting ones are the combinations, not the individual
 * checks.
 *
 *   caller    state      requires
 *   ────────  ─────────  ───────────────────────────────────────────
 *   buyer     Funded     nothing. Their money, their call.
 *   buyer     Delivered  agent attestation over the real proof
 *   relayer   Funded     buyer signature
 *   relayer   Delivered  buyer signature + agent attestation
 *
 * The case that matters most is row 1. Before this change the agent had to
 * sign keccak256("") for a buyer paying directly from Funded: a valid
 * signature over nothing, which looked like verification and verified nothing.
 */
describe("SivanAgreementVault · release matrix", function () {
  const U6 = (n) => ethers.parseUnits(n.toString(), 6);
  const ID = (s) => ethers.id(s);

  const RELEASE_TYPES = {
    ReleaseAuthorization: [
      { name: "agreementId", type: "bytes32" },
      { name: "contractor", type: "address" },
      { name: "netAmount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const AGENT_TYPES = {
    AgentAttestation: [
      { name: "agreementId", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
  };

  async function setup() {
    const [owner, buyer, contractor, feeCollector, relayer] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USD Coin", "USDC", 6);
    const Vault = await ethers.getContractFactory("SivanAgreementVault");
    const vault = await Vault.deploy(feeCollector.address, owner.address, 9827, owner.address);

    await vault.setSupportedToken(await usdc.getAddress(), true);

    await usdc.mint(buyer.address, U6(100000));
    await usdc.connect(buyer).approve(await vault.getAddress(), ethers.MaxUint256);

    const domain = {
      name: "Sivan Celo Settlement Facility",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await vault.getAddress(),
    };
    return { vault, usdc, domain, owner, buyer, contractor, feeCollector, relayer };
  }

  async function fund(vault, usdc, buyer, contractor, id) {
    await fundWithTerms(vault.connect(buyer),
      id, contractor.address, await usdc.getAddress(), U6(100), 24, ethers.ZeroAddress);
    return vault.getAgreement(id);
  }

  const agentSig = (domain, signer, id, proof, ts) =>
    signer.signTypedData(domain, AGENT_TYPES, {
      agreementId: id,
      agentId: 9827n,
      deliverableHash: ethers.keccak256(ethers.toUtf8Bytes(proof)),
      timestamp: ts,
    });

  const buyerSig = (domain, signer, id, contractor, netAmount, nonce, expiry) =>
    signer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id, contractor, netAmount, nonce, expiry,
    });

  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  /* ─── row 1: buyer, Funded, nothing required ─────────────────────── */

  it("buyer releases from Funded with no agent signature at all", async () => {
    const { vault, usdc, buyer, contractor } = await setup();
    const id = ID("buyer-funded");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    const before = await usdc.balanceOf(contractor.address);
    await expect(
      vault.connect(buyer).releasePayment(id, "0x", "0x", 0)
    ).to.not.be.reverted;
    expect(await usdc.balanceOf(contractor.address)).to.equal(before + agr.netAmount);
  });

  it("and the event records that no delivery was on file", async () => {
    const { vault, usdc, buyer, contractor } = await setup();
    const id = ID("buyer-funded-event");
    await fund(vault, usdc, buyer, contractor, id);

    await expect(vault.connect(buyer).releasePayment(id, "0x", "0x", 0))
      .to.emit(vault, "AgreementReleased")
      .withArgs(id, buyer.address, contractor.address,
        (v) => v > 0n, (v) => v >= 0n, 0n, false, 0n); // 0 = BuyerAuthorised
  });

  /* ─── row 2: buyer, Delivered, agent required ────────────────────── */

  it("buyer releasing a DELIVERED agreement still needs the agent", async () => {
    const { vault, usdc, buyer, contractor } = await setup();
    const id = ID("buyer-delivered-noagent");
    await fund(vault, usdc, buyer, contractor, id);
    await vault.connect(contractor).markDelivered(id, "ipfs://proof");

    // The deliverable exists, so the attestation is now load bearing.
    await expect(
      vault.connect(buyer).releasePayment(id, "0x", "0x", 0)
    ).to.be.revertedWith("Invalid agent attestation length");
  });

  it("buyer releases a DELIVERED agreement with a valid attestation", async () => {
    const { vault, usdc, domain, owner, buyer, contractor } = await setup();
    const id = ID("buyer-delivered-ok");
    await fund(vault, usdc, buyer, contractor, id);
    await vault.connect(contractor).markDelivered(id, "ipfs://proof");
    const agr = await vault.getAgreement(id);

    await expect(
      vault.connect(buyer).releasePayment(
        id, "0x", await agentSig(domain, owner, id, "ipfs://proof", agr.deadlineTimestamp), 0)
    ).to.emit(vault, "AgreementReleased")
      .withArgs(id, buyer.address, contractor.address,
        (v) => v > 0n, (v) => v >= 0n, 0n, true, 0n); // 0 = BuyerAuthorised
  });

  it("an attestation over the WRONG proof is refused", async () => {
    const { vault, usdc, domain, owner, buyer, contractor } = await setup();
    const id = ID("wrong-proof");
    await fund(vault, usdc, buyer, contractor, id);
    await vault.connect(contractor).markDelivered(id, "ipfs://real");
    const agr = await vault.getAgreement(id);

    await expect(
      vault.connect(buyer).releasePayment(
        id, "0x", await agentSig(domain, owner, id, "ipfs://forged", agr.deadlineTimestamp), 0)
    ).to.be.revertedWith("Invalid Sivan AI agent attestation");
  });

  /* ─── row 3: relayer, Funded, buyer signature only ───────────────── */

  it("a relayer releases from Funded with only the buyer's signature", async () => {
    const { vault, usdc, domain, buyer, contractor, relayer } = await setup();
    const id = ID("relay-funded");
    const agr = await fund(vault, usdc, buyer, contractor, id);
    const expiry = (await now()) + 3600;

    const sig = await buyerSig(domain, buyer, id, contractor.address, agr.netAmount,
      await vault.agreementNonces(id), expiry);

    // No agent signature. The buyer's own authorization is the authority here,
    // and it pins the exact contractor and amount.
    await expect(
      vault.connect(relayer).releasePayment(id, sig, "0x", expiry)
    ).to.not.be.reverted;
  });

  /* ─── row 4: relayer, Delivered, both required ───────────────────── */

  it("a relayer releasing a DELIVERED agreement needs both signatures", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer } = await setup();
    const id = ID("relay-delivered");
    await fund(vault, usdc, buyer, contractor, id);
    await vault.connect(contractor).markDelivered(id, "ipfs://proof");
    const agr = await vault.getAgreement(id);
    const expiry = (await now()) + 3600;

    const sig = await buyerSig(domain, buyer, id, contractor.address, agr.netAmount,
      await vault.agreementNonces(id), expiry);

    // Buyer signature alone is no longer enough once delivery is recorded.
    await expect(
      vault.connect(relayer).releasePayment(id, sig, "0x", expiry)
    ).to.be.revertedWith("Invalid agent attestation length");

    await expect(
      vault.connect(relayer).releasePayment(
        id, sig, await agentSig(domain, owner, id, "ipfs://proof", agr.deadlineTimestamp), expiry)
    ).to.not.be.reverted;
  });

  /* ─── the rule the whole design rests on ─────────────────────────── */

  it("an absent contractor cannot block their own payment", async () => {
    const { vault, usdc, buyer, contractor } = await setup();
    const id = ID("absent-contractor");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    // The contractor never calls markDelivered. Both parties agree the work is
    // done. Requiring Delivered first would trap the money here permanently.
    const before = await usdc.balanceOf(contractor.address);
    await vault.connect(buyer).releasePayment(id, "0x", "0x", 0);
    expect(await usdc.balanceOf(contractor.address)).to.equal(
      before + agr.netAmount,
      "a silent contractor prevented their own payment"
    );
  });
});
