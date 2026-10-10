import { StaffNote } from "./StaffNote";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { copyText } from "../lib/store";

export type ReceivingDetails = { bank_name: string; routing_number: string; account_number: string; account_type: string; recipient: string };
export type ReceivingKind = "direct_deposit" | "wire" | "bank" | "ach";

export function receivingFromMethod(method: Partial<ReceivingDetails> & { bank_name?: string; routing_number?: string; account_number?: string; account_type?: string; recipient?: string }): ReceivingDetails | null {
  if (!method.routing_number || !method.account_number) return null;
  return {
    bank_name: method.bank_name ?? "",
    routing_number: method.routing_number,
    account_number: method.account_number,
    account_type: method.account_type ?? "",
    recipient: method.recipient ?? "",
  };
}

const COPY: Record<ReceivingKind, { title: string; intro: string; timing: string; region: string }> = {
  direct_deposit: {
    title: "Direct Deposit details",
    region: "Direct Deposit banking details",
    intro: "Share these with your employer or payroll provider. You do not enter an amount in Veyra — payroll sends the deposit to this account.",
    timing: "Typically 1 business day after payroll originates the ACH credit. This page does not enroll you in payroll.",
  },
  wire: {
    title: "Incoming wire details",
    region: "Incoming wire details",
    intro: "Give these to the sending bank. Wires are not initiated from Veyra, so there is no amount to enter here.",
    timing: "Domestic wires usually post the same business day they are sent.",
  },
  bank: {
    title: "Incoming bank transfer",
    region: "Incoming bank transfer details",
    intro: "Use these routing and account numbers in your other bank’s transfer flow. You do not enter an amount in Veyra.",
    timing: "ACH credits typically arrive in 1 business day.",
  },
  ach: {
    title: "ACH receiving details",
    region: "ACH receiving details",
    intro: "Send an ACH credit to this account from another bank. This is not a debit of a linked account, so you do not enter an amount here.",
    timing: "ACH credits typically arrive in 1 business day.",
  },
};

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(!secret);
  const shown = secret && !reveal ? `•••• ${value.slice(-4)}` : value;
  async function copy() {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="receiving-row">
      <dt>{label}</dt>
      <dd>
        <code>{shown}</code>
        {secret && (
          <button type="button" className="ghost-btn sm receiving-icon-btn" onClick={() => setReveal(value => !value)}>
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            {reveal ? "Hide account number" : "Show account number"}
          </button>
        )}
        <button type="button" className="ghost-btn sm receiving-icon-btn" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </dd>
    </div>
  );
}

export function DirectDepositDetails({ details, close, kind = "direct_deposit" }: { details: ReceivingDetails | null; close: () => void; kind?: ReceivingKind }) {
  const copy = COPY[kind];
  const [copiedAll, setCopiedAll] = useState(false);
  async function copyAll() {
    if (!details) return;
    const ok = await copyText(`${details.recipient}\n${details.bank_name}\nRouting (ABA): ${details.routing_number}\nAccount: ${details.account_number}\nAccount type: ${details.account_type || "Checking"}`);
    if (!ok) return;
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 1600);
  }
  return <section className="direct-deposit-details receiving-account" aria-label={copy.region}>
    <h3>{copy.title}</h3>
    {details ? <>
      <p>{copy.intro}</p>
      <dl>
        {details.recipient ? <div className="receiving-row"><dt>Account holder</dt><dd><code>{details.recipient}</code></dd></div> : null}
        {details.bank_name ? <div className="receiving-row"><dt>Bank</dt><dd><code>{details.bank_name}</code></dd></div> : null}
        {details.account_type ? <div className="receiving-row"><dt>Account type</dt><dd><code>{details.account_type}</code></dd></div> : null}
        <CopyField label="Routing number" value={details.routing_number} />
        <CopyField label="Account number" value={details.account_number} secret />
      </dl>
      <div className="receiving-actions">
        <button type="button" className="ghost-btn sm" onClick={() => void copyAll()}>{copiedAll ? <Check size={14} /> : <Copy size={14} />}{copiedAll ? "Details copied" : "Copy all details"}</button>
      </div>
      <p className="receiving-timing">{copy.timing}</p>
    </> : <><StaffNote><p>{kind === "direct_deposit" ? "Your administrator has not configured Direct Deposit receiving details for your account. Do not send funds until these details are available." : "Receiving details are not configured for this account yet. Do not send funds until routing and account numbers are available."}</p></StaffNote><Link to="/app/support-desk" className="text-link" onClick={close}>Request receiving details</Link></>}
  </section>;
}
