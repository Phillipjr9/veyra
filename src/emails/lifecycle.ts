import { emailShell, eyebrow, h1, p, amount, pill, details, btn, note, hero, type PillTone } from "./design.js";

export type LifecycleEvent =
  | "savings_created" | "savings_moved"
  | "bill_scheduled" | "bill_failed"
  | "team_limit" | "team_removed"
  | "support_received" | "support_reply"
  | "application_received";

export type LifecycleMailData = {
  event: LifecycleEvent;
  occurredAt: number;
  amountCents?: number;
  reference?: string;
  accountLast4?: string;
  pocketName?: string;
  targetCents?: number;
  pocketBalanceCents?: number;
  payee?: string;
  frequency?: string;
  dateLabel?: string;
  memberName?: string;
  role?: string;
  limitCents?: number;
  spentCents?: number;
  resetsLabel?: string;
  subject?: string;
  message?: string;
  businessName?: string;
  failureReason?: string;
};

const usd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const whenUTC = (at: number): string =>
  `${new Date(at).toLocaleString("en-US", { timeZone: "UTC" })} UTC`;

/**
 * Money-automation and workspace notifications: savings pockets, scheduled
 * bills, team spending, support conversations and applications. Each event
 * carries its own 3D hero while sharing the standard card blocks. Used by
 * both real transactional delivery and the email preview studio.
 */
export function buildLifecycleEmail(data: LifecycleMailData, appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  const value = data.amountCents !== undefined ? usd(data.amountCents) : "";

  let eyebrowText = "";
  let title = "";
  let description = "";
  let status = "";
  let tone: PillTone = "violet";
  let heroFile = "hero-savings.jpg";
  let heroAlt = "3D illustration of a savings jar with coins and a sprout";
  let link = `${base}/accounts`;
  let linkLabel = "Open Veyra";
  let amountRow = "";
  let extra = "";
  const rows: Array<[string, string]> = [];

  switch (data.event) {
    case "savings_created": {
      eyebrowText = "Savings pockets";
      title = `Your ${data.pocketName || "savings"} pocket is ready`;
      description = `Your new pocket is open and earning 4.25% APY from today. ${data.targetCents ? `We'll cheer you toward the ${usd(data.targetCents)} target — automatic transfers keep you on pace.` : "Add money anytime from checking to start earning."}`;
      status = "Open · earning 4.25% APY";
      tone = "green";
      linkLabel = "View pocket";
      rows.push(["Pocket", data.pocketName || "Savings pocket"]);
      if (data.targetCents !== undefined) rows.push(["Target", usd(data.targetCents)]);
      rows.push(["Opened", whenUTC(data.occurredAt)]);
      if (data.accountLast4) rows.push(["Linked account", `Business checking •••• ${data.accountLast4}`]);
      break;
    }
    case "savings_moved": {
      eyebrowText = "Savings pockets";
      title = `${value} moved to ${data.pocketName || "your pocket"}`;
      description = "Your money moved instantly between your own balances — no fees, no waiting. It keeps earning 4.25% APY in the pocket.";
      status = "Moved instantly";
      tone = "green";
      amountRow = amount(`+${value}`, "in");
      linkLabel = "View pocket";
      rows.push(["From", `Business checking •••• ${data.accountLast4 || "9014"}`], ["To", data.pocketName || "Savings pocket"], ["Amount", value]);
      if (data.pocketBalanceCents !== undefined) rows.push(["Pocket balance", usd(data.pocketBalanceCents)]);
      rows.push(["Date", whenUTC(data.occurredAt)]);
      break;
    }
    case "bill_scheduled": {
      eyebrowText = "Bills & autopay";
      heroFile = "hero-bills.jpg";
      heroAlt = "3D illustration of a calendar with a clock and a bank card";
      title = `Autopay scheduled · ${data.payee || "your bill"}`;
      description = `We'll pay ${data.payee || "this bill"} automatically from your checking. We'll email you a receipt each time it runs — pause or edit it anytime from Bills.`;
      status = "Scheduled";
      link = `${base}/bills`;
      linkLabel = "Manage bills";
      amountRow = amount(`−${value}`, "out");
      rows.push(["Payee", data.payee || "Bill payee"], ["Amount", value]);
      if (data.frequency) rows.push(["Frequency", data.frequency]);
      if (data.dateLabel) rows.push(["First payment", data.dateLabel]);
      if (data.accountLast4) rows.push(["Paid from", `Business checking •••• ${data.accountLast4}`]);
      break;
    }
    case "bill_failed": {
      eyebrowText = "Bills & autopay";
      heroFile = "hero-bills.jpg";
      heroAlt = "3D illustration of a calendar with a clock and a bank card";
      title = `Payment to ${data.payee || "your payee"} didn't go through`;
      description = `We tried to pay ${data.payee || "your bill"} but the payment failed${data.failureReason ? ` — ${data.failureReason.charAt(0).toLowerCase()}${data.failureReason.slice(1)}` : ""}. No money left your account. Update the payment details or retry from Bills to stay on schedule.`;
      status = "Failed · no charge made";
      tone = "red";
      link = `${base}/bills`;
      linkLabel = "Retry payment";
      amountRow = amount(value);
      rows.push(["Payee", data.payee || "Bill payee"], ["Amount", value]);
      if (data.failureReason) rows.push(["Reason", data.failureReason]);
      rows.push(["Attempted", whenUTC(data.occurredAt)]);
      break;
    }
    case "team_limit": {
      eyebrowText = "Team spending";
      heroFile = "hero-team.jpg";
      heroAlt = "3D illustration of three people gathered around a shared card";
      title = `${data.memberName || "A teammate"} reached their spending limit`;
      description = `${data.memberName || "A teammate"} (${data.role || "team member"}) has used their full ${data.limitCents !== undefined ? usd(data.limitCents) : "monthly"} cap. Further outgoing spending on their cards will be declined until the allowance resets.`;
      status = "Limit reached";
      tone = "amber";
      link = `${base}/team`;
      linkLabel = "Review team limits";
      rows.push(["Member", `${data.memberName || "Teammate"} · ${data.role || "Team member"}`]);
      if (data.limitCents !== undefined) rows.push(["Monthly cap", usd(data.limitCents)]);
      if (data.spentCents !== undefined) rows.push(["Spent this month", usd(data.spentCents)]);
      if (data.resetsLabel) rows.push(["Resets", data.resetsLabel]);
      break;
    }
    case "team_removed": {
      eyebrowText = "Team";
      heroFile = "hero-team.jpg";
      heroAlt = "3D illustration of three people gathered around a shared card";
      title = `${data.memberName || "A teammate"} was removed from your team`;
      description = `${data.memberName || "They"} can no longer sign in or spend. Their cards are frozen immediately and shared-account access is revoked — past transactions stay in your history for your records.`;
      status = "Removed";
      tone = "ink";
      link = `${base}/team`;
      linkLabel = "View team";
      rows.push(["Member", `${data.memberName || "Teammate"}${data.role ? ` · ${data.role}` : ""}`], ["Removed", whenUTC(data.occurredAt)], ["Their cards", "Frozen immediately"]);
      break;
    }
    case "support_received": {
      eyebrowText = "Support";
      heroFile = "hero-support.jpg";
      heroAlt = "3D illustration of a headset resting on a speech bubble";
      title = "We've received your message";
      description = "Thanks — your request is in our support queue and a specialist will reply soon, usually within one business day.";
      status = "In queue";
      link = `${base}/support-desk`;
      linkLabel = "View the conversation";
      if (data.reference) rows.push(["Reference", data.reference]);
      if (data.subject) rows.push(["Subject", data.subject]);
      rows.push(["Received", whenUTC(data.occurredAt)]);
      break;
    }
    case "support_reply": {
      eyebrowText = `Support${data.reference ? ` · ${data.reference}` : ""}`;
      heroFile = "hero-support.jpg";
      heroAlt = "3D illustration of a headset resting on a speech bubble";
      title = "You have a reply from Veyra support";
      description = data.message || "A specialist replied to your request — open the conversation to read the full message.";
      status = "New reply";
      tone = "green";
      link = `${base}/support-desk`;
      linkLabel = "Reply in the app";
      if (data.reference) rows.push(["Reference", data.reference]);
      if (data.subject) rows.push(["Subject", data.subject]);
      extra = note("Veyra will never ask for your password, full card number or one-time codes over email.");
      break;
    }
    case "application_received": {
      eyebrowText = "Welcome to Veyra";
      heroFile = "hero-support.jpg";
      heroAlt = "3D illustration of a headset resting on a speech bubble";
      title = "Your application is in review";
      description = `Thanks${data.businessName ? ` — ${data.businessName}'s` : ""} application is with our review team now. Most applications are decided within 1–2 business days, and we'll email you as soon as there's news.`;
      status = "In review";
      tone = "violet";
      link = `${base}/application`;
      linkLabel = "Check application status";
      if (data.businessName) rows.push(["Business", data.businessName]);
      rows.push(["Submitted", whenUTC(data.occurredAt)], ["Review time", "1–2 business days"]);
      extra = note("You never need to send your password or ID by email. Veyra will only ask for documents inside the app.");
      break;
    }
  }

  const subject = data.event === "support_reply" && data.subject
    ? `Re: ${data.subject}${data.reference ? ` [${data.reference}]` : ""}`
    : `Veyra · ${title}`;

  if (data.event === "support_reply" && !rows.length) rows.push(["Received", whenUTC(data.occurredAt)]);

  return {
    subject,
    preheader: status,
    text: `${title}\n\n${description}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${linkLabel}: ${link}`,
    html: emailShell({
      subject, preheader: status, hero: hero(heroFile, heroAlt),
      content: `${eyebrow(eyebrowText)}${h1(title)}${p(description)}${amountRow}${pill(status, tone)}${rows.length ? details(rows) : ""}${btn(linkLabel, link)}${extra}`,
    }),
  };
}
