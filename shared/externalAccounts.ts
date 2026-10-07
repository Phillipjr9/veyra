export type ExternalAccount = {
  id: string; bank_name: string; account_name: string; last4: string;
  account_type: string; status: "pending" | "verified" | "disconnected";
  verification_kind: "provider" | "staff_reference" | "card_token";
  verification_note: string; created_at: number;
  kind?: "bank" | "card";
  card_brand?: string;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
  billing_address_json?: string;
};

/** Card references are masked token records; bank references are staff-entered. */
export function externalAccountStatus(account: ExternalAccount) {
  if (account.status === "pending") return "Awaiting review";
  if (account.status === "disconnected") return "Not approved";
  if (account.kind === "card" || account.verification_kind === "card_token") return "Card reference ready";
  return account.verification_kind === "staff_reference" ? "Staff-approved reference" : "Verified link";
}

export function externalAccountLabel(account: ExternalAccount) {
  if (account.kind === "card") {
    const brand = account.card_brand ? `${account.card_brand} ` : "Debit card ";
    return `${brand}•••• ${account.last4}`;
  }
  return `${account.bank_name} ${account.account_type} •••• ${account.last4}`;
}
