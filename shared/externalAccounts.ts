export type ExternalAccount = {
  id: string; bank_name: string; account_name: string; last4: string;
  account_type: string; status: "pending" | "verified" | "disconnected";
  verification_kind: "provider" | "staff_reference";
  verification_note: string; created_at: number;
};
export function externalAccountStatus(account: ExternalAccount) {
  if (account.status === "pending") return "Awaiting review";
  if (account.status === "disconnected") return "Not approved";
  return account.verification_kind === "staff_reference" ? "Staff-approved reference" : "Verified link";
}
