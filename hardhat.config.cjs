require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const key = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const accounts = key
  ? [key.startsWith("0x") ? key : `0x${key}`]
  : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // Required: deposit() carries enough locals to exceed the EVM's 16 stack
      // slots once fee-on-transfer balance measurement is included. viaIR is
      // the standard remedy and is what production Solidity ships with.
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    ...(process.env.CELO_SEPOLIA_RPC_URL ? {
      celoSepolia: {
        url: process.env.CELO_SEPOLIA_RPC_URL,
        chainId: Number(process.env.CELO_SEPOLIA_CHAIN_ID),
        accounts,
      },
    } : {}),
    hardhat: {
      chainId: 31337,
    },
    // A local fork of Celo mainnet, so the deploy script's token allowlist
    // seeding can be exercised against the REAL cUSD/USDC/USDT contracts
    // rather than only on a bare local chain where it is skipped.
    celofork: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    alfajores: {
      url: process.env.CELO_ALFAJORES_RPC_URL || "https://alfajores-forno.celo-testnet.org",
      chainId: 44787,
      accounts: accounts,
    },
    celo: {
      url: process.env.CELO_RPC_URL || "https://forno.celo.org",
      chainId: 42220,
      accounts: accounts,
    },
  },
  etherscan: {
    apiKey: {
      alfajores: process.env.CELOSCAN_API_KEY || "empty",
      celo: process.env.CELOSCAN_API_KEY || "empty",
    },
    customChains: [
      {
        network: "alfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api-alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io",
        },
      },
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io",
        },
      },
    ],
  },
};
