// Ephemeral Hardhat only. Chain-ID simulation is NOT remote-chain compatibility;
// this configuration is never used by the public deployment CLI.
const path = require("path");
const base = require("../hardhat.config.cjs");
const { getNetwork } = require("./evm-networks.cjs");
const targets = require("./claim-targets.cjs");
const selected = getNetwork(process.env.CLAIM_TEST_NETWORK || "celoSepolia");
if (!selected.testnet || !selected.chainId || !targets.includes(selected.name))
  throw new Error("Claim local test profile must be one of the five explicit testnet targets");
module.exports = { ...base, paths: { root: path.resolve(__dirname, "..") },
  networks: { hardhat: { chainId: selected.chainId } } };
