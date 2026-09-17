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
  if (!["hardhat", "localhost", "celofork", "celosepoliafork", "celo", "alfajores", "celoSepolia"].includes(net)) {
    throw new Error(`Unsupported deployment network: ${net}`);
  }

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
          "  3. fund the dedicated testnet wallet using the appropriate testnet faucet"
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

  // Read-only Sepolia preflight: fail before sending ANY deployment transaction.
  let sepoliaTokens;
  if (net === "celoSepolia") {
    const network = await hre.ethers.provider.getNetwork();
    if (hre.network.config.chainId !== 11142220 || network.chainId !== 11142220n) {
      throw new Error("Celo Sepolia requires chain ID 11142220. Refusing deployment.");
    }
    for (const name of ["SIVAN_FEE_COLLECTOR", "SIVAN_AGENT_ATTESTER", "CELO_SEPOLIA_USDC"]) {
      const value = process.env[name];
      if (!value || !hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
        throw new Error(`${name} must be an explicit nonzero address.`);
      }
    }
    if (!Number.isSafeInteger(registeredAgentId) || registeredAgentId <= 0) {
      throw new Error("SIVAN_AGENT_ID must be a positive safe integer.");
    }
    const token = process.env.CELO_SEPOLIA_USDC;
    const metadata = await describeToken(token);
    if (metadata.symbol !== "USDC" || metadata.decimals !== 6) {
      throw new Error("Configured Sepolia token must report USDC with 6 decimals.");
    }
    if (await hre.ethers.provider.getBalance(deployer.address) === 0n) {
      throw new Error("Deployer needs test CELO for deployment and allowlist gas.");
    }
    sepoliaTokens = { USDC: token };
    console.log("Sepolia preflight passed (network, roles, USDC metadata, nonzero gas balance).");
  }

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

  /**
   * Capture the creation receipt immediately.
   *
   * The first Sepolia deployment finished without recording its transaction
   * hashes, and they had to be recovered from a block explorer afterwards.
   * They are free to capture here and awkward to find later, so capture them.
   */
  const deployTx = vault.deploymentTransaction();
  const deployReceipt = await deployTx.wait();
  if (deployReceipt.status !== 1) {
    throw new Error(`Deployment transaction reverted: ${deployReceipt.hash}`);
  }

  console.log("\nVault deployed:", vaultAddress);
  console.log(`  deploy tx: ${deployReceipt.hash} (block ${deployReceipt.blockNumber})`);
  console.log(`  gas used : ${deployReceipt.gasUsed.toString()}`);

  // ── Seed the allowlist ──────────────────────────────────────────────
  const tokens =
    net === "celo" || net === "celofork"
      ? MAINNET_TOKENS
      : net === "celoSepolia"
      ? sepoliaTokens
      : net === "celosepoliafork"
      ? CELO_SEPOLIA_TOKENS
      : null;

  // Hoisted so the deployment record below can see them.
  let seedTxHash = null;
  let seedBlockNumber = null;
  let listedTokens = [];

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
    const seedReceipt = await tx.wait();
    if (seedReceipt.status !== 1) {
      throw new Error(
        `Allowlist seeding REVERTED.\n` +
          `  vault  : ${vaultAddress}\n` +
          `  seed tx: ${seedReceipt.hash}\n` +
          `The vault exists but accepts ANY token. Do not use it.`
      );
    }
    console.log(`\nListed ${addresses.length} assets in one transaction.`);
    console.log(`  seed tx: ${seedReceipt.hash} (block ${seedReceipt.blockNumber})`);
    seedTxHash = seedReceipt.hash;
    seedBlockNumber = seedReceipt.blockNumber;
    listedTokens = addresses;

    /**
     * Assert the allowlist actually engaged, pinned to the seeding block.
     *
     * Without this check the script can report success while the vault still
     * accepts arbitrary tokens. But the first version of the check read at
     * "latest" and failed a real deployment that was perfectly fine:
     *
     *   Vault deployed: 0x0592edf3...787caf
     *   Listed 1 assets in one transaction.
     *   Error: Allowlist did not engage after seeding. Investigate before use.
     *
     * The flag was true in the seeding transaction's OWN block. forno sits
     * behind several backends; tx.wait() returned from one that had the block
     * and the follow-up eth_call hit one that did not. Reading at `latest`
     * lets a lagging backend answer from before the state change.
     *
     * Pinning to receipt.blockNumber removes the ambiguity: that block either
     * contains the change or the deployment genuinely failed. The retry is
     * only for backends that have not indexed the block yet, which surfaces as
     * a thrown error rather than a stale `false`.
     *
     * NOTHING HERE RE-SENDS A TRANSACTION. Retrying a send after an apparent
     * failure is how one vault becomes two, each holding real money. Retries
     * are reads only.
     */
    const blockTag = seedReceipt.blockNumber;
    const RETRIES = 8;
    let enforced = false;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        enforced = await vault.tokenAllowlistEnforced({ blockTag });
        if (enforced) break;
        // A definitive `false` AT the seeding block is a real failure, not
        // propagation lag. Stop rather than burn the remaining retries.
        throw new Error(
          `Allowlist is not enforced at block ${blockTag}, the block that ` +
            `contains the seeding transaction. This is a genuine failure.`
        );
      } catch (error) {
        if (error.message && error.message.includes("is not enforced at block")) {
          throw new Error(
            `${error.message}\n` +
              `  vault  : ${vaultAddress}\n` +
              `  seed tx: ${seedReceipt.hash}\n` +
              `DO NOT REDEPLOY. Inspect the existing vault first; redeploying ` +
              `creates a second vault and spends more gas.`
          );
        }
        if (attempt === RETRIES) {
          throw new Error(
            `Could not read the allowlist at block ${blockTag} after ` +
              `${RETRIES} attempts: ${error.message}\n` +
              `  vault  : ${vaultAddress}\n` +
              `  seed tx: ${seedReceipt.hash}\n` +
              `The seeding transaction SUCCEEDED. This is a read problem, not ` +
              `a deployment problem. Verify manually:\n` +
              `  cast call ${vaultAddress} "tokenAllowlistEnforced()(bool)" --rpc-url <rpc>\n` +
              `DO NOT REDEPLOY.`
          );
        }
        console.log(`  allowlist read attempt ${attempt} failed, retrying in 2s`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    for (const address of addresses) {
      if (!(await vault.supportedTokens(address, { blockTag }))) {
        throw new Error(
          `Token ${address} is not listed at block ${blockTag}.\n` +
            `  vault  : ${vaultAddress}\n` +
            `  seed tx: ${seedReceipt.hash}\n` +
            `DO NOT REDEPLOY.`
        );
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

  /**
   * READ THE ROLES BACK OFF CHAIN.
   *
   * The constructor takes four addresses in an order that is easy to
   * transpose, and a wrong fee collector or attester is invisible until money
   * moves or a signature fails. Asserting them here costs four eth_calls and
   * converts a silent misconfiguration into a failed deployment.
   */
  const onChain = {
    owner: await vault.owner(),
    feeCollector: await vault.feeCollector(),
    agentAttester: await vault.agentAttester(),
    registeredAgentId: (await vault.registeredAgentId()).toString(),
  };
  const expected = {
    owner: deployer.address,
    feeCollector,
    agentAttester,
    registeredAgentId: String(registeredAgentId),
  };
  console.log("\nRoles read back from the deployed contract:");
  for (const [key, want] of Object.entries(expected)) {
    const got = onChain[key];
    const same =
      typeof want === "string" && want.startsWith("0x")
        ? got.toLowerCase() === want.toLowerCase()
        : got === want;
    console.log(`  ${key.padEnd(18)} ${got} ${same ? "OK" : "MISMATCH, expected " + want}`);
    if (!same) {
      throw new Error(
        `${key} on chain is ${got} but ${want} was intended. The constructor ` +
          `arguments are likely transposed. Vault ${vaultAddress} should be ` +
          `considered unusable.`
      );
    }
  }

  const verifyCommand =
    `npx hardhat verify --network ${net} ${vaultAddress} ` +
    `${feeCollector} ${agentAttester} ${registeredAgentId} ${deployer.address}`;

  console.log("\nVerify with:");
  console.log(`  ${verifyCommand}`);

  /**
   * Write the record to disk rather than relying on the terminal scrollback.
   * deployments/ is gitignored: it contains no secrets, but it is per
   * deployment rather than per repository.
   */
  if (net !== "hardhat" && net !== "localhost") {
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      network: net,
      chainId: hre.network.config.chainId,
      vault: vaultAddress,
      deployTx: deployReceipt.hash,
      deployBlock: deployReceipt.blockNumber,
      deployGasUsed: deployReceipt.gasUsed.toString(),
      seedTx: seedTxHash,
      seedBlock: seedBlockNumber,
      roles: onChain,
      listedTokens,
      feeTiers: {
        tier1UpperUnits: t1u.toString(), tier1Bps: t1b.toString(),
        tier2UpperUnits: t2u.toString(), tier2Bps: t2b.toString(),
        tier3Bps: t3b.toString(),
      },
      deliveryReviewWindowSeconds: (await vault.deliveryReviewWindow()).toString(),
      verifyCommand,
      timestamp: new Date().toISOString(),
    };
    const file = path.join(dir, `${net}-${vaultAddress}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    console.log(`\nDeployment record written to deployments/${path.basename(file)}`);
  }

  return vaultAddress;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
