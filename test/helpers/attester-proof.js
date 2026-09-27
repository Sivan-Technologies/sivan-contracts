const { ethers } = require("hardhat");
const { attesterChallenge } = require("../../scripts/helpers/evm-deployment");
async function signProof(network, config, deployer, artifact, agent) {
  config.attesterProofExpiry = String((await ethers.provider.getBlock("latest")).timestamp + 3600);
  config.attesterProof = await agent.signMessage(attesterChallenge({ network, config, deployer, artifact }));
  return config;
}
module.exports = { signProof };
