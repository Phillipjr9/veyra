import { StaffNote } from "./StaffNote";
import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FundingMethodPicker } from "./FundingMethodPicker";
import { DirectDepositDetails, receivingFromMethod, type ReceivingDetails, type ReceivingKind } from "./DirectDepositDetails";
import { money } from "../lib/store";
import { quoteFee } from "../../shared/fees";
import { methodShowsReceivingAccount, methodTakesAmount } from "../../shared/funding";

export function validFundingAmount(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) >= 10 && Number(value) <= 100_000;
}

export type FundingDetailsMethod = {
  id: string;
  label: string;
  kind?: string;
  unavailable?: boolean;
  takesAmount?: boolean;
  linkedAccountId?: string;
  inboundReceive?: boolean;
  instructions?: string;
  bank_name?: string;
  routing_number?: string;
  account_number?: string;
  account_type?: string;
  recipient?: string;
};

/** The same short details → review interaction as an outgoing payment — only for methods that actually take an amount. */
export function FundingDetails({ methods, selected, amount, note, busy, onMethod, onAmount, onNote, onReview, onCancel, children, linkedAccountCount = 0, receiving = null }: {
  children?: ReactNode; linkedAccountCount?: number; methods: FundingDetailsMethod[]; selected: string; amount: string; note: string; busy: boolean;
  receiving?: ReceivingDetails | null;
  onMethod: (id: string) => void; onAmount: (value: string) => void; onNote: (value: string) => void;
  onReview: () => void; onCancel: () => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const valid = validFundingAmount(amount);
  const currentMethod = methods.find(method => method.id === selected);
  const takesAmount = methodTakesAmount(currentMethod);
  const showAccount = methodShowsReceivingAccount(currentMethod);
  const available = !!currentMethod && !currentMethod.unavailable;
  const invalid = takesAmount && (attempted || amount !== "") && !valid;
  const amountCents = takesAmount && valid ? Math.round(Number(amount) * 100) : 0;
  const fee = quoteFee(currentMethod?.kind === "card" ? "card_deposit" : "deposit", amountCents);
  const summaryFee = currentMethod?.kind === "card" ? quoteFee("card_deposit", 10_000) : null;
  const accountDetails = showAccount
    ? (currentMethod?.kind === "direct_deposit" ? receiving : null) ?? receivingFromMethod(currentMethod ?? {}) ?? receiving
    : null;
  const receivingKind: ReceivingKind = currentMethod?.kind === "wire" || currentMethod?.kind === "bank" || currentMethod?.kind === "ach"
    ? currentMethod.kind
    : "direct_deposit";
  return <form className="flow-pane funding-details" noValidate onSubmit={e => {
    e.preventDefault();
    if (!takesAmount) return;
    setAttempted(true);
    if (!busy && available && valid) onReview();
  }}>
    <h2 className="flow-title" id="flow-title">Add funds</h2>
    <p className="flow-sub">{takesAmount
      ? "Choose a method and amount, then review your deposit."
      : "Share your account details. You do not enter an amount here — money appears when the transfer arrives."}</p>
    <fieldset disabled={busy}>
      {/* The scroll lives on this plain element, not the fieldset: a fieldset
          does not reliably clip overflow, so actions could sit on top of fields. */}
      <div className="funding-details-scroll">
      <label className="flow-label" htmlFor="funding-method">Funding method</label>
      <FundingMethodPicker methods={methods} selected={selected} disabled={busy} onChange={onMethod} />
      {/* At-a-glance summary of the selected method, so the choice is clear
          without opening the list again. */}
      {currentMethod && <div className={`funding-method-summary ${currentMethod.unavailable ? "is-setup" : "is-ready"}`} aria-live="polite">
        <span className="funding-badge">{currentMethod.unavailable ? "Setup needed" : takesAmount ? "Ready" : "Receiving details"}</span>
        <span className="funding-method-summary-text">{currentMethod.unavailable
          ? "Not available yet"
          : takesAmount
            ? (summaryFee && summaryFee.feeCents > 0 ? `Available after you confirm · ${summaryFee.rateBps / 100}% fee on debit cards` : "Available after you confirm · No fee")
            : "No amount to enter · money arrives when the sender posts it"}</span>
      </div>}
      {/* A dead method used to look identical to a working one: the only
          symptom was a disabled button further down the form. */}
      {currentMethod?.unavailable && takesAmount && <p className="funding-method-warning" aria-live="polite">{currentMethod.label} isn’t ready to use yet. Choose another funding method to continue.</p>}
      {(currentMethod?.kind === "ach" || currentMethod?.kind === "card") && <div className="funding-linked-action"><p>{linkedAccountCount ? "Your linked accounts and approved references are available in the dropdown." : "No bank account is available yet. Add an account reference for review, or choose another available method."}</p><Link className="text-link" to="/app/external-accounts" onClick={onCancel}>{linkedAccountCount ? "Manage linked accounts" : "Link an external account"} <ArrowRight size={14} /></Link></div>}
      {showAccount && <DirectDepositDetails details={accountDetails} close={onCancel} kind={receivingKind} />}
      {!takesAmount && !showAccount && currentMethod && <section className="direct-deposit-details receiving-account" aria-label={`${currentMethod.label} instructions`}>
        <h3>{currentMethod.label}</h3>
        <p>{currentMethod.kind === "check"
          ? "Mail-in instructions only. This screen does not capture photos, perform OCR or clear checks."
          : "Follow the instructions from your administrator. You do not enter an amount here."}</p>
        {currentMethod.instructions ? <p>{currentMethod.instructions}</p> : <StaffNote>No instructions are configured for this method yet.</StaffNote>}
      </section>}
      {children}
      {takesAmount && <>
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
      </>}
      </div>
    </fieldset>
      <div className="flow-actions">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>{takesAmount ? "Cancel" : "Done"}</button>
        {takesAmount && <button type="submit" className="solid-btn" disabled={busy || !available}>Review deposit <ArrowRight size={15} /></button>}
      </div>
    <p className="funding-animation-note">{takesAmount
      ? <>Account entries credit immediately after confirmation. <StaffNote>External bank and card processing is not connected.</StaffNote></>
      : <>This screen does not move money. <StaffNote>External bank and card processing is not connected.</StaffNote></>}</p>
  </form>;
}
