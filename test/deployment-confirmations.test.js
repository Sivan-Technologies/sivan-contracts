const { expect } = require('chai');
const { ethers } = require('hardhat');
const { assertConfirmedReceipt, waitForConfirmedReceipt, MIN_CONFIRMATIONS } = require('../scripts/helpers/confirmations');

describe('Shared deployment confirmation and reorg policy', function () {
  async function fixture() {
    const token = await ethers.deployContract('MockERC20', ['Receipt test', 'TEST', 6]);
    const receipt = await token.deploymentTransaction().wait();
    const wrap = overrides => new Proxy(ethers.provider, { get(target, key) {
      if (key in overrides) return overrides[key];
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { receipt, wrap };
  }
  it('refuses a single confirmation and accepts the shared floor of two', async () => {
    const { receipt } = await fixture();
    await expect(assertConfirmedReceipt(ethers.provider, receipt)).rejectedWith('pending confirmations');
    await ethers.provider.send('evm_mine', []);
    const result = await assertConfirmedReceipt(ethers.provider, receipt);
    expect(result.minimumConfirmations).eq(2);
    expect(result.observedConfirmations).gte(2);
  });
  it('rejects failed, missing, orphaned and changed receipts', async () => {
    const { receipt, wrap } = await fixture();
    await ethers.provider.send('evm_mine', []);
    await expect(assertConfirmedReceipt(ethers.provider, null)).rejectedWith('Successful');
    await expect(assertConfirmedReceipt(ethers.provider, { ...receipt, status: 0 })).rejectedWith('Successful');
    await expect(assertConfirmedReceipt(ethers.provider, { ...receipt, blockNumber: undefined })).rejectedWith('Successful');
    await expect(assertConfirmedReceipt(wrap({ getBlock: async () => null }), receipt)).rejectedWith('not canonical');
    await expect(assertConfirmedReceipt(wrap({ getBlock: async () => ({ hash: ethers.ZeroHash }) }), receipt)).rejectedWith('not canonical');
    await expect(assertConfirmedReceipt(wrap({ getTransactionReceipt: async () => null }), receipt)).rejectedWith('changed during readback');
    await expect(assertConfirmedReceipt(wrap({ getTransactionReceipt: async () => ({ ...receipt, blockHash: ethers.ZeroHash }) }), receipt)).rejectedWith('changed during readback');
    await expect(assertConfirmedReceipt(wrap({ getTransactionReceipt: async () => ({ ...receipt, hash: ethers.ZeroHash }) }), receipt)).rejectedWith('changed during readback');
  });
  it('requires confirmations and a bounded wait before continuing', async () => {
    const { receipt } = await fixture();
    await ethers.provider.send('evm_mine', []);
    let args;
    const tx = { wait: async (...values) => { args = values; return receipt; } };
    expect(await waitForConfirmedReceipt(ethers.provider, tx)).eq(receipt);
    expect(args).deep.eq([MIN_CONFIRMATIONS, 180000]);
  });
  it('propagates timeouts without returning a success receipt or retrying', async () => {
    let calls = 0;
    const tx = { wait: async () => { ++calls; throw new Error('receipt timeout'); } };
    await expect(waitForConfirmedReceipt(ethers.provider, tx)).rejectedWith('receipt timeout');
    expect(calls).eq(1);
  });
});
