import { useBankingDialog } from "./bankingDialog";
import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import { money, useAcct } from "../lib/store";
import "../styles/banking-controls.css";

type FundingMethod = { id?: string; label: string; kind: string; instructions: string; bankName: string; routingNumber: string; accountNumber: string; recipient: string; enabled: boolean };
type FundingRequest = { id: string; amount_cents: number; reference: string; status: string; note: string; created_at: number; method_snapshot: string; evidence: string };
const normalize = (m: any): FundingMethod => ({ id: m.id, label: m.label, kind: m.kind, instructions: m.instructions, bankName: m.bank_name, routingNumber: m.routing_number, accountNumber: m.account_number, recipient: m.recipient, enabled: !!m.enabled });
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not complete.";

export function AccountEditor({ userId, name, close, saved }: { userId: string; name: string; close: () => void; saved: () => void }) {
  const [form, setForm] = useState<any>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialog = useBankingDialog(close,busy);
  useEffect(() => { let live = true; apiGet<{ account: any }>(`/api/admin/members/${userId}/account-details`).then(r => { if (live) setForm({ ...r.account, reason: "" }); }).catch(e => { if (live) setError(message(e)); }); return () => { live = false; }; }, [userId]);
  const set = (key: string, value: string) => setForm((f: any) => ({ ...f, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await apiPatch(`/api/admin/members/${userId}/account-details`, form); saved(); close(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Account details: ${name}`} className="banking-panel">
    <h2>Account details: {name}</h2><p>Changes update this member’s account and are recorded in the audit log. These details do not connect or verify an external bank.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}
    {form ? <form className="dash-form" onSubmit={submit}><fieldset disabled={busy}>
      {[['accountNumber','Account number'],['routingNumber','Routing number'],['bankName','Bank name']].map(([key,label]) => <label key={key}>{label}<input required value={form[key]} onChange={e => set(key,e.target.value)} maxLength={key === 'routingNumber' ? 9 : key === 'accountNumber' ? 34 : 120} inputMode={key === 'bankName' ? 'text' : 'numeric'} /></label>)}
      <label>Bank account type<select aria-label="Bank account type" value={form.bankAccountType} onChange={e => set('bankAccountType',e.target.value)}><option>Checking</option><option>Savings</option></select></label>
      <label>Member account type<select aria-label="Member account type" value={form.accountType} onChange={e => set('accountType',e.target.value)}><option value="personal">Personal</option><option value="business">Business</option></select></label>
      {form.accountType === 'business' && <label>Business name<input required value={form.business} maxLength={160} onChange={e => set('business',e.target.value)} /></label>}
      <p>Changing Personal/Business changes the workspace, not identity-verification status. Review the applicant’s business information separately. Active business teammates must be removed before conversion to personal.</p>
      <label>Reason for change<textarea required maxLength={500} value={form.reason} onChange={e => set('reason',e.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="ghost-btn" onClick={close} disabled={busy}>Cancel</button><button className="solid-btn" disabled={busy}>{busy ? 'Saving…' : 'Save account details'}</button></div>
    </fieldset></form> : <button className="ghost-btn" onClick={close}>Close</button>}
  </section></div>;
}

export function FundingManager({ userId, name, canEdit, canReview, close }: { userId: string; name: string; canEdit: boolean; canReview: boolean; close: () => void }) {
  const [methods, setMethods] = useState<FundingMethod[]>([]), [requests, setRequests] = useState<FundingRequest[]>([]), [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const dialog = useBankingDialog(close,busy);
  const [review, setReview] = useState<{ id: string; decision: string } | null>(null), [evidence, setEvidence] = useState("");
  const load = async () => { const r = await apiGet<{ methods: any[]; requests: FundingRequest[] }>(`/api/admin/members/${userId}/funding`); setMethods(r.methods.map(normalize)); setRequests(r.requests); setLoaded(true); };
  useEffect(() => { void load().catch(e => setError(message(e))); }, [userId]);
  const set = (index: number, key: keyof FundingMethod, value: string | boolean) => setMethods(rows => rows.map((m,i) => i === index ? { ...m, [key]: value } : m));
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(""); setStatus(""); try { const r = await apiPut<{ methods: any[] }>(`/api/admin/members/${userId}/funding`, { methods }); setMethods(r.methods.map(normalize)); setStatus("Funding methods saved. No money was collected."); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function reviewRequest(e: FormEvent) { e.preventDefault(); if (!review || busy) return; setBusy(true); setError(""); try { await apiPost(`/api/admin/members/${userId}/funding/${review.id}/review`, { decision: review.decision, evidence }); setReview(null); setEvidence(""); setStatus("Review recorded."); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Funding: ${name}`} className="banking-panel banking-wide">
    <h2>Ways to add funds: {name}</h2><p>Configure methods, masked source labels, recipient details and instructions for this member only. No payment processor is connected by editing this form. Never enter a full card number, CVV, password or API key.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}<p role="status">{status}</p>
    <form onSubmit={save} className="dash-form"><fieldset disabled={!loaded || !canEdit || busy}>
      {methods.map((m,i) => <section className="funding-method-editor" key={m.id ?? i}><h3>Method {i+1}</h3>
        <label>Source / method label<input required maxLength={100} value={m.label} onChange={e => set(i,'label',e.target.value)} placeholder="e.g. Bank transfer or Card ending 1234" /></label>
        <label>Method type<select aria-label="Method type" value={m.kind} onChange={e => set(i,'kind',e.target.value)}>{['bank','wire','card','check','other'].map(k => <option key={k}>{k}</option>)}</select></label>
        <label>Instructions<textarea required maxLength={2000} value={m.instructions} onChange={e => set(i,'instructions',e.target.value)} /></label>
        {(['recipient','bankName','routingNumber','accountNumber'] as const).map(key => <label key={key}>{({recipient:'Recipient / account holder',bankName:'Bank name',routingNumber:'Routing number',accountNumber:'Receiving account number (not a card number)'})[key]}<input value={m[key]} maxLength={key === 'routingNumber' ? 9 : key === 'accountNumber' ? 34 : 160} onChange={e => set(i,key,e.target.value)} /></label>)}
        <label className="banking-check"><input type="checkbox" checked={m.enabled} onChange={e => set(i,'enabled',e.target.checked)} />Enabled for this member</label>
      </section>)}
      <button type="button" className="ghost-btn" disabled={methods.length >= 12} onClick={() => setMethods(rows => [...rows, { label: '',kind:'bank',instructions:'',bankName:'',routingNumber:'',accountNumber:'',recipient:'',enabled:true }])}>Add funding method</button>
      <button className="solid-btn">Save funding methods</button>
    </fieldset></form>
    <h3>Funding requests</h3>{!requests.length && <p>No requests submitted.</p>}
    {requests.map(r => <article className="banking-request" key={r.id}><b>{money(r.amount_cents/100)} · {r.status}</b><span>{r.reference} · {new Date(r.created_at).toLocaleString()}</span><p>{r.note}</p><details><summary>Instructions at submission</summary><p>{JSON.parse(r.method_snapshot).label}</p><p>{JSON.parse(r.method_snapshot).instructions}</p></details>{r.evidence && <p>Review note: {r.evidence}</p>}
      {canReview && r.status === 'pending' && <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => { setReview({id:r.id,decision:'rejected'});setEvidence(''); }}>Reject</button><button type="button" className="solid-btn" onClick={() => { setReview({id:r.id,decision:'confirmed'});setEvidence(''); }}>Confirm received funds</button></div>}
    </article>)}
    {review && <form className="dash-form banking-request" onSubmit={reviewRequest}><h3>{review.decision === 'confirmed' ? 'Confirm receipt before crediting' : 'Reject request'}</h3><p>Confirm only after independently verifying the funds. This action changes the ledger, not an external bank balance.</p><label>Evidence / reason<textarea required maxLength={500} value={evidence} onChange={e => setEvidence(e.target.value)} /></label><button className="solid-btn" disabled={busy}>{busy ? 'Saving…' : 'Commit review'}</button><button type="button" className="ghost-btn" onClick={() => setReview(null)}>Cancel review</button></form>}
    <button type="button" className="ghost-btn" onClick={close} disabled={busy}>Close</button>
  </section></div>;
}

export function FundingDialog({ close, kind }: { close: () => void; kind?: string }) {
  const { refreshAccount } = useAcct();
  const [methods, setMethods] = useState<FundingMethod[]>([]), [requests, setRequests] = useState<FundingRequest[]>([]), [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(""), [amount, setAmount] = useState(""), [note, setNote] = useState(""), [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false), [key, setKey] = useState(() => crypto.randomUUID());
  const dialog = useBankingDialog(close,busy);
  useEffect(() => { let live = true; apiGet<{ methods: any[]; requests: FundingRequest[] }>("/api/me/funding").then(r => { if(live) { const available=r.methods.filter(m => !kind || m.kind === kind); setMethods(available.map(normalize)); setRequests(r.requests); setSelected(available[0]?.id ?? ""); setLoaded(true); } }).catch(e => { if(live) setError(message(e)); }); return () => { live=false; }; }, []);
  async function refreshStatus() {
    setBusy(true); setError("");
    try {
      const r = await apiGet<{ methods: any[]; requests: FundingRequest[] }>("/api/me/funding");
      const available = r.methods.filter(m => !kind || m.kind === kind);
      setMethods(available.map(normalize)); setRequests(r.requests); setLoaded(true);
      if (!available.some(m => m.id === selected)) { setSelected(available[0]?.id ?? ""); setKey(crypto.randomUUID()); setStatus(""); }
      await refreshAccount();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const method = methods.find(m => m.id === selected);
  const change = () => { setKey(crypto.randomUUID()); setStatus(""); };
  async function submit(e: FormEvent) { e.preventDefault(); if(busy) return; setBusy(true); setError(""); try { const r = await apiPost<{ request: FundingRequest }>("/api/me/deposits", { amount, methodId: selected, note, requestKey: key }); setRequests(rows => [r.request,...rows.filter(row => row.id !== r.request.id)]); setStatus(`Request ${r.request.reference}: ${r.request.status}. No funds are credited until confirmed.`); } catch(e) { setError(message(e)); } finally { setBusy(false); } }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Add funds" className="banking-panel"><h2>Add funds</h2>{kind === "check" && <p>Check collection is not connected. This screen only shows check-funding instructions enabled by your administrator. It does not collect photos, perform OCR or clear checks.</p>}<p>Use your enabled funding instructions below. Submitting this form records a request; it does not charge a bank/card or make funds available.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}<p role="status">{status}</p>
    {!loaded && !error && <p>Loading your funding methods…</p>}
    {loaded && !methods.length && <p>No funding methods are enabled for your account. Contact support to request funding instructions.</p>}
    {method && <form className="dash-form" onSubmit={submit}><fieldset disabled={busy}><label>Funding method<select aria-label="Funding method" value={selected} onChange={e => {setSelected(e.target.value);change();}}>{methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <div className="funding-instructions"><h3>{method.label}</h3><p>{method.instructions}</p><dl>{[['Recipient',method.recipient],['Bank',method.bankName],['Routing number',method.routingNumber],['Account number',method.accountNumber]].filter(([,v]) => v).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
      <label>Amount (USD)<input type="number" required min="10" max="100000" step="0.01" inputMode="decimal" value={amount} onChange={e => {setAmount(e.target.value);change();}} /></label><p>$10–$100,000 per request. External fees depend on the funding method; no instant availability is promised.</p>
      <label>Reference or note (optional)<textarea maxLength={500} value={note} onChange={e => {setNote(e.target.value);change();}} /></label><button className="solid-btn" disabled={!!status}>{busy ? 'Submitting…' : 'Submit funding request'}</button>
    </fieldset></form>}
    <h3>Recent requests</h3><button type="button" className="ghost-btn sm" disabled={busy} onClick={() => void refreshStatus()}>Refresh funding status</button>{requests.map(r => <article className="banking-request" key={r.id}><b>{money(r.amount_cents/100)} · {r.status}</b><span>{r.reference}</span></article>)}
    <button type="button" className="ghost-btn" disabled={busy} onClick={close}>Close</button>
  </section></div>;
}
