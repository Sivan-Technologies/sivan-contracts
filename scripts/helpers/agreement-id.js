const { ethers } = require("ethers");
function agreementId(buyer, nonce = ethers.hexlify(ethers.randomBytes(12))) {
  if (!ethers.isAddress(buyer) || buyer === ethers.ZeroAddress || !ethers.isHexString(nonce, 12)) {
    throw new Error("Agreement ID requires a nonzero buyer and exactly 12 nonce bytes");
  }
  return ethers.hexlify(ethers.concat([ethers.getAddress(buyer), nonce]));
}
module.exports = { agreementId };
