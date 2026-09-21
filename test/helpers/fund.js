const { ethers } = require("hardhat");

// Existing lifecycle tests use explicit bilateral standard-review terms.
// Dedicated arbitration tests exercise missing, changed and rejected terms directly.
async function fund(vault, id, contractor, token, amount, deadlineHours, partner) {
  const buyer = await vault.runner.getAddress();
  const independent = (await ethers.getSigners())[9];
  const fundingHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint256", "address"], [token, amount, deadlineHours, partner]
  ));
  await vault.proposeArbitrationTerms(id, contractor, independent.address, 3 * 86400,
    fundingHash, (await ethers.provider.getBlock("latest")).timestamp + 3600);
  const hash = await vault.arbitrationTermsHash(buyer, id);
  await vault.connect(await ethers.getSigner(contractor)).acceptArbitrationTerms(buyer, id, hash, true);
  return vault.deposit(id, contractor, token, amount, deadlineHours, partner);
}

module.exports = { fund };
