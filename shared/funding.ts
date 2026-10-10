/** Funding choices are a catalog, not evidence that a payment rail is connected. */
export const FUNDING_OPTIONS = [
  { kind: "ach", label: "Link a bank (ACH)", description: "Pull from a linked external account after you authorize a debit.", providerRequired: true },
  { kind: "card", label: "Debit card", description: "Charge a debit card. Instant, with a card deposit fee.", providerRequired: true },
  { kind: "zelle", label: "Zelle", description: "View a configured recipient to use through your bank’s Zelle service.", providerRequired: false },
  { kind: "bank", label: "Bank transfer", description: "Share your routing and account number so another bank can send an ACH credit. You do not enter an amount here.", providerRequired: false },
  { kind: "wire", label: "Wire transfer", description: "Share incoming-wire details with the sending bank. Wires are not initiated from Veyra.", providerRequired: false },
  { kind: "direct_deposit", label: "Direct deposit", description: "Share routing and account numbers with payroll. You do not enter an amount here.", providerRequired: false },
  { kind: "check", label: "Check deposit", description: "Mail-in instructions, where configured. Photograph a check on the mobile deposit page.", providerRequired: false },
  { kind: "other", label: "Other funding", description: "Additional funding instructions provided by your administrator.", providerRequired: false },
] as const;

export type FundingKind = typeof FUNDING_OPTIONS[number]["kind"];
export const fundingOption = (kind: string) => FUNDING_OPTIONS.find(option => option.kind === kind);
// These operations have no provider implementation. Admin instruction changes
// must never enable ACH pulls, microdeposits or card collection on their own.
export const fundingRequiresProvider = (kind: string) => fundingOption(kind)?.providerRequired === true;

/** Zelle is a Send money method, not a way to add funds. Its admin-set instructions stay stored, but members never see it in Add funds. */
export const ADD_FUNDS_HIDDEN_KINDS: ReadonlySet<string> = new Set(["zelle"]);
/** The Add funds method list: the catalog without the kinds Add funds must not offer. */
export const ADD_FUNDS_OPTIONS = FUNDING_OPTIONS.filter(option => !ADD_FUNDS_HIDDEN_KINDS.has(option.kind));

/**
 * Incoming rails. The member shares receiving details (or reads instructions).
 * They never type an amount in Add funds — the sending bank, payroll, or mail
 * does. ACH pull from a linked account and debit card are the amount methods.
 */
export const RECEIVE_FUNDING_KINDS: ReadonlySet<string> = new Set(["direct_deposit", "wire", "bank", "check", "other"]);

export type FundingAmountMethod = {
  kind?: string;
  takesAmount?: boolean;
  linkedAccountId?: string;
  inboundReceive?: boolean;
};

/** True when Add funds should collect an amount (ACH debit / debit card). */
export function methodTakesAmount(method: FundingAmountMethod | null | undefined): boolean {
  if (!method) return false;
  if (typeof method.takesAmount === "boolean") return method.takesAmount;
  if (method.kind === "card") return true;
  if (method.kind === "ach") return !method.inboundReceive;
  return false;
}

/** True when Add funds should show routing/account details instead of an amount. */
export function methodShowsReceivingAccount(method: FundingAmountMethod | null | undefined): boolean {
  if (!method?.kind) return false;
  if (method.kind === "direct_deposit" || method.kind === "wire" || method.kind === "bank") return true;
  if (method.kind === "ach" && (method.inboundReceive || !methodTakesAmount(method))) return true;
  return false;
}
