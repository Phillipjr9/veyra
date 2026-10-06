import { emailShell, eyebrow, h1, p, amount, pill, details, btn, note } from "./design.js";

export type ZelleEvent = "outgoing_recorded" | "incoming_pending" | "incoming_confirmed" | "incoming_rejected";
export type ZelleMailData = { event: ZelleEvent; amountCents: number; reference: string; occurredAt: number; accountLast4: string; counterparty?: string };

/** Used by both real transactional delivery and the email preview studio. */
export function buildZelleEmail(data: ZelleMailData, appUrl: string) {
  const outgoing = data.event === 'outgoing_recorded';
  const titles: Record<ZelleEvent,string> = {
    outgoing_recorded: 'Outgoing Zelle transfer recorded',
    incoming_pending: 'Incoming Zelle funding request pending',
    incoming_confirmed: 'Incoming Zelle funds credited',
    incoming_rejected: 'Incoming Zelle funding request declined',
  };
  const descriptions: Record<ZelleEvent,string> = {
    outgoing_recorded: 'An outgoing transfer labelled Zelle was recorded as a debit in your Veyra ledger. This is not confirmation that a payment was sent through Zelle or received by the recipient. No live Zelle connection is active in this implementation.',
    incoming_pending: 'Your incoming Zelle funding request was recorded and is waiting for staff review. No funds have been confirmed or credited. Submitting the request does not initiate a Zelle payment.',
    incoming_confirmed: 'Veyra staff confirmed receipt for your incoming Zelle funding request and credited your Veyra ledger. This notification reports the staff-confirmed ledger update; it is not a confirmation issued by Zelle or your bank.',
    incoming_rejected: 'Staff declined your incoming Zelle funding request. No funds were credited for this request. Contact support in the app if you believe a transfer has already reached the receiving bank.',
  };
  const title = titles[data.event], description = descriptions[data.event];
  const value = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(data.amountCents/100);
  const status = outgoing ? 'Ledger debit recorded' : data.event === 'incoming_confirmed' ? 'Staff-confirmed credit' : data.event === 'incoming_pending' ? 'Pending review · not credited' : 'Declined · not credited';
  const subject = `Veyra · ${title} · ${value}`;
  const link = `${appUrl.replace(/\/+$/,'')}/#/app/transactions`;
  const rows: Array<[string,string]> = [
    ['Direction',outgoing ? 'Outgoing' : 'Incoming'],['Method','Zelle'],['Status',status],['Amount',value],
    ['Veyra account',data.accountLast4 ? `•••• ${data.accountLast4}` : 'Your account'],
    ...(outgoing && data.counterparty ? [['Recipient label',data.counterparty.slice(0,160)] as [string,string]] : []),
    ['Reference',data.reference],['Recorded',new Date(data.occurredAt).toLocaleString('en-US',{timeZone:'UTC'})+' UTC'],
  ];
  const safety = 'This is a Veyra account notification, not an email from Zelle. If you do not recognize this activity, sign in directly and contact support. Never email your password, PIN, full account number or verification code.';
  return { subject, preheader: status, text: `${title}\n\n${description}\n\n${rows.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\nView your account: ${link}\n\n${safety}`,
    html: emailShell({subject,preheader:status,content:`${eyebrow(outgoing ? 'Money out · Zelle' : 'Money in · Zelle')}${h1(title)}${p(description)}${amount(`${outgoing ? '−' : data.event === 'incoming_confirmed' ? '+' : ''}${value}`,outgoing ? 'out' : data.event === 'incoming_confirmed' ? 'in' : 'neutral')}${pill(status,data.event === 'incoming_confirmed' ? 'green' : 'amber')}${details(rows)}${btn('View your Veyra account',link)}${note(safety)}`}) };
}
