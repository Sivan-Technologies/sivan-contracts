/**
 * Hardhat config for Arc Testnet fork tests.
 * Self-contained — does not inherit hardhat.config.cjs to avoid
 * environment-loading side effects.
 *
 * Arc Testnet chain ID 5042002 is not in Hardhat's default hardfork schedule,
 * so we register it explicitly with cancun activated at block 0.
 *
 * Requires ARC_TESTNET_FORK_RPC_URL (or ARC_TESTNET_RPC_URL) in env.
 *
 * Run:
 *   ARC_TESTNET_FORK_RPC_URL=https://rpc.testnet.arc.io \
 *   npx hardhat test --config config/arc-fork-test.cjs --network hardhat \
 *     deployment-test/arc-refund-simulation.test.js
 */
"use strict";
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

const rpcUrl = process.env.ARC_TESTNET_FORK_RPC_URL
  || process.env.ARC_TESTNET_RPC_URL;
if (!rpcUrl) throw new Error(
  "Set ARC_TESTNET_FORK_RPC_URL (or ARC_TESTNET_RPC_URL) to run Arc fork tests"
);

const FORK_BLOCK = process.env.ARC_FORK_BLOCK
  ? parseInt(process.env.ARC_FORK_BLOCK, 10)
  : undefined;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    hardhat: {
      chainId: 5042002,
      // Arc Testnet is Cancun-compatible (confirmed by parentBeaconBlockRoot in
      // block headers on 2026-10-21). Register the hardfork history so Hardhat EDR
      // can resolve any historical block on this chain.
      hardfork: "cancun",
      chains: {
        5042002: {
          hardforkHistory: {
            cancun: 0,
          },
        },
      },
      forking: {
        url: rpcUrl,
        ...(FORK_BLOCK !== undefined ? { blockNumber: FORK_BLOCK } : {}),
      },
    },
  },
};
