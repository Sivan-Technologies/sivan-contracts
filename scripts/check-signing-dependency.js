// Isolated, offline probe: fail if the exercised signing path loads elliptic.
// Never consumes environment keys or broadcasts a transaction.
const assert = require("assert/strict");
const Module = require("module");
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === "elliptic" || request.startsWith("elliptic/")) throw new Error("Legacy elliptic entered the exercised signing path");
  return load.call(this, request, ...args);
};
async function main() {
  const ethers = require("ethers");
  require("./helpers/claim-deployment");
  const { claimAuthorization } = require("./helpers/claim-authorization");
  const wallet = ethers.Wallet.createRandom();
  const target = ethers.Wallet.createRandom().address;
  const signature = await wallet.signMessage("Offline dependency probe");
  assert.equal(ethers.verifyMessage("Offline dependency probe", signature), wallet.address);
  const typed = claimAuthorization({ chainId: 11142220, vault: target, depositId: ethers.id("probe"),
    recipient: wallet.address, deadline: 1n });
  const authorization = await wallet.signTypedData(typed.domain, typed.types, typed.value);
  assert.equal(ethers.verifyTypedData(typed.domain, typed.types, typed.value, authorization), wallet.address);
  const raw = await wallet.signTransaction({ chainId: 11142220, nonce: 0, to: target, value: 0,
    gasLimit: 21000, gasPrice: 1 });
  assert.equal(ethers.Transaction.from(raw).from, wallet.address);
  console.log("PASS: isolated ethers v6 message, claim typed-data and transaction signing without elliptic; no keys logged or transactions broadcast.");
}
main().catch(() => { console.error("Signing dependency probe failed"); process.exitCode = 1; });
