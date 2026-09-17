const hre = require("hardhat");

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

const EXPLORER = "https://celo-sepolia.blockscout.com";
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const STATE = ["Uninitialized", "Funded", "Delivered", "Released", "Refunded", "Disputed"];

const receipts = [];
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
  if (net === "hardhat" || net === "localhost" || net.endsWith("fork")) {
    throw new Error(
      `This script is for a LIVE testnet. On a fork use lifecycle.js, which ` +
        `covers all four scenarios.`
    );
  }

  const provider = hre.ethers.provider;
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

  /**
   * THE SIGNER CHECK THAT USED TO BE MISSING.
   *
   * hardhat.config.cjs puts a single key in `accounts`, so getSigners()
   * returns one address. lifecycle.js assumed three and failed after it had
   * already started spending.
   */
  if (signers.length < 3) {
    throw new Error(
      `This flow needs three distinct funded keys and ${signers.length} is configured.\n` +
        "  The deployer alone cannot play buyer and contractor: deposit()\n" +
        "  rejects an agreement where the contractor is the buyer.\n\n" +
        "  Add to .env:\n" +
        "    BUYER_PRIVATE_KEY=0x...\n" +
        "    CONTRACTOR_PRIVATE_KEY=0x...\n" +
        "  and include them in the celoSepolia accounts array."
    );
  }

  const [deployer, buyer, contractor] = signers;
  const onChainAttester = await vault.agentAttester();
  const attesterSigner = signers.find(
    (s) => s.address.toLowerCase() === onChainAttester.toLowerCase()
  );
  if (!attesterSigner) {
    throw new Error(
      `The vault's attester is ${onChainAttester} and no configured key matches.\n` +
        "  Without it a delivered agreement can never be released. Add the key,\n" +
        "  or call setAgentAttester() to an address you control.\n" +
        "  Verify separately with scripts/check-attester.js."
    );
  }

  const usdcAddress = process.env.LIFECYCLE_TOKEN || "0x01C5C0122039549AD1493B8220cABEdD739BC44E";
  const token = new hre.ethers.Contract(usdcAddress, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  const unit = (n) => hre.ethers.parseUnits(String(n), decimals);
  const fmt = (v) => hre.ethers.formatUnits(v, decimals);

  if (!(await vault.tokenAllowlistEnforced())) {
    throw new Error("Vault is not initialised: no tokens listed. Seed the allowlist first.");
  }
  if (!(await vault.supportedTokens(usdcAddress))) {
    throw new Error(`${symbol} at ${usdcAddress} is not on this vault's allowlist.`);
  }

  const needed = unit(60);
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

  // ── RESUME: finish a timeout agreement opened by an earlier run ─────
  if (process.env.RESUME) {
    const A = process.env.RESUME;
    const agr = await vault.getAgreement(A);
    console.log("RESUMING", A);
    console.log(`  state=${STATE[Number(agr.state)]} unlockAt=${agr.refundUnlockAt}`);

    if (Number(agr.state) === 4) {
      console.log("  already refunded, nothing to do.");
      return;
    }
    const now = (await provider.getBlock("latest")).timestamp;
    if (now <= Number(agr.refundUnlockAt)) {
      const left = Number(agr.refundUnlockAt) - now;
      throw new Error(
        `Not unlocked yet. ${Math.ceil(left / 60)} minutes remain ` +
          `(unlocks at ${new Date(Number(agr.refundUnlockAt) * 1000).toISOString()}).`
      );
    }

    const before = await token.balanceOf(buyer.address);
    record("refundBuyer", await (await vault.connect(buyer).refundBuyer(A)).wait());
    check("buyer refunded in full", (await token.balanceOf(buyer.address)) - before, agr.totalAmount);
    check("state is Refunded", STATE[Number((await vault.getAgreement(A)).state)], "Refunded");
    console.log(`\n  ${EXPLORER}/tx/${receipts[receipts.length - 1].hash}`);
    return;
  }

  const stamp = Date.now();
  const id = (n) => hre.ethers.id(`sivan-live-${stamp}-${n}`);

  // ── 1. Happy path, completes in one sitting ─────────────────────────
  console.log("─── 1. deposit, deliver, release ───────────────────────────");
  {
    const A = id(1);
    const amount = unit(10);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record("deposit", await (await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 48, hre.ethers.ZeroAddress)).wait());

    let agr = await vault.getAgreement(A);
    console.log(`    total=${fmt(agr.totalAmount)} fee=${fmt(agr.feeAmount)} net=${fmt(agr.netAmount)}`);

    const proof = `ipfs://sivan-live-${stamp}`;
    record("markDelivered", await (await vault.connect(contractor).markDelivered(A, proof)).wait());
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
    record("releasePayment", await (await vault
      .connect(buyer).releasePayment(A, "0x", attestation, 0)).wait());

    check("contractor received net", (await token.balanceOf(contractor.address)) - cBefore, agr.netAmount);
    check("fee collector received fee", (await token.balanceOf(feeCollector)) - fBefore, agr.feeAmount);
    check("state is Released", STATE[Number((await vault.getAgreement(A)).state)], "Released");
  }

  // ── 2. Dispute and arbitration, completes in one sitting ────────────
  console.log("\n─── 2. dispute, owner resolves to the buyer ────────────────");
  {
    const A = id(2);
    const amount = unit(10);

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    record("deposit", await (await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 48, hre.ethers.ZeroAddress)).wait());
    record("raiseDispute", await (await vault
      .connect(buyer).raiseDispute(A, "live lifecycle test")).wait());

    const agr = await vault.getAgreement(A);
    check("state is Disputed", STATE[Number(agr.state)], "Disputed");

    const bBefore = await token.balanceOf(buyer.address);
    const fBefore = await token.balanceOf(feeCollector);
    record("resolveDispute", await (await vault
      .connect(deployer).resolveDispute(A, false, "test resolution")).wait());

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

    record("approve", await (await token.connect(buyer).approve(vaultAddress, amount)).wait());
    // One hour is the contract's minimum deadline, so this is the shortest
    // real wait possible rather than an arbitrary choice.
    record("deposit", await (await vault
      .connect(buyer)
      .deposit(A, contractor.address, usdcAddress, amount, 1, hre.ethers.ZeroAddress)).wait());

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
  for (const r of receipts) console.log(`  ${r.label.padEnd(16)} ${EXPLORER}/tx/${r.hash}`);

  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
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
