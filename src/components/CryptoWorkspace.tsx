import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Cable, CheckCircle2, ChevronRight, Coins, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import { apiGet } from "../lib/api";
import { assetIcon, fetchHoldings, type Holding, type HoldingsResponse } from "../lib/holdings";
import { useAcct } from "../lib/store";
import type { CryptoAction, CryptoCapabilities, CryptoOrder } from "../../shared/cryptoWorkspace";
import { CryptoTradeDialog, pendingCryptoOrder } from "./CryptoTradeDialog";
import { CryptoSendDialog, CryptoWithdrawalHistory } from "./CryptoSend";
import { ConnectedWallet } from "./ConnectedWallet";
import "../styles/crypto-workspace.css";

const usd = (value: string) => Number(value).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const actions = [{ id: "buy", label: "Buy", Icon: ArrowDownLeft }, { id: "swap", label: "Swap", Icon: ArrowLeftRight }, { id: "sell", label: "Sell", Icon: ArrowUpRight }, { id: "send", label: "Send", Icon: Send }] as const;
export function CryptoWorkspace() {
  const { user, refreshAccount } = useAcct();
  const [data, setData] = useState<HoldingsResponse | null>(null), [capabilities, setCapabilities] = useState<CryptoCapabilities | null>(null), [orders, setOrders] = useState<CryptoOrder[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [query, setQuery] = useState(""), [view, setView] = useState<"assets" | "activity">("assets");
  const [trade, setTrade] = useState<{ action: CryptoAction; asset?: string } | null>(null), [sending, setSending] = useState<Holding | null>(null), [sendPicker, setSendPicker] = useState(false), [revision, setRevision] = useState(0), [notice, setNotice] = useState("");
  const [params, setParams] = useSearchParams(), sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const [holdings, config, history] = await Promise.all([fetchHoldings(), apiGet<CryptoCapabilities>("/api/me/crypto/capabilities"), apiGet<{ orders: CryptoOrder[] }>("/api/me/crypto/orders")]);
      if (request !== sequence.current) return;
      setData(holdings); setCapabilities(config); setOrders(history.orders); setError("");
    } catch (e) { if (request === sequence.current) setError(e instanceof Error ? e.message : "Could not load crypto account data."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); const timer = setInterval(() => { if (!document.hidden) { void reload(); setRevision(value => value + 1); } }, 30_000); return () => { clearInterval(timer); sequence.current++; }; }, [reload]);
  const changed = useCallback(() => {
    void reload(); setRevision(value => value + 1);
    void refreshAccount().catch(() => setNotice("The order is recorded. Your checking balance could not be refreshed; reload it before making another payment."));
  }, [reload, refreshAccount]);
  useEffect(() => {
    if (!data || !capabilities) return;
    const requested = params.get("action") ?? (params.has("buy") ? "buy" : null), asset = params.get("asset") ?? params.get("buy") ?? undefined;
    if (!requested) return;
    if (capabilities.canOperate && capabilities.accountTrading && ["buy", "sell", "swap"].includes(requested)) setTrade({ action: requested as CryptoAction, asset });
    else setNotice("Crypto account actions require an approved account owner and enabled account trading.");
    const next = new URLSearchParams(params); next.delete("action"); next.delete("buy"); next.delete("asset"); setParams(next, { replace: true });
  }, [params, setParams, data, capabilities]);
  const canTrade = !!capabilities?.canOperate && !!capabilities.accountTrading && data?.tradingEnabled !== false && !error;
  const canSend = !!capabilities?.withdrawals && !error;
  const filtered = (data?.holdings ?? []).filter(h => `${h.asset} ${h.name}`.toLowerCase().includes(query.toLowerCase()));
  const sendable = (data?.holdings ?? []).filter(h => h.units !== "0" && capabilities?.networks.includes(h.withdrawalNetwork as "Bitcoin" | "Ethereum" | "Solana"));
  const canSell = (holding: Holding) => canTrade && !!holding.priceUsd && holding.units !== "0" && data?.quoteStatus !== "stale";
  const canSendHolding = (holding: Holding) => canSend && holding.units !== "0" && !!holding.withdrawalNetwork && !!capabilities?.networks.includes(holding.withdrawalNetwork as "Bitcoin" | "Ethereum" | "Solana");
  const pending = user ? pendingCryptoOrder(user.id) : null;
  const entirelyUnpriced = data?.partial && !data.holdings.some(h => h.units !== "0" && h.valueUsd !== null);
  return <div className="app-page cw-workspace">
    <header className="cw-page-head"><div><span className="cw-eyebrow">DIGITAL ASSETS / YOUR WORKSPACE</span><h1>Crypto, on your terms.</h1><p>Your Veyra holdings and your own wallets. Connected, never combined.</p></div><Link to="/app/markets" className="ghost-btn">Explore markets <ArrowUpRight size={16} /></Link></header>
    {error && <div role="alert" className="cw-notice cw-error"><b>Account data could not be refreshed.</b><p>{error} {data ? "Values below are last known, not a current balance. Trading is paused until refresh succeeds." : "Balances are unavailable, not zero."}</p><button className="ghost-btn sm" disabled={loading} onClick={() => void reload()}>Retry account data</button></div>}
    {notice && <p role="status" className="cw-notice">{notice}<button className="ghost-btn sm" onClick={() => setNotice("")}>Dismiss</button></p>}
    {pending && <div className="cw-notice"><b>An earlier account order needs a status check.</b><p>Resume the same review rather than placing a duplicate order.</p><button className="solid-btn sm" disabled={!data} onClick={() => setTrade({ action: "buy" })}>Check earlier order</button></div>}
    <div className="cw-top-grid"><div className="cw-account-column">
      <section className="cw-hero"><div className="cw-hero-content"><span className="cw-eyebrow"><Coins size={15} /> VEYRA ACCOUNT HOLDINGS</span><h2>{data ? entirelyUnpriced ? "Unavailable" : usd(data.totalUsd) : loading ? "Loading…" : "Unavailable"}</h2><p>{data?.partial ? "Partial estimated value · some assets are unpriced" : "Estimated asset value · kept separate from checking"}</p>{!data?.previewData && <span className="cw-hero-tag">{error ? "Last known data" : data?.quoteStatus === "current" ? "Current market quotes" : data?.quoteStatus === "stale" ? "Stale market quotes" : "Quotes unavailable"}</span>}</div><div className="cw-coins" aria-hidden="true"><img src={assetIcon("BTC")} alt="" /><img src={assetIcon("ETH")} alt="" /><img src={assetIcon("SOL")} alt="" /></div></section>
      <div className="cw-action-bar">{actions.map(({ id, label, Icon }) => <button type="button" key={id} disabled={id === "send" ? !canSend || !!pending : !canTrade} onClick={() => { if (id === "send") setSendPicker(value => !value); else setTrade({ action: id }); }}><span><Icon size={21} /></span><b>{label}</b><small>{id === "send" ? "Wallet request" : "Account order"}</small></button>)}</div>
      {sendPicker && <div className="cw-card cw-send-picker"><h3>Choose an asset to send</h3><p>Bitcoin, Ethereum and Solana mainnets. Requests debit the units immediately; nothing is broadcast.</p>{sendable.length ? sendable.map(h => <button className="ghost-btn" key={h.asset} onClick={() => { setSendPicker(false); setSending(h); }}><img src={assetIcon(h.asset)} width={30} height={30} alt="" /><span>{h.asset} · {h.quantity} available</span><ChevronRight size={15} /></button>) : <p>No available holdings on a supported send network.</p>}<button className="ghost-btn sm" onClick={() => setSendPicker(false)}>Close selection</button></div>}
      <div className="cw-account-notice"><ShieldCheck size={20} /><div><b>Know where your assets live.</b><p>Buy, sell and swap update Veyra’s internal account records. External custody, cash conversion, execution and bridging are not connected. Send records a request and debits the units; it is not a blockchain transfer.</p><Link to="/legal/disclosures">Digital asset disclosures <ArrowUpRight size={12} /></Link></div></div>
      {capabilities && (!capabilities.canOperate || !capabilities.accountTrading) && <p className="cw-notice">{!capabilities.canOperate ? "View-only access. An active, approved account owner is required for these orders; team members cannot initiate them." : "Account trading is currently paused."}</p>}
    </div><ConnectedWallet sepoliaTestnetSend={!!capabilities?.sepoliaTestnetSend} /></div>
    <section className="cw-card cw-portfolio"><div className="cw-portfolio-tools"><div className="cw-tabs" role="group" aria-label="Crypto account view"><button type="button" aria-pressed={view === "assets"} onClick={() => setView("assets")}>Account assets</button><button type="button" aria-pressed={view === "activity"} onClick={() => setView("activity")}>Activity</button></div><button type="button" className="ghost-btn sm" disabled={loading} onClick={() => { void reload(); setRevision(value => value + 1); }}><RefreshCw size={14} />{loading ? "Refreshing…" : "Refresh account"}</button></div>
      {view === "assets" ? <><div className="cw-asset-heading"><div><h2>Your asset directory</h2><p>Available units can be traded or sent. Sent units leave the balance as soon as the request is recorded.</p></div><label className="cw-search"><Search size={16} /><input aria-label="Search account assets" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search assets" maxLength={80} /></label></div>
        {!data && <p role="status">{loading ? "Loading account assets…" : "Account assets unavailable. Use Retry account data above."}</p>}
        <div className="cw-asset-list">{filtered.map(h => <article className="cw-asset-row" key={h.asset} aria-label={`${h.name} account holding`}><div className="cw-asset-name"><img src={assetIcon(h.asset)} width={46} height={46} alt="" /><div><b>{h.name}</b><small>{h.asset} · {h.withdrawalNetwork ?? "Account holding"}</small></div></div><div className="cw-asset-quantity"><small>Available</small><b>{h.quantity} {h.asset}</b></div><div className="cw-asset-value"><small>Estimated value</small><b>{h.valueUsd === null ? "Unpriced" : usd(h.valueUsd)}</b><small>{h.priceUsd ? `${usd(h.priceUsd)} / ${h.asset}` : "Price unavailable"}</small></div><div className="cw-row-actions"><button className="ghost-btn sm" disabled={!canTrade || !h.priceUsd} onClick={() => setTrade({ action: h.units === "0" ? "buy" : "swap", asset: h.asset })}>{h.units === "0" ? "Buy" : "Swap"}</button><button className="ghost-btn sm" disabled={!canSell(h)} onClick={() => setTrade({ action: "sell", asset: h.asset })}>Sell</button><button className="ghost-btn sm" disabled={!canSendHolding(h)} title={!h.withdrawalNetwork ? "Withdrawal network not supported yet" : "Create a withdrawal request"} onClick={() => setSending(h)}>Send</button><Link to={`/app/markets?asset=${encodeURIComponent(h.asset)}`} aria-label={`View ${h.asset} market`} className="cw-icon-button"><ArrowUpRight size={17} /></Link></div></article>)}</div>
        {data && !filtered.length && <p>No assets match your search.</p>}
      </> : <><div className="cw-asset-heading"><div><h2>Recent account orders</h2><p>Reviewed buy, sell and swap orders. Older trades remain in your checking statement.</p></div></div>{!orders.length && <p className="cw-empty">No reviewed account orders yet. Your next completed order will appear here.</p>}<div className="cw-order-list">{orders.map(({ quote, receipt }) => <article key={quote.id} className="cw-order"><span className="cw-icon"><ArrowLeftRight size={18} /></span><div><b>{quote.action === "swap" ? "Swap" : quote.action === "buy" ? "Buy" : "Sell"} · {quote.fromQuantity} {quote.fromAsset} → {quote.toQuantity} {quote.toAsset}</b><small>{receipt && new Date(receipt.completedAt).toLocaleString()}</small><code>{receipt?.reference}</code></div><span className="cw-order-status"><CheckCircle2 size={14} /> Account completed<small>Not on-chain</small></span></article>)}</div><CryptoWithdrawalHistory revision={revision} /></>}
    </section>
    <section className="cw-readiness"><div><Cable size={19} /><h2>Connection status</h2></div><div className="cw-readiness-grid"><p><b>Account orders</b><span>{capabilities?.accountTrading ? "Enabled · internal ledger" : "Unavailable"}</span></p><p><b>External wallets</b><span>Bitcoin · Ethereum · Solana</span></p><p><b>Custody & on-chain execution</b><span>Provider not connected</span></p><p><b>Cash on/off-ramp</b><span>Provider not connected</span></p></div><small>Digital assets are not FDIC insured, are not bank deposits and can lose value. No outside transfer is marked complete without actual execution.</small></section>
    {trade && data && <CryptoTradeDialog action={trade.action} asset={trade.asset} holdings={data.holdings} close={() => { setTrade(null); void reload(); }} completed={changed} />}
    {sending && <CryptoSendDialog holding={sending} close={() => { setSending(null); changed(); }} submitted={changed} />}
  </div>;
}
