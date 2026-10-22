// ─── Arc Testnet chain definition ─────────────────────────────────────────────
import { type Chain } from "viem";

export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18, // native gas view — 18-decimal. ERC-20 view is 6-decimal.
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: {
      name: "Arc Testnet Explorer",
      url: "https://explorer.testnet.arc.io",
    },
  },
  testnet: true,
};

// ─── Deployed SivanClaimVault v3 (Arc Studio deploy 2026-10-22, correct treasury) ──
export const VAULT_ADDRESS = "0x12880b072e2698ffbfea25cc959a92af769efed1" as const;

// ─── Arc Testnet USDC (predeploy, 6-decimal ERC-20) ──────────────────────────
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;

// ─── Claim window ─────────────────────────────────────────────────────────────
export const CLAIM_WINDOW_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const FEE_BPS = 50n; // 0.50%

// ─── ABIs ─────────────────────────────────────────────────────────────────────
export const VAULT_ABI = [
  // Read
  { name: "treasury",        type: "function", stateMutability: "view",      inputs: [],                                                                    outputs: [{ type: "address" }] },
  { name: "fundingPaused",   type: "function", stateMutability: "view",      inputs: [],                                                                    outputs: [{ type: "bool"    }] },
  { name: "FEE_BPS",         type: "function", stateMutability: "view",      inputs: [],                                                                    outputs: [{ type: "uint256" }] },
  { name: "CLAIM_WINDOW",    type: "function", stateMutability: "view",      inputs: [],                                                                    outputs: [{ type: "uint256" }] },
  { name: "allowedTokens",   type: "function", stateMutability: "view",      inputs: [{ name: "token",     type: "address" }],                              outputs: [{ type: "bool"    }] },
  { name: "nonces",          type: "function", stateMutability: "view",      inputs: [{ name: "sender",    type: "address" }],                              outputs: [{ type: "uint256" }] },
  { name: "locked",          type: "function", stateMutability: "view",      inputs: [{ name: "token",     type: "address" }],                              outputs: [{ type: "uint256" }] },
  { name: "deposits",        type: "function", stateMutability: "view",
    inputs: [{ name: "depositId", type: "bytes32" }],
    outputs: [
      { name: "sender",      type: "address" }, { name: "token",     type: "address" },
      { name: "claimSigner", type: "address" }, { name: "netAmount", type: "uint256" },
      { name: "expiresAt",   type: "uint256" }, { name: "status",    type: "uint8"   },
    ],
  },
  { name: "claimDigest",     type: "function", stateMutability: "view",
    inputs: [{ name: "depositId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  { name: "deriveDepositId", type: "function", stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "nonce", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  // Write
  { name: "deposit",         type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "grossAmount", type: "uint256" }, { name: "claimSigner", type: "address" }],
    outputs: [{ name: "depositId", type: "bytes32" }],
  },
  { name: "claim",           type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "depositId", type: "bytes32" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "signature", type: "bytes" }],
    outputs: [],
  },
  { name: "refund",          type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "depositId", type: "bytes32" }],
    outputs: [],
  },
  // Events
  { name: "ClaimVaultDeposited", type: "event",
    inputs: [
      { name: "depositId",    type: "bytes32",  indexed: true  },
      { name: "sender",       type: "address",  indexed: true  },
      { name: "token",        type: "address",  indexed: true  },
      { name: "claimSigner",  type: "address",  indexed: false },
      { name: "grossAmount",  type: "uint256",  indexed: false },
      { name: "feeAmount",    type: "uint256",  indexed: false },
      { name: "netAmount",    type: "uint256",  indexed: false },
      { name: "expiresAt",    type: "uint256",  indexed: false },
    ],
  },
  { name: "ClaimVaultClaimed",   type: "event",
    inputs: [
      { name: "depositId", type: "bytes32", indexed: true  },
      { name: "recipient", type: "address", indexed: true  },
      { name: "amount",    type: "uint256", indexed: false },
    ],
  },
  { name: "ClaimVaultRefunded",  type: "event",
    inputs: [
      { name: "depositId", type: "bytes32", indexed: true  },
      { name: "sender",    type: "address", indexed: true  },
      { name: "amount",    type: "uint256", indexed: false },
    ],
  },
  // Errors (for decoding reverts)
  { name: "ClaimExpired",          type: "error", inputs: [] },
  { name: "FundingPaused",         type: "error", inputs: [] },
  { name: "InexactTransfer",       type: "error", inputs: [] },
  { name: "InvalidAddress",        type: "error", inputs: [] },
  { name: "InvalidAmount",         type: "error", inputs: [] },
  { name: "InvalidAuthorization",  type: "error", inputs: [] },
  { name: "NotActive",             type: "error", inputs: [] },
  { name: "NotSender",             type: "error", inputs: [] },
  { name: "RefundNotAvailable",    type: "error", inputs: [] },
  { name: "UnsupportedToken",      type: "error", inputs: [] },
] as const;

export const ERC20_ABI = [
  { name: "balanceOf",  type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance",  type: "function", stateMutability: "view",       inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "decimals",   type: "function", stateMutability: "view",       inputs: [],                                     outputs: [{ type: "uint8"   }] },
  { name: "symbol",     type: "function", stateMutability: "view",       inputs: [],                                     outputs: [{ type: "string"  }] },
  { name: "approve",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount",  type: "uint256" }], outputs: [{ type: "bool"    }] },
] as const;

// Deposit status enum mirrors contract
export const DepositStatus = { None: 0, Active: 1, Claimed: 2, Refunded: 3 } as const;
export type DepositStatusValue = (typeof DepositStatus)[keyof typeof DepositStatus];
