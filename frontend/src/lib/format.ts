import { USDC_DECIMALS } from "./constants";

/** Format a raw USDC bigint (6 dec) as a display string, e.g. "1.990000 USDC" */
export function formatUsdc(raw: bigint, symbol = "USDC"): string {
  const units = Number(raw) / 10 ** USDC_DECIMALS;
  return `${units.toFixed(USDC_DECIMALS)} ${symbol}`;
}

/** Parse a user input string ("2.5") into raw 6-decimal bigint */
export function parseUsdc(value: string): bigint {
  const n = parseFloat(value);
  if (!isFinite(n) || n < 0) throw new Error("Invalid amount");
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

/** Compute fee (floor) and net from gross, matching contract's Math.mulDiv */
export function computeFee(gross: bigint): { fee: bigint; net: bigint } {
  const fee = (gross * 50n) / 10_000n;
  return { fee, net: gross - fee };
}

/** Short address: 0x1234…abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Format a unix timestamp as a human date */
export function fmtTs(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleString();
}

/** Remaining time from now to a unix timestamp (ts in seconds) */
export function countdown(ts: bigint | number): string {
  const diff = Number(ts) - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
