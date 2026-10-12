const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { fund } = require('./helpers/fund');

// Desired-behavior regression tests. No public RPCs, keys or funds.
describe('Security review 2026-10-12 — signed intervals and refund events', function () {
  const DAY = 86400;
  async function setup() {
    const [owner, buyer, contractor, treasury, relayer] = await ethers.getSigners();
    const token = await ethers.deployContract('MockERC20', ['Audit fixture', 'TEST', 6]);
    const vault = await ethers.deployContract('SivanAgreementVault',
      [treasury.address, owner.address, 9827, owner.address]);
    await vault.setSupportedToken(token.target, true);
    const amount = 100_000_000n;
    await token.mint(buyer.address, amount);
    await token.connect(buyer).approve(vault.target, amount);
    const id = ethers.concat([buyer.address, ethers.randomBytes(12)]);
    await fund(vault.connect(buyer), id, contractor.address, token.target, amount, 720, ethers.ZeroAddress);
    const domain = { name: 'Sivan Celo Settlement Facility', version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: vault.target };
    return { vault, token, buyer, contractor, relayer, treasury, id, domain, amount };
  }
  const field = (name, type = 'uint256') => ({ name, type });
  async function sign(c, kind, issuedAt, expiry, legacy = false, domain = c.domain) {
    const a = await c.vault.getAgreement(c.id);
    const fields = kind === 'release'
      ? [field('agreementId', 'bytes32'), field('contractor', 'address'), field('netAmount'), field('nonce')]
      : [field('agreementId', 'bytes32'), field('nonce')];
    if (!legacy) fields.push(field('issuedAt'));
    fields.push(field('expiry'));
    const name = kind === 'release' ? 'ReleaseAuthorization' : 'ContractorRefundConsent';
    const nonce = kind === 'release' ? await c.vault.agreementNonces(c.id) : await c.vault.refundConsentNonces(c.id);
    const signer = kind === 'release' ? c.buyer : c.contractor;
    return signer.signTypedData(domain, { [name]: fields }, {
      agreementId: c.id, contractor: c.contractor.address, netAmount: a.netAmount, nonce, issuedAt, expiry,
    });
  }
  function submit(c, kind, issuedAt, expiry, signature) {
    const v = c.vault.connect(c.relayer);
    return kind === 'release' ? v.releasePayment(c.id, signature, '0x', issuedAt, expiry)
      : v.mutualRefundWithConsent(c.id, issuedAt, expiry, signature);
  }
  async function unchanged(c) {
    expect(await c.token.balanceOf(c.vault.target)).eq(c.amount);
    expect(await c.token.balanceOf(c.buyer.address)).eq(0);
    expect(await c.token.balanceOf(c.contractor.address)).eq(0);
    expect(await c.vault.agreementNonces(c.id)).eq(0);
    expect(await c.vault.refundConsentNonces(c.id)).eq(0);
    expect((await c.vault.getAgreement(c.id)).state).eq(1);
  }
  for (const kind of ['release', 'refund']) {
    const intervalError = kind === 'release' ? 'Release authorization window too long' : 'Invalid refund consent expiry';
    const signatureError = kind === 'release' ? 'Invalid buyer release authorization' : 'Contractor refund consent required';
    it(`${kind}: a year-long signed interval stays invalid today and a year later`, async () => {
      const c = await setup(), issuedAt = await time.latest(), expiry = issuedAt + 365 * DAY + 3600;
      const signature = await sign(c, kind, issuedAt, expiry);
      await expect(submit(c, kind, issuedAt, expiry, signature)).revertedWith(intervalError);
      await unchanged(c);
      await time.increaseTo(issuedAt + 365 * DAY);
      await expect(submit(c, kind, issuedAt, expiry, signature)).revertedWith(intervalError);
      // A relayer cannot replace issuedAt to make the old interval look fresh.
      await expect(submit(c, kind, expiry - 3600, expiry, signature)).revertedWith(signatureError);
      await unchanged(c);
    });
    it(`${kind}: accepts a full 24-hour interval at exact expiry, once, with exact balances`, async () => {
      const c = await setup(), issuedAt = await time.latest(), expiry = issuedAt + DAY;
      const a = await c.vault.getAgreement(c.id), signature = await sign(c, kind, issuedAt, expiry);
      await time.setNextBlockTimestamp(expiry);
      await submit(c, kind, issuedAt, expiry, signature);
      expect(await c.token.balanceOf(c.vault.target)).eq(0);
      expect(await c.token.balanceOf(c.buyer.address)).eq(kind === 'refund' ? c.amount : 0);
      expect(await c.token.balanceOf(c.contractor.address)).eq(kind === 'release' ? a.netAmount : 0);
      expect(await c.token.balanceOf(c.treasury.address)).eq(kind === 'release' ? a.feeAmount : 0);
      await expect(submit(c, kind, issuedAt, expiry, signature)).reverted;
    });
    it(`${kind}: rejects expired, zero, reversed, future and overlong intervals without consuming a nonce`, async () => {
      const c = await setup(), now = await time.latest();
      for (const [issuedAt, expiry] of [[0, now + 100], [now + 100, now + 200],
        [now, now - 1], [now - DAY, now - 1], [now, now + DAY + 1]]) {
        await expect(submit(c, kind, issuedAt, expiry, await sign(c, kind, issuedAt, expiry))).reverted;
        await unchanged(c);
      }
      const expiry = (await time.latest()) + 3600, signature = await sign(c, kind, now, expiry);
      await time.setNextBlockTimestamp(expiry + 1);
      await expect(submit(c, kind, now, expiry, signature)).reverted;
      await time.increase(365 * DAY);
      await expect(submit(c, kind, now, expiry, signature)).reverted;
      await unchanged(c);
    });
    it(`${kind}: binds issuedAt and rejects old expiry-only, cross-chain and cross-vault signatures`, async () => {
      const c = await setup(), issuedAt = await time.latest(), expiry = issuedAt + 3600;
      const signature = await sign(c, kind, issuedAt, expiry);
      await expect(submit(c, kind, issuedAt - 1, expiry, signature)).revertedWith(signatureError);
      await expect(submit(c, kind, issuedAt, expiry, await sign(c, kind, issuedAt, expiry, true))).revertedWith(signatureError);
      for (const domain of [{ ...c.domain, chainId: 1 }, { ...c.domain, verifyingContract: c.token.target }]) {
        await expect(submit(c, kind, issuedAt, expiry, await sign(c, kind, issuedAt, expiry, false, domain))).revertedWith(signatureError);
      }
      await unchanged(c);
      await submit(c, kind, issuedAt, expiry, signature);
    });
  }
  for (const delivered of [false, true]) {
    it(`refund event describes ${delivered ? 'recorded delivery' : 'no delivery'} without changing payout`, async () => {
      const c = await setup();
      if (delivered) await c.vault.connect(c.contractor).markDelivered(c.id, 'ipfs://audit-delivery');
      const a = await c.vault.getAgreement(c.id);
      await time.increaseTo(a.refundUnlockAt + 1n);
      await expect(c.vault.connect(c.buyer).refundBuyer(c.id)).emit(c.vault, 'AgreementRefunded')
        .withArgs(c.id, c.buyer.address, c.amount, delivered ? 'Inspection expired without acceptance' : 'Delivery deadline expired');
      expect(await c.token.balanceOf(c.buyer.address)).eq(c.amount);
      expect(await c.token.balanceOf(c.contractor.address)).eq(0);
      expect(await c.token.balanceOf(c.treasury.address)).eq(0);
    });
  }
});
