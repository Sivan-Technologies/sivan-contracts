// Public chain identifiers only. Endpoints and credentials belong in the environment.
// "candidate" permits controlled testnet deployment, NOT production certification.
class DeploymentError extends Error {}
const definitions = [
  ["celoSepolia", 11142220, "CELO_SEPOLIA", true, "candidate"],
  ["baseSepolia", 84532, "BASE_SEPOLIA", true, "candidate"],
  ["arbitrumSepolia", 421614, "ARBITRUM_SEPOLIA", true, "candidate"],
  ["ethereumSepolia", 11155111, "ETHEREUM_SEPOLIA", true, "pending"],
  ["optimismSepolia", 11155420, "OP_SEPOLIA", true, "pending"],
  ["polygonAmoy", 80002, "POLYGON_AMOY", true, "pending"],
  ["bscTestnet", 97, "BSC_TESTNET", true, "pending"],
  ["arcTestnet", 5042002, "ARC_TESTNET", true, "pending"],
  ["lineaTestnet", null, "LINEA_TESTNET", true, "pending"],
  ["sonicTestnet", null, "SONIC_TESTNET", true, "pending"],
  ["celo", 42220, "CELO", false, "pending"],
  ["ethereum", 1, "ETHEREUM", false, "pending"],
  ["base", 8453, "BASE", false, "pending"],
  ["arbitrum", 42161, "ARBITRUM", false, "pending"],
  ["optimism", 10, "OP", false, "pending"],
  ["polygon", 137, "POLYGON", false, "pending"],
  ["bsc", 56, "BSC", false, "pending"],
  ["arc", null, "ARC", false, "pending"],
  ["linea", null, "LINEA", false, "pending"],
  ["sonic", null, "SONIC", false, "pending"],
];
const networks = Object.freeze(Object.fromEntries(definitions.map(([name, chainId, prefix, testnet, status]) =>
  [name, Object.freeze({ name, chainId, prefix, testnet, status, evmVersion: "cancun" })])));

function getNetwork(name) {
  const network = networks[name];
  if (!network) throw new DeploymentError("Unknown EVM network");
  return network;
}
function assertDeployable(network) {
  if (!network.testnet) throw new DeploymentError("Mainnet deployment is disabled pending independent release approval");
  if (network.status !== "candidate" || !network.chainId) throw new DeploymentError("Network compatibility review is pending; deployment disabled");
}
function hardhatNetworks(env = process.env) {
  const result = {};
  for (const n of Object.values(networks)) {
    // No placeholder RPC and no private key in Hardhat config/error output.
    if (n.chainId && env[n.prefix + "_RPC_URL"]) {
      result[n.name] = { url: env[n.prefix + "_RPC_URL"], chainId: n.chainId, accounts: [] };
    }
  }
  return result;
}
module.exports = { DeploymentError, networks, getNetwork, assertDeployable, hardhatNetworks };
