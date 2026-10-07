import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { useMoneyFlow } from "./MoneyFlow";
import { externalAccountStatus, type ExternalAccount } from "../../shared/externalAccounts";
import "../styles/funding-hub.css";
export type { ExternalAccount } from "../../shared/externalAccounts";
const blank = { bankName: "", accountName: "", last4: "", accountType: "Checking", ownershipConfirmed: false };
type Snapshot = { accounts: ExternalAccount[]; requests: ExternalAccount[]; referenceRequestsAvailable: boolean; linkingAvailable: boolean };
type Rails = {
  provider: "stripe"; configured: boolean; live: boolean; status: "unavailable" | "not_started" | "onboarding" | "provisioning" | "pending" | "active" | "restricted" | "closed";
  connected: boolean; accountReady: boolean; features: { active: string[]; pending: string[]; restricted: string[] };
  receiving: { bankName?: string; routingNumber?: string; accountNumberLast4?: string; supportedNetworks?: string[] } | null; updatedAt?: number;
  settlements?: Array<{ id: string; flowType: string; amount: number; currency: string; description: string; status: "open" | "posted" | "void"; createdAt: number; postedAt: number | null }>;
};

const railCopy: Record<Rails["status"], { title: string; detail: string }> = {
  unavailable: { title: "Live bank connection unavailable", detail: "Live account linking is not configured for this environment. Your saved references remain separate from a bank connection." },
  not_started: { title: "Set up your live bank connection", detail: "Complete secure Stripe verification to enable provider-backed bank linking, ACH, wire, and card features as they are approved for your account." },
  onboarding: { title: "Verification in progress", detail: "Stripe still needs information to activate your connected account. Continue the secure verification flow to proceed." },
  provisioning: { title: "Preparing your financial account", detail: "Your Stripe account is verified. We are waiting for the requested financial-account capabilities to become available." },
  pending: { title: "Bank rails are activating", detail: "Stripe has received the financial-account request. Some features activate asynchronously; refresh this status after you receive confirmation." },
  active: { title: "Live bank connection active", detail: "Your Stripe financial account is open. Available ACH, wire, and card capabilities appear below as Stripe activates them." },
  restricted: { title: "Live bank connection restricted", detail: "Stripe has restricted one or more requested features. Review the verification requirements or contact support before moving money." },
  closed: { title: "Live bank connection closed", detail: "Your Stripe financial account is no longer open. Contact support before attempting another bank transfer." },
};

export function ExternalAccountsPage() {
  const { openDeposit } = useMoneyFlow();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [rails, setRails] = useState<Rails | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blank), [busy, setBusy] = useState(false), [railBusy, setRailBusy] = useState(false), [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID()), active = useRef(true), submitting = useRef(false), sequence = useRef(0);
  const load = useCallback(async () => {
    const version = ++sequence.current;
    setLoading(true);
    try {
      const [data, railStatus] = await Promise.all([
        apiGet<Snapshot>("/api/me/external-accounts"),
        apiGet<{ rails: Rails }>("/api/me/rails"),
      ]);
      if (active.current && version === sequence.current) { setSnapshot(data); setRails(railStatus.rails); setError(""); }
    } catch (e) { if (active.current && version === sequence.current) setError(e instanceof Error ? e.message : "Account information is unavailable."); }
    finally { if (active.current && version === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; sequence.current++; }; }, [load]);
  function change<K extends keyof typeof blank>(field: K, value: typeof blank[K]) {
    setForm(previous => ({ ...previous, [field]: value })); key.current = crypto.randomUUID(); setNotice(""); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await apiPost<{account: ExternalAccount}>("/api/me/external-accounts", { ...form, requestKey: key.current });
      if (!active.current) return;
      setUncertain(false); setFormOpen(false); setForm(blank); key.current = crypto.randomUUID();
      setNotice(`Account ending ${result.account.last4} saved for review. It will be available for internal account funding only after staff approval. No bank connection or debit was initiated.`);
      await load();
    } catch (e) {
      if (!active.current) return;
      setUncertain(!(e instanceof ApiError && e.status >= 400 && e.status < 500));
      setError(e instanceof Error ? e.message : "We could not confirm the request. Retry the same request to avoid duplicates.");
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  }
  async function beginStripeOnboarding() {
    setRailBusy(true); setError("");
    try {
      const result = await apiPost<{ url: string }>("/api/me/rails/stripe/onboarding");
      // Stripe hosts the collection flow; credentials and documents never pass
      // through Veyra's browser forms or API. Replace the page rather than
      // opening a popup, which is friendlier to mobile and strict popup rules.
      window.location.assign(result.url);
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "We could not start secure verification."); }
    finally { if (active.current) setRailBusy(false); }
  }
  async function activateFinancialAccount() {
    setRailBusy(true); setError("");
    try {
      await apiPost("/api/me/rails/stripe/financial-account");
      if (active.current) { setNotice("Your Stripe financial account request was received. Some capabilities activate asynchronously."); await load(); }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "We could not activate your financial account."); }
    finally { if (active.current) setRailBusy(false); }
  }
  async function refreshRails() {
    setRailBusy(true); setError("");
    try { await apiPost("/api/me/rails/stripe/refresh"); if (active.current) await load(); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : "We could not refresh the Stripe connection."); }
    finally { if (active.current) setRailBusy(false); }
  }
  const accounts = snapshot?.accounts ?? [], requests = snapshot?.requests ?? [];
  const showForm = formOpen || (!accounts.length && !requests.length);
  const card = (account: ExternalAccount) => <article className="external-account-row" key={account.id} aria-label={`${account.bank_name} ending ${account.last4}`}>
    <Landmark size={22} /><div><strong>{account.bank_name}</strong><p>{account.account_name} · {account.account_type} •••• {account.last4}</p>{account.verification_note && <p className="external-review-note">Review note: {account.verification_note}</p>}</div>
    <span className={`funding-badge ${account.status === "verified" ? "is-configured" : ""}`}>{externalAccountStatus(account)}</span>
  </article>;
  return <div className="app-page external-accounts-page">
    <Link to="/app/accounts" className="text-link"><ArrowLeft size={15} /> Accounts</Link>
    <header><span className="cw-eyebrow">CONNECTED FUNDING</span><h1>External accounts</h1><p>Your linked banks and saved funding references, in one place.</p></header>
    {error && <p className="banking-error" role="alert">{error}</p>}
    {notice && <p className="external-account-notice" role="status">{notice}</p>}
    {loading && !snapshot && <p role="status">Loading linked accounts…</p>}
    <div className="external-account-toolbar"><button className="ghost-btn" disabled={loading || busy || railBusy} onClick={() => void load()}><RefreshCw size={15} />{loading ? "Refreshing…" : "Refresh account status"}</button>{accounts.length > 0 && <button className="solid-btn" onClick={() => openDeposit()} disabled={busy || railBusy}>Continue to Add funds <ArrowRight size={15} /></button>}</div>
    {rails?.configured && <section className="panel external-account-list funding-activation-note" aria-live="polite">
      <ShieldCheck size={20} /><div><span className="cw-eyebrow">{rails.live ? "LIVE" : "STRIPE TEST MODE"} · STRIPE FINANCIAL ACCOUNTS</span><h2>{railCopy[rails.status].title}</h2><p>{railCopy[rails.status].detail}</p>
      {rails.receiving?.accountNumberLast4 && <p className="external-review-note">Receiving details issued by Stripe: {rails.receiving.bankName || "Bank account"} · •••• {rails.receiving.accountNumberLast4}{rails.receiving.supportedNetworks?.length ? ` · ${rails.receiving.supportedNetworks.join(" / ").toUpperCase()}` : ""}</p>}
      {rails.features.active.length > 0 && <p className="external-review-note">Active: {rails.features.active.map(feature => feature.replace(/_/g, " ")).join(" · ")}</p>}
      {rails.features.pending.length > 0 && <p className="external-review-note">Pending: {rails.features.pending.map(feature => feature.replace(/_/g, " ")).join(" · ")}</p>}
      {rails.features.restricted.length > 0 && <p className="banking-error">Restricted: {rails.features.restricted.map(feature => feature.replace(/_/g, " ")).join(" · ")}</p>}
      {rails.settlements && rails.settlements.length > 0 && <div className="rail-settlement-list" aria-label="Recent Stripe settlement status"><strong>Recent Stripe settlement status</strong>{rails.settlements.map(settlement => <p className="external-review-note" key={settlement.id}><span className={`funding-badge ${settlement.status === "posted" ? "is-configured" : ""}`}>{settlement.status === "posted" ? "Settled" : settlement.status === "open" ? "Pending" : "Voided"}</span> {settlement.description} · {settlement.amount < 0 ? "−" : "+"}${Math.abs(settlement.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {settlement.currency.toUpperCase()}</p>)}</div>}
      <div className="external-account-toolbar">
        {(rails.status === "not_started" || rails.status === "onboarding" || rails.status === "restricted") && <button type="button" className="solid-btn" disabled={railBusy} onClick={() => void beginStripeOnboarding()}>{railBusy ? "Opening Stripe…" : rails.status === "not_started" ? "Start secure verification" : "Continue secure verification"}<ArrowRight size={15} /></button>}
        {(rails.status === "provisioning" || rails.status === "onboarding") && <button type="button" className="ghost-btn" disabled={railBusy} onClick={() => void activateFinancialAccount()}>{railBusy ? "Checking Stripe…" : "Activate financial account"}</button>}
        {rails.connected && <button type="button" className="ghost-btn" disabled={railBusy} onClick={() => void refreshRails()}><RefreshCw size={15} />{railBusy ? "Refreshing Stripe…" : "Refresh Stripe status"}</button>}
      </div></div>
    </section>}
    {snapshot && <>
      <section className="panel external-account-list" aria-label="Available bank accounts">
        <h2>{accounts.length ? "Your linked accounts & approved references" : "Link an external account"}</h2>
        {accounts.map(card)}
        {!accounts.length && <p>No verified external accounts or approved references are available yet. Save an account reference below to begin staff review.</p>}
        <div className="funding-activation-note"><ShieldCheck size={20} /><strong>Account references and bank connections are different</strong><p>A saved reference records your bank name and last four digits for review. Staff approval enables internal account entries only. {rails?.configured ? "For provider-backed bank linking and ownership verification, use the secure Stripe connection above — never enter a full account number here." : "Live bank linking, ownership checks through a provider and ACH debits are not connected in this environment."}</p></div>
      </section>
      {snapshot.referenceRequestsAvailable && !showForm && <button type="button" className="ghost-btn external-add-reference" onClick={() => setFormOpen(true)}>Add another account reference <ArrowRight size={14} /></button>}
      {snapshot.referenceRequestsAvailable && showForm ? <section className="panel external-account-list external-account-form-panel">
        <h2>Add an account reference</h2><p>Step 1: save your reference. Step 2: staff independently verify ownership. Step 3: the approved reference appears in Add funds. Saving does not verify ownership or authorize a debit.</p>
        <form className="dash-form" onSubmit={submit}>
          <fieldset disabled={busy || uncertain}>
            <label>Bank name<input required maxLength={120} autoComplete="off" value={form.bankName} onChange={e => change("bankName",e.target.value)} placeholder="Name of your bank" /></label>
            <label>Account display name<input required maxLength={120} autoComplete="off" value={form.accountName} onChange={e => change("accountName",e.target.value)} placeholder="For example, Household checking" /></label>
            <div className="external-account-fields"><label>Account type<select value={form.accountType} onChange={e => change("accountType",e.target.value)}><option>Checking</option><option>Savings</option></select></label>
              <label>Last four account digits<input required type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" value={form.last4} onChange={e => change("last4",e.target.value.replace(/\D/g,""))} placeholder="1234" /></label></div>
            <label className="external-ownership"><input type="checkbox" required checked={form.ownershipConfirmed} onChange={e => change("ownershipConfirmed",e.target.checked)} /><span>I own this account. I understand this saves a reference for review and does not link to my bank or authorize a withdrawal.</span></label>
          </fieldset>
          {uncertain && <p role="status">The save result is unconfirmed. Retry this same request before changing the details; it cannot create a duplicate.</p>}
          <button type="submit" className="solid-btn" disabled={busy}>{busy ? "Saving reference…" : uncertain ? "Retry same request" : "Submit account for review"}<ArrowRight size={15} /></button>
        </form>
        <p className="funding-safety-note">Use only the last four digits. Never enter a full external account number, bank password, access code or card details.</p>
      </section> : !snapshot.referenceRequestsAvailable ? <p>Only an active, approved account owner can submit an account reference.</p> : null}
      {requests.length > 0 && <section className="panel external-account-list" aria-label="Account reference reviews"><h2>Account reference reviews</h2>{requests.map(card)}<p>Refresh the status after staff review. For questions, contact support using the bank name and last four digits only.</p></section>}
      <Link to="/app/support-desk" className="text-link">Contact support about bank linking <ArrowRight size={14} /></Link>
    </>}
  </div>;
}
