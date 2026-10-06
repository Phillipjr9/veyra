import { Link } from "react-router-dom";
import { DirectDepositDetails, type ReceivingDetails } from "./DirectDepositDetails";
import type { ExternalAccount } from "./ExternalAccounts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MotionConfig } from "motion/react";
import { FundingAnimation } from "./FundingAnimation";
import { FundingDetails, validFundingAmount } from "./FundingDetails";
import { VeyraMark } from "./VeyraMark";
import { FlowReview, StageDots } from "./MoneyFlow";
import { ArrowDownLeft, ArrowLeft, ArrowRight, Building2, CircleHelp, CreditCard, FileCheck2, Landmark, LockKeyhole, ShieldCheck, Smartphone, WalletCards, X } from "lucide-react";
import { FUNDING_OPTIONS, fundingOption, fundingRequiresProvider, type FundingKind } from "../../shared/funding";
import { apiGet, apiPost } from "../lib/api";
import { money, useAcct } from "../lib/store";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";
import "../styles/funding-hub.css";

type Method = { id: string; kind: FundingKind; label: string; instructions: string; recipient: string; recipient_contact?: string; ledgerOnly?: boolean; unavailable?: boolean; linkedAccountId?: string; bank_name: string; routing_number: string; account_number: string };
type Request = { id: string; amount_cents: number; reference: string; status: string; method_snapshot: string; created_at: number };
type Funding = { linkedAccounts?: ExternalAccount[]; directDeposit?: ReceivingDetails | null; immediateFunding?: boolean; methods: Method[]; requests: Request[] };
const icons = { ach: Landmark, card: CreditCard, zelle: Smartphone, bank: ArrowDownLeft, wire: Building2, direct_deposit: WalletCards, check: FileCheck2, other: CircleHelp };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Funding information could not be loaded. Please try again.";
function requestMethod(request: Request): Partial<Method> {
  try {
    const saved = JSON.parse(request.method_snapshot);
    // Read older receipts without changing their persisted identifiers or balances.
    const ledgerOnly = saved.ledgerOnly === true || saved.demo === true;
    return { ...saved, ledgerOnly, label: ledgerOnly ? String(saved.label ?? "").replace(/ · demo$/i, "") : saved.label };
  } catch { return {}; }
}

function ProviderSetup({ kind }: { kind: "ach" | "card" }) {
  return <section className="funding-setup" aria-label={kind === "ach" ? "ACH linking setup" : "Debit card setup"}>
    <div className="funding-setup-notice"><LockKeyhole size={20} /><div><strong>Awaiting provider activation</strong><p>{kind === "ach"
      ? "Bank linking and trial deposits are not connected yet. No bank details are collected and no trial deposits will be sent from this screen."
      : "A secure card processor must be connected before you can add a debit card. No card details are collected and no charges can be made here."}</p></div></div>
    {kind === "ach" ? <>
      <h3>How bank verification will work</h3>
      <ol className="funding-steps">
        <li><span>1</span><div><strong>Enter your bank details securely</strong><p>Provide the account holder, nine-digit ACH routing number, account number and Checking or Savings type through the connected provider.</p></div></li>
        <li><span>2</span><div><strong>Wait for trial deposits</strong><p>With your consent, the provider will send small verification deposits. Their number, timing and any reversal depend on that provider.</p></div></li>
        <li><span>3</span><div><strong>Verify, then authorize a transfer</strong><p>Confirm the amounts or verification code shown by your bank. Linking an account verifies access; it does not itself authorize an ACH debit or make funds available.</p></div></li>
      </ol>
      <fieldset disabled className="dash-form funding-setup-preview" aria-label="Bank details preview — not active">
        <legend>Bank account setup</legend>
        <label>Account holder<input placeholder="Name on your external account" autoComplete="off" /></label>
        <div className="funding-field-pair"><label>ACH routing number<input placeholder="9-digit routing number" inputMode="numeric" autoComplete="off" /></label><label>External account number<input placeholder="Your bank account number" autoComplete="off" /></label></div>
        <label>External account type<select defaultValue="Checking"><option>Checking</option><option>Savings</option></select></label>
      </fieldset>
      <button type="button" className="solid-btn" disabled>Link bank · not activated</button>
    </> : <>
      <div className="funding-card-illustration" aria-hidden="true"><span>veyra <CreditCard size={26} /></span><strong>•••• &nbsp; •••• &nbsp; •••• &nbsp; ••••</strong><small>SECURE DEBIT CARD LINKING</small></div>
      <h3>Your card stays with the processor</h3><p>Once activated, a provider-hosted form will collect and tokenize your debit card. You’ll review any fees and limits before authorizing a charge. Veyra will not ask you to put a full card number or CVV in a funding note.</p>
      <button type="button" className="solid-btn" disabled>Add debit card · not activated</button>
    </>}
  </section>;
}

// Resolved by the shared Send money animation, never by a network delay.
// The request is sent immediately and success requires both promises.
type FundingPresentation = { finish: () => void };
function releasePresentation(presentation: FundingPresentation) { presentation.finish(); }

export function FundingDialog({ close, kind }: { close: () => void; kind?: string }) {
  const [immediateFunding, setImmediateFunding] = useState(false);
  const submitting = useRef(false), live = useRef(true);
  const [phase, setPhase] = useState<"form" | "review" | "processing" | "receipt">("form");
  const pause = useRef<FundingPresentation | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; if (pause.current) { releasePresentation(pause.current); pause.current = null; } };
  }, []);
  const { refreshAccount } = useAcct();
  const [linkedAccounts, setLinkedAccounts] = useState<ExternalAccount[]>([]);
  const [receiving, setReceiving] = useState<ReceivingDetails | null>(null);
  const [methods, setMethods] = useState<Method[]>([]), [requests, setRequests] = useState<Request[]>([]);
  const [activeKind, setActiveKind] = useState<FundingKind | null>(() => fundingOption(kind ?? "")?.kind ?? null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(""), [amount, setAmount] = useState(""), [note, setNote] = useState("");
  const [error, setError] = useState(""), [submittedId, setSubmittedId] = useState("");
  const [lastReceipt, setLastReceipt] = useState<Request | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const dialog = useBankingDialog(close, busy), detailTitle = useRef<HTMLHeadingElement>(null);
  const previousKind = useRef<FundingKind | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<Funding>("/api/me/funding").then(data => {
      if (live) { setMethods(data.methods); setRequests(data.requests); setLinkedAccounts(data.linkedAccounts ?? []); setReceiving(data.directDeposit ?? null); setImmediateFunding(!!data.immediateFunding); setLoaded(true); }
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (activeKind) { detailTitle.current?.focus(); dialog.current?.scrollTo({ top: 0 }); }
    else if (previousKind.current) {
      dialog.current?.querySelector<HTMLElement>(`[data-funding-kind="${previousKind.current}"]`)?.focus();
    }
    previousKind.current = activeKind;
  }, [activeKind, dialog]);
  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
    dialog.current?.querySelector(".flow-body")?.scrollTo({ top: 0 });
    dialog.current?.focus({ preventScroll: true });
  }, [phase, dialog]);
  const available = immediateFunding ? methods : methods.filter(m => m.kind === activeKind);
  const method = available.find(m => m.id === selected) ?? available.find(m => m.kind === activeKind) ?? available[0];
  const option = activeKind ? fundingOption(activeKind) : undefined;
  const submitted = requests.find(r => r.id === submittedId) ?? (lastReceipt?.id === submittedId ? lastReceipt : undefined);
  const change = () => { setRequestKey(crypto.randomUUID()); setSubmittedId(""); setLastReceipt(null); setError(""); setPhase("form"); };
  function choose(next: FundingKind | null) {
    setActiveKind(next); setSelected(""); setAmount(""); setNote(""); change();
  }
  async function refreshStatus() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const data = await apiGet<Funding>("/api/me/funding");
      setMethods(data.methods); setRequests(data.requests); setLinkedAccounts(data.linkedAccounts ?? []); setReceiving(data.directDeposit ?? null); setImmediateFunding(!!data.immediateFunding); setLoaded(true);
      setLastReceipt(previous => data.requests.find(row => row.id === submittedId) ?? previous);
      if (method && !data.methods.some(m => m.id === method.id && m.kind === method.kind)) { setSelected(""); setAmount(""); setNote(""); setRequestKey(crypto.randomUUID()); setSubmittedId(""); setPhase("form"); }
      await refreshAccount();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (immediateFunding && (phase !== "review" || !validFundingAmount(amount))) return;
    if (submitting.current || busy || submittedId || !method || method.unavailable || (!immediateFunding && fundingRequiresProvider(method.kind))) return;
    submitting.current = true;
    let finishPresentation!: () => void;
    const shown = new Promise<void>(finish => { finishPresentation = finish; });
    const presentation: FundingPresentation = { finish: finishPresentation };
    pause.current = presentation;
    setBusy(true); setError(""); setPhase("processing");
    try {
      // Submit immediately. The minimum below is presentation time only; it
      // never postpones the ledger credit or creates a pending approval.
      const result = await apiPost<{ request: Request }>("/api/me/deposits", { amount, methodId: method.id, note, requestKey, ...(immediateFunding ? { accountEntry: true } : {}) });
      if (!live.current) return;
      if (result.request.status === "confirmed") {
        // A failed balance refresh must not turn an acknowledged deposit into
        // a failure or allow it to be submitted again.
        void refreshAccount().catch(() => {
          if (live.current) setError("Funds were added. Refresh your account to see the updated balance; do not submit another deposit.");
        });
      }
      await shown;
      if (!live.current) return;
      setRequests(rows => [result.request, ...rows.filter(row => row.id !== result.request.id)]);
      setSubmittedId(result.request.id); setLastReceipt(result.request); setPhase("receipt");
    } catch (e) {
      if (live.current) { setError(errorMessage(e)); setPhase("form"); dialog.current?.scrollTo({ top: 0 }); }
    } finally {
      releasePresentation(presentation);
      if (pause.current === presentation) pause.current = null;
      submitting.current = false;
      if (live.current) setBusy(false);
    }
  }

  const compact = immediateFunding || !loaded || phase !== "form";
  return <MotionConfig reducedMotion="user"><div className={compact ? "flow-scrim" : "banking-scrim"}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add funds" className={compact ? "flow-modal kind-deposit funding-flow-modal" : "banking-panel funding-hub"}>
    {!compact ? <header className="funding-hub-header"><div><span className="funding-eyebrow">MOVE MONEY IN</span><h2>Add funds</h2></div><button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void refreshStatus()}>Refresh funding status</button><button type="button" className="funding-close" aria-label="Close" onClick={close} disabled={busy}><X size={20} /></button></header> : <div className="flow-head"><StageDots kind={immediateFunding || !loaded ? "deposit" : "funding"} stage={phase === "receipt" ? "success" : phase} /><button type="button" className="flow-close" aria-label="Close" onClick={close} disabled={busy}><X size={16} /></button></div>}
    <div className={compact ? "flow-body" : undefined}>
    {error && <p role="alert" className="banking-error">{error}</p>}
    {phase === "receipt" && <button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void refreshStatus()}>Refresh funding status</button>}
    {!loaded && !error && <p>Loading your funding methods…</p>}
    {immediateFunding && phase === "form" && <FundingDetails methods={methods} linkedAccountCount={linkedAccounts.length} selected={method?.id ?? ""} amount={amount} note={note} busy={busy}
      onMethod={id => { setSelected(id); setActiveKind(methods.find(m => m.id === id)?.kind ?? null); change(); }}
      onAmount={value => { setAmount(value); change(); }} onNote={value => { setNote(value); change(); }}
      onReview={() => { if (method && !method.unavailable && validFundingAmount(amount) && !busy) { setError(""); setPhase("review"); } }} onCancel={close}>
      {method?.kind === "direct_deposit" && <DirectDepositDetails details={receiving} close={close} />}
    </FundingDetails>}
    {immediateFunding && phase === "review" && method && <FlowReview title="Review deposit"
      description="Check the details before adding funds to your account."
      amount={Number(amount)} confirmLabel={`Add ${money(Number(amount))}`} onBack={() => setPhase("form")} onConfirm={() => void submit()}
      track={{ from: { label: method.label, sub: "Selected funding method", icon: <ArrowDownLeft size={20} /> }, to: { label: "Your Veyra account", sub: "Account entry", icon: <VeyraMark width={20} height={20} /> } }}
      rows={[{ label: "Method", value: method.label }, { label: "To", value: "Your Veyra account" },
        ...(note ? [{ label: "Memo", value: note }] : []), { label: "Available", value: "Immediately after confirmation" }, { label: "Fee", value: "$0.00 · Free", tone: "free" }]}
    />}
    {immediateFunding && phase === "review" && <p className="funding-animation-note">This updates your account. External bank and card processing is not connected.</p>}
    {(phase === "processing" || phase === "receipt") && <FundingAnimation phase={phase} amount={submitted ? submitted.amount_cents / 100 : Number(amount)} source={method?.label ?? "Funding method"} immediate={immediateFunding}
      receipt={submitted ? { status: submitted.status, reference: submitted.reference, ledgerOnly: !!requestMethod(submitted).ledgerOnly, createdAt: submitted.created_at } : undefined}
      onPresented={() => pause.current?.finish()}
      close={close} again={() => choose(null)} />}
    {!immediateFunding && loaded && <div hidden={phase !== "form"}>
    {activeKind && option ? <>
      <button type="button" className="funding-back" onClick={() => choose(null)} disabled={busy}><ArrowLeft size={16} /> All funding methods</button>
      <h3 className="funding-detail-title" ref={detailTitle} tabIndex={-1}>{option.label}</h3>
      {!immediateFunding && option.providerRequired ? <>{activeKind === "ach" && <label className="funding-method-label">Saved bank account<select aria-label="Saved bank account" disabled={!linkedAccounts.length || busy}>{!linkedAccounts.length && <option>No bank account available</option>}{linkedAccounts.map(account => <option key={account.id} value={account.id}>{account.bank_name} {account.account_type} •••• {account.last4}{account.verification_kind === "staff_reference" ? " · Account reference" : ""}</option>)}</select></label>}<ProviderSetup kind={activeKind as "ach" | "card"} />{activeKind === "ach" && <Link to="/app/external-accounts" className="solid-btn" onClick={close}>{linkedAccounts.length ? "Manage linked accounts" : "Link an external account"}</Link>}</> : <>
        <p className="funding-detail-intro">{immediateFunding ? "Choose the amount to add to your account." : option.description}</p>
        {!immediateFunding && activeKind === "zelle" && <div className="funding-activation-note"><strong>Use your participating bank’s app</strong><p>Veyra does not send or request Zelle payments. Confirm that the recipient email or phone and the name shown in your bank app match these instructions before sending. Availability and limits depend on the receiving bank; receipt is not instant or guaranteed here.</p></div>}
        {activeKind === "direct_deposit" && <DirectDepositDetails details={receiving} close={close} />}
        {!immediateFunding && activeKind === "check" && <p>Check collection is not connected. This screen only shows check-funding instructions enabled by your administrator. It does not collect photos, perform OCR or clear checks.</p>}
      </>}
      {loaded && !method && !(activeKind === "direct_deposit" && receiving) && <div className="funding-empty"><ShieldCheck size={22} /><div><strong>{option.providerRequired ? "No connected funding source" : "Instructions not configured"}</strong><p>{option.providerRequired ? "This method will remain inactive until a provider is integrated. Never send bank or card credentials to support." : "Your administrator has not enabled receiving instructions for this method. Contact support before sending funds; do not use unverified account details."}</p></div></div>}
      {method && <>
        <label className="funding-method-label">Funding method<select aria-label="Funding method" disabled={busy} value={method.id} onChange={e => { setSelected(e.target.value); change(); }}>{available.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <div className="funding-instructions"><div className="funding-instructions-heading"><h3>{method.label}</h3><span className="funding-badge">{immediateFunding ? "Available immediately" : option.providerRequired ? "Reference only" : "Manual instructions"}</span></div><p>{method.instructions}</p><dl>{[['Recipient',method.recipient], ...(activeKind === 'zelle' ? [['Zelle email or phone',method.recipient_contact]] : option.providerRequired || activeKind === 'direct_deposit' ? [] : [['Bank',method.bank_name],['Routing number',method.routing_number],['Account number',method.account_number]])].filter(([,value]) => value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
        {(immediateFunding || !option.providerRequired) && <form className="dash-form funding-request-form" onSubmit={submit}><fieldset disabled={busy || !!submittedId}>
          <h3>{immediateFunding ? "Add to your account" : "Let us know about your transfer"}</h3><p>{immediateFunding ? "Your available account balance updates as soon as you add funds. No separate wallet or staff review." : "After following the instructions, record the transfer for review. This does not move money, charge a card or make funds available. Your balance changes only after staff confirm receipt."}</p>
          <label>Amount (USD)<input type="number" required min="10" max="100000" step="0.01" inputMode="decimal" value={amount} onChange={e => {setAmount(e.target.value);change();}} /></label>
          <p>{immediateFunding ? "$10–$100,000 per deposit. No fee." : "$10–$100,000 per request. Your sending bank or provider may have different limits or fees."}</p>
          <label>Reference or note (optional)<textarea maxLength={500} value={note} onChange={e => {setNote(e.target.value);change();}} placeholder="Transfer reference — never a password, full card number or CVV" /></label>
          <button className="solid-btn" disabled={!!submittedId}>{busy ? 'Submitting…' : immediateFunding ? 'Add funds now' : 'Submit funding request'}</button>
        </fieldset></form>}
      </>}
    </> : <>
      <div className="funding-hub-intro"><div><h3>A way in, on your terms.</h3><p>{immediateFunding ? "Choose your funding method and add funds immediately to your account." : "Choose how you’d like to fund your account. See what’s configured, what needs activation, and where each request stands."}</p></div><div className="funding-orbit" aria-hidden="true"><div /><span><Landmark size={28} /></span></div></div>
      <div className="funding-choice-grid">{FUNDING_OPTIONS.filter(o => o.kind !== 'other' || methods.some(m => m.kind === 'other')).map(o => {
        const Icon = icons[o.kind], configured = methods.some(m => m.kind === o.kind);
        return <button type="button" className="funding-choice" data-funding-kind={o.kind} aria-label={o.label} key={o.kind} disabled={busy} onClick={() => choose(o.kind)}>
          <span className={`funding-choice-icon funding-icon-${o.kind}`}><Icon size={21} /></span>
          <span className="funding-choice-copy"><strong>{o.label}</strong><small>{immediateFunding ? "Add funds directly to your account." : o.description}</small><span className={`funding-badge ${!o.providerRequired && configured ? 'is-configured' : ''}`}>{immediateFunding ? 'Available now' : o.providerRequired ? 'Activation needed' : !loaded ? 'Availability not loaded' : configured ? 'Instructions available' : 'Not configured'}</span></span><ArrowRight size={16} className="funding-choice-arrow" />
        </button>;
      })}</div>
      <p className="funding-safety-note"><ShieldCheck size={17} /><span>{immediateFunding ? "Account entries update immediately. External bank and card processing is not connected. Do not enter bank passwords or card details." : "Only use verified receiving instructions. No automatic debit, trial deposit, card charge or instant credit is initiated by this screen."}</span></p>
    </>}
    </div>}
    </div>
  </section></div></MotionConfig>;
}
