import { useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { parseEventLogs } from "viem";
import { toast } from "sonner";
import { Send, RefreshCw, AlertTriangle, CheckCircle, Copy, ExternalLink } from "lucide-react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  VAULT_ADDRESS, USDC_ADDRESS, VAULT_ABI, ERC20_ABI, arcTestnet,
  USDC_DECIMALS,
} from "../lib/constants";
import { formatUsdc, parseUsdc, computeFee, shortAddr } from "../lib/format";

type Step = "form" | "approve" | "approving" | "deposit" | "depositing" | "done";

interface DepositResult {
  depositId: string;
  linkPrivKey: string;
  linkAddress: string;
  grossAmount: bigint;
  feeAmount: bigint;
  netAmount: bigint;
  expiresAt: bigint;
  txHash: string;
}

export default function DepositPage() {
  const { address, isConnected } = useAccount();
  const [step, setStep]             = useState<Step>("form");
  const [amountStr, setAmountStr]   = useState("");
  const [result, setResult]         = useState<DepositResult | null>(null);
  const [linkKey, setLinkKey]       = useState<{ priv: `0x${string}`; addr: `0x${string}` } | null>(null);
  const [copied, setCopied]         = useState<string | null>(null);

  // Live USDC balance & allowance
  const { data: balance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
    args: address ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const { writeContract, data: txHash, reset: resetWrite } = useWriteContract();
  const { isLoading: txPending, isSuccess: txSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  const grossRaw  = (() => { try { return parseUsdc(amountStr); } catch { return null; } })();
  const { fee, net } = grossRaw ? computeFee(grossRaw) : { fee: 0n, net: 0n };
  const needsApproval = grossRaw !== null && grossRaw > 0n && (allowance ?? 0n) < grossRaw;

  const generateLink = useCallback(() => {
    const priv = generatePrivateKey();
    const acc  = privateKeyToAccount(priv);
    return { priv, addr: acc.address };
  }, []);

  // ── Step: Approve ──
  const handleApprove = () => {
    if (!grossRaw || !address) return;
    let key = linkKey;
    if (!key) { key = generateLink(); setLinkKey(key); }
    setStep("approving");
    writeContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve",
      args: [VAULT_ADDRESS, grossRaw],
    });
  };

  // ── Step: Deposit ──
  const handleDeposit = () => {
    if (!grossRaw || !linkKey) return;
    setStep("depositing");
    writeContract({
      address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "deposit",
      args: [USDC_ADDRESS, grossRaw, linkKey.addr],
    });
  };

  // Watch tx confirmation
  if (step === "approving" && txSuccess && receipt) {
    refetchAllowance();
    setStep("deposit");
    resetWrite();
  }
  if (step === "depositing" && txSuccess && receipt) {
    try {
      const logs = parseEventLogs({ abi: VAULT_ABI, logs: receipt.logs, eventName: "ClaimVaultDeposited" });
      if (logs.length > 0) {
        const ev = logs[0].args as {
          depositId: `0x${string}`; feeAmount: bigint; netAmount: bigint; expiresAt: bigint;
        };
        setResult({
          depositId:   ev.depositId,
          linkPrivKey: linkKey!.priv,
          linkAddress: linkKey!.addr,
          grossAmount: grossRaw!,
          feeAmount:   ev.feeAmount,
          netAmount:   ev.netAmount,
          expiresAt:   ev.expiresAt,
          txHash:      receipt.transactionHash,
        });
        setStep("done");
      }
    } catch (e) {
      toast.error("Could not parse deposit event — check the tx on the explorer.");
    }
  }

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  };

  const reset = () => { setStep("form"); setAmountStr(""); setLinkKey(null); setResult(null); resetWrite(); };

  // ── Render ──
  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <Send size={32} style={{ margin: "0 auto 12px", color: "var(--text-faint)" }} />
        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Connect your wallet</div>
        <div className="text-sm text-muted">Connect to Arc Testnet to create a deposit.</div>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div>
        <div className="card" style={{ borderColor: "var(--green)", borderWidth: 2 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 20 }}>
            <CheckCircle size={20} color="var(--green)" />
            <span style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1.1rem" }}>Deposit confirmed</span>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Deposit ID</span>
            <button className="btn btn-ghost btn-sm font-mono" style={{ fontSize: "0.72rem" }} onClick={() => copy(result.depositId, "id")}>
              {shortAddr(result.depositId)} {copied === "id" ? <CheckCircle size={11} /> : <Copy size={11} />}
            </button>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Gross deposited</span>
            <span className="preview-row-value font-mono">{formatUsdc(result.grossAmount)}</span>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Fee (0.5%, non-refundable)</span>
            <span className="preview-row-value font-mono">{formatUsdc(result.feeAmount)}</span>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Net locked (claimable)</span>
            <span className="preview-row-value font-mono text-green">{formatUsdc(result.netAmount)}</span>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Expires (refundable after)</span>
            <span className="preview-row-value font-mono" style={{ fontSize: "0.78rem" }}>
              {new Date(Number(result.expiresAt) * 1000).toUTCString()}
            </span>
          </div>
          <div className="preview-row">
            <span className="preview-row-label">Tx hash</span>
            <a className="btn btn-ghost btn-sm" href={`${arcTestnet.blockExplorers!.default.url}/tx/${result.txHash}`} target="_blank" rel="noreferrer">
              Explorer <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <div className="card alert-warn" style={{ marginTop: 16 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 12, fontWeight: 700 }}>
            <AlertTriangle size={16} /> Claim link private key — save this now
          </div>
          <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
            This key is the only way to authorize a claim. Store it in the link fragment (after <code>#</code>) and never send it on-chain or in plaintext.
          </div>
          <div className="hash-row" style={{ marginBottom: 8, userSelect: "all" }}>
            {result.linkPrivKey}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }} onClick={() => copy(result.linkPrivKey, "priv")}>
              {copied === "priv" ? <CheckCircle size={11} /> : <Copy size={11} />}
            </button>
          </div>
          <div className="text-xs text-muted">Signer address: <code className="font-mono">{result.linkAddress}</code></div>
        </div>

        <button className="btn btn-ghost btn-full" style={{ marginTop: 16 }} onClick={reset}>
          <RefreshCw size={14} /> New deposit
        </button>
      </div>
    );
  }

  // ── Step indicator ──
  const steps = ["Amount", "Approve", "Deposit", "Done"];
  const stepIdx = { form: 0, approve: 1, approving: 1, deposit: 2, depositing: 2, done: 3 }[step];

  return (
    <div>
      <StepBar steps={steps} current={stepIdx} />

      <div className="card">
        <h3 style={{ marginBottom: 20 }}>Create a deposit</h3>

        {/* Amount */}
        <div className="form-group">
          <label className="form-label">Gross amount (USDC)</label>
          <div className="amount-wrap">
            <input
              className="amount-input"
              type="number" min="0.000001" step="0.01"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              disabled={step !== "form"}
            />
            <span className="amount-currency">USDC</span>
          </div>
          <div className="form-hint">
            Your balance: <strong className="font-mono">{balance !== undefined ? formatUsdc(balance as bigint) : "…"}</strong>
          </div>
        </div>

        <FeePreview fee={fee} net={net} show={grossRaw !== null && grossRaw > 0n} />

        {/* Allowance info */}
        {!!grossRaw && needsApproval && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <AlertTriangle size={14} />
            Your current USDC allowance ({formatUsdc((allowance ?? 0n) as bigint)}) is less than the
            gross amount. You need to approve the vault first.
          </div>
        )}

        {/* CTA */}
        {step === "form" && (
          <button
            className="btn btn-primary btn-full"
            disabled={!grossRaw || grossRaw === 0n || !address}
            onClick={() => needsApproval ? handleApprove() : (setStep("deposit"), setLinkKey(generateLink()))}
          >
            {needsApproval ? "Approve USDC" : "Generate link & deposit"}
          </button>
        )}
        {(step === "approve" || step === "approving") && (
          <button
            className="btn btn-primary btn-full"
            disabled={step === "approving" || txPending}
            onClick={handleApprove}
          >
            {(step === "approving" || txPending) ? <><span className="spinner" /> Approving…</> : "Approve USDC"}
          </button>
        )}
        {step === "deposit" && (
          <button
            className="btn btn-accent btn-full"
            disabled={!grossRaw}
            onClick={handleDeposit}
          >
            <Send size={15} /> Confirm deposit
          </button>
        )}
        {step === "depositing" && (
          <button className="btn btn-accent btn-full" disabled>
            <span className="spinner" /> Confirming…
          </button>
        )}
      </div>

      <div className="alert alert-info" style={{ marginTop: 16 }}>
        <AlertTriangle size={14} />
        A fresh cryptographic bearer key is generated per deposit. The key is shown once after the deposit confirms — keep it in the URL fragment of your claim link.
      </div>
    </div>
  );
}

function FeePreview({ fee, net, show }: { fee: bigint; net: bigint; show: boolean }) {
  if (!show) return null;
  return (
    <div className="card card-sm" style={{ background: "rgba(0,0,0,0.02)", marginBottom: 16 }}>
      <div className="preview-row">
        <span className="preview-row-label">Fee (50 bps)</span>
        <span className="preview-row-value font-mono">{formatUsdc(fee)}</span>
      </div>
      <div className="preview-row">
        <span className="preview-row-label">Net locked (claimable / refundable)</span>
        <span className="preview-row-value font-mono text-green">{formatUsdc(net)}</span>
      </div>
      <div className="preview-row">
        <span className="preview-row-label">Expires after</span>
        <span className="preview-row-value">7 days from deposit block</span>
      </div>
    </div>
  );
}

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="step-bar" style={{ marginBottom: 24 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: "contents" }}>
          <div className="step-item">
            <div className={`step-dot${i < current ? " done" : i === current ? " active" : ""}`}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className="step-label">{s}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`step-line${i < current ? " done" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}
