/** Funding choices are a catalog, not evidence that a payment rail is connected. */
export const FUNDING_OPTIONS = [
  { kind: "ach", label: "Link a bank (ACH)", description: "Connect an external account using routing details and trial-deposit verification.", providerRequired: true },
  { kind: "card", label: "Debit card", description: "Add a debit card through a secure payment provider.", providerRequired: true },
  { kind: "zelle", label: "Zelle", description: "View a configured recipient to use through your bank’s Zelle service.", providerRequired: false },
  { kind: "bank", label: "Bank transfer", description: "Send from another bank using your configured receiving instructions.", providerRequired: false },
  { kind: "wire", label: "Wire transfer", description: "Find the recipient and bank details for an incoming wire.", providerRequired: false },
  { kind: "direct_deposit", label: "Direct deposit", description: "Use approved receiving instructions with your employer or payroll provider.", providerRequired: false },
  { kind: "check", label: "Check deposit", description: "View check-delivery instructions, where configured for your account.", providerRequired: false },
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
