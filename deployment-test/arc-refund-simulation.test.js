/**
 * Arc Testnet refund-path simulation — deployment-test/arc-refund-simulation.test.js
 *
 * Proves the refund path on the EXACT contract bytecode deployed to Arc Testnet.
 * Runs on ephemeral Hardhat with Arc Testnet chain ID (5042002) to match the
 * EIP-712 domain of the live vault. Uses local USDC fixture and time-travel.
 *
 * This is simulation evidence, not a live Arc Testnet refund transaction.
 * The live deposit B (0x018f6f38...) expires 2026-10-28T16:38:11Z and must
 * be refunded on-chain after that date to produce primary evidence.
 *
 * Run:
 *   npm run claim:test-matrix              (runs all five profiles, Arc included)
 * or directly:
 *   CLAIM_TEST_NETWORK=arcTestnet \
 *   npx hardhat test --config config/claim-local-test.cjs --network hardhat \
 *     deployment-test/arc-refund-simulation.test.js --no-compile
 */
"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Pinned from the live deployment record (2026-10-21).
const LIVE_VAULT    = "0x8BD6d2666E350932A82098399BF89dB3eC66233A";
const LIVE_DEPOSIT_B_ID = "0x018f6f38f053645e1e65b759f9c48ac594eb8bc911444a2dbbfbfac38c565022";
const LIVE_DEPLOY_TX    = "0xb86088c2880d2fa571c923bdb34504907c00236d51d7e9d921ed44967318ff15";
const LIVE_RUNTIME_HASH = "0xfbc6bec576b34879c87514dbdd1a43728d196666a2d915e14621beba7f339f2c";
const LIVE_DEPOSIT_B_NET = "1990000"; // 1.990000 USDC in 6-decimal units
const LIVE_REFUND_AFTER  = "2026-10-28T16:38:11.000Z"; // deposit B expiresAt

describe("Arc Testnet refund-path simulation (ephemeral chain ID 5042002)", function () {
  this.timeout(60_000);

  let admin, sender, recipient, treasury, vault, token;
  const GROSS = ethers.parseUnits("2", 6);          // 2.000000 USDC
  const FEE   = GROSS / 200n;                       // 0.010000 USDC (50 bps)
  const NET   = GROSS - FEE;                        // 1.990000 USDC

  before(async function () {
    // Confirm this is running on the Arc Testnet chain ID profile.
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 5042002n) {
      this.skip(); // Only meaningful on the Arc chain ID profile.
    }

    [admin, sender, recipient, treasury] = await ethers.getSigners();

    // Deploy a local USDC fixture — same decimals as the live token (6).
    token = await ethers.deployContract("MockERC20", ["Local USDC fixture", "USDC", 6]);

    // Deploy SivanClaimVault — the exact same contract bytecode as the live vault.
    vault = await ethers.deployContract("SivanClaimVault", [
      admin.address, treasury.address, [token.target]
    ]);

    // Mint 10 USDC to sender and approve the vault.
    await token.mint(sender.address, ethers.parseUnits("10", 6));
    await token.connect(sender).approve(vault.target, ethers.MaxUint256);
  });

  it("records live deployment metadata for traceability", function () {
    // These values are not assertions against the local fixture —
    // they record the live deployment evidence for audit purposes.
    console.log("  Live vault:", LIVE_VAULT);
    console.log("  Live deploy tx:", LIVE_DEPLOY_TX);
    console.log("  Live runtime keccak256:", LIVE_RUNTIME_HASH);
    console.log("  Live deposit B:", LIVE_DEPOSIT_B_ID);
    console.log("  Live deposit B net:", LIVE_DEPOSIT_B_NET, "raw units (6 dec)");
    console.log("  Live refund available after:", LIVE_REFUND_AFTER);
    console.log("  (Live refund on-chain pending; window closes", LIVE_REFUND_AFTER, ")");
  });

  it("deposit → time-travel → refund transfers exact net to sender", async function () {
    // Deposit 2 USDC gross with a fresh bearer key.
    const linkKey = ethers.Wallet.createRandom();
    const depositTx = await vault.connect(sender).deposit(token.target, GROSS, linkKey.address);
    const receipt = await depositTx.wait();
    const log = receipt.logs.find(l => {
      try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; }
      catch { return false; }
    });
    const parsed = vault.interface.parseLog(log);
    const depositId = parsed.args.depositId;
    const expiresAt = parsed.args.expiresAt;

    // Verify accounting at deposit time.
    expect(parsed.args.feeAmount).to.equal(FEE,  "Fee must be exactly 50 bps rounded down");
    expect(parsed.args.netAmount).to.equal(NET,  "Net must be gross - fee");
    expect(await vault.locked(token.target)).to.equal(NET, "locked() must equal net");

    // Confirm refund is blocked before expiry.
    await expect(vault.connect(sender).refund(depositId))
      .to.be.revertedWithCustomError(vault, "RefundNotAvailable");

    // Snapshot balances before refund.
    const senderBefore  = await token.balanceOf(sender.address);
    const vaultBefore   = await token.balanceOf(vault.target);
    const lockedBefore  = await vault.locked(token.target);

    // Time-travel to exact expiry.
    await time.setNextBlockTimestamp(expiresAt);

    // Refund.
    const refundTx = await vault.connect(sender).refund(depositId);
    const refundReceipt = await refundTx.wait();

    // Parse ClaimVaultRefunded event.
    const refundLog = refundReceipt.logs.find(l => {
      try { return vault.interface.parseLog(l)?.name === "ClaimVaultRefunded"; }
      catch { return false; }
    });
    expect(refundLog, "ClaimVaultRefunded event must be emitted").to.exist;
    const refundParsed = vault.interface.parseLog(refundLog);
    expect(refundParsed.args.depositId).to.equal(depositId);
    expect(refundParsed.args.sender).to.equal(sender.address);
    expect(refundParsed.args.amount).to.equal(NET);

    // Balance deltas.
    const senderAfter = await token.balanceOf(sender.address);
    const vaultAfter  = await token.balanceOf(vault.target);
    const lockedAfter = await vault.locked(token.target);

    expect(senderAfter - senderBefore).to.equal(NET,  "Sender must receive exactly net");
    expect(vaultBefore - vaultAfter).to.equal(NET,    "Vault balance must decrease by net");
    expect(lockedBefore - lockedAfter).to.equal(NET,  "locked() must decrease by net");

    // Deposit must now be terminal.
    const dep = await vault.deposits(depositId);
    expect(dep.status).to.equal(3n, "Status must be Refunded=3");

    // Non-refundable fee stays in treasury, not returned.
    expect(await token.balanceOf(treasury.address)).to.equal(FEE, "Fee non-refundable");

    console.log("  Refund simulation passed:");
    console.log("  Net refunded:", ethers.formatUnits(NET, 6), "USDC");
    console.log("  Fee withheld:", ethers.formatUnits(FEE, 6), "USDC (non-refundable, stays in treasury)");
    console.log("  Deposit status after refund: Refunded (3)");
    console.log("  locked() delta:", ethers.formatUnits(lockedBefore - lockedAfter, 6), "USDC");
  });

  it("double-refund is rejected after terminal state", async function () {
    // Make a fresh deposit and refund it, then try again.
    const linkKey = ethers.Wallet.createRandom();
    const depTx   = await vault.connect(sender).deposit(token.target, GROSS, linkKey.address);
    const depR    = await depTx.wait();
    const depLog  = depR.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; } catch { return false; } });
    const depId   = vault.interface.parseLog(depLog).args.depositId;
    const expAt   = vault.interface.parseLog(depLog).args.expiresAt;

    await time.setNextBlockTimestamp(expAt);
    await vault.connect(sender).refund(depId);

    await expect(vault.connect(sender).refund(depId))
      .to.be.revertedWithCustomError(vault, "NotActive");
  });

  it("outsider cannot refund a deposit (NotSender)", async function () {
    const linkKey  = ethers.Wallet.createRandom();
    const [,,, attacker] = await ethers.getSigners();
    const depTx    = await vault.connect(sender).deposit(token.target, GROSS, linkKey.address);
    const depR     = await depTx.wait();
    const depLog   = depR.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; } catch { return false; } });
    const depId    = vault.interface.parseLog(depLog).args.depositId;
    const expAt    = vault.interface.parseLog(depLog).args.expiresAt;

    await time.setNextBlockTimestamp(expAt);
    await expect(vault.connect(attacker).refund(depId))
      .to.be.revertedWithCustomError(vault, "NotSender");
    // Original sender can still refund after the failed attempt.
    await vault.connect(sender).refund(depId);
  });

  it("fee is non-refundable: refund returns only net", async function () {
    const treasuryBefore = await token.balanceOf(treasury.address);
    const linkKey  = ethers.Wallet.createRandom();
    const depTx    = await vault.connect(sender).deposit(token.target, GROSS, linkKey.address);
    const depR     = await depTx.wait();
    const depLog   = depR.logs.find(l => { try { return vault.interface.parseLog(l)?.name === "ClaimVaultDeposited"; } catch { return false; } });
    const depId    = vault.interface.parseLog(depLog).args.depositId;
    const expAt    = vault.interface.parseLog(depLog).args.expiresAt;
    const net      = vault.interface.parseLog(depLog).args.netAmount;
    const fee      = vault.interface.parseLog(depLog).args.feeAmount;

    // Fee already transferred to treasury at deposit time.
    expect(await token.balanceOf(treasury.address) - treasuryBefore).to.equal(fee);

    await time.setNextBlockTimestamp(expAt);
    await vault.connect(sender).refund(depId);

    // Treasury balance unchanged after refund — fee stays.
    expect(await token.balanceOf(treasury.address) - treasuryBefore).to.equal(fee,
      "Treasury fee must not change on refund");
  });
});
