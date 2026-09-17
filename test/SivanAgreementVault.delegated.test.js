const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * THE DELEGATED RELEASE PATH
 *
 * A buyer signs an authorization off chain and a relayer, an agent, or the
 * contractor submits it. This is what makes a gasless chat flow possible: the
 * buyer approves in Telegram, Sivan pays the gas and broadcasts.
 *
 * It was entirely broken. The digest embedded `block.timestamp + 1 hours`,
 * which the signer cannot predict, so no correctly signed authorization ever
 * validated. Every one of these tests fails on the pre-fix contract.
 */
describe("SivanAgreementVault · delegated release", function () {
  const U6 = (n) => ethers.parseUnits(n.toString(), 6);
  const ID = (s) => ethers.id(s);

  async function setup() {
    const [owner, buyer, contractor, feeCollector, relayer, attacker] =
      await ethers.getSigners();

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

    return { vault, usdc, domain, owner, buyer, contractor, feeCollector, relayer, attacker };
  }

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

  async function fund(vault, usdc, buyer, contractor, id, amount = U6(100)) {
    await vault.connect(buyer).deposit(
      id, contractor.address, await usdc.getAddress(), amount, 24, ethers.ZeroAddress);
    return vault.getAgreement(id);
  }

  async function agentSig(domain, signer, id, deadline) {
    return signer.signTypedData(domain, AGENT_TYPES, {
      agreementId: id,
      agentId: 9827n,
      deliverableHash: ethers.keccak256(ethers.toUtf8Bytes("")),
      timestamp: deadline,
    });
  }

  async function now() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  }

  it("a relayer can release with a buyer's signed authorization", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer } = await setup();
    const id = ID("relayed-ok");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    const expiry = (await now()) + 3600;
    const buyerSig = await buyer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id,
      contractor: contractor.address,
      netAmount: agr.netAmount,
      nonce: await vault.agreementNonces(id),
      expiry,
    });

    const before = await usdc.balanceOf(contractor.address);
    await expect(
      vault.connect(relayer).releasePayment(
        id, buyerSig, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.not.be.reverted;

    expect(await usdc.balanceOf(contractor.address)).to.equal(before + agr.netAmount);
  });

  it("refuses an authorization that has already expired", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer } = await setup();
    const id = ID("expired");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    const expiry = (await now()) + 600;
    const buyerSig = await buyer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id,
      contractor: contractor.address,
      netAmount: agr.netAmount,
      nonce: await vault.agreementNonces(id),
      expiry,
    });

    await ethers.provider.send("evm_increaseTime", [1200]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      vault.connect(relayer).releasePayment(
        id, buyerSig, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.be.revertedWith("Release authorization expired");
  });

  it("refuses an authorization valid for longer than the maximum window", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer } = await setup();
    const id = ID("too-long");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    // A year out. A standing release order that far ahead is a liability.
    const expiry = (await now()) + 365 * 24 * 3600;
    const buyerSig = await buyer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id,
      contractor: contractor.address,
      netAmount: agr.netAmount,
      nonce: await vault.agreementNonces(id),
      expiry,
    });

    await expect(
      vault.connect(relayer).releasePayment(
        id, buyerSig, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.be.revertedWith("Release authorization window too long");
  });

  it("refuses a signature from anyone other than the buyer", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer, attacker } = await setup();
    const id = ID("wrong-signer");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    const expiry = (await now()) + 3600;
    const forged = await attacker.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id,
      contractor: contractor.address,
      netAmount: agr.netAmount,
      nonce: await vault.agreementNonces(id),
      expiry,
    });

    await expect(
      vault.connect(relayer).releasePayment(
        id, forged, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.be.revertedWith("Invalid buyer release authorization");
  });

  it("refuses an authorization signed for a different amount", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer } = await setup();
    const id = ID("wrong-amount");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    const expiry = (await now()) + 3600;
    const buyerSig = await buyer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id,
      contractor: contractor.address,
      netAmount: agr.netAmount + 1n, // one wei more than the agreement holds
      nonce: await vault.agreementNonces(id),
      expiry,
    });

    await expect(
      vault.connect(relayer).releasePayment(
        id, buyerSig, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.be.revertedWith("Invalid buyer release authorization");
  });

  it("a failed attempt must not consume the nonce", async () => {
    const { vault, usdc, domain, owner, buyer, contractor, relayer, attacker } = await setup();
    const id = ID("nonce-preserved");
    const agr = await fund(vault, usdc, buyer, contractor, id);
    const expiry = (await now()) + 3600;

    const forged = await attacker.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id, contractor: contractor.address, netAmount: agr.netAmount,
      nonce: await vault.agreementNonces(id), expiry,
    });
    await expect(
      vault.connect(relayer).releasePayment(
        id, forged, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.be.reverted;

    // The buyer's genuine signature, made for nonce 0, must still work.
    const good = await buyer.signTypedData(domain, RELEASE_TYPES, {
      agreementId: id, contractor: contractor.address, netAmount: agr.netAmount,
      nonce: 0n, expiry,
    });
    await expect(
      vault.connect(relayer).releasePayment(
        id, good, await agentSig(domain, owner, id, agr.deadlineTimestamp), expiry)
    ).to.not.be.reverted;
  });

  it("the buyer calling directly still needs no signature", async () => {
    const { vault, usdc, domain, owner, buyer, contractor } = await setup();
    const id = ID("direct");
    const agr = await fund(vault, usdc, buyer, contractor, id);

    await expect(
      vault.connect(buyer).releasePayment(
        id, "0x", await agentSig(domain, owner, id, agr.deadlineTimestamp), 0)
    ).to.not.be.reverted;
  });
});
