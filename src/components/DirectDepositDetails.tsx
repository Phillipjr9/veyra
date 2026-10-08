import { StaffNote } from "./StaffNote";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
export type ReceivingDetails = { bank_name: string; routing_number: string; account_number: string; account_type: string; recipient: string };
export function DirectDepositDetails({ details, close }: { details: ReceivingDetails | null; close: () => void }) {
  const [reveal, setReveal] = useState(false);
  return <section className="direct-deposit-details" aria-label="Direct Deposit banking details">
    <h3>Direct Deposit details</h3>
    {details ? <>
      <p>Receiving information configured by your administrator for your account. Share these details with your payroll provider; this page does not enroll you in payroll.</p>
      <dl>{[["Account holder", details.recipient], ["Bank", details.bank_name], ["Account type", details.account_type], ["Routing number", details.routing_number], ["Account number", reveal ? details.account_number : `•••• ${details.account_number.slice(-4)}`]].filter(([,value]) => value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <button type="button" className="ghost-btn sm" onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? "Hide account number" : "Show account number"}</button>
    </> : <><StaffNote><p>Your administrator has not configured Direct Deposit receiving details for your account. Do not send funds until these details are available.</p></StaffNote><Link to="/app/support-desk" className="text-link" onClick={close}>Request receiving details</Link></>}
  </section>;
}
