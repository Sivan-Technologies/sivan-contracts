# Elliptic dependency risk assessment

Assessed 2026-10-11. Review due 2026-11-10 or immediately on dependency/signing
changes or new advisory evidence, whichever comes first.

Status: **residual risk documented; production acceptance requires owner/security
signoff**. This document does not remove the dependency, declare it safe or approve
mainnet use. No forced dependency upgrades or advisory suppression were applied.

## Advisory and affected graph

[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)
describes an ECDSA nonce handling flaw with conditional private-key exposure.
The reviewed advisory lists versions through 6.6.1 affected, with no patched
elliptic version. npm reports 15 low dependency-tree entries, not 15 distinct
demonstrated vault exploits. Moderate-and-above audit failures remain CI-blocking.

Installed graph from `npm ls elliptic @noble/curves --all`:

- `hardhat-network-helpers@1.1.2` → `ethereumjs-util@7.1.5` →
  `ethereum-cryptography@0.1.3` → `secp256k1@4.0.5` → `elliptic@6.6.1`.
- `hardhat-verify@2.1.3` and Hardhat 2's legacy ethersproject graph reach
  `@ethersproject/signing-key@5.8.0` → elliptic.
- Direct `ethers@6.17.0` uses `@noble/curves@1.2.0` for SigningKey operations.

These are JS development/deployment dependencies, not linked Solidity code.
Package presence is not proof that all signing operations invoke the vulnerable
primitive; conversely, absence from one tested path is not global non-reachability.

## Exercised path and containment

`npm run security:signing-dependency` starts a fresh process that rejects any
attempt to load elliptic, then imports the claim deployment helper and exercises
direct ethers v6 message, EIP-712 claim and transaction signing/recovery. It uses
ephemeral keys, runs offline, and never reads signing secrets or broadcasts.
This checks the same direct Wallet family used by the claim CLI; it does not
certify Hardhat internal signers, plugins, third-party applications or all future
runtime paths. The probe is added to CI alongside the unmodified advisory gate.

Existing containment: mainnet deployment blocked, production env rejects raw
private keys, testnet uses separate explicitly configured wallets, no legacy
ethers-v5 signer is intentionally used by the new claim deployment workflow.
Never reuse a test key as a production signer; do not generate comparison
signatures with both vulnerable and unaffected libraries using a production key.

## Decision and follow-up

Continue local/testnet engineering with explicit residual-risk disclosure.
Do not describe this as vulnerability remediation or owner risk acceptance.
Security/release owner must choose a time-bounded production acceptance or a
reviewed toolchain migration before any mainnet activation. No signoff is assumed.

Migration evaluation should pin a supported toolchain/plugin set in a separate
change, then rerun reproducible builds, all Hardhat/Foundry cases, static analysis,
fork deployment, source verification, protected signer integration and public
testnet lifecycles. Compare runtime/creation/ABI fingerprints and keep existing
immutable deployments serviced. Do not use `npm audit fix --force` to mix plugin
major versions. If the advisory expands or this probe fails, stop affected signing
work and reassess rather than loosening the test.
