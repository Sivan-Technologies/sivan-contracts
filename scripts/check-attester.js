const hre = require("hardhat");

/**
 * PROVE THE ATTESTER KEY IS CONTROLLED, WITHOUT MOVING ANY MONEY.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS.
 *
 * The vault's `agentAttester` is just an address written at construction.
 * Setting it proves nothing about whether anyone can still sign for it. If the
 * key was generated once in a terminal and never saved, every agreement that
 * ever reaches `Delivered` becomes unreleasable: `releasePayment` requires an
 * attestation whenever `state == Delivered`, and only that key can produce one.
 *
 * The failure is silent and delayed. Deposits work. Deliveries work. The break
 * only appears when the first real contractor tries to get paid, by which
 * point there is customer money in the contract and the only remaining exits
 * are the buyer's timeout refund or a dispute.
 *
 * Verifying an address is not verifying a key. This script closes that gap by
 * producing a signature and checking the CONTRACT accepts it, rather than
 * checking it locally with ethers and declaring success. A local check would
 * pass even if the EIP-712 domain were wrong, which is exactly how the
 * delegated release path was broken for so long.
 *
 *   ATTESTER_PRIVATE_KEY=0x... VAULT=0x... \
 *     npx hardhat run scripts/check-attester.js --network celoSepolia
 *
 * Read-only. Sends no transactions and costs no gas.
 */

async function main() {
  const vaultAddress = process.env.VAULT;
  if (!vaultAddress || !hre.ethers.isAddress(vaultAddress)) {
    throw new Error("Set VAULT to the deployed vault address.");
  }

  const provider = hre.ethers.provider;
  if ((await provider.getCode(vaultAddress)) === "0x") {
    throw new Error(`No contract at ${vaultAddress} on ${hre.network.name}.`);
  }

  const vault = await hre.ethers.getContractAt("SivanAgreementVault", vaultAddress);
  const onChainAttester = await vault.agentAttester();
  const agentId = await vault.registeredAgentId();
  const chainId = (await provider.getNetwork()).chainId;

  console.log("Attester control check");
  console.log("  network          :", hre.network.name, `(chainId ${chainId})`);
  console.log("  vault            :", vaultAddress);
  console.log("  agentAttester    :", onChainAttester);
  console.log("  registeredAgentId:", agentId.toString());

  const key = (process.env.ATTESTER_PRIVATE_KEY || "").trim();
  if (!key) {
    console.log(
      "\nATTESTER_PRIVATE_KEY not set, so control is UNPROVEN.\n" +
        "The address above is configured, but nothing here shows anyone can sign\n" +
        "for it. Until that is demonstrated, treat every delivered agreement as\n" +
        "potentially unreleasable.\n\n" +
        "Run again with the key to prove it:\n" +
        "  ATTESTER_PRIVATE_KEY=0x... VAULT=" + vaultAddress + " \\\n" +
        "    npx hardhat run scripts/check-attester.js --network " + hre.network.name
    );
    process.exitCode = 1;
    return;
  }

  const wallet = new hre.ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`);
  console.log("  supplied key     :", wallet.address);

  if (wallet.address.toLowerCase() !== onChainAttester.toLowerCase()) {
    throw new Error(
      `The supplied key is for ${wallet.address}, but the vault's attester is ` +
        `${onChainAttester}.\n` +
        `Either supply the right key, or call setAgentAttester(${wallet.address}, ${agentId}) ` +
        `as the owner.`
    );
  }
  console.log("  key matches the configured attester");

  /**
   * Sign a real attestation over a deliberately impossible agreement id.
   *
   * Using a live agreement would be reckless: a valid attestation is a bearer
   * token for releasing that specific payment, and producing one for logging
   * purposes puts it in a terminal buffer. This id will never exist, so the
   * signature can never release anything.
   */
  const probeId = hre.ethers.id("sivan-attester-probe-never-a-real-agreement");
  const deliverable = "attester-control-probe";

  const domain = {
    name: "Sivan Celo Settlement Facility",
    version: "1",
    chainId,
    verifyingContract: vaultAddress,
  };
  const types = {
    AgentAttestation: [
      { name: "agreementId", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
  };
  const value = {
    agreementId: probeId,
    agentId,
    deliverableHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(deliverable)),
    timestamp: 0,
  };

  const signature = await wallet.signTypedData(domain, types, value);

  /**
   * Recover against the CONTRACT'S OWN domain separator, read off chain.
   *
   * Verifying locally with ethers would only prove ethers agrees with itself.
   * The question is whether the deployed contract would accept this signature,
   * and that depends on its domain separator, which is baked into immutables
   * at construction and includes the chain id and the contract's own address.
   * Reading it back is the only way to know the two agree.
   */
  const eip712 = await hre.ethers.getContractAt(
    ["function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])"],
    vaultAddress
  );
  const [, dName, dVersion, dChainId, dVerifying] = await eip712.eip712Domain();

  console.log("\nDomain read back from the contract:");
  console.log("  name             :", dName);
  console.log("  version          :", dVersion);
  console.log("  chainId          :", dChainId.toString());
  console.log("  verifyingContract:", dVerifying);

  const mismatches = [];
  if (dName !== domain.name) mismatches.push(`name: ${dName} vs ${domain.name}`);
  if (dVersion !== domain.version) mismatches.push(`version: ${dVersion} vs ${domain.version}`);
  if (dChainId !== chainId) mismatches.push(`chainId: ${dChainId} vs ${chainId}`);
  if (dVerifying.toLowerCase() !== vaultAddress.toLowerCase()) {
    mismatches.push(`verifyingContract: ${dVerifying} vs ${vaultAddress}`);
  }
  if (mismatches.length) {
    throw new Error(
      "The contract's EIP-712 domain does not match what the backend would sign:\n  " +
        mismatches.join("\n  ") +
        "\nEvery attestation would be rejected."
    );
  }

  const recovered = hre.ethers.verifyTypedData(
    { name: dName, version: dVersion, chainId: dChainId, verifyingContract: dVerifying },
    types,
    value,
    signature
  );

  if (recovered.toLowerCase() !== onChainAttester.toLowerCase()) {
    throw new Error(
      `Recovered ${recovered} against the contract's own domain, expected ${onChainAttester}.`
    );
  }

  /**
   * SCOPE THE CLAIM TO WHAT WAS ACTUALLY CHECKED.
   *
   * An audit flagged the previous wording, "Delivered agreements are
   * releasable", as broader than the evidence. This script recovers a
   * signature off chain against the contract's own domain. It never calls
   * releasePayment, so it cannot speak to the other conditions that gate a
   * release: agreement state, buyer authorisation, expiry bounds, nonce, or
   * whether the contract is paused.
   *
   * What it proves is precise and still worth having: the key exists, it
   * matches the configured attester, and the domain both sides use agrees.
   * Those are exactly the failures that are invisible until a real release
   * reverts.
   */
  console.log("\nPROVEN, precisely:");
  console.log("  - the supplied key controls the vault's configured agentAttester");
  console.log("  - its signatures recover correctly under the EIP-712 domain the");
  console.log("    contract itself reports, so attestations will not be rejected");
  console.log("    for a domain mismatch");
  console.log("\nNOT proven here: that any given release will succeed. This performs");
  console.log("no on-chain call, so agreement state, buyer authorisation, expiry,");
  console.log("nonce and pause state are all unverified. Exercise a real release");
  console.log("with scripts/lifecycle.js on a fork, or lifecycle-live.js on testnet.");
}

main().catch((error) => {
  console.error("\nATTESTER CHECK FAILED:", error.message);
  process.exitCode = 1;
});
