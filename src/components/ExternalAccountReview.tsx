import { useState, type FormEvent } from "react";
import { externalAccountStatus, type ExternalAccount } from "../../shared/externalAccounts";
import { apiPost } from "../lib/api";

export function ExternalAccountReview({ userId, accounts, canReview, refreshed, blocked, onBusyChange }: { userId: string; accounts: ExternalAccount[]; canReview: boolean; refreshed: () => Promise<void>; blocked: boolean; onBusyChange: (busy: boolean) => void }) {
  const [selected, setSelected] = useState<ExternalAccount | null>(null), [decision, setDecision] = useState("approve"), [note, setNote] = useState(""), [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected || busy || blocked) return;
    setBusy(true); onBusyChange(true); setError("");
    try {
      await apiPost(`/api/admin/members/${userId}/external-accounts/${selected.id}/review`, { decision, note, ownershipVerified: verified });
      setSelected(null); await refreshed();
    } catch (e) { setError(e instanceof Error ? e.message : "The review could not be saved."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="External account reference reviews">
    <h3>External account references</h3><p>Staff approval is for internal account-entry funding only, not a provider connection or ACH authorization. Independently verify ownership before approval. Never put full bank numbers or credentials in the review note.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}
    {!accounts.length && <p>No external account references submitted.</p>}
    {accounts.map(account => <article className="banking-request" key={account.id}><b>{account.bank_name} · {account.account_type} •••• {account.last4}</b><span>{account.account_name} · {externalAccountStatus(account)}</span>{account.verification_note && <p>{account.verification_note}</p>}
      {canReview && account.status === "pending" && account.verification_kind === "staff_reference" && <button className="ghost-btn sm" disabled={busy || blocked} onClick={() => { setSelected(account); setNote(""); setVerified(false); setDecision("approve"); setError(""); }}>Review account reference</button>}
    </article>)}
    {selected && <form className="dash-form banking-request" onSubmit={submit}><fieldset disabled={busy || blocked}>
      <h3>Review {selected.bank_name} •••• {selected.last4}</h3>
      <label>Reference decision<select value={decision} onChange={e => { setDecision(e.target.value); setVerified(false); }}><option value="approve">Approve account reference</option><option value="reject">Decline account reference</option></select></label>
      <label>Ownership review note<textarea required minLength={15} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Evidence reference or reason; shared with the account owner" /></label>
      {decision === "approve" && <label className="banking-check"><input type="checkbox" required checked={verified} onChange={e => setVerified(e.target.checked)} />I independently verified account ownership. This does not connect a bank or authorize an ACH debit.</label>}
      <button type="submit" className="solid-btn" disabled={decision === "approve" && !verified}>{busy ? "Saving review…" : "Save reference review"}</button>
      <button type="button" className="ghost-btn" onClick={() => setSelected(null)}>Cancel reference review</button>
    </fieldset></form>}
  </section>;
}
