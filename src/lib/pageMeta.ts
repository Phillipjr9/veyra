/**
 * Per-route document metadata.
 *
 * The app is a hash-router SPA, which means one HTML document serves every
 * screen. Without this, every tab, bookmark, browser-history entry and shared
 * link is labelled with the home page's title and description — so "Pricing",
 * "Disclosures" and "Statements" are indistinguishable to a member and to a
 * crawler. Titles and descriptions are resolved from the path (never from the
 * rendered data) so a slow or failed API load can never leave the wrong title
 * on the tab.
 */

export type PageMeta = { title: string; description: string };

const SITE = "Veyra";

const DEFAULT_DESCRIPTION =
  "Everyday banking meets Bitcoin and digital assets. Explore Veyra’s personal and business accounts, crypto holdings, and security-first financial tools.";

/** Titles are written `<page> · Veyra` so the brand stays in short tab labels. */
const page = (title: string, description: string): PageMeta => ({
  title: `${title} · ${SITE}`,
  description,
});

const MARKETING: Record<string, PageMeta> = {
  "/": {
    title: "Veyra | Everyday Banking & Digital Assets",
    description: DEFAULT_DESCRIPTION,
  },
  "/platform": page("The platform", "Accounts, cards, rewards, payments and invoicing in one platform for teams that would rather not run their finances by spreadsheet."),
  "/personal": page("Personal banking", "A daily account with debit cards, transfers, rewards, savings pockets and spending insights that stay easy to read."),
  "/business-account": page("Business account", "Business checking built for cash flow: invoicing, team roles and approvals, cards with limits, and reporting your accountant can use."),
  "/cards": page("Cards", "Virtual and physical debit cards with instant freeze, per-card limits, merchant and category locks, and controls your team can enforce."),
  "/rewards": page("Rewards", "Cash back on everyday spend, with reporting that shows which categories and merchants actually earned it."),
  "/payments": page("Payments", "Send ACH and wire transfers, pay vendors and bills on a schedule, and move money between Veyra accounts instantly."),
  "/invoicing": page("Invoicing", "Create and send invoices, track what is outstanding, accept payment into your account and reconcile it against the ledger."),
  "/integrations": page("Integrations", "Connect Veyra to the accounting, payroll and commerce tools your business already runs on."),
  "/analytics": page("Financial analytics", "Cash in and out, runway, category spend and receivables — the numbers behind the decisions, kept current."),
  "/ai-cfo": page("AI CFO", "Automatic categorisation, forecasts and plain-language answers about where your money is going next."),
  "/scout": page("Veyra Scout", "AI that hunts for savings on every charge and explains what it found before you act on it."),
  "/pricing": page("Pricing", "Everyday and Plus for personal accounts; Starter and Pro for business. Plan availability, and what is and isn’t switched on today."),
  "/security": page("Security", "How Veyra protects your account: encryption, passkeys, two-step sign-in, device sessions, card controls and an append-only audit trail."),
  "/support": page("Support", "Message a specialist, browse the help center, or send the support team a note — and get a reference you can follow up on."),
  "/help-center": page("Help center", "Answers about accounts, cards, transfers, statements, security and digital assets without the runaround."),
  "/concierge": page("Business concierge", "Hands-on help with the details that slow a business down — a real person, around the clock."),
  "/perks": page("Member perks", "Partner offers selected for growing businesses, redeemable from your Veyra account."),
  "/email-templates": page("Email notifications", "Every transactional email Veyra sends, previewed in one place with copyable HTML."),
  "/contact": page("Contact", "Talk to sales or support about a Veyra business account."),
  "/about": page("About Veyra", "Why we are building a calmer, more honest home for business and personal money."),
  "/careers": page("Careers", "Open roles at Veyra — small team, real ownership, work that shows up in people’s businesses."),
  "/legal/privacy": page("Privacy Policy", "What Veyra collects, why it is collected, who it is shared with and the choices you have."),
  "/legal/terms": page("Terms of Service", "The terms that apply to a Veyra account, including eligibility, acceptable use and limits of the service."),
  "/legal/disclosures": page("Disclosures", "Important explanations about Veyra’s status as a financial technology product, banking partners, digital assets and risk."),
  "/login": page("Sign in", "Sign in to your Veyra account with your password, a passkey or a linked provider."),
  "/signup": page("Open an account", "Open a personal or business Veyra account. Applications are reviewed before the dashboard unlocks."),
  "/forgot-password": page("Reset your password", "Reset your Veyra password with a one-time code sent to your email."),
  "/invite/accept": page("Accept an invitation", "Accept a Veyra team invitation and choose your own password."),
};

/** Authenticated screens: not indexed, but they still need honest tab titles. */
const APP: Record<string, PageMeta> = {
  "/app": page("Overview", "Your Veyra account overview: balance, recent activity, goals and quick actions."),
  "/app/accounts": page("Accounts & savings", "Your account details, routing information and savings pockets."),
  "/app/external-accounts": page("External accounts", "Account references submitted for staff review, and the funding methods available to you."),
  "/app/markets": page("Markets", "Digital-asset market data, timestamps and your own positions."),
  "/app/assets": page("Digital assets", "Your Veyra holdings and connected wallets — kept separate, never combined."),
  "/app/assets/receive": page("Receive crypto", "Share a QR code or barcode, or link MetaMask, Trust Wallet, Phantom or UniSat by pasting a public address."),
  "/app/cards": page("Cards", "Issue, freeze and manage your Veyra cards, limits and shipping."),
  "/app/transactions": page("Transactions", "Your full ledger, filterable by type, category and date."),
  "/app/transfers": page("Transfers", "Send money, receive money, deposit a check and review fees before anything is sent."),
  "/app/zelle": page("Zelle®", "Your Zelle® receiving identifier, QR code and deposit details."),
  "/app/check-deposit": page("Check deposit", "Photograph the front and endorsed back of a check. Funds are added to your account when you confirm."),
  "/app/payments": page("Payments", "Outgoing payments, saved recipients and scheduled bills."),
  "/app/invoices": page("Invoicing", "Create invoices, send reminders and record payment."),
  "/app/bills": page("Bills & scheduled payments", "Scheduled and recurring payments, and what is due next."),
  "/app/plan": page("Money plan", "Monthly spending plans by category, and what is left in each."),
  "/app/scout": page("Scout AI", "Ask Scout about spending, merchants, cards or bills and see the account activity behind the answer."),
  "/app/rewards": page("Rewards", "Cash-back earnings, redemption and the purchases that earned the most."),
  "/app/team": page("Team", "Teammates, roles, spending allowances and pending invitations."),
  "/app/perks": page("Perks", "Partner offers available to your account."),
  "/app/statements": page("Statements", "Account statements and CSV exports generated from your ledger."),
  "/app/disputes": page("Disputes & fraud resolution", "Open, track and respond to disputes on card and transfer activity."),
  "/app/kyc": page("Identity verification", "Your identity verification status and what is needed next."),
  "/app/security": page("Security center", "Passkeys, two-step sign-in, recovery codes, devices and live sessions."),
  "/app/support-desk": page("Support & messages", "Your conversations with the Veyra support team."),
  "/app/settings": page("Settings", "Profile, preferences, notifications and account settings."),
  "/app/superadmin": page("Control center", "Veyra staff control center: customers, accounts, ledger, KYC, risk, staff and audit."),
};

const NOT_FOUND = page("Page not found", "That page does not exist. Head back to the Veyra home page or open your account.");

/** `senior-product-engineer` → `Senior Product Engineer`. */
const humanize = (slug: string) =>
  slug
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Resolves metadata for a hash-router path. Unrecognised paths return the
 * not-found copy rather than the home page's, so a stale bookmark is labelled
 * honestly.
 */
export function pageMeta(pathname: string): PageMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = MARKETING[path] ?? APP[path];
  if (exact) return exact;

  if (path.startsWith("/careers/")) {
    const role = humanize(path.slice("/careers/".length));
    return page(`${role} · Careers`, `Veyra is hiring a ${role}. Read the role and get in touch.`);
  }
  if (path.startsWith("/app/superadmin")) return APP["/app/superadmin"]!;
  if (path.startsWith("/app/assets/wallets/")) return page("Wallet", "QR code, barcode and public address for this wallet.");
  if (path.startsWith("/app/")) return APP["/app"]!;
  if (path === "/application") {
    return page("Application status", "Where your Veyra application stands and what happens next.");
  }
  return NOT_FOUND;
}

/** Writes the resolved metadata onto the document, creating tags if absent. */
export function applyPageMeta(meta: PageMeta): void {
  if (typeof document === "undefined") return;
  if (document.title !== meta.title) document.title = meta.title;
  setMeta("name", "description", meta.description);
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);
}

function setMeta(attribute: "name" | "property", key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  if (tag.content !== content) tag.content = content;
}
