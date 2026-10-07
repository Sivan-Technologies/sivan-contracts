const { expect } = require('chai');
const { check, TARGETS } = require('../scripts/check-testnet-rpcs');
const { getNetwork, assertDeployable } = require('../config/evm-networks.cjs');
describe('Read-only five-testnet diagnostics', () => {
  for (const name of TARGETS) {
    it(`checks ${name} without signing or broadcasting`, async () => {
      const n = getNetwork(name), calls = [];
      const request = async (_url, options) => {
        const { method } = JSON.parse(options.body); calls.push(method);
        return { ok: true, json: async () => ({ result: method === 'eth_chainId'
          ? '0x' + n.chainId.toString(16)
          : { number: '0x10', timestamp: '0x' + Math.floor(Date.now()/1000).toString(16) } }) };
      };
      expect((await check(name, { [n.prefix + '_RPC_URL']: 'https://example.invalid' }, request)).ok).eq(true);
      expect(calls).deep.eq(['eth_chainId', 'eth_getBlockByNumber']);
    });
  }
  it('fails closed for missing configuration, wrong chain and provider errors', async () => {
    expect((await check('arcTestnet', {})).error).eq('RPC_NOT_CONFIGURED');
    const env = { ARC_TESTNET_RPC_URL: 'https://example.invalid/secret' };
    expect((await check('arcTestnet', env, async () => ({ok:true,json:async()=>({result:'0x1'})}))).error).eq('CHAIN_ID_MISMATCH');
    const result = await check('arcTestnet', env, async () => { throw new Error(env.ARC_TESTNET_RPC_URL); });
    expect(JSON.stringify(result)).not.include('secret');
    expect(result.ok).eq(false);
  });
  it('keeps pending profiles and every mainnet blocked', () => {
    for(const name of ['arcTestnet','bscTestnet','arc','bsc','celo','base','arbitrum']) {
      expect(() => assertDeployable(getNetwork(name))).to.throw();
    }
  });
  it('rejects stale blocks and non-HTTPS endpoints', async () => {
    const env = { BSC_TESTNET_RPC_URL: 'https://example.invalid' };
    const request = async (_url, options) => ({ok:true,json:async()=>({result:
      JSON.parse(options.body).method === 'eth_chainId' ? '0x61' : {number:'0x1',timestamp:'0x1'} })});
    expect((await check('bscTestnet', env, request)).error).eq('BLOCK_NOT_FRESH');
    expect((await check('bscTestnet', {BSC_TESTNET_RPC_URL:'http://example.invalid'},
      async () => {throw new Error('Must not request');})).ok).eq(false);
  });
});
