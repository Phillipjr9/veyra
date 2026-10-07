import { CryptoTradeAnimation } from "./CryptoTradeAnimation";
import { CryptoRoute } from "./CryptoRoute";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { useAcct } from "../lib/store";
import type { Holding } from "../lib/holdings";
import { displayUnits, type CryptoAction, type CryptoOrder, type CryptoQuote, type CryptoReceipt } from "../../shared/cryptoWorkspace";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";
import "../styles/crypto-workspace.css";

const pending = new Map<string, string>();
const keyFor = (id: string) => `veyra.crypto.pending.${id}`;
export function pendingCryptoOrder(userId: string): string | null {
  try { return sessionStorage.getItem(keyFor(userId)) ?? pending.get(userId) ?? null; } catch { return pending.get(userId) ?? null; }
}
function storePending(userId: string, quoteId: string | null) {
  if (quoteId) pending.set(userId, quoteId); else pending.delete(userId);
  try { if (quoteId) sessionStorage.setItem(keyFor(userId), quoteId); else sessionStorage.removeItem(keyFor(userId)); } catch { /* Memory fallback for embedded browsers. */ }
}
const titles = { buy: "Buy crypto", sell: "Sell crypto", swap: "Swap crypto" };
export function CryptoTradeDialog({ action, asset, holdings, close, completed }: {
  action: CryptoAction; asset?: string; holdings: Holding[]; close: () => void; completed: () => void;
}) {
  const { user, account } = useAcct();
  const userId = user?.id ?? "";
  const initialAsset = holdings.find(h => h.asset === asset)?.asset ?? holdings[0]?.asset ?? "BTC";
  const [source, setSource] = useState(initialAsset), [target, setTarget] = useState(action === "buy" ? initialAsset : initialAsset === "USDC" ? "ETH" : "USDC");
  const [amount, setAmount] = useState(""), [accepted, setAccepted] = useState(false), [quote, setQuote] = useState<CryptoQuote | null>(null), [receipt, setReceipt] = useState<CryptoReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false), [clock, setClock] = useState(Date.now());
  const [recoveryId, setRecoveryId] = useState(() => pendingCryptoOrder(userId));
  const [processing, setProcessing] = useState(false);
  const presentation = useRef<(() => void) | null>(null);
  const active = useRef(false), mounted = useRef(true), completedRef = useRef(completed);
  completedRef.current = completed;
  const dialog = useBankingDialog(close, busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; presentation.current?.(); }; }, []);
  useEffect(() => { if (!quote) return; const timer = setInterval(() => setClock(Date.now()), 500); return () => clearInterval(timer); }, [quote]);
  function finish(result: CryptoReceipt) {
    storePending(userId, null); setRecoveryId(null); setReceipt(result); setQuote(result); setUncertain(false); completedRef.current();
  }
  async function recover(id: string) {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try {
      const order = await apiGet<CryptoOrder>(`/api/me/crypto/orders/${encodeURIComponent(id)}`);
      if (!mounted.current) return;
      if (order.receipt) finish(order.receipt);
      else if (order.status === "expired") { storePending(userId, null); setRecoveryId(null); setQuote(null); setUncertain(false); setError("The previous order expired without execution. You can request a new quote."); }
      else { setQuote(order.quote); setClock(Date.now()); setUncertain(true); setRecoveryId(null); }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 400) { storePending(userId, null); setRecoveryId(null); }
      setError("We could not verify the previous order. Check its status before placing another order.");
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { const id = pendingCryptoOrder(userId); if (id) void recover(id); }, [userId]);
  async function review(event: FormEvent) {
    event.preventDefault(); if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try {
      const result = await apiPost<{ quote: CryptoQuote }>("/api/me/crypto/quote", { action, fromAsset: action === "buy" ? "USD" : source, toAsset: action === "sell" ? "USD" : target, amount });
      if (mounted.current) { setQuote(result.quote); setClock(Date.now()); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not get a current quote."); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function confirm() {
    if (!quote || active.current) return;
    active.current = true; setBusy(true); setProcessing(true); setError(""); storePending(userId, quote.id);
    const shown = new Promise<void>(resolve => { presentation.current = resolve; });
    try {
      const result = await apiPost<{ receipt: CryptoReceipt }>("/api/me/crypto/confirm", { quoteId: quote.id });
      await shown;
      if (mounted.current) finish(result.receipt);
    } catch (e) {
      if (!mounted.current) return;
      // A definitive validation refusal follows the server's completed-order
      // replay check. Connection/server/auth failures remain uncertain: same ID only.
      if (e instanceof ApiError && e.status === 400) { storePending(userId, null); setUncertain(false); }
      else setUncertain(true);
      setError(e instanceof Error ? e.message : "The order status could not be confirmed.");
    } finally { presentation.current?.(); presentation.current = null; active.current = false; if (mounted.current) { setBusy(false); setProcessing(false); } }
  }
  const available = holdings.find(h => h.asset === source);
  const seconds = quote ? Math.max(0, Math.ceil((quote.expiresAt - clock) / 1000)) : 0;
  const choose = (value: string, which: "source" | "target") => { if (which === "source") { setSource(value); if (value === target) setTarget(holdings.find(h => h.asset !== value)?.asset ?? "ETH"); } else setTarget(value); setAmount(""); };
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titles[quote?.action ?? action]} className="banking-panel cw-dialog">
    <span className="cw-eyebrow"><ShieldCheck size={14} /> VEYRA ACCOUNT ORDER</span>
    {quote?.previewData && <p className="preview-crypto-notice" role="status"><strong>TEST DATA · NOT LIVE</strong>This quote is generated sample data. Confirming it moves test records only — no real funds and no external market.</p>}
    {!processing && <><h2>{receipt ? "Account order completed" : quote ? "Review your order" : titles[action]}</h2>
    <p className="cw-subtle">Account balances only. Custody, cash conversion and external trading providers are not connected. This is not an on-chain transaction.</p></>}
    {error && <p role="alert" className="banking-error">{error}</p>}
    {recoveryId && !quote && <div className="cw-notice"><p>Checking an earlier order prevents duplicate execution after a lost connection.</p><button className="solid-btn" disabled={busy} onClick={() => void recover(recoveryId)}>{busy ? "Checking order…" : "Check order status"}</button></div>}
    {!quote && !recoveryId && <form className="dash-form" onSubmit={review}>
      <CryptoRoute editable busy={busy}
        from={action === "buy" ? { asset: "USD", accountLast4: account?.bankDetails.accountNumber.slice(-4) } : { asset: source, choices: holdings, onChange: value => choose(value, "source") }}
        to={action === "sell" ? { asset: "USD", accountLast4: account?.bankDetails.accountNumber.slice(-4) } : { asset: target, choices: holdings.filter(h => action === "buy" || h.asset !== source), onChange: value => choose(value, "target") }} />
      <label>{action === "buy" ? "Amount to spend (USD)" : `Quantity (${source})`}<input required inputMode="decimal" maxLength={72} pattern="[0-9]+(\.[0-9]+)?" autoComplete="off" placeholder={action === "buy" ? "0.00" : "0.00000000"} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <p className="cw-subtle">Available: {action === "buy" ? (account ? `$${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in checking` : "Checking balance unavailable") : `${available?.quantity ?? "Unavailable"} ${source}`}</p>
      <div className="cw-quick">{action === "buy" ? [25, 100, 250].map(value => <button type="button" className="ghost-btn sm" key={value} onClick={() => setAmount(String(value))}>${value}</button>) : <button type="button" className="ghost-btn sm" disabled={!available || available.units === "0"} onClick={() => setAmount(available?.quantity ?? "")}>Use available amount</button>}</div>
      <label className="cw-checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required /><span>I understand this updates Veyra account records, not externally held coins. Digital assets are not deposits or FDIC insured.</span></label>
      <button className="solid-btn" disabled={busy || !accepted || !amount}>{busy ? "Getting current quote…" : "Review order"}</button>
    </form>}
    {processing && quote && <CryptoTradeAnimation key={quote.id} quote={quote} onPresented={() => presentation.current?.()} />}
    {quote && !processing && <>
      <div className="cw-review cw-review-route"><CryptoRoute from={{ asset: quote.fromAsset, quantity: quote.fromQuantity, accountLast4: account?.bankDetails.accountNumber.slice(-4) }} to={{ asset: quote.toAsset, quantity: quote.toQuantity, accountLast4: account?.bankDetails.accountNumber.slice(-4) }} /></div>
      <dl className="cw-details"><div><dt>Settlement</dt><dd>Veyra account only</dd></div><div><dt>Account fee</dt><dd>${quote.feeUsd}</dd></div><div><dt>Network fee</dt><dd>None collected · no broadcast</dd></div>{quote.fromAsset !== "USD" && <div><dt>1 {quote.fromAsset}</dt><dd>${displayUnits(quote.fromPriceCents, 2)}</dd></div>}{quote.toAsset !== "USD" && <div><dt>1 {quote.toAsset}</dt><dd>${displayUnits(quote.toPriceCents, 2)}</dd></div>}</dl>
      <p className="cw-subtle">Output is rounded down to the destination asset’s precision. A swap exchanges account holdings only; it does not bridge networks.</p>
      {receipt ? <div className="cw-notice" role="status"><CheckCircle2 size={20} /><b>Recorded once in your account</b><code>{receipt.reference}</code><p>{new Date(receipt.completedAt).toLocaleString()} · No blockchain transaction hash.</p></div> : <>
        <p className="cw-quote-clock"><Clock3 size={15} />{seconds ? `Quote expires in ${seconds}s` : "Quote expired · request a new review"}</p>
        {uncertain && <p className="cw-notice" role="status">Status unconfirmed. Retry this same order or close and return to check it. Do not create another order to repeat this payment.</p>}
        <div className="modal-actions"><button type="button" className="ghost-btn" disabled={busy || uncertain} onClick={() => { setQuote(null); setError(""); }}>Edit / refresh quote</button><button type="button" className="solid-btn" disabled={busy || (!seconds && !uncertain)} onClick={() => void confirm()}>{busy ? "Confirming…" : uncertain ? "Retry same order" : `Confirm ${quote.action}`}</button></div>
      </>}
    </>}
    <button type="button" className="ghost-btn cw-close" disabled={busy} onClick={close}>{receipt ? "Done" : "Close"}</button>
  </section></div>;
}
