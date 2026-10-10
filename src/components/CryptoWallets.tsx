import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { ArrowLeft, Copy, Download, Link2, QrCode, ShieldCheck } from "lucide-react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { copyText } from "../lib/store";
import { assetIcon } from "../lib/holdings";
import "../styles/crypto-workspace.css";

export type CryptoWallet = {
  id: string; kind: "deposit" | "linked"; network: string; asset: string;
  address: string; label: string; createdAt: number;
};

const BRANDS = [
  { label: "MetaMask", network: "Ethereum" as const },
  { label: "Trust Wallet", network: "Ethereum" as const },
  { label: "Coinbase Wallet", network: "Ethereum" as const },
  { label: "Rainbow", network: "Ethereum" as const },
  { label: "Phantom", network: "Solana" as const },
  { label: "UniSat", network: "Bitcoin" as const },
  { label: "Other", network: "Ethereum" as const },
];

export function Barcode({ value }: { value: string }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svg.current || !value) return;
    try {
      JsBarcode(svg.current, value, { format: "CODE128", displayValue: false, lineColor: "#1f1730", background: "#ffffff", width: 1.4, height: 64, margin: 4 });
    } catch { /* Some addresses cannot be encoded; QR still works. */ }
  }, [value]);
  return <svg ref={svg} role="img" aria-label="Wallet barcode" />;
}

function useWallets() {
  const [wallets, setWallets] = useState<CryptoWallet[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    try {
      const data = await apiGet<{ wallets: CryptoWallet[] }>("/api/me/crypto/wallets");
      setWallets(data.wallets); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load wallets."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return { wallets, error, setError, loading, load };
}

function WalletTile({ wallet }: { wallet: CryptoWallet }) {
  return (
    <Link className="cw-wallet-tile" to={`/app/assets/wallets/${wallet.id}`} aria-label={`${wallet.label} wallet`}>
      <div className="cw-wallet-tile-face">
        <span className="cw-wallet-tile-shine" aria-hidden="true" />
        <img className="cw-wallet-tile-coin" src={assetIcon(wallet.asset)} alt="" />
        <small>{wallet.kind === "linked" ? "Linked wallet" : "Receive address"}</small>
        <b>{wallet.label}</b>
        <span>{wallet.network} · {wallet.asset}</span>
        <code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-5)}</code>
      </div>
    </Link>
  );
}

function LinkWalletForm({ onLinked }: { onLinked: (wallet: CryptoWallet) => void }) {
  const [brand, setBrand] = useState(BRANDS[0].label);
  const [network, setNetwork] = useState<"Bitcoin" | "Ethereum" | "Solana">("Ethereum");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  function pick(next: string) {
    const match = BRANDS.find(row => row.label === next) ?? BRANDS[0];
    setBrand(match.label); setNetwork(match.network); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await apiPost<{ wallet: CryptoWallet }>("/api/me/crypto/wallets/link", {
        network, address: address.trim(), label: brand === "Other" ? "" : brand, requestKey: key.current,
      });
      key.current = crypto.randomUUID();
      setAddress("");
      onLinked(result.wallet);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not link that wallet.");
      key.current = crypto.randomUUID();
    } finally { setBusy(false); }
  }
  return (
    <form className="dash-form cw-link-form" onSubmit={submit}>
      <div className="cw-section-head">
        <div>
          <span className="cw-eyebrow"><Link2 size={14} /> SELF-CUSTODY</span>
          <h2>Link MetaMask, Trust Wallet and more</h2>
        </div>
      </div>
      <p className="cw-subtle">Paste a public address. No browser extension, keys or recovery phrase. Each linked wallet gets its own page with a QR code and barcode.</p>
      {error && <p role="alert" className="banking-error">{error}</p>}
      <label>Wallet
        <select value={brand} onChange={e => pick(e.target.value)}>
          {BRANDS.map(row => <option key={row.label}>{row.label}</option>)}
        </select>
      </label>
      <label>Network
        <select value={network} onChange={e => setNetwork(e.target.value as typeof network)}>
          <option>Bitcoin</option><option>Ethereum</option><option>Solana</option>
        </select>
      </label>
      <label>Public address
        <input required maxLength={120} autoComplete="off" spellCheck={false} value={address} onChange={e => setAddress(e.target.value)} placeholder={network === "Bitcoin" ? "bc1…" : network === "Solana" ? "Base58 address" : "0x…"} />
      </label>
      <button type="submit" className="solid-btn" disabled={busy}><Link2 size={15} />{busy ? "Linking…" : `Link ${brand}`}</button>
    </form>
  );
}

export function CryptoReceivePage() {
  const navigate = useNavigate();
  const { wallets, error, loading, load } = useWallets();
  const deposits = wallets.filter(w => w.kind === "deposit");
  const linked = wallets.filter(w => w.kind === "linked");
  return (
    <div className="app-page cw-workspace">
      <header className="cw-page-head">
        <div>
          <Link to="/app/assets" className="text-link"><ArrowLeft size={15} /> Crypto</Link>
          <span className="cw-eyebrow"><QrCode size={14} /> RECEIVE</span>
          <h1>Your wallets</h1>
          <p>Open a wallet for its QR code and barcode. Link MetaMask, Trust Wallet, Phantom or UniSat by pasting an address.</p>
        </div>
      </header>
      {error && <p role="alert" className="banking-error">{error}</p>}
      {loading && !wallets.length && <p role="status">Loading wallets…</p>}
      <section>
        <div className="cw-section-head"><div><h2>Receive addresses</h2></div></div>
        <div className="cw-wallet-stage">
          {deposits.map(wallet => <WalletTile key={wallet.id} wallet={wallet} />)}
        </div>
      </section>
      <section className="cw-card cw-link-panel">
        <LinkWalletForm onLinked={wallet => { void load(); navigate(`/app/assets/wallets/${wallet.id}`); }} />
        {linked.length > 0 && (
          <>
            <h3 className="cw-linked-heading">Linked wallets</h3>
            <div className="cw-wallet-stage">
              {linked.map(wallet => <WalletTile key={wallet.id} wallet={wallet} />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function CryptoWalletPage() {
  const { walletId } = useParams();
  const { wallets, error, loading, load } = useWallets();
  const wallet = wallets.find(row => row.id === walletId);
  const [qr, setQr] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    void QRCode.toDataURL(wallet.address, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1a1228", light: "#ffffff" } })
      .then(value => { if (live) setQr(value); })
      .catch(() => { if (live) setNote("QR unavailable. Copy the address."); });
    return () => { live = false; };
  }, [wallet?.address]);
  async function copy() {
    if (!wallet) return;
    const ok = await copyText(wallet.address);
    setNote(ok ? "Address copied." : "Copy is unavailable. Select the address instead.");
  }
  async function record(event: FormEvent) {
    event.preventDefault();
    if (!wallet) return;
    setBusy(true); setNote("");
    try {
      await apiPost("/api/me/crypto/wallets/receive", { asset: wallet.asset, amount, txid: txid.trim(), requestKey: key.current });
      key.current = crypto.randomUUID();
      setAmount(""); setTxid("");
      setNote(`${wallet.asset} recorded on your Veyra holdings.`);
      await load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Could not record that deposit.");
      key.current = crypto.randomUUID();
    } finally { setBusy(false); }
  }
  if (loading && !wallet) return <div className="app-page cw-workspace"><p role="status">Loading wallet…</p></div>;
  if (!wallet) return <div className="app-page cw-workspace"><p role="alert">{error || "This wallet is not on your account."}</p><Link to="/app/assets/receive" className="text-link"><ArrowLeft size={15} /> All wallets</Link></div>;
  return (
    <div className="app-page cw-workspace cw-wallet-page">
      <header className="cw-page-head">
        <div>
          <Link to="/app/assets/receive" className="text-link"><ArrowLeft size={15} /> All wallets</Link>
          <span className="cw-eyebrow">{wallet.kind === "linked" ? "LINKED WALLET" : "RECEIVE ADDRESS"}</span>
          <h1>{wallet.label}</h1>
          <p>{wallet.network} · {wallet.asset}. Share the QR, barcode or full address. Never share a key or recovery phrase.</p>
        </div>
      </header>
      <div className="cw-wallet-hero">
        <div className="cw-wallet-orbit" aria-hidden="true">
          <img src={assetIcon(wallet.asset)} alt="" />
        </div>
        <article className="cw-wallet-pass">
          <span className="cw-wallet-pass-shine" aria-hidden="true" />
          <div className="cw-wallet-pass-meta">
            <small>{wallet.network}</small>
            <b>{wallet.label}</b>
            <span>{wallet.kind === "linked" ? "Self-custody · public address only" : "Veyra receive address"}</span>
          </div>
          {qr && <img className="cw-wallet-pass-qr" src={qr} alt={`${wallet.label} QR`} width={200} height={200} />}
          <div className="cw-wallet-pass-bar"><Barcode value={wallet.address} /></div>
          <code className="cw-address">{wallet.address}</code>
          <div className="cw-wallet-actions">
            <button type="button" className="ghost-btn sm" onClick={() => void copy()}><Copy size={14} /> Copy</button>
            {qr && <a className="ghost-btn sm" href={qr} download={`veyra-${wallet.asset.toLowerCase()}-qr.png`}><Download size={14} /> Save QR</a>}
          </div>
        </article>
      </div>
      {note && <p role="status" className="cw-subtle">{note}</p>}
      {wallet.kind === "deposit" && (
        <form className="dash-form cw-receive-form" onSubmit={record}>
          <h3>Record inbound {wallet.asset}</h3>
          <p className="cw-subtle">After you send {wallet.asset} to this address, record the quantity so it credits Veyra holdings. This is an account entry, not a chain confirmation.</p>
          <label>Quantity<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Amount in ${wallet.asset}`} /></label>
          <label>Transaction id (optional)<input maxLength={120} value={txid} onChange={e => setTxid(e.target.value)} placeholder="On-chain hash, if you have one" /></label>
          <button type="submit" className="solid-btn" disabled={busy}>{busy ? "Recording…" : `Credit ${wallet.asset}`}</button>
        </form>
      )}
      <p className="cw-safety"><ShieldCheck size={14} /> Incoming coins stay on the network of this address. Wrong-network sends cannot be recovered here.</p>
    </div>
  );
}
