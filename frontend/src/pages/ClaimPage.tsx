import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEventLogs } from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { toast } from "sonner";
import { Download, CheckCircle, ExternalLink, AlertTriangle, Eye } from "lucide-react";
import {
  VAULT_ADDRESS, USDC_ADDRESS, VAULT_ABI, arcTestnet, DepositStatus,
} from "../lib/constants";
import { formatUsdc, shortAddr, fmtTs, countdown } from "../lib/format";

export default function ClaimPage() {
  const { address, isConnected } = useAccount();
  const [depositId, setDepositId]   = useState("");
  const [linkPrivKey, setLinkPrivKey] = useState("");
  const [recipient, setRecipient]   = useState(address ?? "");
  const [deadline, setDeadline]     = useState<string>("");
  const [claiming, setClaiming]     = useState(false);
  const [claimedTx, setClaimedTx]   = useState<string | null>(null);

  const depositIdHex = (depositId.startsWith("0x") && depositId.length === 66)
    ? depositId as `0x${string}` : undefined;

  // Read deposit state
  const { data: deposit, isLoading: depositLoading, refetch } = useReadContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "deposits",
    args: depositIdHex ? [depositIdHex] : undefined,
    query: { enabled: !!depositIdHex },
  });

  const dep = deposit as [string, string, string, bigint, bigint, number] | undefined;
  const [, , claimSigner, netAmount, expiresAt, status] = dep ?? [];

  const isActive   = status === DepositStatus.Active;
  const isExpired  = expiresAt !== undefined && BigInt(Math.floor(Date.now() / 1000)) >= expiresAt;
  const isClaimed  = status === DepositStatus.Claimed;
  const isRefunded = status === DepositStatus.Refunded;

  // Compute claimDigest on-chain
  const deadlineBn = deadline ? BigInt(Math.floor(new Date(deadline).getTime() / 1000)) : undefined;
  const recipientAddr = (recipient.startsWith("0x") && recipient.length === 42)
    ? recipient as `0x${string}` : undefined;

  const { data: digest } = useReadContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "claimDigest",
    args: depositIdHex && recipientAddr && deadlineBn ? [depositIdHex, recipientAddr, deadlineBn] : undefined,
    query: { enabled: !!(depositIdHex && recipientAddr && deadlineBn) },
  });

  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: txPending, isSuccess: txDone, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  if (txDone && receipt && claiming) {
    setClaiming(false);
    try {
      const logs = parseEventLogs({ abi: VAULT_ABI, logs: receipt.logs, eventName: "ClaimVaultClaimed" });
      if (logs.length > 0) setClaimedTx(receipt.transactionHash);
    } catch { setClaimedTx(receipt.transactionHash); }
  }

  const handleClaim = async () => {
    if (!depositIdHex || !recipientAddr || !deadlineBn || !digest || !linkPrivKey) {
      toast.error("Fill all fields before claiming.");
      return;
    }
    try {
      // Sign the raw EIP-712 digest with the link key (no eth_sign prefix — raw hash)
      let privKey = linkPrivKey.trim() as `0x${string}`;
      if (!privKey.startsWith("0x")) privKey = `0x${privKey}` as `0x${string}`;
      const acc = privateKeyToAccount(privKey);
      if (acc.address.toLowerCase() !== (claimSigner as string).toLowerCase()) {
        toast.error(`Key mismatch: derived ${acc.address}, expected ${claimSigner}`);
        return;
      }
      // signTypedData produces the signature using the EIP-712 typed-data domain and message.
      // The vault uses ECDSA.recover(claimDigest(…), sig) — claimDigest already includes the domain prefix,
      // so we sign the raw bytes of the digest directly (no double-hashing).
      // Use account.sign on the raw 32-byte digest.
      const sig = await acc.sign({ hash: digest as `0x${string}` });

      setClaiming(true);
      writeContract({
        address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "claim",
        args: [depositIdHex, recipientAddr, deadlineBn, sig],
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Signing error: ${msg.slice(0, 100)}`);
    }
  };

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <Download size={32} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: 8 }}>Connect your wallet</div>
        <div className="text-sm text-muted">Connect to Arc Testnet to claim.</div>
      </div>
    );
  }

  if (claimedTx) {
    return (
      <div className="card" style={{ borderColor: "var(--green)", borderWidth: 2 }}>
        <CheckCircle size={24} color="var(--green)" style={{ marginBottom: 12 }} />
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Claim confirmed</div>
        <a className="btn btn-ghost" href={`${arcTestnet.blockExplorers!.default.url}/tx/${claimedTx}`} target="_blank" rel="noreferrer">
          View transaction <ExternalLink size={13} />
        </a>
        <button className="btn btn-ghost btn-full" style={{ marginTop: 12 }} onClick={() => { setClaimedTx(null); setDepositId(""); }}>
          Claim another
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ marginBottom: 20 }}>Claim a deposit</h3>

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
            {depositLoading ? (
              <span className="text-sm text-muted">Loading deposit…</span>
            ) : dep && status !== DepositStatus.None ? (
              <>
                <div className="preview-row">
                  <span className="preview-row-label">Status</span>
                  <StatusBadge status={status!} expired={isExpired} />
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Net claimable</span>
                  <span className="preview-row-value font-mono">{formatUsdc(netAmount!)}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Expires</span>
                  <span className="preview-row-value text-sm">
                    {fmtTs(expiresAt!)}
                    {isActive && !isExpired && (
                      <span className="text-muted" style={{ marginLeft: 8 }}>({countdown(expiresAt!)} left)</span>
                    )}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-row-label">Claim signer</span>
                  <span className="font-mono text-xs">{shortAddr(claimSigner as string)}</span>
                </div>
              </>
            ) : (
              <span className="text-sm text-muted">Deposit not found — check the ID.</span>
            )}
          </div>
        )}

        {isClaimed  && <div className="alert alert-info"><Eye size={14} /> This deposit has already been claimed.</div>}
        {isRefunded && <div className="alert alert-warn"><AlertTriangle size={14} /> This deposit has been refunded.</div>}
        {isExpired && isActive && <div className="alert alert-warn"><AlertTriangle size={14} /> Deposit is expired — only a refund is now possible.</div>}

        {isActive && !isExpired && (
          <>
            <div className="form-group">
              <label className="form-label">Link private key (bearer key)</label>
              <input
                className="form-input mono"
                type="password"
                placeholder="0x..."
                value={linkPrivKey}
                onChange={(e) => setLinkPrivKey(e.target.value)}
              />
              <span className="form-hint">The private key stored in the claim URL fragment. Never transmitted on-chain.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Recipient address</label>
              <input
                className="form-input mono"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Authorization deadline</label>
              <input
                className="form-input"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
              <span className="form-hint">Must be before deposit expiry ({expiresAt ? fmtTs(expiresAt) : "—"}).</span>
            </div>

            {digest && (
              <div className="card card-sm" style={{ background: "rgba(0,0,0,0.02)", marginBottom: 16 }}>
                <div className="text-xs text-faint" style={{ marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>On-chain claimDigest (EIP-712)</div>
                <div className="hash-row text-xs">{digest as string}</div>
              </div>
            )}

            <button
              className="btn btn-accent btn-full"
              disabled={!depositIdHex || !linkPrivKey || !recipientAddr || !deadlineBn || claiming || txPending}
              onClick={handleClaim}
            >
              {(claiming || txPending) ? <><span className="spinner" /> Claiming…</> : <><Download size={15} /> Sign &amp; relay claim</>}
            </button>
          </>
        )}
      </div>

      <div className="alert alert-info" style={{ marginTop: 16 }}>
        <AlertTriangle size={14} />
        Anyone may relay a signed authorization. The recipient cannot be changed after signing.
      </div>
    </div>
  );
}

function StatusBadge({ status, expired }: { status: number; expired: boolean }) {
  if (status === DepositStatus.Claimed)  return <span className="badge badge-claimed">Claimed</span>;
  if (status === DepositStatus.Refunded) return <span className="badge badge-refunded">Refunded</span>;
  if (status === DepositStatus.Active && expired) return <span className="badge badge-refunded">Expired (refund only)</span>;
  if (status === DepositStatus.Active)   return <span className="badge badge-active">Active</span>;
  return <span className="badge badge-none">None</span>;
}
