const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { readback } = require("../scripts/helpers/claim-deployment");

describe("Claim confirmation policy regression", function () {
  it("rejects one confirmation, accepts two and rejects noncanonical or disappearing receipts", async function () {
    expect(network.name).to.equal("hardhat");
    const [admin, treasury] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20", ["Audit token", "TEST", 6]);
    const vault = await ethers.deployContract("SivanClaimVault", [admin.address, treasury.address, [token.target]]);
    const receipt = await vault.deploymentTransaction().wait();
    const record = { deployTx: receipt.hash, vault: vault.target,
      abi: vault.interface.fragments, config: { admin: admin.address, treasury: treasury.address,
        tokens: [{ address: token.target }] } };
    expect(await receipt.confirmations()).to.equal(1);
    await expect(readback(ethers.provider, record)).to.be.rejectedWith("pending confirmations");
    await ethers.provider.send("evm_mine", []);
    const result = await readback(ethers.provider, record);
    expect(result.deployBlock).to.equal(receipt.blockNumber);
    expect(result.minimumConfirmations).to.equal(2);
    expect(result.observedConfirmations).to.equal(2);
    const wrap = overrides => new Proxy(ethers.provider, { get(target, key) {
      if (key in overrides) return overrides[key];
      const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(readback(wrap({ getBlock: async () => ({ hash: ethers.ZeroHash }) }), record))
      .to.be.rejectedWith("not canonical");
    let reads = 0;
    await expect(readback(wrap({ getTransactionReceipt: async () => ++reads === 1 ? receipt : null }), record))
      .to.be.rejectedWith("changed during readback");
  });
});
