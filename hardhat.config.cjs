require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("./scripts/helpers/environment").loadEnvironment();
const { hardhatNetworks, networks } = require("./config/evm-networks.cjs");
const configured = hardhatNetworks();
const customChains = [];
const apiKey = {};
for (const n of Object.values(networks)) {
  const apiURL = process.env[n.prefix + "_EXPLORER_API_URL"];
  const browserURL = process.env[n.prefix + "_EXPLORER_BROWSER_URL"];
  const key = process.env[n.prefix + "_EXPLORER_API_KEY"];
  if (n.chainId && apiURL && browserURL && key) {
    customChains.push({ network: n.name, chainId: n.chainId, urls: { apiURL, browserURL } });
    apiKey[n.name] = key;
  }
}
module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" } },
  networks: {
    hardhat: { chainId: 31337 },
    ...configured,
    ...(process.env.CELO_FORK_RPC_URL ? { celofork: { url: process.env.CELO_FORK_RPC_URL, chainId: 31337 } } : {}),
    ...(process.env.CELO_SEPOLIA_FORK_RPC_URL ? { celosepoliafork: { url: process.env.CELO_SEPOLIA_FORK_RPC_URL, chainId: 11142220 } } : {}),
  },
  etherscan: { apiKey, customChains },
};
