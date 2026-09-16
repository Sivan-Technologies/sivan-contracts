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

const MAINNET_TOKENS = {
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
};

/**
 * Alfajores testnet. Only cUSD is asserted here because it is the one address
 * on the testnet that is stable and widely published. Additional testnet
 * assets should be verified on chain before being added, the same way the
 * mainnet list was. An unverified constant in a deploy script is how a vault
 * ends up allowlisting an address that is not the token anyone thinks it is.
 */
const ALFAJORES_TOKENS = {
  cUSD: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
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
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;

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
      : net === "alfajores"
      ? ALFAJORES_TOKENS
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
