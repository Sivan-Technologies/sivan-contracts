import { useReadContract, useReadContracts } from "wagmi";
import { ExternalLink, RefreshCw, Lock, Coins } from "lucide-react";
import {
  VAULT_ADDRESS, USDC_ADDRESS, VAULT_ABI, ERC20_ABI, arcTestnet,
} from "../lib/constants";
import { formatUsdc, shortAddr } from "../lib/format";

export default function VaultStatus() {
  const vaultReads = useReadContracts({
    contracts: [
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "treasury"      },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "fundingPaused" },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "FEE_BPS"       },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "CLAIM_WINDOW"  },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "allowedTokens", args: [USDC_ADDRESS] },
      { address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "locked",        args: [USDC_ADDRESS] },
    ],
    query: { refetchInterval: 15_000 },
  });

  const usdcBal = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: [VAULT_ADDRESS],
    query: { refetchInterval: 15_000 },
  });

  const loading = vaultReads.isLoading;
  const [treasury, paused, feeBps, claimWindow, usdcAllowed, lockedAmt] =
    (vaultReads.data ?? []).map((r) => r.result);

  const pausedBool   = paused       as boolean  | undefined;
  const treasuryAddr = treasury     as `0x${string}` | undefined;
  const feeBpsN      = feeBps       as bigint   | undefined;
  const windowN      = claimWindow  as bigint   | undefined;
  const usdcOk       = usdcAllowed  as boolean  | undefined;
  const lockedN      = lockedAmt    as bigint   | undefined;
  const vaultBal     = usdcBal.data as bigint   | undefined;

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: "1.3rem" }}>Vault Status</h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { vaultReads.refetch(); usdcBal.refetch(); }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Deployment card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="text-xs text-faint font-mono" style={{ marginBottom: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Deployed Contract
        </div>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1.05rem" }}>
              SivanClaimVault v1
            </div>
            <div className="text-sm text-muted" style={{ marginTop: 2 }}>
              Arc Testnet — chain 5042002 — block 68,379,040
            </div>
          </div>
          <a
            href={`${arcTestnet.blockExplorers!.default.url}/address/${VAULT_ADDRESS}`}
            target="_blank" rel="noreferrer"
            className="btn btn-ghost btn-sm"
          >
            Explorer <ExternalLink size={12} />
          </a>
        </div>
        <div className="hash-row">
          <Lock size={13} style={{ flexShrink: 0, color: "var(--text-faint)" }} />
          {VAULT_ADDRESS}
        </div>
      </div>

      {/* Config grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="Funding" loading={loading}
          value={pausedBool ? <span className="badge badge-paused">Paused</span> : <span className="badge badge-active">Open</span>}
        />
        <StatCard label="Fee" loading={loading}
          value={feeBpsN !== undefined ? `${Number(feeBpsN)} bps (0.5%)` : "—"}
        />
        <StatCard label="Claim window" loading={loading}
          value={windowN !== undefined ? `${Number(windowN) / 86400} days` : "—"}
        />
        <StatCard label="USDC allowed" loading={loading}
          value={usdcOk !== undefined ? (usdcOk ? <span className="badge badge-active">Yes</span> : <span className="badge badge-none">No</span>) : "—"}
        />
      </div>

      {/* Balances */}
      <div className="card">
        <div className="text-xs text-faint font-mono" style={{ marginBottom: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Vault Balances
        </div>
        <div className="preview-row">
          <span className="preview-row-label"><Coins size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Total USDC held</span>
          <span className="preview-row-value font-mono">
            {vaultBal !== undefined ? formatUsdc(vaultBal) : loading ? "…" : "—"}
          </span>
        </div>
        <div className="preview-row">
          <span className="preview-row-label"><Lock size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />Active liabilities (locked)</span>
          <span className="preview-row-value font-mono">
            {lockedN !== undefined ? formatUsdc(lockedN) : loading ? "…" : "—"}
          </span>
        </div>
        <div className="preview-row">
          <span className="preview-row-label">Surplus (fees + donations)</span>
          <span className="preview-row-value font-mono">
            {vaultBal !== undefined && lockedN !== undefined
              ? formatUsdc(vaultBal - lockedN)
              : loading ? "…" : "—"}
          </span>
        </div>
      </div>

      {/* Roles */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="text-xs text-faint font-mono" style={{ marginBottom: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Roles (testnet EOAs)
        </div>
        <div className="preview-row">
          <span className="preview-row-label">Treasury</span>
          <a
            className="font-mono text-sm text-accent"
            href={`${arcTestnet.blockExplorers!.default.url}/address/${treasuryAddr ?? ""}`}
            target="_blank" rel="noreferrer"
          >
            {treasuryAddr ? shortAddr(treasuryAddr) : loading ? "…" : "—"}
          </a>
        </div>
        <div className="preview-row">
          <span className="preview-row-label">USDC (Arc predeploy)</span>
          <a
            className="font-mono text-sm text-accent"
            href={`${arcTestnet.blockExplorers!.default.url}/address/${USDC_ADDRESS}`}
            target="_blank" rel="noreferrer"
          >
            {shortAddr(USDC_ADDRESS)}
          </a>
        </div>
        <div className="preview-row">
          <span className="preview-row-label">Source verified</span>
          <span className="badge badge-active">Blockscout</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, loading,
}: { label: string; value: React.ReactNode; loading: boolean }) {
  return (
    <div className="card card-sm">
      <div className="text-xs text-faint" style={{ marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "0.95rem" }}>
        {loading ? <span className="text-faint">…</span> : value}
      </div>
    </div>
  );
}
