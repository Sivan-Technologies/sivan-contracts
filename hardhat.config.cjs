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
    // THE LIVE CELO TESTNET. Deploy here.
    //
    // Celo Sepolia replaced Alfajores. Alfajores was sunset on 30 Sep 2025
    // alongside Ethereum Holesky, which it was anchored to; Celo Sepolia is
    // anchored to Ethereum Sepolia and is the long-term testnet. It started
    // from a clean slate, so nothing from Alfajores carried over and every
    // contract has to be redeployed rather than reused.
    // The environment-backed celoSepolia entry is defined above.
    // A local fork of Celo Sepolia, so a deployment can be rehearsed end to end
    // against the REAL testnet token contracts without spending testnet CELO
    // or exposing a key. Start it with:
    //   anvil --fork-url https://forno.celo-sepolia.celo-testnet.org --port 8546
    celosepoliafork: {
      url: "http://127.0.0.1:8546",
      chainId: 11142220,
    },
    // DEAD NETWORK, kept only so old references fail loudly rather than
    // silently pointing at an RPC that no longer answers. Chain 44787 was
    // sunset on 30 Sep 2025. Use celoSepolia.
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
      // Blockscout ignores the key but hardhat-verify requires a non-empty
      // string, so this is a placeholder rather than a credential.
      celoSepolia: "blockscout",
      alfajores: process.env.CELOSCAN_API_KEY || "empty",
      celo: process.env.CELOSCAN_API_KEY || "empty",
    },
    customChains: [
      {
        // Verification goes through Blockscout, not Celoscan.
        //
        // Celoscan's V1 API now answers every request with "You are using a
        // deprecated V1 endpoint, switch to Etherscan API V2", and the V2
        // endpoint requires an Etherscan key. Blockscout needs no key at all
        // and serves Celo Sepolia, so it is both fewer moving parts and one
        // less secret to hold.
        network: "celoSepolia",
        chainId: 11142220,
        urls: {
          apiURL: "https://celo-sepolia.blockscout.com/api",
          browserURL: "https://celo-sepolia.blockscout.com",
        },
      },
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
