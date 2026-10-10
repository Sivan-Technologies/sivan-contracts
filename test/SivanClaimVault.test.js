const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('SivanClaimVault — isolated claim-link lifecycle', function () {
  let admin, sender, recipient, treasury, relayer, attacker, vault, token, key;
  const types = { Claim: [
    { name: 'depositId', type: 'bytes32' }, { name: 'recipient', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ] };
  async function setup(name = 'MockERC20', decimals = 6) {
    [admin, sender, recipient, treasury, relayer, attacker] = await ethers.getSigners();
    token = name === 'MockERC20'
      ? await ethers.deployContract(name, ['Local test token', 'TEST', decimals])
      : await ethers.deployContract(name);
    vault = await ethers.deployContract('SivanClaimVault', [admin.address, treasury.address, [token.target]]);
    key = ethers.Wallet.createRandom();
    await token.mint(sender.address, ethers.parseUnits('100', decimals));
    await token.connect(sender).approve(vault.target, ethers.MaxUint256);
  }
  async function deposit(amount = 20_000_000n) {
    const id = await vault.deriveDepositId(sender.address, await vault.nonces(sender.address));
    await vault.connect(sender).deposit(token.target, amount, key.address);
    return { id, item: await vault.deposits(id) };
  }
  async function sign(id, deadline, target = recipient.address, overrides = {}) {
    return key.signTypedData({ name: 'SivanClaimVault', version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: vault.target,
      ...overrides }, types, { depositId: id, recipient: target, deadline });
  }
  beforeEach(async () => setup());

  for (const [name, decimals] of [['MockERC20', 6], ['MockERC20', 18], ['LegacyUsdtFixture', 6]]) {
    it(`deposit → relayed claim and deposit → refund conserve funds (${name}, ${decimals}dp)`, async () => {
      await setup(name, decimals);
      const gross = ethers.parseUnits('20', decimals), fee = gross / 200n, net = gross - fee;
      const a = await deposit(gross), b = await deposit(gross);
      expect(a.id).not.to.equal(b.id);
      expect(await token.balanceOf(treasury.address)).to.equal(fee * 2n);
      const sig = await sign(a.id, a.item.expiresAt);
      await expect(vault.connect(relayer).claim(a.id, recipient.address, a.item.expiresAt, sig))
        .to.emit(vault, 'ClaimVaultClaimed').withArgs(a.id, recipient.address, net);
      expect(await token.balanceOf(recipient.address)).to.equal(net);
      await time.increaseTo(b.item.expiresAt);
      await expect(vault.connect(sender).refund(b.id)).to.emit(vault, 'ClaimVaultRefunded')
        .withArgs(b.id, sender.address, net);
      expect(await token.balanceOf(sender.address)).to.equal(ethers.parseUnits('100', decimals) - gross * 2n + net);
      expect(await vault.locked(token.target)).to.equal(0);
      expect(await token.balanceOf(vault.target)).to.equal(0);
      await expect(vault.connect(sender).refund(b.id)).to.be.revertedWithCustomError(vault, 'NotActive');
      await expect(vault.claim(a.id, recipient.address, a.item.expiresAt, sig)).to.be.revertedWithCustomError(vault, 'NotActive');
    });
  }

  it('a copied authorization cannot redirect funds, but can relay to the authorized recipient', async () => {
    const { id, item } = await deposit(), sig = await sign(id, item.expiresAt);
    await expect(vault.connect(attacker).claim(id, attacker.address, item.expiresAt, sig))
      .to.be.revertedWithCustomError(vault, 'InvalidAuthorization');
    await vault.connect(attacker).claim(id, recipient.address, item.expiresAt, sig);
    expect(await token.balanceOf(attacker.address)).to.equal(0);
    await expect(vault.connect(sender).refund(id)).to.be.revertedWithCustomError(vault, 'NotActive');
  });
  it('rejects wrong chain, vault, deposit and signer authorizations', async () => {
    const a = await deposit(), b = await deposit();
    for (const overrides of [{ chainId: 1 }, { verifyingContract: attacker.address }]) {
      await expect(vault.claim(a.id, recipient.address, a.item.expiresAt, await sign(a.id, a.item.expiresAt, recipient.address, overrides)))
        .to.be.revertedWithCustomError(vault, 'InvalidAuthorization');
    }
    await expect(vault.claim(b.id, recipient.address, a.item.expiresAt, await sign(a.id, a.item.expiresAt)))
      .to.be.revertedWithCustomError(vault, 'InvalidAuthorization');
    key = ethers.Wallet.createRandom();
    await expect(vault.claim(a.id, recipient.address, a.item.expiresAt, await sign(a.id, a.item.expiresAt)))
      .to.be.revertedWithCustomError(vault, 'InvalidAuthorization');
    expect((await vault.deposits(a.id)).status).to.equal(1);
  });
  it('refund is unavailable early or to an outsider; exact expiry admits refund, not claim', async () => {
    const { id, item } = await deposit(), sig = await sign(id, item.expiresAt);
    await expect(vault.connect(sender).refund(id)).to.be.revertedWithCustomError(vault, 'RefundNotAvailable');
    await expect(vault.connect(attacker).refund(id)).to.be.revertedWithCustomError(vault, 'NotSender');
    await time.setNextBlockTimestamp(item.expiresAt);
    await expect(vault.claim(id, recipient.address, item.expiresAt, sig)).to.be.revertedWithCustomError(vault, 'ClaimExpired');
    await vault.connect(sender).refund(id);
    await expect(vault.claim(id, recipient.address, item.expiresAt, sig)).to.be.revertedWithCustomError(vault, 'NotActive');
  });
  it('claim works one second before expiry', async () => {
    const { id, item } = await deposit(), sig = await sign(id, item.expiresAt);
    await time.setNextBlockTimestamp(item.expiresAt - 1n);
    await vault.claim(id, recipient.address, item.expiresAt, sig);
  });
  it('refund succeeds at the exact expiry timestamp', async () => {
    const { id, item } = await deposit();
    await time.setNextBlockTimestamp(item.expiresAt);
    await vault.connect(sender).refund(id);
    expect((await vault.deposits(id)).status).to.equal(3);
  });
  it('keeps separate tokens and sender nonces isolated', async () => {
    const a = await deposit();
    const other = await ethers.deployContract('MockERC20', ['Other', 'OTHER', 18]);
    await vault.setTokenAllowed(other.target, true);
    const gross = ethers.parseEther('20');
    await other.mint(attacker.address, gross);
    await other.connect(attacker).approve(vault.target, gross);
    const id = await vault.deriveDepositId(attacker.address, 0);
    await vault.connect(attacker).deposit(other.target, gross, key.address);
    expect(id).not.to.equal(a.id);
    await vault.claim(a.id, recipient.address, a.item.expiresAt, await sign(a.id, a.item.expiresAt));
    expect(await vault.locked(token.target)).to.equal(0);
    expect(await vault.locked(other.target)).to.equal(gross - gross / 200n);
    const b = await vault.deposits(id);
    await time.increaseTo(b.expiresAt);
    await vault.connect(attacker).refund(id);
    expect(await other.balanceOf(attacker.address)).to.equal(gross - gross / 200n);
  });
  it('signature deadlines are enforced independently of the deposit expiry', async () => {
    const { id, item } = await deposit();
    const past = BigInt(await time.latest()) - 1n;
    for (const deadline of [past, item.expiresAt + 1n]) {
      await expect(vault.claim(id, recipient.address, deadline, await sign(id, deadline)))
        .to.be.revertedWithCustomError(vault, 'InvalidAuthorization');
    }
  });
  it('pause and token removal block deposits but preserve both exits', async () => {
    const a = await deposit(), b = await deposit();
    await vault.setFundingPaused(true);
    await expect(deposit()).to.be.revertedWithCustomError(vault, 'FundingPaused');
    await vault.setTokenAllowed(token.target, false);
    await vault.claim(a.id, recipient.address, a.item.expiresAt, await sign(a.id, a.item.expiresAt));
    await time.increaseTo(b.item.expiresAt);
    await vault.connect(sender).refund(b.id);
    await vault.setFundingPaused(false);
    await expect(deposit()).to.be.revertedWithCustomError(vault, 'UnsupportedToken');
  });
  it('failed claim/refund token transfers roll back and can be retried', async () => {
    await setup('LegacyUsdtFixture');
    const a = await deposit(), b = await deposit();
    await token.setBlocked(recipient.address);
    const sig = await sign(a.id, a.item.expiresAt);
    await expect(vault.claim(a.id, recipient.address, a.item.expiresAt, sig)).to.be.reverted;
    expect((await vault.deposits(a.id)).status).to.equal(1);
    expect(await vault.locked(token.target)).to.equal(39_800_000n);
    await token.setBlocked(ethers.ZeroAddress);
    await vault.claim(a.id, recipient.address, a.item.expiresAt, sig);
    await token.setBlocked(sender.address);
    await time.increaseTo(b.item.expiresAt);
    await expect(vault.connect(sender).refund(b.id)).to.be.reverted;
    expect((await vault.deposits(b.id)).status).to.equal(1);
    await token.setBlocked(ethers.ZeroAddress);
    await vault.connect(sender).refund(b.id);
  });
  it('failed fee collection rolls back funding and the sender nonce', async () => {
    await setup('LegacyUsdtFixture');
    await token.setBlocked(treasury.address);
    await expect(deposit()).to.be.reverted;
    expect(await vault.nonces(sender.address)).to.equal(0);
    expect(await token.balanceOf(vault.target)).to.equal(0);
    expect(await token.balanceOf(sender.address)).to.equal(100_000_000n);
  });
  it('rejects invalid inputs and unauthorized administration', async () => {
    await expect(vault.connect(attacker).setFundingPaused(true)).to.be.reverted;
    await expect(vault.connect(attacker).setTokenAllowed(token.target, false)).to.be.reverted;
    await expect(deposit(0n)).to.be.revertedWithCustomError(vault, 'InvalidAmount');
    for (const signer of [ethers.ZeroAddress, vault.target, token.target]) {
      await expect(vault.connect(sender).deposit(token.target, 1n, signer)).to.be.revertedWithCustomError(vault, 'InvalidAddress');
    }
    await expect(vault.setTokenAllowed(attacker.address, true)).to.be.revertedWithCustomError(vault, 'InvalidAddress');
    const { id, item } = await deposit();
    for (const address of [ethers.ZeroAddress, vault.target]) {
      await expect(vault.claim(id, address, item.expiresAt, await sign(id, item.expiresAt, address)))
        .to.be.revertedWithCustomError(vault, 'InvalidAddress');
    }
    await expect(vault.claim(id, recipient.address, item.expiresAt, '0x')).to.be.reverted;
  });
  it('two-step admin transfer cannot redirect existing escrow', async () => {
    const { id, item } = await deposit();
    await vault.transferOwnership(attacker.address);
    expect(await vault.owner()).to.equal(admin.address);
    await vault.connect(attacker).acceptOwnership();
    await vault.connect(attacker).setFundingPaused(true);
    await vault.claim(id, recipient.address, item.expiresAt, await sign(id, item.expiresAt));
    expect(await vault.treasury()).to.equal(treasury.address);
  });
  it('rounds fee down in raw units and does not expose donated tokens to claims', async () => {
    await token.transfer(vault.target, 123n);
    const { id, item } = await deposit(1n);
    expect(item.netAmount).to.equal(1);
    await vault.claim(id, recipient.address, item.expiresAt, await sign(id, item.expiresAt));
    expect(await token.balanceOf(vault.target)).to.equal(123);
    expect(await vault.locked(token.target)).to.equal(0);
  });
  it('rejects taxed incoming transfers without consuming another deposit', async () => {
    const good = await deposit();
    const taxed = await ethers.deployContract('MockFeeOnTransferERC20', ['Taxed', 'TAX', 6, 100]);
    await vault.setTokenAllowed(taxed.target, true);
    await taxed.mint(sender.address, 20_000_000n);
    await taxed.connect(sender).approve(vault.target, 20_000_000n);
    await expect(vault.connect(sender).deposit(taxed.target, 20_000_000n, key.address))
      .to.be.revertedWithCustomError(vault, 'InexactTransfer');
    expect(await vault.locked(taxed.target)).to.equal(0);
    expect((await vault.deposits(good.id)).netAmount).to.equal(19_900_000n);
  });
  it('rejects reentrant claim callbacks and pays the recipient only once', async () => {
    await setup('ClaimCallbackToken');
    const { id, item } = await deposit();
    const sig = await sign(id, item.expiresAt);
    await token.arm(vault.target, vault.interface.encodeFunctionData('claim', [id, recipient.address, item.expiresAt, sig]));
    await vault.claim(id, recipient.address, item.expiresAt, sig);
    expect(await token.callbackSucceeded()).to.equal(false);
    expect(await token.balanceOf(recipient.address)).to.equal(19_900_000n);
    expect(await vault.locked(token.target)).to.equal(0);
  });
  it('signing helper matches the on-chain EIP-712 digest', async () => {
    const { claimAuthorization } = require('../scripts/helpers/claim-authorization');
    const { id, item } = await deposit();
    const auth = claimAuthorization({ chainId: 31337, vault: vault.target,
      depositId: id, recipient: recipient.address, deadline: item.expiresAt });
    expect(ethers.TypedDataEncoder.hash(auth.domain, auth.types, auth.value))
      .to.equal(await vault.claimDigest(id, recipient.address, item.expiresAt));
  });
  it('varied amounts and mixed exits preserve aggregate liabilities after every transition', async () => {
    await token.mint(sender.address, 1_000_000_000_000n);
    const pending = [];
    let liability = 0n;
    let feeTotal = 0n;
    let seed = 912345n;
    for (let i = 0; i < 40; i++) {
      seed = (seed * 1664525n + 1013904223n) % (2n ** 32n);
      const gross = seed + 1n, fee = gross / 200n;
      const entry = await deposit(gross);
      feeTotal += fee; liability += gross - fee;
      pending.push(entry);
      expect(await vault.locked(token.target)).to.equal(liability);
      expect(await token.balanceOf(vault.target)).to.equal(liability);
    }
    for (let i = 0; i < pending.length; i += 2) {
      const { id, item } = pending[i];
      await vault.claim(id, recipient.address, item.expiresAt, await sign(id, item.expiresAt));
      liability -= item.netAmount;
      expect(await vault.locked(token.target)).to.equal(liability);
      expect(await token.balanceOf(vault.target)).to.equal(liability);
    }
    await time.increaseTo(pending.at(-1).item.expiresAt);
    for (let i = 1; i < pending.length; i += 2) {
      const { id, item } = pending[i];
      await vault.connect(sender).refund(id);
      liability -= item.netAmount;
      expect(await vault.locked(token.target)).to.equal(liability);
      expect(await token.balanceOf(vault.target)).to.equal(liability);
    }
    expect(liability).to.equal(0);
    expect(await token.balanceOf(treasury.address)).to.equal(feeTotal);
  });
});
