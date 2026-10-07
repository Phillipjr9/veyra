/**
 * Transaction fee schedule shared by the web app and API.
 *
 * Convention used everywhere in the ledger:
 * - `amount` remains the signed principal of the movement (negative = money out).
 * - `fee` is a non-negative charge for the movement.
 * - The cash effect of a transaction is always `amount - fee`.
 *
 * Fees are product charges, not team spend. Monthly teammate caps intentionally
 * continue to measure spend principal; the fee is shown separately and debited
 * from the account in addition to the principal.
 */
export type FeeKind =
  | "transfer"
  | "bill"
  | "crypto_buy"
  | "crypto_sell"
  | "crypto_swap"
  | "card_deposit"
  | "deposit"
  | "internal"
  | "adjustment";

export type FeeRule = { rateBps: number; minCents: number; maxCents: number };

export type FeeQuote = {
  kind: FeeKind;
  /** Signed principal in cents. Fees are calculated from its absolute value. */
  amountCents: number;
  /** Non-negative fee in cents. */
  feeCents: number;
  rateBps: number;
  minCents: number;
  maxCents: number;
  /** Cash movement in cents: `amountCents - feeCents`. */
  cashCents: number;
  label: string;
};

/**
 * Current schedule. Kept in one place so API, statements, receipts and client
 * previews cannot drift apart. Amounts are intentionally conservative for a
 * business treasury product.
 */
export const FEE_RULES: Record<FeeKind, FeeRule> = {
  transfer: { rateBps: 50, minCents: 10, maxCents: 1000 },
  bill: { rateBps: 50, minCents: 10, maxCents: 1000 },
  crypto_buy: { rateBps: 50, minCents: 1, maxCents: 2500 },
  crypto_sell: { rateBps: 50, minCents: 1, maxCents: 2500 },
  crypto_swap: { rateBps: 50, minCents: 1, maxCents: 2500 },
  card_deposit: { rateBps: 150, minCents: 10, maxCents: 5000 },
  deposit: { rateBps: 0, minCents: 0, maxCents: 0 },
  internal: { rateBps: 0, minCents: 0, maxCents: 0 },
  adjustment: { rateBps: 0, minCents: 0, maxCents: 0 },
};

export const FEE_LABELS: Record<FeeKind, string> = {
  transfer: "Transfer fee",
  bill: "Bill payment fee",
  crypto_buy: "Crypto order fee",
  crypto_sell: "Crypto order fee",
  crypto_swap: "Crypto swap fee",
  card_deposit: "Card deposit fee",
  deposit: "Deposit fee",
  internal: "Internal transfer fee",
  adjustment: "Adjustment fee",
};

const roundHalfUp = (value: number) => Math.floor(value + 0.5);

/** Calculate a fee from a signed principal amount. Never returns a negative fee. */
export function quoteFee(kind: FeeKind, amountCents: number): FeeQuote {
  if (!Number.isSafeInteger(amountCents)) throw new Error("Invalid fee amount.");
  const rule = FEE_RULES[kind];
  const principal = Math.abs(amountCents);
  const raw = principal > 0 && rule.rateBps > 0 ? roundHalfUp((principal * rule.rateBps) / 10_000) : 0;
  const feeCents = Math.min(rule.maxCents, Math.max(rule.minCents, raw));
  return {
    kind,
    amountCents,
    feeCents,
    rateBps: rule.rateBps,
    minCents: rule.minCents,
    maxCents: rule.maxCents,
    cashCents: amountCents - feeCents,
    label: FEE_LABELS[kind],
  };
}

/** Format a fee quote for receipt/statement copy. */
export function feeLine(quote: FeeQuote): string {
  return `${quote.label} (${quote.rateBps / 100}%)`;
}

/** Sum principal and fee movement for balance math: outgoing debits grow, credits shrink. */
export function applyFee(amountCents: number, feeCents: number): number {
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(feeCents) || feeCents < 0) throw new Error("Invalid fee application.");
  return amountCents - feeCents;
}
