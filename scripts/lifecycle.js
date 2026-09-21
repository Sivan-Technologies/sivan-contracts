const hre = require("hardhat");
const { arbitrationConfig, acceptArbitrationTerms } = require("./helpers/arbitration-terms");

/**
 * FULL LIFECYCLE EXERCISE AGAINST REAL USDC.
 *
 * Runs four complete agreements through the vault and checks BALANCES AND
 * RECEIPTS, not status messages:
 *
 *   1. deposit -> markDelivered -> releasePayment (with agent attestation)
 *   2. deposit -> deadline passes -> refundBuyer
 *   3. deposit -> markDelivered -> raiseDispute -> resolveDispute(buyer)
 *   4. the griefing attack: late delivery claim must be REFUSED
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TEST SUITE.
 *
 * The Hardhat tests run against MockERC20 on a bare local chain. That proves
 * the logic, but it does not prove the vault works with the actual Circle USDC
 * contract at its real address, which has its own transfer semantics, its own
 * decimals, and could in principle be paused or blocklisting. Those are the
 * things that only show up against the real token.
 *
 * Run it against a fork first, for free:
 *   anvil --fork-url https://forno.celo-sepolia.celo-testnet.org --port 8546
 *   VAULT=0x... npx hardhat run scripts/lifecycle.js --network celosepoliafork
 *
 * Then against the live testnet, which costs testnet gas and produces real
 * explorer links:
 *   VAULT=0x... npx hardhat run scripts/lifecycle.js --network celoSepolia
 *
 * On a fork it funds the actors by impersonating a whale or writing storage.
 * On the live network it expects the deployer to already hold test USDC and
 * refuses to invent balances, because a lifecycle test that fakes its own
 * funding is not testing the thing it claims to test.
 */

const USDC = process.env.LIFECYCLE_TOKEN || "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
const EXPLORER = "https://celo-sepolia.blockscout.com";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

const STATE = ["Uninitialized", "Funded", "Delivered", "Released", "Refunded", "Disputed"];

const receipts = [];

function record(label, receipt) {
  receipts.push({ label, hash: receipt.hash, gas: receipt.gasUsed.toString() });
  console.log(`      tx ${receipt.hash}  gas ${receipt.gasUsed}`);
  return receipt;
}

/** Assert, loudly, with the two values printed. */
function check(label, actual, expected) {
  const ok = actual.toString() === expected.toString();
  console.log(`      ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) throw new Error(`${label}: got ${actual}, expected ${expected}`);
}

async function main() {
  const net = hre.network.name;
  const isFork = net === "celosepoliafork" || net === "hardhat" || net === "localhost";

  /**
   * THIS SCRIPT IS FORK-ONLY, AND IT NOW SAYS SO BEFORE SPENDING ANYTHING.
   *
   * An audit pointed out that it could not complete on a live testnet: it
   * needs three signers where hardhat configures one, and its timeout scenario
   * deposits real funds and THEN calls warp(), which deliberately throws on a
   * remote network. The deposit succeeds, the warp fails, and the money is
   * left locked in an agreement the script has abandoned.
   *
   * Refusing at the top converts that into a message. Scenarios 2 and 4 depend
   * on moving time, which no amount of configuration makes possible on a real
   * chain; they need a resumable design that returns after the real deadline,
   * not a flag. Until that exists this stays fork-only.
   *
   * For a live testnet walkthrough use scripts/lifecycle-live.js, which runs
   * only the scenarios that do not require time travel.
   */
  if (!isFork) {
    throw new Error(
      `lifecycle.js is fork-only and refuses to run on ${net}.\n` +
        "  Two of its four scenarios depend on warping time, which cannot be\n" +
        "  done on a live chain. Running it here would deposit funds and then\n" +
        "  abandon them mid-scenario.\n\n" +
        "  Rehearse on a fork:\n" +
        "    anvil --fork-url https://forno.celo-sepolia.celo-testnet.org --port 8546 --chain-id 11142220\n" +
        "    VAULT=0x... npx hardhat run scripts/lifecycle.js --network celosepoliafork\n\n" +
        "  For a real testnet run:\n" +
        "    VAULT=0x... npx hardhat run scripts/lifecycle-live.js --network celoSepolia"
    );
  }

  const vaultAddress = process.env.VAULT;
  if (!vaultAddress || !hre.ethers.isAddress(vaultAddress)) {
    throw new Error(
      "Set VAULT to the deployed vault address.\n" +
        "  VAULT=0x... npx hardhat run scripts/lifecycle.js --network celoSepolia"
    );
  }

  const provider = hre.ethers.provider;
  const code = await provider.getCode(vaultAddress);
  if (code === "0x") throw new Error(`No contract at ${vaultAddress} on ${net}.`);

  const vault = await hre.ethers.getContractAt("SivanAgreementVault", vaultAddress);
  const token = new hre.ethers.Contract(USDC, ERC20_ABI, provider);

  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  const unit = (n) => hre.ethers.parseUnits(String(n), decimals);
  const fmt = (v) => hre.ethers.formatUnits(v, decimals);

  console.log("SIVAN VAULT LIFECYCLE");
  console.log("  network :", net, "chainId", (await provider.getNetwork()).chainId.toString());
  console.log("  vault   :", vaultAddress);
  console.log("  token   :", USDC, `(${symbol}, ${decimals} dp)`);

  // ── Actors ──────────────────────────────────────────────────────────
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];

  /**
   * The attester must be able to SIGN, not merely be named.
   *
   * The deployed vault's agentAttester is whatever address was set at
   * construction. Unless we hold that key we cannot produce a valid
   * attestation, and the delivered-release path cannot be exercised at all.
   * This is the "confirm the backend controls the attester key" item, and it
   * is checked rather than assumed.
   */
  const onChainAttester = await vault.agentAttester();
  const owner = await vault.owner();
  console.log("  owner   :", owner);
  console.log("  attester:", onChainAttester);

  let buyer, contractor, attesterSigner;
  if (isFork) {
    // On a fork we can impersonate anyone, including the real attester.
    buyer = signers[1];
    contractor = signers[2];
    await provider.send("hardhat_impersonateAccount", [onChainAttester]);
    await provider.send("hardhat_setBalance", [
      onChainAttester,
      "0x" + hre.ethers.parseEther("10").toString(16),
    ]);
    attesterSigner = await hre.ethers.getSigner(onChainAttester);
    // Owner too, so resolveDispute can be exercised.
    await provider.send("hardhat_impersonateAccount", [owner]);
    await provider.send("hardhat_setBalance", [
      owner,
      "0x" + hre.ethers.parseEther("10").toString(16),
    ]);
  } else {
    if (signers.length < 3) {
      throw new Error(
        "Live run needs three funded keys: deployer, buyer, contractor.\n" +
          "Add BUYER_PRIVATE_KEY and CONTRACTOR_PRIVATE_KEY to the accounts array."
      );
    }
    buyer = signers[1];
    contractor = signers[2];
    const local = signers.find(
      (s) => s.address.toLowerCase() === onChainAttester.toLowerCase()
    );
    if (!local) {
      throw new Error(
        `The vault's attester is ${onChainAttester} and no configured key matches it.\n` +
          `Without that key no delivered agreement can ever be released. Either add\n` +
          `the attester key, or call setAgentAttester() to an address you control.`
      );
    }
    attesterSigner = local;
  }
  console.log("  buyer   :", buyer.address);
  console.log("  contract:", contractor.address);
  const reviewConfig = await arbitrationConfig(vault, buyer, contractor);
  const recordTerms = async (label, tx) => record(label, await tx.wait());

  // ── Funding ─────────────────────────────────────────────────────────
  const needed = unit(400);
  let buyerBalance = await token.balanceOf(buyer.address);
  if (buyerBalance < needed) {
    if (!isFork) {
      throw new Error(
        `Buyer ${buyer.address} holds ${fmt(buyerBalance)} ${symbol}, needs ${fmt(needed)}.\n` +
          `Fund it with test USDC first. This script will not fabricate balances on a live network.`
      );
    }
    /**
     * Fork funding: overwrite the balance slot directly.
     *
     * Impersonating a whale is the usual trick, but it needs a whale to exist
     * and stay funded. Writing the storage slot works regardless and is
     * honest about being a fork-only shortcut.
     */
    console.log("\n  funding buyer by writing the balance slot (fork only)");
    let found = false;
    for (let slot = 0; slot < 100 && !found; slot++) {
      const key = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [buyer.address, slot]
        )
      );
      const before = await provider.getStorage(USDC, key);
      await provider.send("hardhat_setStorageAt", [
        USDC,
        key,
        hre.ethers.zeroPadValue(hre.ethers.toBeHex(needed * 2n), 32),
      ]);
      if ((await token.balanceOf(buyer.address)) >= needed) {
        console.log(`    balance slot ${slot}`);
        found = true;
      } else {
        await provider.send("hardhat_setStorageAt", [USDC, key, before]);
      }
    }
    if (!found) throw new Error("Could not locate the USDC balance slot on this fork.");
    buyerBalance = await token.balanceOf(buyer.address);
  }
  console.log(`  buyer holds ${fmt(buyerBalance)} ${symbol}`);

  const feeCollector = await vault.feeCollector();
  const domain = {
    name: "Sivan Celo Settlement Facility",
    version: "1",
    chainId: (await provider.getNetwork()).chainId,
    verifyingContract: vaultAddress,
  };
  const attestationTypes = {
    AgentAttestation: [
      { name: "agreementId", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
  };

  const stamp = Date.now();
  const id = (n) => hre.ethers.id(`sivan-lifecycle-${stamp}-${n}`);

  const warp = async (seconds) => {
    if (!isFork) throw new Error("Cannot warp time on a live network.");
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
  };

  // ════════════════════════════════════════════════════════════════════
  console.log("\n─── 1. HAPPY PATH: deposit, deliver, release ───────────────");
  {
    const A = id(1);
    const amount = unit(100);
    await acceptArbitrationTerms(vault, buyer, contractor, A, USDC, amount, 48, hre.ethers.ZeroAddress, reviewConfig, recordTerms);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record(
      "deposit",
      await (
        await vault.connect(buyer).deposit(A, contractor.address, USDC, amount, 48, hre.ethers.ZeroAddress)
      ).wait()
    );

    let agr = await vault.getAgreement(A);
    console.log(`    state=${STATE[Number(agr.state)]} total=${fmt(agr.totalAmount)} fee=${fmt(agr.feeAmount)} net=${fmt(agr.netAmount)}`);
    check("vault holds the deposit", await token.balanceOf(vaultAddress), agr.totalAmount);
    check("fee is 75bps of 100 units", agr.feeAmount, (amount * 75n) / 10000n);

    const proof = "ipfs://QmSivanLifecycleDeliverable";
    record("markDelivered", await (await vault.connect(contractor).markDelivered(A, proof)).wait());
    agr = await vault.getAgreement(A);
    check("state is Delivered", STATE[Number(agr.state)], "Delivered");
    if (agr.deliveredAt === 0n) throw new Error("deliveredAt was not stamped");

    const attestation = await attesterSigner.signTypedData(domain, attestationTypes, {
      agreementId: A,
      agentId: await vault.registeredAgentId(),
      deliverableHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(proof)),
      timestamp: agr.deadlineTimestamp,
    });

    const cBefore = await token.balanceOf(contractor.address);
    const fBefore = await token.balanceOf(feeCollector);
    record("releasePayment", await (await vault.connect(buyer).releasePayment(A, "0x", attestation, 0)).wait());

    check("contractor received netAmount", (await token.balanceOf(contractor.address)) - cBefore, agr.netAmount);
    check("fee collector received the fee", (await token.balanceOf(feeCollector)) - fBefore, agr.feeAmount);
    check("state is Released", STATE[Number((await vault.getAgreement(A)).state)], "Released");
    check("vault retains no dust", await token.balanceOf(vaultAddress), 0n);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log("\n─── 2. TIMEOUT REFUND: deposit, deadline passes, refund ────");
  {
    const A = id(2);
    const amount = unit(60);
    await acceptArbitrationTerms(vault, buyer, contractor, A, USDC, amount, 1, hre.ethers.ZeroAddress, reviewConfig, recordTerms);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record(
      "deposit",
      await (
        await vault.connect(buyer).deposit(A, contractor.address, USDC, amount, 1, hre.ethers.ZeroAddress)
      ).wait()
    );

    const agr = await vault.getAgreement(A);
    const bBefore = await token.balanceOf(buyer.address);

    console.log("    warping past the deadline");
    await warp(3600 + 60);

    record("refundBuyer", await (await vault.connect(buyer).refundBuyer(A)).wait());
    check("buyer refunded IN FULL, no fee", (await token.balanceOf(buyer.address)) - bBefore, agr.totalAmount);
    check("state is Refunded", STATE[Number((await vault.getAgreement(A)).state)], "Refunded");
    check("vault retains no dust", await token.balanceOf(vaultAddress), 0n);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log("\n─── 3. DISPUTE: deliver, buyer disputes, owner refunds ─────");
  {
    const A = id(3);
    const amount = unit(200);
    await acceptArbitrationTerms(vault, buyer, contractor, A, USDC, amount, 48, hre.ethers.ZeroAddress, reviewConfig, recordTerms);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record(
      "deposit",
      await (
        await vault.connect(buyer).deposit(A, contractor.address, USDC, amount, 48, hre.ethers.ZeroAddress)
      ).wait()
    );
    record("markDelivered", await (await vault.connect(contractor).markDelivered(A, "ipfs://disputed")).wait());
    record("raiseDispute", await (await vault.connect(buyer).raiseDispute(A, "deliverable does not match scope")).wait());

    const agr = await vault.getAgreement(A);
    check("state is Disputed", STATE[Number(agr.state)], "Disputed");
    if (agr.disputedAt === 0n) throw new Error("disputedAt was not stamped");

    // While disputed, neither party can exit unilaterally.
    let blocked = false;
    try {
      await vault.connect(buyer).refundBuyer(A);
    } catch {
      blocked = true;
    }
    console.log(`      ${blocked ? "OK  " : "FAIL"} refundBuyer is blocked while disputed`);
    if (!blocked) throw new Error("a disputed agreement must not be unilaterally refundable");

    const bBefore = await token.balanceOf(buyer.address);
    const fBefore = await token.balanceOf(feeCollector);
    const ownerSigner = isFork ? await hre.ethers.getSigner(owner) : deployer;
    record(
      "resolveDispute(false)",
      await (await vault.connect(ownerSigner).resolveDispute(A, false, "no deliverable provided")).wait()
    );

    check("buyer refunded IN FULL", (await token.balanceOf(buyer.address)) - bBefore, agr.totalAmount);
    check("arbiter took NO fee", (await token.balanceOf(feeCollector)) - fBefore, 0n);
    check("state is Refunded", STATE[Number((await vault.getAgreement(A)).state)], "Refunded");
    check("vault retains no dust", await token.balanceOf(vaultAddress), 0n);
  }

  // ════════════════════════════════════════════════════════════════════
  console.log("\n─── 4. THE GRIEFING ATTACK MUST FAIL ───────────────────────");
  {
    const A = id(4);
    const amount = unit(40);
    await acceptArbitrationTerms(vault, buyer, contractor, A, USDC, amount, 1, hre.ethers.ZeroAddress, reviewConfig, recordTerms);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record(
      "deposit",
      await (
        await vault.connect(buyer).deposit(A, contractor.address, USDC, amount, 1, hre.ethers.ZeroAddress)
      ).wait()
    );

    console.log("    warping past the deadline with nothing delivered");
    await warp(3600 + 60);

    let refused = false;
    let reason = "";
    try {
      await vault.connect(contractor).markDelivered(A, "ipfs://nothing-was-delivered");
    } catch (error) {
      refused = true;
      reason = error.shortMessage || error.message;
    }
    console.log(`      ${refused ? "OK  " : "FAIL"} late delivery refused: ${reason}`);
    if (!refused) {
      throw new Error(
        "CRITICAL: a post-deadline delivery claim was accepted. The lockup bug is present."
      );
    }

    const agr = await vault.getAgreement(A);
    check("state is still Funded", STATE[Number(agr.state)], "Funded");

    const bBefore = await token.balanceOf(buyer.address);
    record("refundBuyer", await (await vault.connect(buyer).refundBuyer(A)).wait());
    check("buyer still got their money", (await token.balanceOf(buyer.address)) - bBefore, agr.totalAmount);
    check("vault retains no dust", await token.balanceOf(vaultAddress), 0n);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n─── ALL FOUR LIFECYCLES PASSED ─────────────────────────────");
  check("vault is fully drained", await token.balanceOf(vaultAddress), 0n);

  const totalGas = receipts.reduce((a, r) => a + BigInt(r.gas), 0n);
  console.log(`\n${receipts.length} transactions, ${totalGas} gas total`);

  if (!isFork) {
    console.log("\nExplorer links:");
    for (const r of receipts) console.log(`  ${r.label.padEnd(22)} ${EXPLORER}/tx/${r.hash}`);

    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `lifecycle-${net}-${Date.now()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ network: net, vault: vaultAddress, token: USDC, receipts, totalGas: totalGas.toString() }, null, 2)
    );
    console.log(`\nReceipts written to deployments/${path.basename(file)}`);
  }
}

main().catch((error) => {
  console.error("\nLIFECYCLE FAILED:", error.message);
  process.exitCode = 1;
});
