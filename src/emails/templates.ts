/**
 * Veyra transactional email templates.
 *
 * One template for every notification the product generates (see the
 * notification types in src/lib/store.tsx: scout / card / transfer /
 * security / invoice, plus account-lifecycle and auth events). Sample data
 * mirrors the in-app demo account (Park & Co Studio) so previews match the
 * product exactly.
 *
 * Usage: `buildEmails()` returns render-ready documents. A backend can import
 * these builders, swap the sample values for real data, and send.
 */
import {
  APP_BASE, emailShell, eyebrow, h1, p, amount, pill, details, btn, textLink, note, progress,
} from "./design";

export type EmailCategory = "security" | "transfers" | "cards" | "invoices" | "scout" | "account";

export interface EmailTemplate {
  id: string;
  name: string;
  category: EmailCategory;
  subject: string;
  preheader: string;
  html: string;
}

const APP = APP_BASE;

/* ============================================================ SECURITY */

const signinAlert: EmailTemplate = {
  id: "signin-alert",
  name: "New sign-in alert",
  category: "security",
  subject: "New sign-in to your Veyra account",
  preheader: "Chrome on macOS · San Francisco, CA · verified with two-factor authentication.",
  html: emailShell({
    subject: "New sign-in to your Veyra account",
    preheader: "Chrome on macOS · San Francisco, CA · verified with two-factor authentication.",
    content: `
      ${eyebrow("Security alert")}
      ${h1("New sign-in to your account")}
      ${p("Hi Hana — a new sign-in to your Veyra account was detected. Because two-factor authentication is on, it was verified with a one-time code.")}
      ${pill("Verified · 2FA", "green")}
      ${details([
        ["Device", "MacBook Pro"],
        ["Browser", "Chrome 141"],
        ["Location", "San Francisco, CA"],
        ["Date & time", "Oct 2, 2026 · 9:41 AM PT"],
        ["Authentication", "Authenticator app"],
      ])}
      ${btn("Review account activity", `${APP}/security`)}
      ${note("If this wasn't you, reset your password immediately and contact support. We'll never ask for your password or one-time codes by email or phone.")}
    `,
  }),
};

const passwordReset: EmailTemplate = {
  id: "password-reset",
  name: "Password reset",
  category: "security",
  subject: "Reset your Veyra password",
  preheader: "This link expires in 30 minutes. Requested from Chrome on macOS.",
  html: emailShell({
    subject: "Reset your Veyra password",
    preheader: "This link expires in 30 minutes. Requested from Chrome on macOS.",
    content: `
      ${eyebrow("Account access")}
      ${h1("Reset your password")}
      ${p("Hi Hana — we received a request to reset the password for your Veyra account. Choose a new password using the button below.")}
      ${btn("Choose a new password", `${APP}/forgot-password`)}
      ${details([
        ["Requested from", "Chrome on macOS"],
        ["Date & time", "Oct 2, 2026 · 9:41 AM PT"],
        ["Link expires", "In 30 minutes"],
        ["Request reference", "VYR-PW7K2M9X"],
      ])}
      ${note("Didn't request this? You can safely ignore this email — your password won't change. For your security, the link can only be used once.")}
    `,
  }),
};

const disputeOpened: EmailTemplate = {
  id: "dispute-opened",
  name: "Dispute opened",
  category: "security",
  subject: "Dispute opened · Fable Cloud charge",
  preheader: "$218.00 is under review. Case #DSP-4471 opened Oct 2, 2026.",
  html: emailShell({
    subject: "Dispute opened · Fable Cloud charge",
    preheader: "$218.00 is under review. Case #DSP-4471 opened Oct 2, 2026.",
    content: `
      ${eyebrow("Card protection")}
      ${h1("Your dispute is under review")}
      ${p("We've opened a dispute for the charge below and notified the merchant. Most cases resolve within 10 business days, and we'll email you at every step.")}
      ${amount("−$218.00", "out")}
      ${pill("Under review", "amber")}
      ${details([
        ["Merchant", "Fable Cloud"],
        ["Disputed amount", "$218.00"],
        ["Transaction date", "Oct 1, 2026"],
        ["Card", "Subscriptions •••• 2903"],
        ["Case number", "DSP-4471"],
        ["Provisional credit", "Within 2 business days"],
      ])}
      ${btn("View dispute status", `${APP}/disputes`)}
      ${note("Keep any receipts, invoices or correspondence with the merchant — they can help us resolve the case faster.")}
    `,
  }),
};

const disputeResolved: EmailTemplate = {
  id: "dispute-resolved",
  name: "Dispute resolved",
  category: "security",
  subject: "Dispute resolved · $218.00 returned",
  preheader: "Case #DSP-4471 closed in your favor. Funds are in your checking.",
  html: emailShell({
    subject: "Dispute resolved · $218.00 returned",
    preheader: "Case #DSP-4471 closed in your favor. Funds are in your checking.",
    content: `
      ${eyebrow("Card protection")}
      ${h1("Good news — your dispute was resolved")}
      ${p("Case #DSP-4471 was closed in your favor and the full amount has been returned to your business checking.")}
      ${amount("+$218.00", "in")}
      ${pill("Resolved · funds returned", "green")}
      ${details([
        ["Merchant", "Fable Cloud"],
        ["Amount returned", "$218.00"],
        ["Credited to", "Business checking •••• 9014"],
        ["Date credited", "Oct 2, 2026"],
        ["Case number", "DSP-4471"],
        ["New balance", "$84,290.42"],
      ])}
      ${btn("View transaction", `${APP}/transactions`)}
    `,
  }),
};

const cardsFrozenAll: EmailTemplate = {
  id: "cards-frozen-all",
  name: "All cards frozen",
  category: "security",
  subject: "All Veyra cards are now frozen",
  preheader: "New purchases will be declined until you unfreeze a card.",
  html: emailShell({
    subject: "All Veyra cards are now frozen",
    preheader: "New purchases will be declined until you unfreeze a card.",
    content: `
      ${eyebrow("Security action confirmed")}
      ${h1("All of your cards are frozen")}
      ${p("You froze every card on your Veyra account from the Security Center. New card purchases will be declined until you unfreeze a card. Scheduled payments, incoming deposits and ACH transfers are unaffected.")}
      ${pill("3 cards frozen", "red")}
      ${details([
        ["Cards frozen", "Subscriptions •••• 2903, Advertising •••• 7741, Metal debit •••• 5118"],
        ["Action taken", "Oct 2, 2026 · 8:12 PM PT"],
        ["Authorized by", "Hana Park (you)"],
        ["Still active", "ACH transfers, bills, deposits"],
      ])}
      ${btn("Go to Security Center", `${APP}/security`)}
      ${note("Frozen cards decline new authorizations instantly. Unfreeze any card from the Cards tab whenever you're ready.")}
    `,
  }),
};

/* ============================================================ TRANSFERS */

const depositReceived: EmailTemplate = {
  id: "deposit-received",
  name: "Deposit received",
  category: "transfers",
  subject: "Deposit received · +$6,800.00",
  preheader: "From Mono Labs via ACH — available now in business checking.",
  html: emailShell({
    subject: "Deposit received · +$6,800.00",
    preheader: "From Mono Labs via ACH — available now in business checking.",
    content: `
      ${eyebrow("Money in")}
      ${h1("A deposit just landed")}
      ${p("Your deposit cleared and the funds are available in your business checking right now.")}
      ${amount("+$6,800.00", "in")}
      ${pill("Available now", "green")}
      ${details([
        ["From", "Mono Labs"],
        ["Method", "ACH · Northfield Bank"],
        ["Deposited to", "Business checking •••• 9014"],
        ["Memo", "Invoice #1048 · milestone 2"],
        ["Date & time", "Oct 2, 2026 · 7:03 AM PT"],
        ["Reference", "VYR-K4M8T2QP"],
        ["New balance", "$84,290.42"],
      ])}
      ${btn("View transaction", `${APP}/transactions`)}
    `,
  }),
};

const transferSent: EmailTemplate = {
  id: "transfer-sent",
  name: "Transfer sent (Zelle®)",
  category: "transfers",
  subject: "You sent $1,200.00 to Harbor Studio",
  preheader: "Sent with Zelle® in seconds from business checking •••• 9014.",
  html: emailShell({
    subject: "You sent $1,200.00 to Harbor Studio",
    preheader: "Sent with Zelle® in seconds from business checking •••• 9014.",
    content: `
      ${eyebrow("Money out")}
      ${h1("Transfer complete")}
      ${p("Your Zelle® payment was delivered. The money left your account immediately.")}
      ${amount("−$1,200.00", "out")}
      ${pill("Delivered", "green")}
      ${details([
        ["Sent to", "Harbor Studio"],
        ["Delivery", "Zelle® · within seconds"],
        ["From", "Business checking •••• 9014"],
        ["Memo", "Brand workshop deposit"],
        ["Date & time", "Oct 2, 2026 · 10:26 AM PT"],
        ["Reference", "VYR-Z9R3XW7D"],
        ["New balance", "$83,090.42"],
      ])}
      ${btn("View transaction", `${APP}/transactions`)}
      ${note("Zelle® payments are instant and can't be reversed once delivered. Only send to people and businesses you trust.")}
    `,
  }),
};

const billPaid: EmailTemplate = {
  id: "bill-paid",
  name: "Scheduled bill paid",
  category: "transfers",
  subject: "Bill paid · Commons Coworking $599.00",
  preheader: "Autopay completed. Next payment scheduled for Nov 1, 2026.",
  html: emailShell({
    subject: "Bill paid · Commons Coworking $599.00",
    preheader: "Autopay completed. Next payment scheduled for Nov 1, 2026.",
    content: `
      ${eyebrow("Bills & autopay")}
      ${h1("Your bill was paid")}
      ${p("An autopay scheduled payment was completed from your business checking.")}
      ${amount("−$599.00", "out")}
      ${pill("Autopay · paid", "violet")}
      ${details([
        ["Payee", "Commons Coworking"],
        ["Memo", "Desk memberships"],
        ["Category", "Operations"],
        ["Frequency", "Monthly"],
        ["Paid from", "Business checking •••• 9014"],
        ["Date", "Oct 1, 2026"],
        ["Next payment", "Nov 1, 2026"],
      ])}
      ${btn("Manage bills", `${APP}/bills`)}
    `,
  }),
};

const rewardsRedeemed: EmailTemplate = {
  id: "rewards-redeemed",
  name: "Cash back redeemed",
  category: "transfers",
  subject: "Cash back redeemed · $86.40 added to checking",
  preheader: "Your Veyra rewards balance was redeemed 1:1 into checking.",
  html: emailShell({
    subject: "Cash back redeemed · $86.40 added to checking",
    preheader: "Your Veyra rewards balance was redeemed 1:1 into checking.",
    content: `
      ${eyebrow("Rewards")}
      ${h1("Cash back redeemed")}
      ${p("You redeemed your available cash back. It moved straight into your checking at full value — 1:1, no fees, no minimums.")}
      ${amount("+$86.40", "in")}
      ${pill("Redeemed 1:1", "green")}
      ${details([
        ["Redemption", "$86.40"],
        ["Lifetime rewards", "$1,420.50"],
        ["Deposited to", "Business checking •••• 9014"],
        ["Date & time", "Oct 2, 2026 · 4:55 PM PT"],
        ["Reference", "VYR-RW5D8N2J"],
        ["New balance", "$84,376.82"],
      ])}
      ${btn("See rewards activity", `${APP}/rewards`)}
    `,
  }),
};

/* ============================================================ CARDS */

const cardIssued: EmailTemplate = {
  id: "card-issued",
  name: "New card issued",
  category: "cards",
  subject: "Your new virtual card is ready",
  preheader: "Subscriptions •••• 2903 · $4,000 monthly limit · locked to Software.",
  html: emailShell({
    subject: "Your new virtual card is ready",
    preheader: "Subscriptions •••• 2903 · $4,000 monthly limit · locked to Software.",
    content: `
      ${eyebrow("Cards")}
      ${h1("Your virtual card is live")}
      ${p("A new virtual card was issued on your account. It's ready to use online immediately — add it to a wallet or copy the details from the app.")}
      ${pill("Active", "green")}
      ${details([
        ["Card", "Subscriptions •••• 2903"],
        ["Type", "Virtual"],
        ["Monthly limit", "$4,000.00"],
        ["Category lock", "Software only"],
        ["Cardholder", "Hana Park"],
        ["Issued", "Oct 2, 2026"],
      ])}
      ${btn("View card details", `${APP}/cards`)}
      ${note("Virtual cards can be frozen, replaced or deleted anytime from the Cards tab — merchants you've frozen out lose access instantly.")}
    `,
  }),
};

const cardShipped: EmailTemplate = {
  id: "card-shipped",
  name: "Card shipping update",
  category: "cards",
  subject: "Your Veyra Arc card is out for delivery",
  preheader: "Metal debit •••• 5118 arriving today by 8 PM via Meridian Express.",
  html: emailShell({
    subject: "Your Veyra Arc card is out for delivery",
    preheader: "Metal debit •••• 5118 arriving today by 8 PM via Meridian Express.",
    content: `
      ${eyebrow("Shipping update")}
      ${h1("Your card is arriving today")}
      ${p("Heads up — your Veyra Arc metal debit card is out for delivery and should arrive by 8:00 PM tonight.")}
      ${pill("Out for delivery", "amber")}
      ${details([
        ["Card", "Metal debit •••• 5118"],
        ["Carrier", "Meridian Express"],
        ["Tracking", "MEX-30298-4471-US"],
        ["Shipped to", "548 Market St, San Francisco, CA 94104"],
        ["Estimated delivery", "Oct 2, 2026 · by 8:00 PM"],
      ])}
      ${btn("Track shipment", `${APP}/cards`)}
      ${note("Activate the card in the app the moment it arrives — it's inactive until you do, so it's safe in the mail.")}
    `,
  }),
};

const cardFrozen: EmailTemplate = {
  id: "card-frozen",
  name: "Card frozen / unfrozen",
  category: "cards",
  subject: "Travel card frozen",
  preheader: "New purchases on •••• 9086 will be declined until you unfreeze it.",
  html: emailShell({
    subject: "Travel card frozen",
    preheader: "New purchases on •••• 9086 will be declined until you unfreeze it.",
    content: `
      ${eyebrow("Card controls")}
      ${h1("Travel card is frozen")}
      ${p("You froze your Travel card from the app. New purchases will be declined until you unfreeze it — existing recurring charges may still go through.")}
      ${pill("Frozen", "red")}
      ${details([
        ["Card", "Travel •••• 9086"],
        ["Action", "Freeze"],
        ["Taken", "Oct 2, 2026 · 6:18 PM PT"],
        ["Authorized by", "Hana Park (you)"],
        ["Monthly limit", "$3,000.00"],
        ["International use", "Enabled"],
      ])}
      ${btn("Unfreeze card", `${APP}/cards`)}
    `,
  }),
};

const cardReplaced: EmailTemplate = {
  id: "card-replaced",
  name: "Replacement card issued",
  category: "cards",
  subject: "Replacement card issued · Metal debit",
  preheader: "Old card •••• 5118 is frozen permanently. •••• 8230 is on its way.",
  html: emailShell({
    subject: "Replacement card issued · Metal debit",
    preheader: "Old card •••• 5118 is frozen permanently. •••• 8230 is on its way.",
    content: `
      ${eyebrow("Card replacement")}
      ${h1("A replacement card is on its way")}
      ${p("We've issued a replacement for your Metal debit card. The old card is permanently frozen — subscriptions and saved merchants will need the new details once you activate.")}
      ${pill("Shipped", "violet")}
      ${details([
        ["Old card", "Metal debit •••• 5118 (frozen)"],
        ["New card", "•••• 8230"],
        ["Reason", "Reported lost"],
        ["Monthly limit", "$15,000.00 (carried over)"],
        ["Shipped to", "548 Market St, San Francisco, CA 94104"],
        ["Estimated arrival", "Oct 6 – Oct 8, 2026"],
      ])}
      ${btn("Track replacement", `${APP}/cards`)}
    `,
  }),
};

/* ============================================================ INVOICES */

const invoicePaid: EmailTemplate = {
  id: "invoice-paid",
  name: "Invoice paid",
  category: "invoices",
  subject: "Lumen Retail paid invoice #1050",
  preheader: "$1,150.00 settled by ACH and available in your checking.",
  html: emailShell({
    subject: "Lumen Retail paid invoice #1050",
    preheader: "$1,150.00 settled by ACH and available in your checking.",
    content: `
      ${eyebrow("Invoicing")}
      ${h1("Invoice #1050 is settled")}
      ${p("Lumen Retail paid your invoice in full. The funds are in your business checking and ready to use.")}
      ${amount("+$1,150.00", "in")}
      ${pill("Settled", "green")}
      ${details([
        ["Invoice", "#1050"],
        ["Client", "Lumen Retail"],
        ["Amount", "$1,150.00"],
        ["Paid", "Oct 2, 2026 · 11:02 AM PT"],
        ["Method", "ACH transfer"],
        ["Deposited to", "Business checking •••• 9014"],
        ["Processing fee", "$0.00"],
        ["Reference", "VYR-INV1050LMN"],
      ])}
      ${btn("View invoice", `${APP}/invoices`)}
    `,
  }),
};

const invoiceSent: EmailTemplate = {
  id: "invoice-sent",
  name: "Invoice sent",
  category: "invoices",
  subject: "Invoice #1051 sent to Mono Labs",
  preheader: "$6,800.00 · due Oct 16, 2026 (Net 14).",
  html: emailShell({
    subject: "Invoice #1051 sent to Mono Labs",
    preheader: "$6,800.00 · due Oct 16, 2026 (Net 14).",
    content: `
      ${eyebrow("Invoicing")}
      ${h1("Invoice #1051 is on its way")}
      ${p("We emailed your invoice to Mono Labs with a secure payment link. You'll get a notification the moment it's viewed or paid.")}
      ${pill("Sent · net 14", "violet")}
      ${details([
        ["Invoice", "#1051"],
        ["Client", "Mono Labs"],
        ["Sent to", "ap@monolabs.io"],
        ["Amount", "$6,800.00"],
        ["Issued", "Oct 2, 2026"],
        ["Due", "Oct 16, 2026"],
        ["Status", "Awaiting payment"],
      ])}
      ${btn("View invoice", `${APP}/invoices`)}
    `,
  }),
};

const invoiceOverdue: EmailTemplate = {
  id: "invoice-overdue",
  name: "Invoice overdue",
  category: "invoices",
  subject: "Invoice #1050 is overdue · $1,150.00",
  preheader: "Lumen Retail is 6 days past due. Send a reminder in one tap.",
  html: emailShell({
    subject: "Invoice #1050 is overdue · $1,150.00",
    preheader: "Lumen Retail is 6 days past due. Send a reminder in one tap.",
    content: `
      ${eyebrow("Invoicing")}
      ${h1("Invoice #1050 is past due")}
      ${p("Lumen Retail hasn't paid this invoice yet — it's now 6 days overdue. A polite reminder usually does the trick; we can send one for you.")}
      ${amount("$1,150.00")}
      ${pill("Overdue · 6 days", "red")}
      ${details([
        ["Invoice", "#1050"],
        ["Client", "Lumen Retail"],
        ["Amount", "$1,150.00"],
        ["Issued", "Sep 18, 2026"],
        ["Due", "Oct 2, 2026"],
        ["Days overdue", "6"],
      ])}
      ${btn("Send payment reminder", `${APP}/invoices`)}
      ${textLink("View invoice details", `${APP}/invoices`)}
    `,
  }),
};

/* ============================================================ SCOUT */

const scoutSaved: EmailTemplate = {
  id: "scout-saved",
  name: "Scout savings alert",
  category: "scout",
  subject: "Scout saved you $148.86",
  preheader: "A lower rate was negotiated on your Northstar Ads plan.",
  html: emailShell({
    subject: "Scout saved you $148.86",
    preheader: "A lower rate was negotiated on your Northstar Ads plan.",
    content: `
      ${eyebrow("Scout AI")}
      ${h1("Scout found a better rate")}
      ${p("Scout spotted an annual-rate discount on your Northstar Ads plan and applied it automatically. No action needed — the savings are already yours.")}
      ${amount("−$148.86 saved", "in")}
      ${pill("Applied automatically", "green")}
      ${details([
        ["Merchant", "Northstar Ads"],
        ["Plan", "Spring retargeting campaign"],
        ["Billed rate", "$1,240.50"],
        ["Negotiated rate", "$1,091.64"],
        ["You saved", "$148.86"],
        ["Applied", "Oct 2, 2026"],
        ["Lifetime Scout savings", "$1,284.62"],
      ])}
      ${btn("See what Scout found", `${APP}/scout`)}
    `,
  }),
};

const scoutDigest: EmailTemplate = {
  id: "scout-digest",
  name: "Weekly Scout digest",
  category: "scout",
  subject: "Your week with Scout · $61.40 saved",
  preheader: "4 subscriptions reviewed, 1 rate negotiated, 2 renewals flagged.",
  html: emailShell({
    subject: "Your week with Scout · $61.40 saved",
    preheader: "4 subscriptions reviewed, 1 rate negotiated, 2 renewals flagged.",
    content: `
      ${eyebrow("Scout AI · weekly digest")}
      ${h1("Scout watched your money this week")}
      ${p("Here's what Scout noticed across your accounts between Sep 25 and Oct 2.")}
      ${details([
        ["Saved this week", "$61.40"],
        ["Subscriptions reviewed", "4"],
        ["Rates negotiated", "1"],
        ["Renewals flagged", "2"],
        ["Spending vs. plan", "6% under budget"],
        ["Cash runway", "11.2 months"],
      ])}
      ${progress(64, "Monthly budget used · $12,740 of $20,000")}
      ${btn("Open Scout", `${APP}/scout`)}
      ${textLink("Change digest frequency", `${APP}/settings`)}
    `,
    footerLinks: '<a href="#" style="color:#443173;font-weight:600;text-decoration:none;">Unsubscribe from digests</a>',
  }),
};

/* ============================================================ ACCOUNT */

const welcome: EmailTemplate = {
  id: "welcome",
  name: "Welcome / account opened",
  category: "account",
  subject: "Welcome to Veyra, Hana",
  preheader: "Your business checking account is open. One step left to unlock everything.",
  html: emailShell({
    subject: "Welcome to Veyra, Hana",
    preheader: "Your business checking account is open. One step left to unlock everything.",
    content: `
      ${eyebrow("Welcome")}
      ${h1("Your Veyra account is open")}
      ${p("Welcome aboard, Hana. Park & Co Studio now has a Veyra business checking account, a metal debit card on the way, and Scout keeping watch from day one.")}
      ${details([
        ["Account", "Business checking •••• 9014"],
        ["Routing number", "091408735"],
        ["Bank partner", "Northfield Bank, Member FDIC"],
        ["Plan", "Growth"],
        ["Opened", "Oct 2, 2026"],
      ])}
      ${progress(72, "Account setup · 72% complete")}
      ${btn("Finish setup", `${APP}/kyc`)}
      ${note("Last step: verify your business address to unlock outgoing wires and unlimited card issuance. It takes about two minutes.")}
    `,
  }),
};

const kycApproved: EmailTemplate = {
  id: "kyc-approved",
  name: "Verification approved",
  category: "account",
  subject: "Verification complete · your account is fully active",
  preheader: "Business registration verified. All account limits are lifted.",
  html: emailShell({
    subject: "Verification complete · your account is fully active",
    preheader: "Business registration verified. All account limits are lifted.",
    content: `
      ${eyebrow("Account verification")}
      ${h1("You're fully verified")}
      ${p("We've verified your business registration and address. Every Veyra feature is now unlocked — wires, higher limits, unlimited cards and invoicing.")}
      ${pill("Approved", "green")}
      ${details([
        ["Business", "Park & Co Studio"],
        ["Document verified", "Business registration"],
        ["Country", "United States"],
        ["Completed", "Oct 2, 2026 · 3:24 PM PT"],
        ["Account status", "Active · no limits"],
        ["Daily wire ceiling", "$250,000"],
      ])}
      ${btn("Go to dashboard", `${APP}`)}
    `,
  }),
};

const kycAction: EmailTemplate = {
  id: "kyc-action",
  name: "Verification action needed",
  category: "account",
  subject: "Action needed · verify your identity",
  preheader: "Our compliance team requested identity verification — complete it in about five minutes.",
  html: emailShell({
    subject: "Action needed · verify your identity",
    preheader: "Our compliance team requested identity verification — complete it in about five minutes.",
    content: `
      ${eyebrow("Account verification")}
      ${h1("Verification was requested for your account")}
      ${p("The Veyra compliance team has asked you to verify your identity. Until then, your account keeps reduced limits. Completing verification takes about five minutes — your details, a few documents, and you're done.")}
      ${pill("Action needed", "amber")}
      ${details([
        ["Requested by", "Veyra compliance team"],
        ["Documents needed", "Photo ID · Proof of address"],
        ["Your progress", "72% complete"],
        ["Started", "Sep 30, 2026"],
        ["Review time", "1–2 business days after submit"],
      ])}
      ${progress(72, "Verification · 72% complete")}
      ${btn("Continue verification", `${APP}/kyc`)}
      ${note("Unverified accounts keep a $10,000 monthly send limit. Verifying lifts all limits — including outgoing wires and unlimited card issuance.")}
    `,
  }),
};

const teamInvite: EmailTemplate = {
  id: "team-invite",
  name: "Team member invite",
  category: "account",
  subject: "You're invited to join Park & Co Studio on Veyra",
  preheader: "Hana Park invited you as a team member with a $2,000 monthly card limit.",
  html: emailShell({
    subject: "You're invited to join Park & Co Studio on Veyra",
    preheader: "Hana Park invited you as a team member with a $2,000 monthly card limit.",
    content: `
      ${eyebrow("Team invitation")}
      ${h1("Join Park & Co Studio on Veyra")}
      ${p("Hana Park has invited you to manage money together on Veyra. Accept to get your own card, see shared accounts, and help run the business's spending.")}
      ${details([
        ["Business", "Park & Co Studio"],
        ["Your role", "Team member"],
        ["Monthly card limit", "$2,000.00"],
        ["Invited by", "Hana Park · hana@parkandco.com"],
        ["Invitation expires", "In 7 days"],
      ])}
      ${btn("Accept invitation", `${APP}/invite/accept?email=june%40parkandco.com&business=Park%20%26%20Co%20Studio&role=Team%20member`)}
      ${note("You'll create your own password when you accept — Hana's credentials are never shared with you.")}
    `,
  }),
};

const statementReady: EmailTemplate = {
  id: "statement-ready",
  name: "Monthly statement ready",
  category: "account",
  subject: "Your September statement is ready",
  preheader: "47 transactions · ending balance $84,290.42 · PDF available now.",
  html: emailShell({
    subject: "Your September statement is ready",
    preheader: "47 transactions · ending balance $84,290.42 · PDF available now.",
    content: `
      ${eyebrow("Statements")}
      ${h1("Your September statement is ready")}
      ${p("The official statement for Sep 1 – Sep 30, 2026 is available to view or download in the app.")}
      ${pill("Ready", "violet")}
      ${details([
        ["Period", "Sep 1 – Sep 30, 2026"],
        ["Account", "Business checking •••• 9014"],
        ["Transactions", "47"],
        ["Money in", "$21,450.00"],
        ["Money out", "$17,983.58"],
        ["Ending balance", "$84,290.42"],
      ])}
      ${btn("Download PDF", `${APP}/statements`)}
      ${textLink("View statements archive", `${APP}/statements`)}
    `,
  }),
};

const savingsGoal: EmailTemplate = {
  id: "savings-goal",
  name: "Savings pocket goal reached",
  category: "account",
  subject: "You reached your Tax reserve goal",
  preheader: "$20,000 saved in your Tax reserve pocket — automatic transfers paused.",
  html: emailShell({
    subject: "You reached your Tax reserve goal",
    preheader: "$20,000 saved in your Tax reserve pocket — automatic transfers paused.",
    content: `
      ${eyebrow("Savings pockets")}
      ${h1("You hit your Tax reserve goal")}
      ${p("Your Tax reserve pocket just reached its $20,000 target. Automatic transfers have paused so nothing over-fills — your money stays right where it is, earning 4.25% APY.")}
      ${amount("$20,000.00")}
      ${pill("Goal reached", "green")}
      ${details([
        ["Pocket", "Tax reserve"],
        ["Saved", "$20,000.00"],
        ["Target", "$20,000.00"],
        ["Started", "May 14, 2026"],
        ["Interest earned", "$187.32"],
        ["Automatic transfers", "Paused at target"],
      ])}
      ${progress(100)}
      ${btn("View pocket", `${APP}/accounts`)}
    `,
  }),
};

/* ============================================================ REGISTRY */

export const emailTemplates: EmailTemplate[] = [
  // Security
  signinAlert,
  passwordReset,
  disputeOpened,
  disputeResolved,
  cardsFrozenAll,
  // Transfers
  depositReceived,
  transferSent,
  billPaid,
  rewardsRedeemed,
  // Cards
  cardIssued,
  cardShipped,
  cardFrozen,
  cardReplaced,
  // Invoices
  invoicePaid,
  invoiceSent,
  invoiceOverdue,
  // Scout
  scoutSaved,
  scoutDigest,
  // Account lifecycle
  welcome,
  kycApproved,
  kycAction,
  teamInvite,
  statementReady,
  savingsGoal,
];

export const emailCategories: Array<{ id: EmailCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "security", label: "Security" },
  { id: "transfers", label: "Transfers" },
  { id: "cards", label: "Cards" },
  { id: "invoices", label: "Invoices" },
  { id: "scout", label: "Scout" },
  { id: "account", label: "Account" },
];

/** Convenience for a backend: fetch one template by id. */
export const getEmailTemplate = (id: string): EmailTemplate | undefined =>
  emailTemplates.find(t => t.id === id);
