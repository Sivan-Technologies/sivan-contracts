const { isHexString } = require("ethers");

async function assertSepolia(networkName, provider) {
  if (networkName !== "celoSepolia") throw new Error("Lifecycle transactions require celoSepolia; mainnet and other networks are forbidden.");
  if ((await provider.getNetwork()).chainId !== 11142220n) {
    throw new Error("RPC chain ID must be 11142220. No transactions were started.");
  }
}

async function recoveryContext(vault, id, signers, provider) {
  if (!isHexString(id, 32)) throw new Error("RESUME must be a 32-byte agreement ID.");
  const agreement = await vault.getAgreement(id);
  const state = Number(agreement.state);
  if (state === 0) throw new Error("Recovery agreement does not exist.");
  if (state === 4) return { agreement, complete: true };
  if (![1, 2].includes(state)) throw new Error("Agreement is not eligible for ordinary refund; do not start a new purchase.");
  const buyer = signers.find(s => s.address.toLowerCase() === agreement.buyer.toLowerCase());
  if (!buyer) throw new Error("Configure the existing agreement buyer's signing key to recover it.");
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  if (now <= agreement.refundUnlockAt) throw new Error(`Refund is not unlocked; retry after timestamp ${agreement.refundUnlockAt}.`);
  if (await provider.getBalance(buyer.address) === 0n) throw new Error("Buyer needs test CELO for refund gas.");
  // Simulate the exact refund before broadcasting. No token balance, current
  // allowlist, contractor, attester or owner credentials are needed to exit.
  await vault.connect(buyer).refundBuyer.staticCall(id);
  return { agreement, buyer, complete: false };
}

async function assertActors(vault, deployer, buyer, contractor) {
  if (!deployer || !buyer || !contractor) throw new Error("Configure deployer, BUYER_PRIVATE_KEY and CONTRACTOR_PRIVATE_KEY for a new lifecycle.");
  if (new Set([deployer, buyer, contractor].map(s => s.address.toLowerCase())).size !== 3) {
    throw new Error("Deployer, buyer and contractor must be distinct test wallets.");
  }
  if ((await vault.owner()).toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("Configured deployer is not the vault owner; arbitration test would fail. No purchase started.");
  }
}

module.exports = { assertSepolia, recoveryContext, assertActors };
