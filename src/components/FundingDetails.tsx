import { StaffNote } from "./StaffNote";
import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FundingMethodPicker } from "./FundingMethodPicker";
import { money } from "../lib/store";
import { quoteFee } from "../../shared/fees";

export function validFundingAmount(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) >= 10 && Number(value) <= 100_000;
}

/** The same short details → review interaction as an outgoing payment. */
export function FundingDetails({ methods, selected, amount, note, busy, onMethod, onAmount, onNote, onReview, onCancel, children, linkedAccountCount = 0 }: {
  children?: ReactNode; linkedAccountCount?: number; methods: { id: string; label: string; kind?: string; unavailable?: boolean }[]; selected: string; amount: string; note: string; busy: boolean;
  onMethod: (id: string) => void; onAmount: (value: string) => void; onNote: (value: string) => void;
  onReview: () => void; onCancel: () => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const valid = validFundingAmount(amount);
  const currentMethod = methods.find(method => method.id === selected);
  const available = !!currentMethod && !currentMethod.unavailable;
  const invalid = (attempted || amount !== "") && !valid;
  const amountCents = valid ? Math.round(Number(amount) * 100) : 0;
  const fee = quoteFee(currentMethod?.kind === "card" ? "card_deposit" : "deposit", amountCents);
  const summaryFee = currentMethod?.kind === "card" ? quoteFee("card_deposit", 10_000) : null;
  return <form className="flow-pane funding-details" noValidate onSubmit={e => {
    e.preventDefault(); setAttempted(true);
    if (!busy && available && valid) onReview();
  }}>
    <h2 className="flow-title" id="flow-title">Add funds</h2>
    <p className="flow-sub">Choose a method and amount, then review your deposit.</p>
    <fieldset disabled={busy}>
      {/* The scroll lives on this plain element, not the fieldset: a fieldset
          does not reliably clip overflow, so actions could sit on top of fields. */}
      <div className="funding-details-scroll">
      <label className="flow-label" htmlFor="funding-method">Funding method</label>
      <FundingMethodPicker methods={methods} selected={selected} disabled={busy} onChange={onMethod} />
      {/* At-a-glance summary of the selected method, so the choice is clear
          without opening the list again. */}
      {currentMethod && <div className={`funding-method-summary ${currentMethod.unavailable ? "is-setup" : "is-ready"}`} aria-live="polite">
        <span className="funding-badge">{currentMethod.unavailable ? "Setup needed" : "Ready"}</span>
        <span className="funding-method-summary-text">{currentMethod.unavailable ? "Not available yet" : "Available immediately"} · {summaryFee && summaryFee.feeCents > 0 ? `${summaryFee.rateBps / 100}% fee on debit cards` : "No fee"}</span>
      </div>}
      {/* A dead method used to look identical to a working one: the only
          symptom was a disabled button further down the form. */}
      {currentMethod?.unavailable && <p className="funding-method-warning" aria-live="polite">{currentMethod.label} isn’t ready to use yet. Choose another funding method to continue.</p>}
      <div className="funding-linked-action"><p>{linkedAccountCount ? "Your linked accounts and approved references are available in the dropdown." : "No bank account is available yet. Add an account reference for review, or choose another available method."}</p><Link className="text-link" to="/app/external-accounts" onClick={onCancel}>{linkedAccountCount ? "Manage linked accounts" : "Link an external account"} <ArrowRight size={14} /></Link></div>
      {children}
      <label className="flow-label" htmlFor="funding-amount">Amount (USD)</label>
      <div className={`flow-amount-field ${invalid ? "is-invalid" : ""}`}>
        <span aria-hidden="true">$</span>
        <input id="funding-amount" type="number" inputMode="decimal" min="10" max="100000" step="0.01" required placeholder="0.00"
          value={amount} onChange={e => onAmount(e.target.value)} aria-invalid={invalid} aria-describedby="funding-amount-hint" />
      </div>
      <p id="funding-amount-hint" className={invalid ? "flow-field-error" : "flow-field-note"} role={invalid ? "alert" : undefined}>
        {invalid ? "Enter $10–$100,000 with no more than two decimal places." : currentMethod?.kind === "card" ? "$10–$100,000 per deposit. Card-funded deposits include a 1.5% fee." : "$10–$100,000 per deposit. No fee."}
      </p>
      <div className="quick-row">{[250, 1000, 5000].map(value => <button type="button" key={value} className={Number(amount) === value ? "on" : ""} onClick={() => onAmount(String(value))}>{money(value, false)}</button>)}</div>
      <label className="flow-label" htmlFor="funding-note">Memo (optional)</label>
      <input id="funding-note" maxLength={500} value={note} onChange={e => onNote(e.target.value)} placeholder="A short note — no passwords or card details" />
      <div className="flow-rows compact">
        <div className={`flow-row ${fee.feeCents > 0 ? "" : "free"}`}><span>Deposit fee</span><b>{fee.feeCents > 0 ? money(fee.feeCents / 100) : "$0.00"}</b></div>
        <div className="flow-row"><span>To</span><b>Your Veyra account</b></div>
      </div>
      </div>
    </fieldset>
      <div className="flow-actions">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="solid-btn" disabled={busy || !available}>Review deposit <ArrowRight size={15} /></button>
      </div>
    <p className="funding-animation-note">Account entries credit immediately after confirmation. <StaffNote>External bank and card processing is not connected.</StaffNote></p>
  </form>;
}
