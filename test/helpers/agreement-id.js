const { ethers } = require("ethers");
const { agreementId } = require("../../scripts/helpers/agreement-id");
// Public Hardhat fixture address: every legacy JS fixture uses signer 1 as buyer.
// Tests with another buyer must pass that buyer explicitly.
function testAgreementId(label, buyer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8") {
  return agreementId(buyer, ethers.dataSlice(ethers.id(label), 0, 12));
}
module.exports = { testAgreementId };
