import { StaffNote } from "./StaffNote";
import { CryptoTradeAnimation, cryptoTrack } from "./CryptoTradeAnimation";
import { CryptoRoute } from "./CryptoRoute";
import { FlowReceipt, FlowReview, StageDots } from "./MoneyFlow";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, X } from "lucide-react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { downloadFile, longDate, money, useAcct } from "../lib/store";
import type { Holding } from "../lib/holdings";
import { displayUnits, type CryptoAction, type CryptoOrder, type CryptoQuote, type CryptoReceipt } from "../../shared/cryptoWorkspace";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";
import "../styles/crypto-workspace.css";
import "../styles/crypto-flow.css";

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
const verbs = { buy: "purchased", sell: "sold", swap: "swapped" };
type Stage = "form" | "review" | "processing" | "success";
/** Balances captured when a quote is reviewed, so "after" figures are relative to the order, not to a later refresh. */
type Snapshot = { balance: number; fromUnits: string; toUnits: string };

const cents = (value: number) => Math.round(value * 100) / 100;
const usd = (value: number) => money(cents(value));

export function CryptoTradeDialog({ action, asset, holdings, close, completed }: {
  action: CryptoAction; asset?: string; holdings: Holding[]; close: () => void; completed: () => void;
}) {
  const { user, account } = useAcct();
  const userId = user?.id ?? "";
  /* Sell can only send what the account holds, so its source list is limited to non-zero balances. */
  const sellable = holdings.filter(h => h.units !== "0");
  const sourceChoices = action === "sell" ? sellable : holdings;
  const initialAsset = sourceChoices.find(h => h.asset === asset)?.asset ?? sourceChoices[0]?.asset ?? "BTC";
  const [source, setSource] = useState(initialAsset), [target, setTarget] = useState(action === "buy" ? initialAsset : initialAsset === "USDC" ? "ETH" : "USDC");
  const [amount, setAmount] = useState(""), [accepted, setAccepted] = useState(false), [quote, setQuote] = useState<CryptoQuote | null>(null), [receipt, setReceipt] = useState<CryptoReceipt | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false), [clock, setClock] = useState(Date.now());
  const [recoveryId, setRecoveryId] = useState(() => pendingCryptoOrder(userId));
  const [processing, setProcessing] = useState(false);
  const presentation = useRef<(() => void) | null>(null);
  const active = useRef(false), mounted = useRef(true), completedRef = useRef(completed);
  completedRef.current = completed;
  const dialog = useBankingDialog(close, busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; presentation.current?.(); }; }, []);
  useEffect(() => { if (!quote) return; const timer = setInterval(() => setClock(Date.now()), 500); return () => clearInterval(timer); }, [quote]);

  /** Captures what the account holds right now, before any order changes it. */
  function capture(q: CryptoQuote): Snapshot {
    return {
      balance: account?.balance ?? 0,
      fromUnits: holdings.find(h => h.asset === q.fromAsset)?.units ?? "0",
      toUnits: holdings.find(h => h.asset === q.toAsset)?.units ?? "0",
    };
  }
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
      else { setSnapshot(capture(order.quote)); setQuote(order.quote); setClock(Date.now()); setUncertain(true); setRecoveryId(null); }
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
      if (mounted.current) { setSnapshot(capture(result.quote)); setQuote(result.quote); setClock(Date.now()); }
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

  function again() {
    setQuote(null); setReceipt(null); setSnapshot(null); setAmount(""); setAccepted(false); setError(""); setUncertain(false);
  }

  const stage: Stage = processing && quote ? "processing" : receipt ? "success" : quote ? "review" : "form";
  const available = holdings.find(h => h.asset === source);
  const seconds = quote ? Math.max(0, Math.ceil((quote.expiresAt - clock) / 1000)) : 0;
  const choose = (value: string, which: "source" | "target") => { if (which === "source") { setSource(value); if (value === target) setTarget(holdings.find(h => h.asset !== value)?.asset ?? "ETH"); } else setTarget(value); setAmount(""); };
  const last4 = account?.bankDetails.accountNumber.slice(-4);

  /* Live estimate from the last priced holdings. The locked quote from the server is the only binding figure. */
  const priceOf = (code: string) => { const value = Number(holdings.find(h => h.asset === code)?.priceUsd); return Number.isFinite(value) && value > 0 ? value : null; };
  /* Dropdown option: the quantity the account holds, with its approximate value when a price is known. */
  const holdingChoice = (h: Holding) => {
    const price = Number(h.priceUsd);
    const value = Number.isFinite(price) && price > 0 && h.units !== "0" ? ` ≈ ${usd(Number(h.quantity) * price)}` : "";
    return { asset: h.asset, name: h.name, detail: h.units === "0" ? "none held" : `${h.quantity} held${value}` };
  };
  function estimate(): string | null {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return null;
    if (action === "buy") {
      const price = priceOf(target); const dec = Math.min(8, holdings.find(h => h.asset === target)?.decimals ?? 8);
      return price ? `≈ ${(n / price).toFixed(dec)} ${target} at about $${price.toLocaleString(undefined, { maximumFractionDigits: 2 })} each` : null;
    }
    if (action === "sell") { const price = priceOf(source); return price ? `≈ ${usd(n * price)} to checking before the account fee` : null; }
    const from = priceOf(source), to = priceOf(target);
    return from && to ? `≈ ${(n * from / to).toFixed(6)} ${target} before the account fee` : null;
  }

  /* Checking movement by order type, matching the server: buy debits cost plus fee, sell credits proceeds less fee, swap debits only its fee. */
  function cashDelta(q: CryptoQuote): number {
    const notional = Number(q.notionalUsd), fee = Number(q.feeUsd);
    return q.action === "buy" ? -(notional + fee) : q.action === "sell" ? notional - fee : -fee;
  }

  /* Review rows are computed from the server's quote, never from client prices. */
  function reviewRows(q: CryptoQuote) {
    const notional = Number(q.notionalUsd), fee = Number(q.feeUsd);
    const rows: { label: string; value: string; tone?: "free" }[] = [];
    if (q.action === "buy") { rows.push({ label: "Pay from", value: `Veyra checking •••• ${last4 ?? "----"}` }); rows.push({ label: "You receive", value: `${q.toQuantity} ${q.toAsset}` }); }
    if (q.action === "sell") { rows.push({ label: "You sell", value: `${q.fromQuantity} ${q.fromAsset}` }); rows.push({ label: "Credited to", value: `Veyra checking •••• ${last4 ?? "----"}` }); }
    if (q.action === "swap") { rows.push({ label: "You give", value: `${q.fromQuantity} ${q.fromAsset}` }); rows.push({ label: "You receive", value: `${q.toQuantity} ${q.toAsset}` }); }
    if (q.fromAsset !== "USD") rows.push({ label: `1 ${q.fromAsset} price`, value: `$${displayUnits(q.fromPriceCents, 2)}` });
    if (q.toAsset !== "USD") rows.push({ label: `1 ${q.toAsset} price`, value: `$${displayUnits(q.toPriceCents, 2)}` });
    rows.push(fee > 0 ? { label: "Account fee", value: `$${q.feeUsd}` } : { label: "Account fee", value: "Free", tone: "free" });
    rows.push({ label: "Network fee", value: "None · no broadcast", tone: "free" });
    if (q.action === "buy") rows.push({ label: "Total debited", value: usd(notional + fee) });
    if (q.action === "sell") rows.push({ label: "Credited to checking", value: usd(notional - fee) });
    if (snapshot) rows.push({ label: "Checking after", value: usd(snapshot.balance + cashDelta(q)) });
    if (snapshot && q.fromAsset !== "USD") rows.push({ label: `${q.fromAsset} after`, value: `${displayUnits((BigInt(snapshot.fromUnits) - BigInt(q.fromUnits)).toString(), q.fromDecimals)} ${q.fromAsset}` });
    if (snapshot && q.toAsset !== "USD") rows.push({ label: `${q.toAsset} after`, value: `${displayUnits((BigInt(snapshot.toUnits) + BigInt(q.toUnits)).toString(), q.toDecimals)} ${q.toAsset}` });
    return rows;
  }

  /* Receipt rows are the same facts the review showed, now confirmed. */
  function receiptRows(q: CryptoReceipt) {
    const rows = reviewRows(q).filter(row => !/price$/.test(row.label) && row.label !== "Credited to checking" && row.label !== "Total debited" && row.label !== "Checking after");
    return [
      { label: "Reference", value: q.reference },
      { label: "Completed", value: longDate(q.completedAt) },
      ...rows,
    ];
  }

  function downloadReceipt(q: CryptoReceipt) {
    const lines = [
      "VEYRA — ACCOUNT ORDER RECEIPT", `Order: ${titles[q.action]}`, `Reference: ${q.reference}`,
      `Completed: ${longDate(q.completedAt)}`, `From: ${q.fromQuantity} ${q.fromAsset}`, `To: ${q.toQuantity} ${q.toAsset}`,
      `Notional: $${q.notionalUsd}`, `Account fee: $${q.feeUsd}`, "Network fee: none · no blockchain transaction", "",
      "Recorded once in your account. Account balances only; not an on-chain transaction.",
    ];
    downloadFile(`veyra-crypto-${q.reference}.txt`, lines.join("\n"));
  }

  const content = (() => {
    if (stage === "processing" && quote) return <CryptoTradeAnimation key={quote.id} quote={quote} onPresented={() => presentation.current?.()} />;

    if (stage === "success" && receipt) {
      const q = receipt, cash = cashDelta(q);
      return <div role="status">
        <FlowReceipt isDeposit={cash > 0} value={Math.abs(cash)}
          title={`Crypto ${verbs[q.action]}`}
          subtitle={q.action === "buy" ? `${q.toQuantity} ${q.toAsset} added to your holdings`
            : q.action === "sell" ? `${q.fromQuantity} ${q.fromAsset} sold · ${usd(Number(q.notionalUsd) - Number(q.feeUsd))} credited to checking`
            : `${q.fromQuantity} ${q.fromAsset} exchanged for ${q.toQuantity} ${q.toAsset}`}
          rows={receiptRows(q)}
          balanceBefore={snapshot ? snapshot.balance : undefined}
          balanceAfter={snapshot ? snapshot.balance + cash : undefined}
          download={() => downloadReceipt(q)} onAgain={again} onClose={close} againLabel={`${titles[q.action].split(" ")[0]} more`}
          extra={<p className="cw-recorded"><CheckCircle2 size={16} /> <b>Recorded once in your account</b> · {new Date(q.completedAt).toLocaleString()} · No blockchain transaction hash.</p>} />
      </div>;
    }

    if (stage === "review" && quote) {
      const fraction = quote.expiresAt > quote.createdAt ? Math.min(1, Math.max(0, seconds * 1000 / (quote.expiresAt - quote.createdAt))) : 0;
      const notional = Number(quote.notionalUsd);
      return <FlowReview className="cw-review" title="Review your order"
        description={quote.action === "buy" ? `Buy ${quote.toAsset} with checking. Veyra updates your account balances only.`
          : quote.action === "sell" ? `Sell ${quote.fromAsset} to checking. Veyra updates your account balances only.`
          : `Swap ${quote.fromAsset} for ${quote.toAsset} inside your account.`}
        amount={notional} track={cryptoTrack(quote)} rows={reviewRows(quote)}
        backLabel="Edit quote" confirmLabel={busy ? "Confirming…" : uncertain ? "Retry same order" : `Confirm ${quote.action}`}
        backDisabled={busy || uncertain} confirmDisabled={busy || (!seconds && !uncertain)}
        onBack={() => { setQuote(null); setError(""); }} onConfirm={() => void confirm()}
        extra={<div className="crypto-review-extra">
          {error && <p role="alert" className="banking-error">{error}</p>}
          <div className="crypto-lock">
            <p className="crypto-lock-head"><Clock3 size={15} />{seconds ? `Price locked for ${seconds}s` : "Quote expired · request a new review"}</p>
            <div className="flow-progress" aria-hidden="true"><i style={{ transform: `scaleX(${fraction})` }} /></div>
          </div>
          <p className="cw-subtle">Output is rounded down to the destination asset’s precision. A swap exchanges account holdings only; it does not bridge networks.</p>
          {uncertain && <p className="cw-notice" role="status">Status unconfirmed. Retry this same order or close and return to check it. Do not create another order to repeat this payment.</p>}
        </div>} />;
    }

    // Details stage: the order form, with recovery of an earlier order first.
    const est = estimate();
    return <div className="crypto-form-pane">
      <h2 className="flow-title" id="flow-title">{titles[action]}</h2>
      <p className="flow-sub">Account balances only. <StaffNote>Custody, cash conversion and external trading providers are not connected.</StaffNote> This is not an on-chain transaction.</p>
      {error && <p role="alert" className="banking-error">{error}</p>}
      {recoveryId && <div className="cw-notice"><p>Checking an earlier order prevents duplicate execution after a lost connection.</p><button className="solid-btn" disabled={busy} onClick={() => void recover(recoveryId)}>{busy ? "Checking order…" : "Check order status"}</button></div>}
      {!recoveryId && action === "sell" && sellable.length === 0 && <p className="cw-notice" role="status">You don’t hold any crypto to sell. Buy an asset first, then sell it here.</p>}
      {!recoveryId && (action !== "sell" || sellable.length > 0) && <form className="dash-form" onSubmit={review}>
        <CryptoRoute editable busy={busy}
          from={action === "buy" ? { asset: "USD", accountLast4: last4 } : { asset: source, choices: sourceChoices.map(holdingChoice), onChange: value => choose(value, "source") }}
          to={action === "sell" ? { asset: "USD", accountLast4: last4 } : { asset: target, choices: holdings.filter(h => action === "buy" || h.asset !== source).map(holdingChoice), onChange: value => choose(value, "target") }} />
        <label>{action === "buy" ? "Amount to spend (USD)" : `Quantity (${source})`}<input required inputMode="decimal" maxLength={72} pattern="[0-9]+(\.[0-9]+)?" autoComplete="off" placeholder={action === "buy" ? "0.00" : "0.00000000"} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <p className="cw-subtle">Available: {action === "buy" ? (account ? `$${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in checking` : "Checking balance unavailable") : `${available?.quantity ?? "Unavailable"} ${source}`}</p>
        {est && <p className="crypto-estimate" aria-live="polite">{est}<span> · final figures are locked at review</span></p>}
        <div className="cw-quick">{action === "buy" ? [25, 100, 250, 500].map(value => <button type="button" className="ghost-btn sm" key={value} onClick={() => setAmount(String(value))}>${value}</button>) : <button type="button" className="ghost-btn sm" disabled={!available || available.units === "0"} onClick={() => setAmount(available?.quantity ?? "")}>Use available amount</button>}</div>
        <label className="cw-checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required /><span>I understand this updates Veyra account records, not externally held coins. Digital assets are not deposits or FDIC insured.</span></label>
        <button className="solid-btn" disabled={busy || !accepted || !amount}>{busy ? "Getting current quote…" : "Review order"}</button>
      </form>}
    </div>;
  })();

  return <div className="flow-scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}>
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titles[quote?.action ?? action]} className="flow-modal kind-send cw-dialog crypto-flow">
      <div className="flow-head">
        <StageDots kind="deposit" stage={stage} completionLabel="Done" />
        <button type="button" className="flow-close" onClick={close} aria-label="Close" disabled={busy}><X size={16} /></button>
      </div>
      <div className="flow-body"><div className="flow-stage" key={stage}>{content}</div></div>
    </section>
  </div>;
}
