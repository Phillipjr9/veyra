import { StaffNote } from "./StaffNote";
import { assetIcon } from "../../shared/assetIcons";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Cable, Copy, Download, ExternalLink, Link2, RefreshCw, ShieldCheck, Unplug, Wallet, X } from "lucide-react";
import QRCode from "qrcode";
import { connectWallet, discoverWallets, disconnectWallet, readWallet, watchWallet, type WalletChoice, type WalletSession } from "../lib/web3";
import { copyText } from "../lib/store";
import { useBankingDialog } from "./bankingDialog";
import { SepoliaSendDialog } from "./SepoliaSendDialog";

function WalletPicker({ close, choices, select, busy, error }: { close: () => void; choices: WalletChoice[]; select: (choice: WalletChoice) => void; busy: boolean; error: string }) {
  const dialog = useBankingDialog(close, busy);
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Connect a wallet" className="banking-panel cw-dialog">
    <span className="cw-eyebrow"><Link2 size={14} /> YOUR KEYS. YOUR WALLET.</span><h2>Connect a wallet</h2><p>Share your public address with Veyra. Connecting does not sign a transaction, move coins or authorize access to your Veyra account.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}
    <div className="cw-wallet-choices">{choices.map(choice => <button type="button" className="cw-wallet-choice" key={choice.id} disabled={busy} onClick={() => select(choice)}><Wallet size={22} /><span><b>{choice.name}</b><small>{choice.network}{choice.network === "Solana" ? " · public address" : " · mainnet required"}</small></span><Link2 size={18} /></button>)}</div>
    {busy && <p role="status">Check your wallet for the connection request. Veyra will never ask for your recovery phrase.</p>}
    {!choices.length && <div className="cw-notice"><b>No browser wallet detected</b><p>Paste a MetaMask, Trust Wallet, Phantom or UniSat address on Receive — no extension required. Extensions may not be available in an embedded browser.</p><Link to="/app/assets/receive">Open Receive</Link></div>}
    <details className="cw-install"><summary>Compatible wallets & connection help</summary><p>Ethereum: EIP-6963 or EIP-1193 browser wallets. Solana: Phantom. Bitcoin: UniSat with Bitcoin-mainnet support. Wallet names are self-reported, not a Veyra endorsement.</p><div><a href="https://metamask.io/download" target="_blank" rel="noopener noreferrer">Ethereum wallet <ExternalLink size={12} /></a><a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Phantom <ExternalLink size={12} /></a><a href="https://unisat.io/download" target="_blank" rel="noopener noreferrer">UniSat <ExternalLink size={12} /></a></div><p>WalletConnect QR/mobile linking is not configured. Use a supported wallet’s browser instead.</p></details>
    <button type="button" className="ghost-btn cw-close" disabled={busy} onClick={close}>Close</button>
  </section></div>;
}
function ReceiveWallet({ session, close }: { session: WalletSession; close: () => void }) {
  const dialog = useBankingDialog(close, false);
  const [qr, setQr] = useState(""), [message, setMessage] = useState("");
  useEffect(() => { let live = true; void QRCode.toDataURL(session.address, { width: 600, margin: 4, errorCorrectionLevel: "M" }).then(value => { if (live) setQr(value); }).catch(() => { if (live) setMessage("QR unavailable. Copy the full address instead."); }); return () => { live = false; }; }, [session.address]);
  async function copy() { try { await copyText(session.address); setMessage("Address copied."); } catch { setMessage("Copy was blocked. Select and copy the full address below."); } }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Receive to connected wallet" className="banking-panel cw-dialog">
    <span className="cw-eyebrow">EXTERNAL WALLET · NOT YOUR VEYRA ACCOUNT</span><h2>Receive to your wallet</h2><p>Send only assets supported by this wallet on <b>{session.choice.network} mainnet</b>. Confirm the address and network in your wallet before sharing.</p>
    {session.choice.network === "Solana" && <p className="cw-notice">Phantom does not expose its selected network through this connector. Check that the sender uses Solana mainnet.</p>}
    {qr && <img className="cw-qr" src={qr} alt={`${session.choice.network} connected wallet address QR`} width={240} height={240} />}
    <code className="cw-address">{session.address}</code><p className="cw-notice">This address comes from your connected wallet. Incoming coins will not credit Veyra’s built-in account holdings. No Veyra custody deposit address is available yet.</p>
    <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => void copy()}><Copy size={15} /> Copy address</button>{qr && <a className="ghost-btn" href={qr} download={`veyra-${session.choice.network.toLowerCase()}-wallet-qr.png`}><Download size={15} /> Download QR</a>}</div>{message && <p role="status">{message}</p>}<button type="button" className="solid-btn cw-close" onClick={close}>Close</button>
  </section></div>;
}

export function ConnectedWallet({ sepoliaTestnetSend = false }: { sepoliaTestnetSend?: boolean }) {
  const [choices, setChoices] = useState<WalletChoice[]>([]), [picker, setPicker] = useState(false), [wallet, setWallet] = useState<WalletSession | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [receive, setReceive] = useState(false), [sepoliaSend, setSepoliaSend] = useState(false);
  const sequence = useRef(0), stopWatching = useRef<(() => void) | null>(null), running = useRef(false);
  useEffect(() => { const stop = discoverWallets(setChoices); return () => { stop(); sequence.current++; stopWatching.current?.(); }; }, []);
  function invalidate() { sequence.current++; running.current = false; setBusy(false); stopWatching.current?.(); stopWatching.current = null; setWallet(null); setReceive(false); setError("Your wallet account or network changed. Reconnect to verify the new address and balances."); }
  async function connect(choice: WalletChoice) {
    if (running.current) return;
    running.current = true; const request = ++sequence.current;
    stopWatching.current?.(); stopWatching.current = null; setBusy(true); setWallet(null); setError("");
    try {
      const session = await connectWallet(choice);
      if (request !== sequence.current) return;
      stopWatching.current = watchWallet(choice, invalidate);
      const balances = await readWallet(session);
      if (request !== sequence.current) return;
      setWallet(balances); setPicker(false);
    } catch (e) { if (request === sequence.current) { stopWatching.current?.(); stopWatching.current = null; setError(e instanceof Error ? e.message.slice(0, 240) : "Connection declined or unavailable. Open your wallet and try again."); } }
    finally { if (request === sequence.current) { running.current = false; setBusy(false); } }
  }
  async function refresh() {
    if (!wallet || running.current) return;
    running.current = true; const request = ++sequence.current; setBusy(true); setError("");
    // Clear old balances immediately; a failed refresh cannot look like a fresh read.
    setWallet({ ...wallet, balances: wallet.balances.map(b => ({ ...b, quantity: null, note: "Refreshing…" })) });
    try { const result = await readWallet(wallet); if (request === sequence.current) setWallet(result); }
    catch (e) { if (request === sequence.current) { setWallet(null); setReceive(false); stopWatching.current?.(); stopWatching.current = null; setError(e instanceof Error ? e.message : "Wallet unavailable. Reconnect to retry."); } }
    finally { if (request === sequence.current) { running.current = false; setBusy(false); } }
  }
  function disconnect() { sequence.current++; stopWatching.current?.(); stopWatching.current = null; const previous = wallet; setWallet(null); setReceive(false); setError(""); running.current = false; setBusy(false); if (previous) void disconnectWallet(previous); }
  return <section className="cw-card cw-wallet-card">
    <div className="cw-section-head"><div><span className="cw-eyebrow">SELF-CUSTODY</span><h2>Your connected wallet</h2></div><span className="cw-icon"><Wallet size={23} /></span></div>
    <p className="cw-subtle">Connect MetaMask, Trust Wallet, Phantom or UniSat in the browser, or paste an address on Receive. Assets stay separate from checking. No keys or recovery phrases are stored.</p>
    {error && !picker && <p role="alert" className="banking-error">{error}<button type="button" className="cw-icon-button" aria-label="Dismiss wallet message" onClick={() => setError("")}><X size={14} /></button></p>}
    {!wallet ? <><div className="cw-wallet-empty"><span className="cw-connection-art" aria-hidden="true"><Wallet size={35} /><Link2 size={20} /></span><h3>A window into your wallet.</h3><p>Connect Bitcoin, Ethereum or Solana.<br />Your assets remain in your control.</p></div><button className="solid-btn" type="button" onClick={() => { setError(""); setPicker(true); }}><Link2 size={16} /> Connect wallet</button></> : <>
      <div className="cw-connected-label"><span className="cw-dot" /><b>{wallet.choice.name}</b><span>{wallet.choice.network}</span></div>
      <code className="cw-address">{wallet.address}</code>
      <p className="cw-subtle">{wallet.choice.network === "Solana" ? "Public address connected · confirm the selected network in Phantom." : `${wallet.choice.network} mainnet checked.`} Connection is not proof of wallet ownership to Veyra.</p>
      <div className="cw-wallet-balances">{wallet.balances.map(balance => <div key={balance.asset}><span className="cw-wallet-asset"><img src={assetIcon(balance.asset)} alt="" width={22} height={22} />{balance.asset}</span><b>{balance.quantity === null ? "Unavailable" : balance.quantity}</b>{balance.note && <small>{balance.note}</small>}</div>)}</div>
      <p className="cw-subtle">Last checked {new Date(wallet.observedAt).toLocaleTimeString()}. {wallet.choice.network === "Ethereum" ? "ETH, USDC and USDT only. Other tokens are not indexed." : "Not included in account totals."}</p>
      <div className="cw-wallet-actions"><button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> {busy ? "Reading…" : "Refresh"}</button><button type="button" className="ghost-btn sm" disabled={busy} onClick={() => setReceive(true)}>Receive / QR</button><button type="button" className="ghost-btn sm" disabled={busy} onClick={disconnect}><Unplug size={14} /> Disconnect</button></div>
      <p className="cw-subtle">Disconnecting removes this Veyra connection. Revoke site permissions in your wallet settings if needed.</p>
    </>}
    <StaffNote><div className="cw-provider-note"><Cable size={18} /><div><b>Mainnet and partner execution are not connected</b><p>Veyra account buy/sell/swap remain internal. Mainnet sends, wallet swaps and cash rails need reviewed, integrated providers. Connecting a wallet never authorizes those operations.</p></div></div></StaffNote>
    <StaffNote><div className="cw-wallet-locked" aria-label="External wallet actions awaiting integration">{["Buy", "Swap", "Sell", "Send"].map(action => <button type="button" className="ghost-btn sm" disabled key={action} title="Mainnet execution provider is not connected">{action}</button>)}</div></StaffNote>
    {sepoliaTestnetSend && <div className="cw-testnet-send-card"><small><b>TESTNET ONLY</b> · Sepolia ETH has no real-world value and never changes Veyra account balances.</small><button type="button" className="ghost-btn" onClick={() => setSepoliaSend(true)}>Send Sepolia test ETH</button></div>}
    <small className="cw-safety"><ShieldCheck size={14} /> Never share a private key or recovery phrase.</small>
    {picker && <WalletPicker close={() => setPicker(false)} choices={choices} select={choice => void connect(choice)} busy={busy} error={error} />}
    {receive && wallet && <ReceiveWallet session={wallet} close={() => setReceive(false)} />}
    {sepoliaSend && <SepoliaSendDialog choices={choices} close={() => setSepoliaSend(false)} />}
  </section>;
}
