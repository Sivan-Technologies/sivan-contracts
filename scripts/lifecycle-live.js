const hre = require("hardhat");
const { arbitrationConfig, acceptArbitrationTerms } = require("./helpers/arbitration-terms");
const { assertSepolia, recoveryContext, assertActors } = require("./helpers/lifecycle-safety");
const fs = require("fs");
const path = require("path");

/**
 * LIVE TESTNET LIFECYCLE. Real chain, real USDC, real explorer links.
 *
 * WHY THIS IS SEPARATE FROM lifecycle.js.
 *
 * An audit found that lifecycle.js could not complete on Celo Sepolia: it
 * requires three signers where hardhat configures one, and its timeout
 * scenario deposits funds and then calls warp(), which deliberately throws on
 * a remote network. The deposit lands, the warp fails, and the script walks
 * away from an agreement holding money.
 *
 * Time travel is not a configuration problem. On a real chain a deadline
 * arrives when it arrives, so the honest split is:
 *
 *   lifecycle.js       fork only. All four scenarios including the two that
 *                      need to move the clock.
 *   lifecycle-live.js  this file. Only what completes in one sitting, plus a
 *                      RESUMABLE timeout test that you start now and finish
 *                      after the real deadline passes.
 *
 * EVERY PRECONDITION IS CHECKED BEFORE THE FIRST TRANSACTION. The failure mode
 * being avoided is the expensive one: discovering a missing signer or an
 * unlisted token only after funds are already committed.
 *
 *   # phase 1: deposit, deliver, release, and open a timeout agreement
 *   VAULT=0x... npx hardhat run scripts/lifecycle-live.js --network celoSepolia
 *
 *   # phase 2, after the printed deadline has passed
 *   VAULT=0x... RESUME=<agreementId> npx hardhat run scripts/lifecycle-live.js --network celoSepolia
 */

const EXPLORER = process.env.CELO_SEPOLIA_EXPLORER_URL;
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const STATE = ["Uninitialized", "Funded", "Delivered", "Released", "Refunded", "Disputed"];

const receipts = [];
let journal;
let journalFile;
function saveProgress() {
  const temporary = `${journalFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(journal, null, 2));
  fs.renameSync(temporary, journalFile);
}
async function recordTransaction(label, tx) {
  const entry = { label, hash: tx.hash, status: "submitted" };
  journal.transactions.push(entry);
  saveProgress();
  // Never retry a send. Preserve submitted hashes even when waiting fails.
  const receipt = await tx.wait();
  entry.status = receipt.status === 1 ? "confirmed" : "reverted";
  entry.blockNumber = receipt.blockNumber;
  saveProgress();
  if (receipt.status !== 1) throw new Error(`Transaction reverted: ${tx.hash}`);
  return record(label, receipt);
}
function record(label, r) {
  receipts.push({ label, hash: r.hash, gas: r.gasUsed.toString() });
  console.log(`      tx ${r.hash}  gas ${r.gasUsed}`);
  return r;
}
function check(label, actual, expected) {
  const ok = actual.toString() === expected.toString();
  console.log(`      ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) throw new Error(`${label}: got ${actual}, expected ${expected}`);
}

async function main() {
  const net = hre.network.name;
  const provider = hre.ethers.provider;
  await assertSepolia(net, provider);
  const vaultAddress = process.env.VAULT;

  // ── Preconditions, all of them, before any transaction ──────────────
  console.log("PREFLIGHT");

  if (!vaultAddress || !hre.ethers.isAddress(vaultAddress)) {
    throw new Error("Set VAULT to the deployed vault address.");
  }
  if ((await provider.getCode(vaultAddress)) === "0x") {
    throw new Error(`No contract at ${vaultAddress} on ${net}.`);
  }

  const vault = await hre.ethers.getContractAt("SivanAgreementVault", vaultAddress);
  const signers = await hre.ethers.getSigners();
  function roleSigner(variable, fallback) {
    const key = (process.env[variable] || "").trim();
    if (!key) return fallback;
    try {
      return new hre.ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
    } catch {
      throw new Error(`${variable} is not a valid private key (value withheld).`);
    }
  }
  const buyerKey = roleSigner("BUYER_PRIVATE_KEY", undefined);
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  journalFile = path.join(dir, `lifecycle-progress-${net}-${Date.now()}.json`);
  journal = { network: net, chainId: 11142220, vault: vaultAddress, agreements: [], transactions: [] };
  saveProgress(); // Check record storage is writable before sending anything.

  if (process.env.RESUME) {
    const A = process.env.RESUME;
    const recovery = await recoveryContext(vault, A, buyerKey ? [buyerKey, ...signers] : signers, provider);
    if (recovery.complete) {
      console.log("Already refunded; no transaction needed.");
      return;
    }
    const { agreement: agr, buyer } = recovery;
    const token = new hre.ethers.Contract(agr.token, ERC20_ABI, provider);
    journal.agreements.push({ id: A, buyer: agr.buyer, token: agr.token, purpose: "resume" });
    saveProgress();
    const before = await token.balanceOf(buyer.address);
    await recordTransaction("refundBuyer", await vault.connect(buyer).refundBuyer(A));
    check("buyer refunded in full", (await token.balanceOf(buyer.address)) - before, agr.totalAmount);
    check("state is Refunded", STATE[Number((await vault.getAgreement(A)).state)], "Refunded");
    return;
  }

  /**
   * THE SIGNER CHECK THAT USED TO BE MISSING.
   *
   * hardhat.config.cjs puts a single key in `accounts`, so getSigners()
   * returns one address. lifecycle.js assumed three and failed after it had
   * already started spending.
   */
  if (signers.length < 3 && !(buyerKey && process.env.CONTRACTOR_PRIVATE_KEY)) {
    throw new Error(
      `This flow needs three distinct funded keys and ${signers.length} is configured.\n` +
        "  The deployer alone cannot play buyer and contractor: deposit()\n" +
        "  rejects an agreement where the contractor is the buyer.\n\n" +
        "  Add to .env:\n" +
        "    BUYER_PRIVATE_KEY=0x...\n" +
        "    CONTRACTOR_PRIVATE_KEY=0x...\n" +
        "  These keys are loaded only by this testnet lifecycle script."
    );
  }

  const deployer = signers[0];
  const buyer = buyerKey || signers[1];
  const contractor = roleSigner("CONTRACTOR_PRIVATE_KEY", signers[2]);
  await assertActors(vault, deployer, buyer, contractor);
  const reviewConfig = await arbitrationConfig(vault, buyer, contractor);
  if (await vault.paused()) throw new Error("Vault is paused; no lifecycle started.");
  const onChainAttester = await vault.agentAttester();
  const attesterSigner = roleSigner("ATTESTER_PRIVATE_KEY", [...signers, buyer, contractor].find(
    (s) => s.address.toLowerCase() === onChainAttester.toLowerCase()
  ));
  if (!attesterSigner || attesterSigner.address.toLowerCase() !== onChainAttester.toLowerCase()) {
    throw new Error(
      `The vault's attester is ${onChainAttester} and no configured key matches.\n` +
        "  Without it a delivered agreement can never be released. Add the key,\n" +
        "  or call setAgentAttester() to an address you control.\n" +
        "  Verify separately with scripts/check-attester.js."
    );
  }

  const usdcAddress = process.env.LIFECYCLE_TOKEN || process.env.CELO_SEPOLIA_USDC;
  if (!usdcAddress || !hre.ethers.isAddress(usdcAddress)) throw new Error("Configure a valid CELO_SEPOLIA_USDC or LIFECYCLE_TOKEN address.");
  const token = new hre.ethers.Contract(usdcAddress, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  if (symbol !== "USDC" || Number(decimals) !== 6) throw new Error("Lifecycle token must report USDC with 6 decimals.");
  const unit = (n) => hre.ethers.parseUnits(String(n), decimals);
  const fmt = (v) => hre.ethers.formatUnits(v, decimals);

  if (!(await vault.tokenAllowlistEnforced())) {
    throw new Error("Vault is not initialised: no tokens listed. Seed the allowlist first.");
  }
  if (!(await vault.supportedTokens(usdcAddress))) {
    throw new Error(`${symbol} at ${usdcAddress} is not on this vault's allowlist.`);
  }

  const needed = unit(30);
  const buyerBalance = await token.balanceOf(buyer.address);
  if (buyerBalance < needed) {
    throw new Error(
      `Buyer ${buyer.address} holds ${fmt(buyerBalance)} ${symbol}, needs ${fmt(needed)}.\n` +
        "  Fund it with test USDC. This script will not fabricate balances."
    );
  }
  for (const [label, s] of [["buyer", buyer], ["contractor", contractor], ["deployer", deployer]]) {
    if ((await provider.getBalance(s.address)) === 0n) {
      throw new Error(`${label} ${s.address} has no CELO for gas.`);
    }
  }

  console.log("  vault    :", vaultAddress);
  console.log("  token    :", usdcAddress, `(${symbol}, ${decimals} dp)`);
  console.log("  buyer    :", buyer.address, `${fmt(buyerBalance)} ${symbol}`);
  console.log("  contractr:", contractor.address);
  console.log("  attester :", onChainAttester, "(key present)");
  console.log("  all preconditions satisfied\n");

  const feeCollector = await vault.feeCollector();
  if ([buyer, contractor].some(s => s.address.toLowerCase() === feeCollector.toLowerCase())) {
    throw new Error("Use a separate fee collector for unambiguous lifecycle balance checks.");
  }
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
  const id = (n) => {
    const value = hre.ethers.id(`sivan-live-${stamp}-${n}`);
    journal.agreements.push({ id: value, buyer: buyer.address, token: usdcAddress, scenario: n });
    saveProgress();
    console.log(`    agreementId: ${value}`);
    return value;
  };

  // ── 1. Happy path, completes in one sitting ─────────────────────────
  console.log("─── 1. deposit, deliver, release ───────────────────────────");
  {
    const A = id(1);
    const amount = unit(10);

    await acceptArbitrationTerms(vault, buyer, contractor, A, usdcAddress, amount, 48, hre.ethers.ZeroAddress, reviewConfig, recordTransaction);
    await recordTransaction("approve", await token.connect(buyer).approve(vaultAddress, amount));
    await recordTransaction("deposit", await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 48, hre.ethers.ZeroAddress));

    let agr = await vault.getAgreement(A);
    console.log(`    total=${fmt(agr.totalAmount)} fee=${fmt(agr.feeAmount)} net=${fmt(agr.netAmount)}`);

    const proof = `ipfs://sivan-live-${stamp}`;
    await recordTransaction("markDelivered", await vault.connect(contractor).markDelivered(A, proof));
    agr = await vault.getAgreement(A);
    check("state is Delivered", STATE[Number(agr.state)], "Delivered");

    const attestation = await attesterSigner.signTypedData(domain, attestationTypes, {
      agreementId: A,
      agentId: await vault.registeredAgentId(),
      deliverableHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(proof)),
      timestamp: agr.deadlineTimestamp,
    });

    const cBefore = await token.balanceOf(contractor.address);
    const fBefore = await token.balanceOf(feeCollector);
    await recordTransaction("releasePayment", await vault
      .connect(buyer).releasePayment(A, "0x", attestation, 0));

    check("contractor received net", (await token.balanceOf(contractor.address)) - cBefore, agr.netAmount);
    check("fee collector received fee", (await token.balanceOf(feeCollector)) - fBefore, agr.feeAmount);
    check("state is Released", STATE[Number((await vault.getAgreement(A)).state)], "Released");
  }

  // ── 2. Dispute and arbitration, completes in one sitting ────────────
  console.log("\n─── 2. dispute, owner resolves to the buyer ────────────────");
  {
    const A = id(2);
    const amount = unit(10);

    await acceptArbitrationTerms(vault, buyer, contractor, A, usdcAddress, amount, 48, hre.ethers.ZeroAddress, reviewConfig, recordTransaction);
    await recordTransaction("approve", await token.connect(buyer).approve(vaultAddress, amount));
    await recordTransaction("deposit", await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 48, hre.ethers.ZeroAddress));
    await recordTransaction("raiseDispute", await vault
      .connect(buyer).raiseDispute(A, "live lifecycle test"));

    const agr = await vault.getAgreement(A);
    check("state is Disputed", STATE[Number(agr.state)], "Disputed");

    const bBefore = await token.balanceOf(buyer.address);
    const fBefore = await token.balanceOf(feeCollector);
    await recordTransaction("resolveDispute", await vault
      .connect(deployer).resolveDispute(A, false, "test resolution"));

    check("buyer refunded in full", (await token.balanceOf(buyer.address)) - bBefore, agr.totalAmount);
    check("arbiter took NO fee", (await token.balanceOf(feeCollector)) - fBefore, 0n);
  }

  // ── 3. Timeout refund, OPENED here and resumed later ────────────────
  console.log("\n─── 3. timeout refund (resumable) ──────────────────────────");
  let resumeId;
  {
    const A = id(3);
    resumeId = A;
    const amount = unit(10);

    await acceptArbitrationTerms(vault, buyer, contractor, A, usdcAddress, amount, 1, hre.ethers.ZeroAddress, reviewConfig, recordTransaction);
    await recordTransaction("approve", await token.connect(buyer).approve(vaultAddress, amount));
    // One hour is the contract's minimum deadline, so this is the shortest
    // real wait possible rather than an arbitrary choice.
    await recordTransaction("deposit", await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 1, hre.ethers.ZeroAddress));

    const agr = await vault.getAgreement(A);
    console.log(`    agreementId : ${A}`);
    console.log(`    unlocks at  : ${new Date(Number(agr.refundUnlockAt) * 1000).toISOString()}`);
    console.log("    This cannot be completed now: the deadline is real. Re-run with");
    console.log(`      VAULT=${vaultAddress} RESUME=${A} npx hardhat run scripts/lifecycle-live.js --network ${net}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const totalGas = receipts.reduce((a, r) => a + BigInt(r.gas), 0n);
  console.log(`\n${receipts.length} transactions, ${totalGas} gas`);
  console.log("\nExplorer links:");
  for (const r of receipts) console.log(`  ${r.label.padEnd(16)} ${EXPLORER ? `${EXPLORER}/tx/` : ""}${r.hash}`);

  const file = path.join(dir, `lifecycle-live-${net}-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      { network: net, vault: vaultAddress, token: usdcAddress, receipts,
        totalGas: totalGas.toString(), pendingTimeoutAgreement: resumeId },
      null, 2
    )
  );
  console.log(`\nReceipts written to deployments/${path.basename(file)}`);
}

main().catch((error) => {
  console.error("\nLIFECYCLE FAILED:", error.message);
  process.exitCode = 1;
});
