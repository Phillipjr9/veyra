import { useEffect, useRef, useState, type FormEvent } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { ArrowDownLeft, Copy, Download, Link2, QrCode, Wallet } from "lucide-react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { copyText } from "../lib/store";
import { assetIcon } from "../lib/holdings";

export type CryptoWallet = {
  id: string; kind: "deposit" | "linked"; network: string; asset: string;
  address: string; label: string; createdAt: number;
};

function Barcode({ value }: { value: string }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svg.current || !value) return;
    try {
      JsBarcode(svg.current, value, { format: "CODE128", displayValue: false, lineColor: "#1f1730", background: "#ffffff", width: 1.4, height: 56, margin: 4 });
    } catch { /* Some addresses cannot be encoded; QR still works. */ }
  }, [value]);
  return <svg ref={svg} role="img" aria-label="Wallet barcode" />;
}

function WalletCard({ wallet, onReceive }: { wallet: CryptoWallet; onReceive?: (wallet: CryptoWallet) => void }) {
  const [qr, setQr] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(wallet.address, { width: 480, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1f1730", light: "#ffffff" } })
      .then(value => { if (live) setQr(value); })
      .catch(() => { if (live) setNote("QR unavailable. Copy the address."); });
    return () => { live = false; };
  }, [wallet.address]);
  async function copy() {
    const ok = await copyText(wallet.address);
    setNote(ok ? "Address copied." : "Copy is unavailable. Select the address instead.");
  }
  return (
    <article className="cw-deposit-card" aria-label={`${wallet.label} ${wallet.kind} wallet`}>
      <div className="cw-deposit-head">
        <img src={assetIcon(wallet.asset)} width={28} height={28} alt="" />
        <div>
          <b>{wallet.label}</b>
          <small>{wallet.network} · {wallet.kind === "deposit" ? "Veyra receive address" : "Linked external wallet"}</small>
        </div>
        {wallet.kind === "deposit" && onReceive && (
          <button type="button" className="ghost-btn sm" onClick={() => onReceive(wallet)}><ArrowDownLeft size={14} /> I sent funds</button>
        )}
      </div>
      <div className="cw-deposit-codes">
        {qr && <img className="cw-qr" src={qr} alt={`${wallet.asset} receive QR`} width={140} height={140} />}
        <div className="cw-barcode"><Barcode value={wallet.address} /></div>
      </div>
      <code className="cw-address">{wallet.address}</code>
      <div className="cw-wallet-actions">
        <button type="button" className="ghost-btn sm" onClick={() => void copy()}><Copy size={14} /> Copy</button>
        {qr && <a className="ghost-btn sm" href={qr} download={`veyra-${wallet.asset.toLowerCase()}-qr.png`}><Download size={14} /> Save QR</a>}
      </div>
      {note && <p role="status" className="cw-subtle">{note}</p>}
    </article>
  );
}

export function CryptoWalletsPanel() {
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [network, setNetwork] = useState<"Bitcoin" | "Ethereum" | "Solana">("Ethereum");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [receive, setReceive] = useState<CryptoWallet | null>(null);
  const [amount, setAmount] = useState("");
  const [txid, setTxid] = useState("");
  const key = useRef(crypto.randomUUID());

  async function load() {
    try {
      const data = await apiGet<{ wallets: CryptoWallet[] }>("/api/me/crypto/wallets");
      setWallets(data.wallets); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load wallets."); }
  }
  useEffect(() => { void load(); }, []);

  async function link(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await apiPost("/api/me/crypto/wallets/link", { network, address: address.trim(), label: label.trim(), requestKey: key.current });
      key.current = crypto.randomUUID();
      setAddress(""); setLabel("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not link that wallet.");
      key.current = crypto.randomUUID();
    } finally { setBusy(false); }
  }

  async function recordReceive(event: FormEvent) {
    event.preventDefault();
    if (!receive) return;
    setBusy(true); setError("");
    try {
      await apiPost("/api/me/crypto/wallets/receive", { asset: receive.asset, amount, txid: txid.trim(), requestKey: key.current });
      key.current = crypto.randomUUID();
      setReceive(null); setAmount(""); setTxid("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record that deposit.");
      key.current = crypto.randomUUID();
    } finally { setBusy(false); }
  }

  const deposits = wallets.filter(w => w.kind === "deposit");
  const linked = wallets.filter(w => w.kind === "linked");

  return (
    <section className="cw-card cw-wallets-panel">
      <div className="cw-section-head">
        <div><span className="cw-eyebrow"><QrCode size={14} /> YOUR VEYRA WALLETS</span><h2>Receive from any external wallet</h2></div>
        <span className="cw-icon"><Wallet size={23} /></span>
      </div>
      <p className="cw-subtle">Each account has its own deposit addresses. Share the QR, barcode or full address. Incoming coins credit your Veyra holdings after you record the deposit.</p>
      {error && <p role="alert" className="banking-error">{error}</p>}
      <div className="cw-deposit-grid">
        {deposits.map(wallet => <WalletCard key={wallet.id} wallet={wallet} onReceive={setReceive} />)}
      </div>
      {receive && (
        <form className="dash-form cw-receive-form" onSubmit={recordReceive}>
          <h3>Record inbound {receive.asset}</h3>
          <p className="cw-subtle">Use this after you send {receive.asset} to the address above from an external wallet.</p>
          <label>Quantity<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Amount in ${receive.asset}`} /></label>
          <label>Transaction id (optional)<input maxLength={120} value={txid} onChange={e => setTxid(e.target.value)} placeholder="On-chain hash, if you have one" /></label>
          <div className="cw-wallet-actions">
            <button type="submit" className="solid-btn" disabled={busy}>{busy ? "Recording…" : `Credit ${receive.asset}`}</button>
            <button type="button" className="ghost-btn" onClick={() => setReceive(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="cw-section-head" style={{ marginTop: 18 }}>
        <div><span className="cw-eyebrow"><Link2 size={14} /> SELF-CUSTODY</span><h2>Link an external wallet</h2></div>
      </div>
      <p className="cw-subtle">Paste a public address to link Bitcoin, Ethereum or Solana without a browser extension. Connecting never asks for a key or recovery phrase.</p>
      <form className="dash-form" onSubmit={link}>
        <label>Network
          <select value={network} onChange={e => setNetwork(e.target.value as typeof network)}>
            <option>Bitcoin</option><option>Ethereum</option><option>Solana</option>
          </select>
        </label>
        <label>Wallet address<input required maxLength={120} autoComplete="off" spellCheck={false} value={address} onChange={e => setAddress(e.target.value)} placeholder={network === "Bitcoin" ? "bc1…" : network === "Solana" ? "Base58 address" : "0x…"} /></label>
        <label>Label (optional)<input maxLength={80} value={label} onChange={e => setLabel(e.target.value)} placeholder="Ledger, Rainbow, Phantom…" /></label>
        <button type="submit" className="solid-btn" disabled={busy}><Link2 size={15} />{busy ? "Linking…" : "Link wallet"}</button>
      </form>
      {linked.length > 0 && (
        <div className="cw-deposit-grid" style={{ marginTop: 16 }}>
          {linked.map(wallet => <WalletCard key={wallet.id} wallet={wallet} />)}
        </div>
      )}
    </section>
  );
}
