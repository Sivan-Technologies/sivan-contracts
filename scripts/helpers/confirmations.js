const { DeploymentError } = require('../../config/evm-networks.cjs');

// Minimum testnet observation policy, not a claim of L1/L2 economic finality.
// No environment switch may lower this floor. Production remains gated.
const MIN_CONFIRMATIONS = 2;
const RECEIPT_TIMEOUT_MS = 180000;

async function assertConfirmedReceipt(provider, receipt) {
  if (!receipt || receipt.status !== 1 || !receipt.hash || !receipt.blockHash ||
      !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0)
    throw new DeploymentError('Successful transaction receipt required');
  const latest = Number(BigInt(await provider.send('eth_blockNumber', [])));
  const observed = latest - receipt.blockNumber + 1;
  if (observed < MIN_CONFIRMATIONS)
    throw new DeploymentError('Transaction pending confirmations; reconcile before continuing');
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash !== receipt.blockHash)
    throw new DeploymentError('Transaction receipt is not canonical; reconcile before continuing');
  const current = await provider.getTransactionReceipt(receipt.hash);
  if (!current || current.status !== 1 || current.hash !== receipt.hash || current.blockHash !== receipt.blockHash ||
      current.blockNumber !== receipt.blockNumber)
    throw new DeploymentError('Transaction receipt changed during readback; reconcile before continuing');
  return { minimumConfirmations: MIN_CONFIRMATIONS, observedConfirmations: observed,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
}

async function waitForConfirmedReceipt(provider, transaction) {
  const receipt = await transaction.wait(MIN_CONFIRMATIONS, RECEIPT_TIMEOUT_MS);
  await assertConfirmedReceipt(provider, receipt);
  return receipt;
}

module.exports = { MIN_CONFIRMATIONS, RECEIPT_TIMEOUT_MS, assertConfirmedReceipt, waitForConfirmedReceipt };
