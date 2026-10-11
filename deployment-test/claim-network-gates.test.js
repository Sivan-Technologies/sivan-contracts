const { expect } = require("chai");
const hre = require("hardhat");
const { networks, getNetwork } = require("../config/evm-networks.cjs");
const { guard } = require("../scripts/helpers/claim-deployment");
const targets = require("../config/claim-targets.cjs");

describe("Claim network rollout gates — local evidence only", function () {
  it("uses the selected target chain ID on an ephemeral Hardhat network", async function () {
    const network = getNetwork(process.env.CLAIM_TEST_NETWORK || "celoSepolia");
    expect(hre.network.name).to.equal("hardhat");
    expect(targets).to.include(network.name);
    expect((await hre.ethers.provider.getNetwork()).chainId).to.equal(BigInt(network.chainId));
  });
  it("keeps every pending testnet and every mainnet blocked despite local test success", function () {
    for (const network of Object.values(networks)) {
      if (!network.testnet) expect(() => guard(network, "testnet")).to.throw("Mainnet");
      else if (network.status !== "candidate") expect(() => guard(network, "testnet")).to.throw("pending");
      else expect(() => guard(network, "testnet")).not.to.throw();
      expect(() => guard(network, "production")).to.throw("testnet profile");
    }
  });
});
