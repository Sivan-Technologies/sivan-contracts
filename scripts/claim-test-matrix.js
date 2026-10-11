// Local fixtures only: no public RPCs or keys used by these child processes.
const { execFileSync } = require("child_process");
const { getNetwork } = require("../config/evm-networks.cjs");
const targets = require("../config/claim-targets.cjs");
for (const network of targets.map(getNetwork)) {
  console.log(`Claim LOCAL fixture matrix: ${network.name} (${network.chainId}); public deployment gate: ${network.status}`);
  const tests = ["test/SivanClaimVault.test.js", "deployment-test/claim-network-gates.test.js"];
  if (network.status === "candidate") tests.push("deployment-test/claim-deployment.test.js");
  execFileSync(process.execPath, [require.resolve("hardhat/internal/cli/cli"), "test", "--config",
    "config/claim-local-test.cjs", "--network", "hardhat", ...tests, "--no-compile"],
  { stdio: "inherit", env: { ...process.env, CLAIM_TEST_NETWORK: network.name } });
}
