// Arc Testnet — SivanClaimVault v1 deposit-B refund script.
//
// PURPOSE: Close the final evidence gap from the funded lifecycle run
// (2026-10-21). Deposit B was made during that run and is held in
// the live vault. Its 7-day window expires 2026-10-28T16:38:11Z.
// After that timestamp, the original sender calls refund(depositId).
//
// WHEN TO RUN: After 2026-10-28T16:38:11Z (UTC).
// USAGE:   node -r dotenv/config scripts/arc-claim-refund.js
// REQUIRES: .env.testnet loaded (ARC_TESTNET_RPC_URL, ARC_TESTNET_LIFECYCLE_SENDER_KEY).
//
// WHAT IT CHECKS:
//   1. Current block timestamp >= expiresAt (gate: will not attempt early).
//   2. Deposit B status is 1 (Active) before refund.
//   3. Records sender USDC balance before and after.
//   4. Calls refund(depositIdB) from the original sender wallet.
//   5. Asserts: deposit status == 3 (Refunded), sender gained exactly netAmount,
//      vault locked() decreased by exactly netAmount.
//   6. Prints a complete evidence summary for the gap report.
//
// DO NOT re-run after a successful refund — deposit B will be status 3 (Refunded)
// and the refund call will revert with NotActive.

"use strict";
const { ethers } = require("ethers");

// ── Live constants from the 2026-10-21 lifecycle run ─────────────────────────
const VAULT_ADDRESS  = "0x8BD6d2666E350932A82098399BF89dB3eC66233A";
const USDC_ADDRESS   = "0x3600000000000000000000000000000000000000";
const DEPOSIT_ID_B   = "0x018f6f38f053645e1e65b759f9c48ac594eb8bc911444a2dbbfbfac38c565022";
const EXPIRES_AT_B   = 1761662291n; // Unix timestamp: 2026-10-28T16:38:11Z
const CHAIN_ID       = 5042002n;

const VAULT_ABI = [
  "function refund(bytes32 depositId) external",
  "function deposits(bytes32) view returns (address sender, address token, address claimSigner, uint256 netAmount, uint256 expiresAt, uint8 status)",
  "function locked(address) view returns (uint256)",
  "event ClaimVaultRefunded(bytes32 indexed depositId, address indexed sender, uint256 amount)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function fmt(v, dec) { return (Number(v) / 10 ** dec).toFixed(dec) + " USDC"; }
function log(msg, obj) {
  const ts = new Date().toISOString();
  if (obj !== undefined)
    console.log(`[${ts}] ${msg}`, JSON.stringify(obj, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
  else
    console.log(`[${ts}] ${msg}`);
}

async function main() {
  const RPC_URL    = process.env.ARC_TESTNET_RPC_URL;
  const SENDER_KEY = process.env.ARC_TESTNET_LIFECYCLE_SENDER_KEY;
  if (!RPC_URL)    throw new Error("ARC_TESTNET_RPC_URL not set");
  if (!SENDER_KEY) throw new Error("ARC_TESTNET_LIFECYCLE_SENDER_KEY not set");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID)
    throw new Error(`Chain ID mismatch: got ${net.chainId}, expected ${CHAIN_ID}`);

  const sender = new ethers.Wallet(SENDER_KEY, provider);
  const vault  = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, sender);
  const usdc   = new ethers.Contract(USDC_ADDRESS,  ERC20_ABI, provider);
  const dec    = Number(await usdc.decimals());

  log("Connected", { chainId: net.chainId.toString(), vault: VAULT_ADDRESS, block: await provider.getBlockNumber() });

  // ── Gate: check deposit state ─────────────────────────────────────────────
  const dep = await vault.deposits(DEPOSIT_ID_B);
  const { sender: depSender, netAmount, expiresAt, status } = dep;
  log("Deposit B on-chain state", {
    depositId: DEPOSIT_ID_B, status: status.toString(),
    net: fmt(netAmount, dec), expiresAt: new Date(Number(expiresAt) * 1000).toISOString(),
    sender: depSender,
  });
  if (status !== 1n) {
    if (status === 3n) {
      log("Deposit B already refunded (status=3). Evidence already captured; nothing to do.");
      provider.destroy(); return;
    }
    if (status === 2n) throw new Error("Deposit B was claimed (status=2) — unexpected for this deposit");
    throw new Error(`Unexpected deposit status: ${status}`);
  }
  if (sender.address.toLowerCase() !== depSender.toLowerCase())
    throw new Error(`Sender mismatch: key is ${sender.address}, deposit sender is ${depSender}`);

  // ── Gate: time check ──────────────────────────────────────────────────────
  const block = await provider.getBlock("latest");
  const nowTs = BigInt(block.timestamp);
  if (nowTs < expiresAt) {
    const waitSec = Number(expiresAt - nowTs);
    const waitHr  = (waitSec / 3600).toFixed(1);
    throw new Error(`Refund window not open yet. Current block timestamp: ${nowTs} (${new Date(Number(nowTs)*1000).toISOString()}). ` +
      `Refund available after: ${new Date(Number(expiresAt)*1000).toISOString()} (${waitHr}h from now). ` +
      `Do not re-run until after that time.`);
  }
  log("Refund window is open", {
    blockTimestamp: new Date(Number(nowTs) * 1000).toISOString(),
    expiresAt: new Date(Number(expiresAt) * 1000).toISOString(),
  });

  // ── Snapshots before ─────────────────────────────────────────────────────
  const [senderBefore, vaultBefore, lockedBefore] = await Promise.all([
    usdc.balanceOf(sender.address),
    usdc.balanceOf(VAULT_ADDRESS),
    vault.locked(USDC_ADDRESS),
  ]);
  log("Balances before refund", {
    sender: fmt(senderBefore, dec), vault: fmt(vaultBefore, dec), locked: fmt(lockedBefore, dec),
  });

  // ── Refund ────────────────────────────────────────────────────────────────
  log(`Calling refund(${DEPOSIT_ID_B}) from ${sender.address}...`);
  const refundTx = await vault.refund(DEPOSIT_ID_B);
  const receipt  = await refundTx.wait(2);
  const refundLog = receipt.logs.find(l => {
    try { return vault.interface.parseLog(l)?.name === "ClaimVaultRefunded"; } catch { return false; }
  });
  const refundParsed = refundLog ? vault.interface.parseLog(refundLog) : null;

  log("Refund confirmed", {
    tx: receipt.hash, block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    refundedAmount: refundParsed ? fmt(refundParsed.args.amount, dec) : "parse-failed",
  });

  // ── Snapshots after ───────────────────────────────────────────────────────
  const [senderAfter, vaultAfter, lockedAfter, depAfter] = await Promise.all([
    usdc.balanceOf(sender.address),
    usdc.balanceOf(VAULT_ADDRESS),
    vault.locked(USDC_ADDRESS),
    vault.deposits(DEPOSIT_ID_B),
  ]);

  // ── Assertions ────────────────────────────────────────────────────────────
  const senderGain  = senderAfter  - senderBefore;
  const vaultLoss   = vaultBefore  - vaultAfter;
  const lockedDelta = lockedBefore - lockedAfter;

  const errors = [];
  if (depAfter.status !== 3n)           errors.push(`status != 3 (Refunded): got ${depAfter.status}`);
  if (senderGain !== netAmount)         errors.push(`sender gain ${senderGain} != net ${netAmount}`);
  if (vaultLoss !== netAmount)          errors.push(`vault loss ${vaultLoss} != net ${netAmount}`);
  if (lockedDelta !== netAmount)        errors.push(`locked delta ${lockedDelta} != net ${netAmount}`);
  if (errors.length) throw new Error("Accounting assertions FAILED:\n" + errors.join("\n"));

  log("Accounting assertions PASSED");

  // ── Evidence summary ──────────────────────────────────────────────────────
  log("=== REFUND EVIDENCE SUMMARY ===", {
    chain: "Arc Testnet", chainId: CHAIN_ID.toString(),
    vault: VAULT_ADDRESS, block: receipt.blockNumber,
    depositId: DEPOSIT_ID_B,
    refundTx: receipt.hash,
    netRefunded: fmt(netAmount, dec),
    senderGained: fmt(senderGain, dec),
    vaultBalanceDelta: `-${fmt(vaultLoss, dec)}`,
    lockedDelta: `-${fmt(lockedDelta, dec)}`,
    depositStatusAfter: "3 (Refunded)",
    feePaidAtDeposit: "0.010000 USDC (non-refundable, remained in treasury)",
    allAssertionsPassed: true,
    note: "This closes the final evidence gap from the 2026-10-21 lifecycle run.",
  });

  provider.destroy();
}

main().catch(e => {
  console.error("REFUND FAILED:", e.message);
  process.exitCode = 1;
});
