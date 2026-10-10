const { ethers, network } = require('hardhat');
const assert = require('node:assert/strict');
const { claimAuthorization } = require('./helpers/claim-authorization');

// Intentionally no public-network deployment support. No production key or URL.
async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (network.name !== 'hardhat' || chainId !== 31337n) {
    throw new Error('Claim lifecycle only runs on the ephemeral Hardhat network');
  }
  const [admin, sender, recipient, treasury, relayer] = await ethers.getSigners();
  const token = await ethers.deployContract('MockERC20', ['Local USDC fixture', 'USDC', 6]);
  const vault = await ethers.deployContract('SivanClaimVault', [admin.address, treasury.address, [token.target]]);
  await (await token.mint(sender.address, 40_000_000n)).wait();
  await (await token.connect(sender).approve(vault.target, 40_000_000n)).wait();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const key = ethers.Wallet.createRandom();
    const id = await vault.deriveDepositId(sender.address, i);
    const receipt = await (await vault.connect(sender).deposit(token.target, 20_000_000n, key.address)).wait();
    assert.equal(receipt.status, 1);
    ids.push(id);
    if (i === 0) {
      const item = await vault.deposits(id);
      const auth = claimAuthorization({ chainId, vault: vault.target, depositId: id,
        recipient: recipient.address, deadline: item.expiresAt });
      const signature = await key.signTypedData(auth.domain, auth.types, auth.value);
      await (await vault.connect(relayer).claim(id, recipient.address, item.expiresAt, signature)).wait();
    }
  }
  const pending = await vault.deposits(ids[1]);
  await network.provider.send('evm_setNextBlockTimestamp', [Number(pending.expiresAt)]);
  await (await vault.connect(sender).refund(ids[1])).wait();
  assert.equal((await vault.deposits(ids[0])).status, 2n);
  assert.equal((await vault.deposits(ids[1])).status, 3n);
  assert.equal(await token.balanceOf(recipient.address), 19_900_000n);
  assert.equal(await token.balanceOf(sender.address), 19_900_000n);
  assert.equal(await token.balanceOf(treasury.address), 200_000n);
  assert.equal(await vault.locked(token.target), 0n);
  assert.equal(await token.balanceOf(vault.target), 0n);
  console.log('LOCAL ONLY: deployment → approval → two deposits → relayed claim / expired refund verified.');
  console.log('No public deployment, frontend, backend or issuer-token integration was exercised.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
