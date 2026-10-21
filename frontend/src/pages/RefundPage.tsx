import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEventLogs } from "viem";
import { RotateCcw, CheckCircle, ExternalLink, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  VAULT_ADDRESS, VAULT_ABI, arcTestnet, DepositStatus,
} from "../lib/constants";
import { formatUsdc, shortAddr, fmtTs, countdown } from "../lib/format";

export default function RefundPage() {
  const { address, isConnected } = useAccount();
  const [depositId, setDepositId] = useState("");
  const [refundedTx, setRefundedTx] = useState<string | null>(null);

  const depositIdHex = (depositId.startsWith("0x") && depositId.length === 66)
    ? depositId as `0x${string}` : undefined;

  const { data: deposit, isLoading } = useReadContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "deposits",
    args: depositIdHex ? [depositIdHex] : undefined,
    query: { enabled: !!depositIdHex },
  });

  const dep = deposit as [string, string, string, bigint, bigint, number] | undefined;
  const [sender, , , netAmount, expiresAt, status] = dep ?? [];

  const now        = BigInt(Math.floor(Date.now() / 1000));
  const isActive   = status === DepositStatus.Active;
  const isExpired  = expiresAt !== undefined && now >= expiresAt;
  const isMine     = sender !== undefined && address !== undefined && sender.toLowerCase() === address.toLowerCase();
  const canRefund  = isActive && isExpired && isMine;
  const waitLeft   = expiresAt !== undefined && !isExpired ? countdown(expiresAt) : null;

  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: txPending, isSuccess: txDone, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  if (txDone && receipt && !refundedTx) {
    try {
      const logs = parseEventLogs({ abi: VAULT_ABI, logs: receipt.logs, eventName: "ClaimVaultRefunded" });
      if (logs.length > 0) setRefundedTx(receipt.transactionHash);
      else setRefundedTx(receipt.transactionHash);
    } catch { setRefundedTx(receipt.transactionHash); }
  }

  const handleRefund = () => {
    if (!depositIdHex) { toast.error("Enter a deposit ID."); return; }
    if (!canRefund) { toast.error("Refund not available — check deposit status and expiry."); return; }
    writeContract({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "refund", args: [depositIdHex] });
  };

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <RotateCcw size={32} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: 8 }}>Connect your wallet</div>
        <div className="text-sm text-muted">Connect to Arc Testnet to request a refund.</div>
      </div>
    );
  }

  if (refundedTx) {
    return (
      <div className="card" style={{ borderColor: "var(--green)", borderWidth: 2 }}>
        <CheckCircle size={24} color="var(--green)" style={{ marginBottom: 12 }} />
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Refund confirmed</div>
        <div className="text-sm text-muted" style={{ marginBottom: 16 }}>
          {netAmount !== undefined && `${formatUsdc(netAmount)} returned to sender. The 0.5% fee was non-refundable.`}
        </div>
        <a className="btn btn-ghost" href={`${arcTestnet.blockExplorers!.default.url}/tx/${refundedTx}`} target="_blank" rel="noreferrer">
          View transaction <ExternalLink size={13} />
        </a>
        <button className="btn btn-ghost btn-full" style={{ marginTop: 12 }} onClick={() => { setRefundedTx(null); setDepositId(""); }}>
          Refund another
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginBottom: 20 }}>Request a refund</h3>

        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Clock size={14} />
          Refunds are only available to the original sender after the 7-day claim window expires.
          The 0.5% fee is non-refundable.
        </div>

        <div className="form-group">
          <label className="form-label">Deposit ID (bytes32)</label>
          <input
            className="form-input mono"
            placeholder="0x..."
            value={depositId}
            onChange={(e) => setDepositId(e.target.value)}
          />
        </div>

        {/* Deposit state preview */}
        {depositIdHex && (
          <div className="card card-sm" style={{ background: "rgba(0,0,0,0.02)", marginBottom: 16 }}>
            {isLoading ? (
              <span className="text-sm text-muted">Loading…</span>
            ) : dep && status !== DepositStatus.None ? (
              <>
                <div className="preview-row">
                  <span className="preview-row-label">Status</span>
                  <StatusBadge status={status!} expired={isExpired} />
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Original sender</span>
                  <span className="font-mono text-xs">{shortAddr(sender as string)}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Net amount (refundable)</span>
                  <span className="preview-row-value font-mono">{formatUsdc(netAmount!)}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Refund available after</span>
                  <span className="preview-row-value text-sm">{fmtTs(expiresAt!)}</span>
                </div>
                {waitLeft && (
                  <div className="preview-row">
                    <span className="preview-row-label">Time remaining</span>
                    <span className="preview-row-value" style={{ color: "var(--amber)" }}>
                      <Clock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                      {waitLeft}
                    </span>
                  </div>
                )}
                {!isMine && isActive && (
                  <div className="alert alert-warn" style={{ marginTop: 8 }}>
                    <AlertTriangle size={13} />
                    Only the original sender ({shortAddr(sender as string)}) can refund this deposit.
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted">Deposit not found.</span>
            )}
          </div>
        )}

        {/* Special case: live deposit B from lifecycle session */}
        {depositId === "" && (
          <div className="card card-sm" style={{ background: "rgba(0,0,0,0.02)", marginBottom: 16 }}>
            <div className="text-xs text-faint" style={{ marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Live deposit B (from lifecycle test)
            </div>
            <div className="preview-row">
              <span className="preview-row-label">Deposit ID</span>
              <button className="btn btn-ghost btn-sm font-mono" style={{ fontSize: "0.72rem" }}
                onClick={() => setDepositId("0x018f6f38f053645e1e65b759f9c48ac594eb8bc911444a2dbbfbfac38c565022")}>
                0x018f6f38… (click to load)
              </button>
            </div>
            <div className="preview-row">
              <span className="preview-row-label">Refund available after</span>
              <span className="preview-row-value text-sm">2026-10-28T16:38:11Z</span>
            </div>
          </div>
        )}

        <button
          className="btn btn-primary btn-full"
          disabled={!canRefund || txPending}
          onClick={handleRefund}
        >
          {txPending
            ? <><span className="spinner" /> Refunding…</>
            : waitLeft
            ? <><Clock size={14} /> Refund available in {waitLeft}</>
            : <><RotateCcw size={14} /> Confirm refund</>}
        </button>

        {isActive && isExpired && !isMine && (
          <div className="alert alert-warn" style={{ marginTop: 12 }}>
            <AlertTriangle size={14} />
            Your connected wallet is not the deposit sender — only the original sender can refund.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, expired }: { status: number; expired: boolean }) {
  if (status === DepositStatus.Claimed)  return <span className="badge badge-claimed">Claimed</span>;
  if (status === DepositStatus.Refunded) return <span className="badge badge-refunded">Refunded</span>;
  if (status === DepositStatus.Active && expired) return <span className="badge badge-active">Ready to refund</span>;
  if (status === DepositStatus.Active)   return <span className="badge badge-none">Active (waiting)</span>;
  return <span className="badge badge-none">None</span>;
}
