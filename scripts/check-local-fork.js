// Test accounts must NEVER send transactions to a remote RPC in CI.
function checkLocalFork(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Configure a local fork RPC URL"); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "8545" ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Fork transaction RPC must be the local runner at 127.0.0.1 port 8545");
  }
}
if (require.main === module) checkLocalFork(process.env.CELO_FORK_RPC_URL);
module.exports = { checkLocalFork };
