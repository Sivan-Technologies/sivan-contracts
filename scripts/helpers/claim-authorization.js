const { getAddress, ZeroAddress } = require('ethers');

// Typed-data builder only. Does not handle URLs, log secrets, relay, or send funds.
function claimAuthorization({ chainId, vault, depositId, recipient, deadline }) {
  if (BigInt(chainId) <= 0n || BigInt(deadline) <= 0n) throw new Error('Invalid chain or deadline');
  if (!/^0x[0-9a-fA-F]{64}$/.test(depositId)) throw new Error('Invalid deposit ID');
  vault = getAddress(vault);
  recipient = getAddress(recipient);
  if (vault === ZeroAddress || recipient === ZeroAddress || recipient === vault) throw new Error('Invalid destination');
  return {
    domain: { name: 'SivanClaimVault', version: '1', chainId: BigInt(chainId), verifyingContract: vault },
    types: { Claim: [
      { name: 'depositId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ] },
    value: { depositId, recipient, deadline: BigInt(deadline) },
  };
}
module.exports = { claimAuthorization };
