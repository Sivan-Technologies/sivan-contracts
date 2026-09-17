const hre = require("hardhat");

/**
 * Deploy the SivanAgreementVault and list the assets it will accept.
 *
 * WHY THE SEEDING MATTERS.
 *
 * The vault starts permissive: with an empty allowlist it accepts any ERC-20,
 * because a fresh deployment with an empty map that refused everything would be
 * unusable. The allowlist only starts being enforced once the owner lists a
 * first token. So a deployment that never seeds is a deployment that accepts
 * arbitrary tokens forever, which is exactly the hole the allowlist exists to
 * close.
 *
 * This script therefore deploys AND lists in one run, and refuses to finish
 * quietly if the listing did not take.
 *
 * TOKEN ADDRESSES ARE VERIFIED, NOT COPIED.
 * Each mainnet address below was read back from Celo with eth_call on
 * symbol() and decimals() before being written here:
 *
 *   0x765DE816845861e75A25fCA122bb6898B8B1282a  symbol USDm (cUSD)  18 dp
 *   0xcebA9300f2b948710d2653dD7B07f33A8B32118C  symbol USDC          6 dp
 *   0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e  symbol USD₮ (USDT)   6 dp
 *
 * Note the decimal spread: 18dp cUSD next to 6dp USDC on the same vault. That
 * is precisely why the fee tiers are scaled per token rather than hardcoded to
 * 1e6, and why this list is worth verifying rather than trusting.
 */

/**
 * ORDER IS DELIBERATE: USDC FIRST.
 *
 * USDC is the primary settlement asset and the one every integration is tested
 * against first, so it is listed first and appears first in the deploy output.
 * cUSD and USDT follow.
 *
 * This is not cosmetic. The order here is the order the allowlist transaction
 * enumerates, the order the log prints, and the order anyone reading this file
 * will assume reflects priority. Leading with cUSD implied Celo's native
 * stablecoin was the default, which is not how the product is being rolled out.
 */
const MAINNET_TOKENS = {
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", //  6 dp, primary
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a", // 18 dp, symbol reports USDm
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", //  6 dp, symbol reports USD-T
};

/**
 * CELO SEPOLIA TESTNET (chain 11142220). This is where testnet deployments go.
 *
 * Alfajores was sunset on 30 Sep 2025 with Ethereum Holesky. Celo Sepolia
 * replaced it with a clean slate, which means every Alfajores address is
 * meaningless here. The old hardcoded Alfajores cUSD constant,
 * 0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1, returns an empty eth_getCode on
 * Celo Sepolia: it is not a token on this chain, it is nothing at all. Listing
 * it would have allowlisted a blank address.
 *
 * Every address below was read back off Celo Sepolia with eth_call on symbol()
 * and decimals(), and checked for non-empty bytecode, before being written
 * here. Same standard as the mainnet list:
 *
 *   0x01C5C0122039549AD1493B8220cABEdD739BC44E  symbol USDC         6 dp
 *   0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b  symbol USDm (cUSD) 18 dp
 *   0xd077A400968890Eacc75cdc901F0356c943e4fDb  symbol USD-T        6 dp
 *
 * USDC first, matching mainnet and matching how the product is rolled out.
 * The 6dp/18dp spread is present on testnet too, so the per-token fee tier
 * scaling gets exercised here rather than first meeting it on mainnet.
 */
const CELO_SEPOLIA_TOKENS = {
  USDC: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", //  6 dp, primary
  cUSD: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b", // 18 dp, symbol reports USDm
  USDT: "0xd077A400968890Eacc75cdc901F0356c943e4fDb", //  6 dp, symbol reports USD-T
};

/** Read symbol() and decimals() back off chain so we never list a guess. */
async function describeToken(address) {
  const erc20 = await hre.ethers.getContractAt(
    ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
    address
  );
  const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
  return { symbol, decimals: Number(decimals) };
}

async function main() {
  const net = hre.network.name;

  /**
   * Check the deployer key BEFORE touching the network.
   *
   * hre.ethers.getSigners() opens an RPC connection, so a missing key
   * surfaced as an ENOTFOUND DNS error rather than "you forgot the key".
   * Diagnosing a config mistake from a network stack trace wastes time that
   * a one-line check prevents.
   */
  if (net === "alfajores") {
    throw new Error(
      "Alfajores was sunset on 30 Sep 2025 and its RPC no longer answers.\n" +
        "Celo's live testnet is Celo Sepolia (chain 11142220). Deploy with:\n" +
        "  npx hardhat run scripts/deploy.js --network celoSepolia"
    );
  }

  if (
    net !== "hardhat" &&
    net !== "localhost" &&
    net !== "celofork" &&
    net !== "celosepoliafork"
  ) {
    const key = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
    if (!key) {
      throw new Error(
        `DEPLOYER_PRIVATE_KEY is empty, so there is nothing to sign the ${net} ` +
          "deployment with.\n" +
          "  1. cp .env.example .env\n" +
          "  2. generate a FRESH key (cast wallet new)\n" +
          "  3. fund it at https://faucet.celo.org for Alfajores"
      );
    }
    const normalised = key.startsWith("0x") ? key : `0x${key}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) {
      throw new Error(
        "DEPLOYER_PRIVATE_KEY is not a 32-byte hex key. Expected 64 hex " +
          "characters, optionally 0x-prefixed."
      );
    }
  }

  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying SivanAgreementVault");
  console.log("  network :", net, "(chainId", hre.network.config.chainId + ")");
  console.log("  deployer:", deployer.address);

  const feeCollector = process.env.SIVAN_FEE_COLLECTOR || deployer.address;
  const agentAttester = process.env.SIVAN_AGENT_ATTESTER || deployer.address;
  const registeredAgentId = Number(process.env.SIVAN_AGENT_ID || 9827);

  if (net === "celo") {
    /**
     * On mainnet, defaulting the fee collector or the attester to the deployer
     * key is a real mistake, not a convenience: it puts protocol revenue and
     * the attestation authority on a hot deploy key. Refuse rather than warn.
     */
    if (!process.env.SIVAN_FEE_COLLECTOR || !process.env.SIVAN_AGENT_ATTESTER) {
      throw new Error(
        "Refusing to deploy to Celo mainnet with the deployer key as fee collector " +
          "or agent attester. Set SIVAN_FEE_COLLECTOR and SIVAN_AGENT_ATTESTER."
      );
    }
  }

  console.log("  fee collector :", feeCollector);
  console.log("  agent attester:", agentAttester, "(ERC-8004 #" + registeredAgentId + ")");

  const Vault = await hre.ethers.getContractFactory("SivanAgreementVault");
  const vault = await Vault.deploy(
    feeCollector,
    agentAttester,
    registeredAgentId,
    deployer.address
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log("\nVault deployed:", vaultAddress);

  // ── Seed the allowlist ──────────────────────────────────────────────
  const tokens =
    net === "celo" || net === "celofork"
      ? MAINNET_TOKENS
      : net === "celoSepolia" || net === "celosepoliafork"
      ? CELO_SEPOLIA_TOKENS
      : null;

  if (!tokens) {
    console.log("\nLocal network: skipping the allowlist seed.");
  } else {
    console.log("\nVerifying tokens on chain before listing:");
    const addresses = [];
    for (const [label, address] of Object.entries(tokens)) {
      try {
        const { symbol, decimals } = await describeToken(address);
        console.log(`  ${label.padEnd(5)} ${address}  symbol=${symbol} decimals=${decimals}`);
        addresses.push(address);
      } catch (error) {
        // A constant that does not answer symbol() is not a token. Do not list
        // it, and do not fail the whole deployment over it either.
        console.log(`  ${label.padEnd(5)} ${address}  SKIPPED, did not answer symbol()`);
      }
    }

    if (addresses.length === 0) {
      throw new Error("No tokens verified. Refusing to leave the vault permissive.");
    }

    if (!Object.keys(tokens).includes("USDC")) {
      console.log(
        "\n  NOTE: USDC is not in this network's list. It is the primary test asset.\n" +
        "  Set ALFAJORES_USDC to the verified address and redeploy, or list it\n" +
        "  afterwards with setSupportedToken()."
      );
    }

    const tx = await vault.setSupportedTokens(addresses, true);
    await tx.wait();
    console.log(`\nListed ${addresses.length} assets in one transaction.`);

    // Assert the allowlist is actually enforced now. Without this the script
    // can report success while the vault still accepts arbitrary tokens.
    const enforced = await vault.tokenAllowlistEnforced();
    if (!enforced) {
      throw new Error("Allowlist did not engage after seeding. Investigate before use.");
    }
    for (const address of addresses) {
      if (!(await vault.supportedTokens(address))) {
        throw new Error(`Token ${address} is not listed after seeding.`);
      }
    }
    console.log("Allowlist enforced and every listed asset confirmed on chain.");
  }

  // ── Report the live fee schedule ────────────────────────────────────
  const [t1u, t1b, t2u, t2b, t3b] = await Promise.all([
    vault.tier1UpperUnits(), vault.tier1Bps(),
    vault.tier2UpperUnits(), vault.tier2Bps(), vault.tier3Bps(),
  ]);
  console.log("\nFee tiers (whole token units, scaled per token decimals):");
  console.log(`  <= ${t1u} units : ${t1b} bps`);
  console.log(`  <= ${t2u} units : ${t2b} bps`);
  console.log(`   > ${t2u} units : ${t3b} bps`);
  console.log("  adjust later with setFeeTiers(), no redeploy required");

  console.log("\nVerify with:");
  console.log(
    `  npx hardhat verify --network ${net} ${vaultAddress} ` +
      `${feeCollector} ${agentAttester} ${registeredAgentId} ${deployer.address}`
  );

  return vaultAddress;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
