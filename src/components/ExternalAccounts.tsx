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

export function ExternalAccountsPage() {
  const { openDeposit } = useMoneyFlow();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blank), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID()), active = useRef(true), submitting = useRef(false), sequence = useRef(0);
  const load = useCallback(async () => {
    const version = ++sequence.current;
    setLoading(true);
    try {
      const data = await apiGet<Snapshot>("/api/me/external-accounts");
      if (active.current && version === sequence.current) { setSnapshot(data); setError(""); }
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
    <div className="external-account-toolbar"><button className="ghost-btn" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15} />{loading ? "Refreshing…" : "Refresh account status"}</button>{accounts.length > 0 && <button className="solid-btn" onClick={() => openDeposit()} disabled={busy}>Continue to Add funds <ArrowRight size={15} /></button>}</div>
    {snapshot && <>
      <section className="panel external-account-list" aria-label="Available bank accounts">
        <h2>{accounts.length ? "Your linked accounts & approved references" : "Link an external account"}</h2>
        {accounts.map(card)}
        {!accounts.length && <p>No verified external accounts or approved references are available yet. Save an account reference below to begin staff review.</p>}
        <div className="funding-activation-note"><ShieldCheck size={20} /><strong>Account references and bank connections are different</strong><p>A saved reference records your bank name and last four digits for review. Staff approval enables internal account entries only. Live bank linking, ownership checks through a provider and ACH debits are not connected.</p></div>
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
