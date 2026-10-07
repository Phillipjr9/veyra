/** Shared wording for inbox, email and future provider callbacks. */
export const CRYPTO_ACTIVITIES = ["buy", "sell", "swap", "deposit", "withdrawal", "transfer"] as const;
export const CRYPTO_STATUSES = ["recorded", "confirmed", "completed", "failed", "cancelled"] as const;
export type CryptoNotification = {
  activity: typeof CRYPTO_ACTIVITIES[number]; status: typeof CRYPTO_STATUSES[number];
  reference: string; occurredAt: number; asset: string; quantity: string;
  toAsset?: string; toQuantity?: string; network?: string;
  settlement: "account" | "request" | "blockchain";
  transactionHash?: string; confirmations?: number;
};
const labels = { buy: "purchase", sell: "sale", swap: "swap", deposit: "deposit", withdrawal: "withdrawal", transfer: "transfer" };
export function cryptoNotificationContent(data: CryptoNotification) {
  // Request-only rails must never produce an externally confirmed success.
  if (data.settlement === "request" && ["completed", "confirmed"].includes(data.status)) throw new Error("A request is not a completed crypto movement.");
  if (data.settlement === "blockchain" && ["completed", "confirmed"].includes(data.status) && (!data.transactionHash || !Number.isSafeInteger(data.confirmations) || data.confirmations! < 1)) throw new Error("Blockchain confirmation evidence is required.");
  const status = { recorded: "recorded", confirmed: "confirmed", completed: "completed", failed: "failed", cancelled: "cancelled" }[data.status];
  const title = `Crypto ${labels[data.activity]} ${status}`;
  const amount = `${data.quantity} ${data.asset}${data.toAsset && data.toQuantity ? ` → ${data.toQuantity} ${data.toAsset}` : ""}`;
  const scope = data.settlement === "account" ? "Veyra account records only; no external trade or blockchain broadcast." : data.settlement === "request" ? "Request only; no blockchain transaction has been broadcast and no network fee was collected." : "Status reported by the connected network provider.";
  const outcome = data.status === "recorded" ? (data.activity === "withdrawal" ? "Your request is recorded and the units have left your holdings." : "This activity is recorded, not completed.")
    : data.status === "cancelled" ? "This activity was cancelled."
    : data.status === "failed" ? (data.settlement === "blockchain" ? "The network reported that this transaction failed. Network fees may still apply; review the transaction details." : "This attempt could not be completed. No balance changes were applied for this attempt. Review its status before retrying.")
    : data.status === "confirmed" ? "Confirmation has been recorded." : "Your account activity has been recorded successfully.";
  return { title, amount, scope, outcome, detail: `${amount}. ${outcome} ${scope} Reference: ${data.reference}.` };
}
