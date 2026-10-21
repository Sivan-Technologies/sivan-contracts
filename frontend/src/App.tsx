import { useState } from "react";
import { ConnectKitButton } from "connectkit";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import {
  Layers, Send, Download, RotateCcw, Info,
  AlertTriangle, Book, Activity,
} from "lucide-react";
import VaultStatus from "./pages/VaultStatus";
import DepositPage from "./pages/DepositPage";
import ClaimPage   from "./pages/ClaimPage";
import RefundPage  from "./pages/RefundPage";
import ApiDocsPage from "./pages/ApiDocsPage";
import { arcTestnet } from "./lib/constants";

type Page = "status" | "deposit" | "claim" | "refund" | "api";

export default function App() {
  const [page, setPage] = useState<Page>("status");
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== arcTestnet.id;

  return (
    <div className="app-layout">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="flex items-center gap-2" style={{ marginBottom: 24 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "var(--navy)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <Layers size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "0.9rem" }}>Claim Vault</div>
            <div className="text-xs text-faint">Arc Testnet</div>
          </div>
        </div>

        <span className="nav-section-label">Vault</span>
        <NavBtn page="status"  cur={page} set={setPage} icon={<Activity  size={15} />} label="Vault Status" />

        <span className="nav-section-label">Actions</span>
        <NavBtn page="deposit" cur={page} set={setPage} icon={<Send      size={15} />} label="Deposit"      />
        <NavBtn page="claim"   cur={page} set={setPage} icon={<Download  size={15} />} label="Claim"        />
        <NavBtn page="refund"  cur={page} set={setPage} icon={<RotateCcw size={15} />} label="Refund"       />

        <span className="nav-section-label">Reference</span>
        <NavBtn page="api"     cur={page} set={setPage} icon={<Book      size={15} />} label="API Layout"   />

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <div className="card card-sm" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <Info size={12} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            Testnet only — no real funds.
            <br />
            <span className="text-faint">Journal:</span>
            <code className="font-mono" style={{ display: "block", marginTop: 4, fontSize: "0.7rem", wordBreak: "break-all" }}>
              deployments/claim-5042002-v1.json
            </code>
          </div>
        </div>
      </aside>

      {/* ── Topbar ───────────────────────────────────────── */}
      <header className="topbar">
        <div className="flex items-center gap-3">
          <span style={{ fontFamily: "Space Grotesk", fontWeight: 600, fontSize: "0.95rem" }}>
            {pageTitle(page)}
          </span>
          <span className="badge badge-active" style={{ fontSize: "0.65rem" }}>
            Arc Testnet 5042002
          </span>
        </div>
        <div className="flex items-center gap-2">
          {wrongChain && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => switchChain({ chainId: arcTestnet.id })}
            >
              <AlertTriangle size={13} />
              Switch to Arc Testnet
            </button>
          )}
          <ConnectKitButton />
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────── */}
      <main className="main-content">
        {wrongChain && (
          <div className="alert alert-warn">
            <AlertTriangle size={16} />
            Your wallet is on chain {chainId}. Switch to Arc Testnet (5042002) to interact.
          </div>
        )}
        {page === "status"  && <VaultStatus />}
        {page === "deposit" && <DepositPage />}
        {page === "claim"   && <ClaimPage   />}
        {page === "refund"  && <RefundPage  />}
        {page === "api"     && <ApiDocsPage />}
      </main>
    </div>
  );
}

function NavBtn({
  page, cur, set, icon, label,
}: {
  page: Page; cur: Page; set: (p: Page) => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button
      className={`nav-link${cur === page ? " active" : ""}`}
      onClick={() => set(page)}
    >
      {icon} {label}
    </button>
  );
}

function pageTitle(p: Page): string {
  const titles: Record<Page, string> = {
    status: "Vault Status", deposit: "Deposit", claim: "Claim",
    refund: "Refund", api: "API Layout",
  };
  return titles[p];
}
