const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { readback } = require("../scripts/helpers/claim-deployment");

describe("Claim audit reproductions (not remediation)", function () {
  it("documents that recovery readback accepts a receipt with only one confirmation", async function () {
    expect(network.name).to.equal("hardhat");
    const [admin, treasury] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20", ["Audit token", "TEST", 6]);
    const vault = await ethers.deployContract("SivanClaimVault", [admin.address, treasury.address, [token.target]]);
    const receipt = await vault.deploymentTransaction().wait();
    const record = { deployTx: receipt.hash, vault: vault.target,
      abi: vault.interface.fragments, config: { admin: admin.address, treasury: treasury.address,
        tokens: [{ address: token.target }] } };
    expect(await receipt.confirmations()).to.equal(1);
    const result = await readback(ethers.provider, record);
    expect(result.deployBlock).to.equal(receipt.blockNumber);
  });
});
