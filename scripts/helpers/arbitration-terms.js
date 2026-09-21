const { ethers } = require("hardhat");

async function arbitrationConfig(vault, buyer, contractor, env = process.env) {
  const independentReviewer = env.INDEPENDENT_REVIEWER;
  const hours = Number(env.PRIMARY_REVIEW_HOURS);
  if (!ethers.isAddress(independentReviewer || "") || independentReviewer === ethers.ZeroAddress)
    throw new Error("Set INDEPENDENT_REVIEWER to the agreed independent reviewer address.");
  if (![24, 72, 168].includes(hours)) throw new Error("Set PRIMARY_REVIEW_HOURS to 24, 72 or 168.");
  const excluded = [await buyer.getAddress(), await contractor.getAddress(), await vault.owner(),
    await vault.agentAttester(), await vault.feeCollector(), await vault.getAddress()];
  if (excluded.some(address => address.toLowerCase() === independentReviewer.toLowerCase()))
    throw new Error("Independent reviewer must be distinct from parties, primary reviewer, agent, fee collector and vault.");
  // An older deployed vault must fail preflight before approvals or deposits.
  await vault.arbitrationTermsHash(await buyer.getAddress(), ethers.ZeroHash);
  return { independentReviewer, primaryReviewPeriod: hours * 3600 };
}

async function acceptArbitrationTerms(vault, buyer, contractor, id, token, amount, hours, partner, config, record) {
  const fundingHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "address"], [token, amount, hours, partner]
  ));
  const now = (await vault.runner.provider.getBlock("latest")).timestamp;
  await record("propose arbitration terms", await vault.connect(buyer).proposeArbitrationTerms(
    id, await contractor.getAddress(), config.independentReviewer, config.primaryReviewPeriod, fundingHash, now + 3600
  ));
  const buyerAddress = await buyer.getAddress();
  const hash = await vault.arbitrationTermsHash(buyerAddress, id);
  await record("accept arbitration terms", await vault.connect(contractor).acceptArbitrationTerms(buyerAddress, id, hash, true));
}

module.exports = { arbitrationConfig, acceptArbitrationTerms };
