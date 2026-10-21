// Arc Testnet funded lifecycle test for SivanClaimVault v1.
// Exercises: deposit (fee check), relayed claim (exact delta), replay rejection,
// second deposit, expired-refund path wait note.
// This script does NOT time-travel. The 7-day refund window is a real wait.
// A second deposit is made; its refund availability is recorded with timestamp.
//
// Usage: node -r dotenv/config scripts/arc-claim-lifecycle.js
// Requires .env.testnet with ARC_TESTNET_* and LIFECYCLE_SENDER_KEY set.

"use strict";
const { ethers } = require("ethers");

const VAULT_ADDRESS = "0x8BD6d2666E350932A82098399BF89dB3eC66233A";
const USDC_ADDRESS  = "0x3600000000000000000000000000000000000000";
const RPC_URL       = process.env.ARC_TESTNET_RPC_URL;
const SENDER_KEY    = process.env.ARC_TESTNET_LIFECYCLE_SENDER_KEY;
const CHAIN_ID      = 5042002n;

const VAULT_ABI = [
  "function deposit(address token, uint256 grossAmount, address claimSigner) external returns (bytes32)",
  "function claim(bytes32 depositId, address recipient, uint256 deadline, bytes calldata signature) external",
  "function refund(bytes32 depositId) external",
  "function claimDigest(bytes32 depositId, address recipient, uint256 deadline) view returns (bytes32)",
  "function deposits(bytes32) view returns (address sender, address token, address claimSigner, uint256 netAmount, uint256 expiresAt, uint8 status)",
  "function locked(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function FEE_BPS() view returns (uint256)",
  "function CLAIM_WINDOW() view returns (uint256)",
  "function treasury() view returns (address)",
  "event ClaimVaultDeposited(bytes32 indexed depositId, address indexed sender, address indexed token, address claimSigner, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, uint256 expiresAt)",
  "event ClaimVaultClaimed(bytes32 indexed depositId, address indexed recipient, uint256 amount)",
  "event ClaimVaultRefunded(bytes32 indexed depositId, address indexed sender, uint256 amount)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function fmt(v, dec) { return (Number(v) / 10**dec).toFixed(dec) + " USDC"; }
function log(msg, obj) {
  const ts = new Date().toISOString();
  if (obj !== undefined) console.log(`[${ts}] ${msg}`, JSON.stringify(obj, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
  else console.log(`[${ts}] ${msg}`);
}

async function main() {
  if (!RPC_URL) throw new Error("ARC_TESTNET_RPC_URL not set");
  if (!SENDER_KEY) throw new Error("ARC_TESTNET_LIFECYCLE_SENDER_KEY not set");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`Chain ID mismatch: got ${net.chainId}, expected ${CHAIN_ID}`);
  log("Connected to Arc Testnet", { chainId: net.chainId.toString(), block: await provider.getBlockNumber() });

  const sender = new ethers.Wallet(SENDER_KEY, provider);
  const linkKey = ethers.Wallet.createRandom(); // fresh per-deposit bearer key
  const recipient = ethers.Wallet.createRandom(); // fresh recipient — no funds needed to receive

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, sender);
  const usdc  = new ethers.Contract(USDC_ADDRESS,  ERC20_ABI,  sender);
  const dec   = Number(await usdc.decimals());

  const treasury = await vault.treasury();
  log("Vault config", {
    vault: VAULT_ADDRESS, feeBps: (await vault.FEE_BPS()).toString(),
    claimWindowDays: (Number(await vault.CLAIM_WINDOW()) / 86400).toString(),
    treasury
  });

  // ── Snapshot balances before ──────────────────────────────────────────────
  const [senderBefore, treasuryBefore, vaultBefore, recipientBefore, lockedBefore] = await Promise.all([
    usdc.balanceOf(sender.address), usdc.balanceOf(treasury),
    usdc.balanceOf(VAULT_ADDRESS),  usdc.balanceOf(recipient.address),
    vault.locked(USDC_ADDRESS),
  ]);
  log("Balances before", {
    sender: fmt(senderBefore, dec), treasury: fmt(treasuryBefore, dec),
    vault: fmt(vaultBefore, dec), recipient: fmt(recipientBefore, dec),
  });

  // ── Approval ─────────────────────────────────────────────────────────────
  const grossA = ethers.parseUnits("2", dec);   // deposit A — will be claimed
  const grossB = ethers.parseUnits("2", dec);   // deposit B — records refund availability
  const totalGross = grossA + grossB;

  log("Approving USDC for vault…");
  const approveTx = await usdc.approve(VAULT_ADDRESS, totalGross);
  const approveReceipt = await approveTx.wait(2);
  log("Approval confirmed", { tx: approveReceipt.hash, block: approveReceipt.blockNumber, confirmations: await approveReceipt.confirmations() });

  // ── Deposit A ─────────────────────────────────────────────────────────────
  log(`Depositing ${fmt(grossA, dec)} (gross) with bearer key ${linkKey.address}…`);
  const depATx = await vault.deposit(USDC_ADDRESS, grossA, linkKey.address);
  const depAReceipt = await depATx.wait(2);
  const depALog = depAReceipt.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; } catch { return false; } });
  const depAParsed = vault.interface.parseLog(depALog);
  const depositIdA = depAParsed.args.depositId;
  const feeA = depAParsed.args.feeAmount;
  const netA = depAParsed.args.netAmount;
  const expiresAtA = depAParsed.args.expiresAt;
  log("Deposit A confirmed", {
    tx: depAReceipt.hash, block: depAReceipt.blockNumber,
    depositId: depositIdA, gross: fmt(grossA, dec),
    fee: fmt(feeA, dec), net: fmt(netA, dec),
    expiresAt: new Date(Number(expiresAtA) * 1000).toISOString(),
  });

  // ── Deposit B ─────────────────────────────────────────────────────────────
  const linkKeyB = ethers.Wallet.createRandom();
  log(`Depositing ${fmt(grossB, dec)} (gross) with fresh bearer key ${linkKeyB.address}…`);
  const depBTx = await vault.deposit(USDC_ADDRESS, grossB, linkKeyB.address);
  const depBReceipt = await depBTx.wait(2);
  const depBLog = depBReceipt.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; } catch { return false; } });
  const depBParsed = vault.interface.parseLog(depBLog);
  const depositIdB = depBParsed.args.depositId;
  const netB = depBParsed.args.netAmount;
  const expiresAtB = depBParsed.args.expiresAt;
  log("Deposit B confirmed", {
    tx: depBReceipt.hash, block: depBReceipt.blockNumber,
    depositId: depositIdB, net: fmt(netB, dec),
    expiresAt: new Date(Number(expiresAtB) * 1000).toISOString(),
    note: "Refund available after that timestamp (7-day window). Not simulated on a live chain.",
  });

  // ── Verify locked balance delta ───────────────────────────────────────────
  const lockedAfterDeposits = await vault.locked(USDC_ADDRESS);
  const expectedLockedDelta = netA + netB;
  if (lockedAfterDeposits - lockedBefore !== expectedLockedDelta)
    throw new Error(`locked() delta mismatch: got ${lockedAfterDeposits - lockedBefore}, expected ${expectedLockedDelta}`);
  log("locked() delta matches netA + netB", { totalLocked: fmt(lockedAfterDeposits, dec), thisBatchLocked: fmt(expectedLockedDelta, dec) });

  // ── Sign claim for A ──────────────────────────────────────────────────────
  // claimDigest() returns the EIP-712 typed-data hash (already hashed).
  // OZ ECDSA.recover() expects a signature over the raw 32-byte hash with no
  // additional prefix. Use signingKey.sign() which does NOT add the eth prefix.
  const deadline = expiresAtA;
  const digest = await vault.claimDigest(depositIdA, recipient.address, deadline);
  const rawSig = linkKey.signingKey.sign(ethers.getBytes(digest));
  const packedSig = ethers.concat([rawSig.r, rawSig.s, Uint8Array.of(rawSig.v)]);

  // ── Claim A ───────────────────────────────────────────────────────────────
  log(`Claiming deposit A to recipient ${recipient.address}…`);
  const claimTx = await vault.claim(depositIdA, recipient.address, deadline, packedSig);
  const claimReceipt = await claimTx.wait(2);
  const claimLog = claimReceipt.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultClaimed"; } catch { return false; } });
  const claimParsed = vault.interface.parseLog(claimLog);
  log("Claim A confirmed", {
    tx: claimReceipt.hash, block: claimReceipt.blockNumber,
    recipient: claimParsed.args.recipient, amount: fmt(claimParsed.args.amount, dec),
  });

  // ── Replay rejection ──────────────────────────────────────────────────────
  log("Testing replay rejection (same depositId, same sig)…");
  try {
    const replayTx = await vault.claim(depositIdA, recipient.address, deadline, packedSig);
    await replayTx.wait(1);
    throw new Error("REPLAY NOT REJECTED — contract defect");
  } catch (e) {
    if (e.message === "REPLAY NOT REJECTED — contract defect") throw e;
    log("Replay correctly rejected", { reason: e.shortMessage || e.message.slice(0, 100) });
  }

  // ── Final balance snapshot ────────────────────────────────────────────────
  const [senderAfter, treasuryAfter, vaultAfter, recipientAfter] = await Promise.all([
    usdc.balanceOf(sender.address), usdc.balanceOf(treasury),
    usdc.balanceOf(VAULT_ADDRESS),  usdc.balanceOf(recipient.address),
  ]);
  log("Balances after claim", {
    sender: fmt(senderAfter, dec), treasury: fmt(treasuryAfter, dec),
    vault: fmt(vaultAfter, dec), recipient: fmt(recipientAfter, dec),
  });

  // ── Accounting assertions ─────────────────────────────────────────────────
  const feeB = grossB / 200n;
  const expectedTreasuryGain = feeA + feeB;
  const actualTreasuryGain   = treasuryAfter - treasuryBefore;
  if (actualTreasuryGain !== expectedTreasuryGain)
    throw new Error(`Treasury gain mismatch: got ${actualTreasuryGain}, expected ${expectedTreasuryGain}`);

  const actualRecipientGain = recipientAfter - recipientBefore;
  if (actualRecipientGain !== netA)
    throw new Error(`Recipient gain mismatch: got ${actualRecipientGain}, expected ${netA}`);

  const lockedAfterClaim = await vault.locked(USDC_ADDRESS);
  const expectedLockedAfterClaim = lockedBefore + netB; // A settled, B still active
  if (lockedAfterClaim !== expectedLockedAfterClaim)
    throw new Error(`locked() after claim mismatch: got ${lockedAfterClaim}, expected ${expectedLockedAfterClaim}`);

  log("Accounting assertions PASSED", {
    treasuryGained: fmt(actualTreasuryGain, dec),
    recipientGained: fmt(actualRecipientGain, dec),
    remainingLocked: fmt(lockedAfterClaim, dec),
    note: "Deposit B (net locked) awaits 7-day refund window. Not claimable or refundable yet.",
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const block = await provider.getBlockNumber();
  log("=== LIFECYCLE EVIDENCE SUMMARY ===", {
    chain: "Arc Testnet", chainId: CHAIN_ID.toString(),
    vault: VAULT_ADDRESS, block,
    depositA: { id: depositIdA, tx: depAReceipt.hash, gross: fmt(grossA, dec), fee: fmt(feeA, dec), net: fmt(netA, dec) },
    depositB: { id: depositIdB, tx: depBReceipt.hash, gross: fmt(grossB, dec), net: fmt(netB, dec),
      refundAvailableAfter: new Date(Number(expiresAtB) * 1000).toISOString() },
    claimA: { tx: claimReceipt.hash, recipient: recipient.address, amount: fmt(netA, dec) },
    replayRejected: true,
    accountingAssertionsPassed: true,
    exactTransferGuardPassed: true,
    refundOfBNotTested: "7-day window has not elapsed; refund availability recorded above",
  });

  provider.destroy();
}

main().catch(e => { console.error("LIFECYCLE FAILED:", e.message); process.exitCode = 1; });
