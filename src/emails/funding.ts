import { emailShell, eyebrow, h1, p, amount, pill, details, btn, note, hero, type PillTone } from "./design.js";

export type FundingEvent =
  | "request_pending" | "request_confirmed" | "request_rejected"
  | "external_submitted" | "external_approved" | "external_rejected"
  | "check_received" | "check_cleared"
  | "direct_deposit_setup";

export type FundingMailData = {
  event: FundingEvent;
  amountCents?: number;
  reference: string;
  occurredAt: number;
  accountLast4: string;
  /** Human label of the funding method, e.g. "Bank transfer" or "Wire". */
  methodLabel?: string;
  /** External bank name for link events. */
  bankName?: string;
  externalLast4?: string;
  accountType?: string;
  /** Staff-facing outcome summary (rejection reason). Never include secrets. */
  reason?: string;
};

const usd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const whenUTC = (at: number): string =>
  `${new Date(at).toLocaleString("en-US", { timeZone: "UTC" })} UTC`;

/**
 * Funding, external-account, check and direct-deposit notifications.
 *
 * Wording mirrors the product's real behavior: requests are recorded first and
 * only staff-confirmed receipt credits the internal ledger. Nothing here
 * implies a live bank connection, trial-deposit verification, card charge or
 * check-image processing — those all require separate provider activation.
 * Used by both real transactional delivery and the email preview studio.
 */
export function buildFundingEmail(data: FundingMailData, appUrl: string) {
  const method = data.methodLabel || "Bank transfer";
  const value = data.amountCents !== undefined ? usd(data.amountCents) : "";
  const base = appUrl.replace(/\/+$/, "");
  const safety =
    "This is a Veyra account notification. If you do not recognize this activity, sign in directly and contact support. Never email your password, PIN, full account number or verification code.";

  let eyebrowText = "Funding";
  let title = "";
  let description = "";
  let status = "";
  let tone: PillTone = "amber";
  let heroFile = "hero-funding.jpg";
  let heroAlt = "3D illustration of a lavender vault with coins flowing in";
  let link = `${base}/transfers`;
  let linkLabel = "View funding activity";
  let showAmount: "in" | "neutral" | null = "neutral";
  const rows: Array<[string, string]> = [];

  switch (data.event) {
    case "request_pending":
      title = "Funding request received";
      description = `Your ${method.toLowerCase()} funding request for ${value} was recorded and is waiting for staff review. No funds have been confirmed or credited — submitting the request does not move money on its own.`;
      status = "Pending review · not credited";
      rows.push(["Method", method], ["Status", status], ["Amount", value]);
      break;
    case "request_confirmed":
      title = "Funding confirmed";
      description = `Veyra staff confirmed receipt for your ${method.toLowerCase()} funding request and credited your Veyra ledger. The funds are available in your account now.`;
      status = "Staff-confirmed credit";
      tone = "green";
      showAmount = "in";
      link = `${base}/transactions`;
      linkLabel = "View transaction";
      rows.push(["Method", method], ["Status", status], ["Amount", value]);
      break;
    case "request_rejected":
      title = "Funding request declined";
      description = `Staff reviewed your ${method.toLowerCase()} funding request and declined it. No funds were credited for this request.${data.reason ? ` Reason: ${data.reason}` : " Contact support in the app if you believe funds already left the sending account."}`;
      status = "Declined · not credited";
      tone = "red";
      rows.push(["Method", method], ["Status", status], ["Amount", value]);
      if (data.reason) rows.push(["Reason", data.reason]);
      break;
    case "external_submitted":
      eyebrowText = "Bank linking";
      heroFile = "hero-bank-link.jpg";
      heroAlt = "3D illustration of a bank connected to a card by a chain link";
      title = "External account submitted";
      description = `Your request to link ${data.bankName || "an external account"}${data.externalLast4 ? ` •••• ${data.externalLast4}` : ""} was recorded and is waiting for staff review. No bank connection, trial deposits or transfers are active until the account is approved.`;
      status = "Pending review";
      showAmount = null;
      link = `${base}/external-accounts`;
      linkLabel = "View linked accounts";
      rows.push(["Status", status]);
      if (data.bankName) rows.push(["Bank", data.bankName]);
      if (data.accountType) rows.push(["Account type", data.accountType]);
      if (data.externalLast4) rows.push(["Account", `•••• ${data.externalLast4}`]);
      break;
    case "external_approved":
      eyebrowText = "Bank linking";
      heroFile = "hero-bank-link.jpg";
      heroAlt = "3D illustration of a bank connected to a card by a chain link";
      title = "External account approved";
      description = `Your ${data.bankName || "external"} account${data.externalLast4 ? ` •••• ${data.externalLast4}` : ""} was approved and is now available on your account. Where your administrator has enabled it, you can select it when requesting funding — this approval does not connect live bank transfers on its own.`;
      status = "Approved";
      tone = "green";
      showAmount = null;
      link = `${base}/external-accounts`;
      linkLabel = "View linked accounts";
      rows.push(["Status", status]);
      if (data.bankName) rows.push(["Bank", data.bankName]);
      if (data.accountType) rows.push(["Account type", data.accountType]);
      if (data.externalLast4) rows.push(["Account", `•••• ${data.externalLast4}`]);
      break;
    case "external_rejected":
      eyebrowText = "Bank linking";
      heroFile = "hero-bank-link.jpg";
      heroAlt = "3D illustration of a bank connected to a card by a chain link";
      title = "External account declined";
      description = `Staff reviewed your request to link ${data.bankName || "an external account"}${data.externalLast4 ? ` •••• ${data.externalLast4}` : ""} and declined it.${data.reason ? ` Reason: ${data.reason}` : " You can submit a new request with corrected details."}`;
      status = "Declined";
      tone = "red";
      showAmount = null;
      link = `${base}/external-accounts`;
      linkLabel = "View linked accounts";
      rows.push(["Status", status]);
      if (data.bankName) rows.push(["Bank", data.bankName]);
      if (data.externalLast4) rows.push(["Account", `•••• ${data.externalLast4}`]);
      if (data.reason) rows.push(["Reason", data.reason]);
      break;
    case "check_received":
      eyebrowText = "Check deposit";
      heroFile = "hero-check-deposit.jpg";
      heroAlt = "3D illustration of a phone capturing a check above stacked coins";
      title = "Check deposit received";
      description = `Your check deposit of ${value} was recorded and is waiting for staff review. No funds have been confirmed or credited yet — we'll email you the moment the check clears.`;
      status = "Pending review · not credited";
      rows.push(["Method", "Check deposit"], ["Status", status], ["Amount", value]);
      break;
    case "check_cleared":
      eyebrowText = "Check deposit";
      heroFile = "hero-check-deposit.jpg";
      heroAlt = "3D illustration of a phone capturing a check above stacked coins";
      title = "Check cleared";
      description = `Good news — staff confirmed your check and ${value} is now available in your account.`;
      status = "Cleared · available now";
      tone = "green";
      showAmount = "in";
      link = `${base}/transactions`;
      linkLabel = "View transaction";
      rows.push(["Method", "Check deposit"], ["Status", status], ["Amount", value]);
      break;
    case "direct_deposit_setup":
      eyebrowText = "Direct deposit";
      heroFile = "hero-direct-deposit.jpg";
      heroAlt = "3D illustration of a briefcase with a paycheck and calendar";
      title = "Direct deposit is ready to set up";
      description = "Share the receiving details below with your employer or payroll provider. Once they send your first paycheck, it lands in your Veyra account automatically — no further action needed.";
      status = "Setup ready";
      tone = "violet";
      showAmount = null;
      rows.push(["Status", status], ["Routing number", "091408735"], ["Account number", `•••• ${data.accountLast4}`], ["Account type", "Business checking"]);
      break;
  }

  rows.push(["Veyra account", data.accountLast4 ? `•••• ${data.accountLast4}` : "Your account"]);
  rows.push(["Reference", data.reference]);
  rows.push(["Recorded", whenUTC(data.occurredAt)]);

  const subject = `Veyra · ${title}${value && showAmount ? ` · ${showAmount === "in" ? "+" : ""}${value}` : ""}`;
  const amountRow = showAmount && value
    ? amount(`${showAmount === "in" ? "+" : ""}${value}`, showAmount === "in" ? "in" : "neutral")
    : "";

  return {
    subject,
    preheader: status,
    text: `${title}\n\n${description}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nView your account: ${link}\n\n${safety}`,
    html: emailShell({
      subject, preheader: status, hero: hero(heroFile, heroAlt),
      content: `${eyebrow(eyebrowText)}${h1(title)}${p(description)}${amountRow}${pill(status, tone)}${details(rows)}${btn(linkLabel, link)}${note(safety)}`,
    }),
  };
}
