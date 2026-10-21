import { useState } from "react";
import { Copy, CheckCircle, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { VAULT_ADDRESS, USDC_ADDRESS, arcTestnet } from "../lib/constants";

export default function ApiDocsPage() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.3rem", marginBottom: 6 }}>Connected API Layout</h2>
        <p className="text-sm text-muted">
          Full reference for every read call, write call, and event that this frontend uses against
          <code className="font-mono" style={{ margin: "0 4px", fontSize: "0.78rem" }}>SivanClaimVault v1</code>
          on Arc Testnet. All calls route through wagmi → viem → <code className="font-mono" style={{ fontSize: "0.78rem" }}>https://rpc.testnet.arc.io</code>.
        </p>
      </div>

      {/* Network */}
      <Section title="Network configuration">
        <Row label="Chain ID"            value="5042002 (0x4cef52)" />
        <Row label="RPC"                 value="https://rpc.testnet.arc.io" />
        <Row label="Explorer"            value="https://explorer.testnet.arc.io" link={arcTestnet.blockExplorers!.default.url} />
        <Row label="Native currency"     value="USDC (18-decimal native view)" />
        <Row label="ERC-20 USDC (6 dec)" value={USDC_ADDRESS} mono link={`${arcTestnet.blockExplorers!.default.url}/address/${USDC_ADDRESS}`} />
        <Row label="Vault address"       value={VAULT_ADDRESS} mono link={`${arcTestnet.blockExplorers!.default.url}/address/${VAULT_ADDRESS}`} />
        <Row label="Source verified"     value="Blockscout (2026-10-21)" />
      </Section>

      {/* Reads */}
      <Section title="Read calls (eth_call)">
        <FnCard
          sig="treasury() → address"
          desc="Immutable treasury address that receives the 0.5% fee on every deposit."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'treasury' }`}
        />
        <FnCard
          sig="fundingPaused() → bool"
          desc="If true, new deposits are blocked. Existing claim and refund exits are unaffected."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'fundingPaused' }`}
        />
        <FnCard
          sig="FEE_BPS() → uint256"
          desc="Fee in basis points. Always 50 (0.5%) in v1."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'FEE_BPS' }`}
        />
        <FnCard
          sig="CLAIM_WINDOW() → uint256"
          desc="Deposit expiry window in seconds. Always 604800 (7 days) in v1."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'CLAIM_WINDOW' }`}
        />
        <FnCard
          sig="allowedTokens(address token) → bool"
          desc="Whether a token is on the deposit allowlist. Only Arc Testnet USDC is admitted in this deployment."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'allowedTokens', args: [USDC_ADDRESS] }`}
        />
        <FnCard
          sig="locked(address token) → uint256"
          desc="Total net liabilities locked for active (including expired-but-unrefunded) deposits of a given token."
          used="VaultStatus page"
          example={`{ address: VAULT_ADDRESS, functionName: 'locked', args: [USDC_ADDRESS] }`}
        />
        <FnCard
          sig="nonces(address sender) → uint256"
          desc="Per-sender deposit nonce. Increments on every successful deposit. Used to derive the next deposit ID."
          used="DepositPage (implicit — nonce is read from the emitted event)"
        />
        <FnCard
          sig="deposits(bytes32 depositId) → (sender, token, claimSigner, netAmount, expiresAt, status)"
          desc="Full deposit record. Status: 0=None, 1=Active, 2=Claimed, 3=Refunded. expiresAt is a block timestamp."
          used="ClaimPage, RefundPage"
          example={`{ address: VAULT_ADDRESS, functionName: 'deposits', args: [depositId] }`}
        />
        <FnCard
          sig="claimDigest(bytes32 depositId, address recipient, uint256 deadline) → bytes32"
          desc="Returns the EIP-712 typed-data hash that the link key must sign to authorize a claim. Computed on-chain so the frontend never needs to reconstruct the domain separator."
          used="ClaimPage"
          example={`{ address: VAULT_ADDRESS, functionName: 'claimDigest', args: [depositId, recipient, deadline] }`}
        />
        <FnCard
          sig="deriveDepositId(address sender, uint256 nonce) → bytes32"
          desc="Pure helper — keccak256(chainId, vault, sender, nonce). Use only to predict the next ID before a deposit confirms; always prefer the event-emitted ID for durable tracking."
          used="Not used in the UI directly (IDs read from events)"
        />
        <FnCard
          sig="ERC20 balanceOf(address) → uint256"
          desc="USDC balance of a given address (6-decimal ERC-20 view). Used for the depositor balance display and vault surplus calculation."
          used="DepositPage, VaultStatus"
          example={`{ address: USDC_ADDRESS, functionName: 'balanceOf', args: [account] }`}
        />
        <FnCard
          sig="ERC20 allowance(address owner, address spender) → uint256"
          desc="USDC allowance from owner to vault. Checked before deposit to determine whether an approval step is needed."
          used="DepositPage"
          example={`{ address: USDC_ADDRESS, functionName: 'allowance', args: [owner, VAULT_ADDRESS] }`}
        />
      </Section>

      {/* Writes */}
      <Section title="Write calls (eth_sendRawTransaction)">
        <FnCard
          sig="ERC20 approve(address spender, uint256 amount) → bool"
          desc="Approve the vault to pull grossAmount USDC. Only needed when the current allowance is less than the intended deposit. Sent first in the deposit flow."
          used="DepositPage (approve step)"
          example={`writeContract({ address: USDC_ADDRESS, functionName: 'approve', args: [VAULT_ADDRESS, grossAmount] })`}
        />
        <FnCard
          sig="deposit(address token, uint256 grossAmount, address claimSigner) → bytes32"
          desc="Pull grossAmount USDC from the sender, send fee to treasury, lock net in the vault for 7 days. Emits ClaimVaultDeposited with the deposit ID, fee, net, and expiry."
          used="DepositPage"
          example={`writeContract({ address: VAULT_ADDRESS, functionName: 'deposit', args: [USDC_ADDRESS, grossAmount, linkKeyAddress] })`}
        />
        <FnCard
          sig="claim(bytes32 depositId, address recipient, uint256 deadline, bytes signature)"
          desc="Release net USDC to recipient. Requires a raw-hash ECDSA signature (no eth_sign prefix) over claimDigest(depositId, recipient, deadline) made by the deposit's claimSigner key. Anyone may relay. Reverts if expired, status != Active, or signature invalid."
          used="ClaimPage"
          example={`const sig = account.sign({ hash: digest })\nwriteContract({ address: VAULT_ADDRESS, functionName: 'claim', args: [depositId, recipient, deadline, sig] })`}
        />
        <FnCard
          sig="refund(bytes32 depositId)"
          desc="Return net USDC to the original sender. Only callable by the sender, only after expiresAt. No admin approval required. Fee is not returned."
          used="RefundPage"
          example={`writeContract({ address: VAULT_ADDRESS, functionName: 'refund', args: [depositId] })`}
        />
      </Section>

      {/* Events */}
      <Section title="Events (eth_getLogs)">
        <FnCard
          sig="ClaimVaultDeposited(bytes32 depositId, address sender, address token, address claimSigner, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, uint256 expiresAt)"
          desc="Emitted on every successful deposit. depositId, sender, token are indexed. Parse this event to get the deposit ID after a deposit transaction confirms — never derive the ID from a pre-broadcast nonce."
          used="DepositPage (parses after tx confirmation)"
        />
        <FnCard
          sig="ClaimVaultClaimed(bytes32 depositId, address recipient, uint256 amount)"
          desc="Emitted when a claim succeeds. amount equals the deposit's netAmount."
          used="ClaimPage"
        />
        <FnCard
          sig="ClaimVaultRefunded(bytes32 depositId, address sender, uint256 amount)"
          desc="Emitted when a refund succeeds. amount equals the deposit's netAmount."
          used="RefundPage"
        />
      </Section>

      {/* EIP-712 */}
      <Section title="EIP-712 signing schema">
        <div className="card card-sm" style={{ background: "rgba(0,0,0,0.02)", marginBottom: 12 }}>
          <pre style={{ fontFamily: "var(--mono)", fontSize: "0.78rem", whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--text)" }}>{`Domain:
  name:              "SivanClaimVault"
  version:           "1"
  chainId:           5042002
  verifyingContract: ${VAULT_ADDRESS}

Type:
  Claim(
    bytes32 depositId,
    address recipient,
    uint256 deadline
  )

How to sign (frontend):
  // 1. Read the on-chain digest (avoids re-implementing the domain separator)
  const digest = await readContract({ functionName: 'claimDigest', args: [depositId, recipient, deadline] })
  // 2. Sign the raw 32-byte hash — no eth_sign prefix
  const sig = account.sign({ hash: digest })
  // 3. Pass sig directly to claim()

Important:
  - OZ ECDSA.recover() expects a raw hash with no additional prefix.
  - deadline must satisfy: block.timestamp <= deadline <= expiresAt
  - A copied signature can only pay the signed recipient — not a substituted address.`}</pre>
        </div>
      </Section>

      {/* Error catalogue */}
      <Section title="Revert errors">
        <div style={{ display: "grid", gap: 8 }}>
          {[
            ["ClaimExpired()",         "block.timestamp >= expiresAt when calling claim()"],
            ["FundingPaused()",        "fundingPaused is true when calling deposit()"],
            ["InexactTransfer()",      "Token transfer did not move the exact expected amount (fee-on-transfer protection)"],
            ["InvalidAddress()",      "Zero address, vault address, or contract address passed where an EOA is required"],
            ["InvalidAmount()",       "grossAmount == 0 passed to deposit()"],
            ["InvalidAuthorization()", "ECDSA recovery returned an address != claimSigner, or deadline out of range"],
            ["NotActive()",           "deposit.status != Active when calling claim() or refund()"],
            ["NotSender()",           "msg.sender != deposit.sender when calling refund()"],
            ["RefundNotAvailable()",  "block.timestamp < expiresAt when calling refund()"],
            ["UnsupportedToken()",    "token not in allowedTokens when calling deposit()"],
          ].map(([err, desc]) => (
            <div key={err} className="preview-row" style={{ alignItems: "flex-start", gap: 12 }}>
              <code className="font-mono text-xs" style={{ flexShrink: 0, color: "var(--red)" }}>{err}</code>
              <span className="text-sm text-muted">{desc}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <button
        style={{ all: "unset", display: "flex", alignItems: "center", gap: 8, width: "100%", cursor: "pointer", marginBottom: open ? 16 : 0 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: "1rem" }}>{title}</span>
      </button>
      {open && children}
    </div>
  );
}

function FnCard({ sig, desc, used, example }: { sig: string; desc: string; used: string; example?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (example) navigator.clipboard.writeText(example).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 12 }}>
      <button
        style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 8, width: "100%" }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={13} style={{ marginTop: 2, flexShrink: 0 }} /> : <ChevronRight size={13} style={{ marginTop: 2, flexShrink: 0 }} />}
        <code className="font-mono text-sm" style={{ color: "var(--accent)", lineHeight: 1.4 }}>{sig}</code>
      </button>
      {open && (
        <div style={{ paddingLeft: 21, marginTop: 8 }}>
          <p className="text-sm text-muted" style={{ marginBottom: 6 }}>{desc}</p>
          <div className="text-xs text-faint" style={{ marginBottom: example ? 8 : 0 }}>Used in: {used}</div>
          {example && (
            <div className="hash-row" style={{ position: "relative" }}>
              <pre style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", whiteSpace: "pre-wrap", flex: 1 }}>{example}</pre>
              <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, marginLeft: 8 }} onClick={copy}>
                {copied ? <CheckCircle size={11} /> : <Copy size={11} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label, value, mono, link,
}: { label: string; value: string; mono?: boolean; link?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="preview-row" style={{ alignItems: "flex-start" }}>
      <span className="preview-row-label" style={{ flexShrink: 0, minWidth: 180 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, wordBreak: "break-all" }}>
        <span className={mono ? "font-mono text-xs" : "text-sm font-bold"}>{value}</span>
        {link && <a href={link} target="_blank" rel="noreferrer"><ExternalLink size={11} color="var(--accent)" /></a>}
        {mono && <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 24 }} onClick={copy}>{copied ? <CheckCircle size={10} /> : <Copy size={10} />}</button>}
      </span>
    </div>
  );
}
