// Read-only network diagnostics. Never loads a signer or broadcasts transactions.
const { getNetwork } = require('../config/evm-networks.cjs');
const { loadEnvironment } = require('./helpers/environment');
const TARGETS = ['celoSepolia', 'baseSepolia', 'arbitrumSepolia', 'bscTestnet', 'arcTestnet'];

async function check(name, env = process.env, request = fetch) {
  if (!TARGETS.includes(name)) throw new Error('Unsupported testnet diagnostic target');
  const network = getNetwork(name);
  const endpoint = env[`${network.prefix}_RPC_URL`];
  const result = { network: name, expectedChainId: network.chainId, deploymentStatus: network.status };
  if (!endpoint) return { ...result, ok: false, error: 'RPC_NOT_CONFIGURED' };
  try {
    if (new URL(endpoint).protocol !== 'https:') throw new Error('HTTPS_REQUIRED');
    async function rpc(method, params) {
      const response = await request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000), redirect: 'error',
      });
      if (!response.ok) throw new Error('RPC_UNAVAILABLE');
      const data = await response.json();
      if (data.error || data.result == null) throw new Error('RPC_UNAVAILABLE');
      return data.result;
    }
    const id = await rpc('eth_chainId', []);
    if (BigInt(id) !== BigInt(network.chainId)) return { ...result, ok: false, error: 'CHAIN_ID_MISMATCH' };
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    const timestamp = Number(BigInt(block.timestamp));
    const age = Math.floor(Date.now() / 1000) - timestamp;
    if (!Number.isSafeInteger(timestamp) || age < -60 || age > 300) return { ...result, ok: false, error: 'BLOCK_NOT_FRESH' };
    return { ...result, ok: true, block: String(BigInt(block.number)), blockAgeSeconds: age,
      scope: 'chain identity and block freshness only; not contract compatibility or deployment approval' };
  } catch {
    // Never expose endpoint credentials, provider response bodies or raw errors.
    return { ...result, ok: false, error: 'RPC_CHECK_FAILED' };
  }
}

async function main() {
  loadEnvironment();
  const names = process.argv.slice(2);
  if (names.some(n => !TARGETS.includes(n))) throw new Error('Unsupported target');
  const results = await Promise.all((names.length ? names : TARGETS).map(n => check(n)));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('Testnet diagnostics failed; details withheld.'); process.exitCode = 1; });
module.exports = { check, TARGETS };
