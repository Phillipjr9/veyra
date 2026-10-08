/**
 * Integration switches. Administrators set up each integration and can turn it
 * on or off at any time (for example during an upgrade). Members only ever see
 * an integration that is switched on AND ready; they never see setup status.
 */
export const INTEGRATIONS = [
  { id: "wire", label: "Wire transfer", group: "Add funds", fundingKind: "wire", provider: null, implemented: true,
    description: "Incoming wires into the admin-set receiving instructions." },
  { id: "direct_deposit", label: "Direct deposit", group: "Add funds", fundingKind: "direct_deposit", provider: null, implemented: true,
    description: "Payroll receiving instructions set on each member account." },
  { id: "bank_transfer", label: "Bank transfer", group: "Add funds", fundingKind: "bank", provider: null, implemented: true,
    description: "Transfers from another bank using the configured receiving instructions." },
  { id: "check", label: "Check deposit", group: "Add funds", fundingKind: "check", provider: null, implemented: true,
    description: "Check-delivery instructions where configured for the account." },
  { id: "other_funding", label: "Other funding", group: "Add funds", fundingKind: "other", provider: null, implemented: true,
    description: "Additional funding instructions from the administrator." },
  { id: "ach", label: "Link a bank (ACH)", group: "Bank and card", fundingKind: "ach", provider: "stripe", implemented: false,
    description: "Linked external bank accounts with verification." },
  { id: "debit_card", label: "Debit card", group: "Bank and card", fundingKind: "card", provider: "stripe", implemented: false,
    description: "Debit cards added through a secure card processor." },
  { id: "crypto_trading", label: "Crypto buy, sell and swap", group: "Crypto", fundingKind: null, provider: null, implemented: true,
    description: "Account orders against internal crypto holdings." },
  { id: "crypto_send", label: "Crypto send requests", group: "Crypto", fundingKind: null, provider: null, implemented: true,
    description: "Send requests that debit account units." },
] as const;

export type IntegrationId = typeof INTEGRATIONS[number]["id"];
export type IntegrationDef = typeof INTEGRATIONS[number];

export const integrationById = (id: string): IntegrationDef | undefined =>
  INTEGRATIONS.find(integration => integration.id === id);

export const integrationForFundingKind = (kind: string): IntegrationDef | undefined =>
  INTEGRATIONS.find(integration => integration.fundingKind === kind);
