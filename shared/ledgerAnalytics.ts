/** Shared by server snapshots and client previews. No account or UI dependencies. */
export type LedgerRow = { amount: number; date: number; status?: string; category?: string; method?: string };
export const FLOW_DAY = 86_400_000;

const DAY = FLOW_DAY;
export type FlowRange = 7 | 30 | 90;

/** UTC calendar day that contains `ts` (midnight inclusive). */
export function utcDayStart(ts: number) {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcDayLabel(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Read-only rolling-window analytics. Aggregate cents, exclude pending and
 * future-dated records, and never manufacture a trend for an empty account.
 * Each range is one UTC calendar day per bucket so a posted movement lands on
 * the same date the ledger shows, not a multi-day blob labeled with its end. */
export function buildCashFlow(transactions: readonly LedgerRow[], days: FlowRange, now = Date.now()) {
  const today = utcDayStart(now);
  const start = today - (days - 1) * DAY;
  const buckets = Array.from({ length: days }, (_, i) => {
    const at = start + i * DAY;
    return {
      at,
      end: i === days - 1 ? now : at + DAY,
      inflowCents: 0,
      outflowCents: 0,
    };
  });
  let included = 0;
  let pending = 0;
  const categories = new Map<string, number>();
  const channels = new Map<string, { inflow: number; outflow: number }>();
  for (const transaction of transactions) {
    if (transaction.date < start || transaction.date > now || !Number.isFinite(transaction.amount) || !Number.isFinite(transaction.date)) continue;
    if (transaction.status === "pending") { pending++; continue; }
    if (transaction.status !== "cleared" || Math.round(Math.abs(transaction.amount) * 100) === 0) continue;
    const index = Math.floor((utcDayStart(transaction.date) - start) / DAY);
    if (index < 0 || index >= days) continue;
    const cents = Math.round(Math.abs(transaction.amount) * 100);
    if (transaction.amount > 0) buckets[index].inflowCents += cents;
    else buckets[index].outflowCents += cents;
    if (transaction.amount < 0) categories.set(transaction.category || "Other", (categories.get(transaction.category || "Other") ?? 0) + cents);
    const name = paymentChannel(transaction.method);
    const channel = channels.get(name) ?? { inflow: 0, outflow: 0 };
    if (transaction.amount > 0) channel.inflow += cents;
    else channel.outflow += cents;
    channels.set(name, channel);
    included++;
  }
  const inflowCents = buckets.reduce((sum, bucket) => sum + bucket.inflowCents, 0);
  const outflowCents = buckets.reduce((sum, bucket) => sum + bucket.outflowCents, 0);
  return {
    start, end: now, included, pending,
    inflow: inflowCents / 100, outflow: outflowCents / 100,
    net: (inflowCents - outflowCents) / 100,
    categories: [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, cents]) => ({ name, total: cents / 100 })),
    channels: [...channels].map(([name, value]) => ({ name, inflow: value.inflow / 100, outflow: value.outflow / 100, total: (value.inflow + value.outflow) / 100, share: (value.inflow + value.outflow) / Math.max(1, inflowCents + outflowCents) * 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    buckets: buckets.map(bucket => ({
      at: bucket.at, end: bucket.end,
      label: utcDayLabel(bucket.at),
      inflow: bucket.inflowCents / 100, outflow: bucket.outflowCents / 100,
    })),
  };
}


/** Keep every rail, including Internal, instead of silently dropping small slices. */
export function paymentChannel(method?: string) {
  const raw = (method ?? "").toLowerCase();
  if (raw.includes("internal") || raw.includes("pocket")) return "Internal";
  if (raw.includes("zelle")) return "Zelle";
  if (raw.includes("card")) return "Card";
  if (raw.includes("ach")) return "ACH";
  if (raw.includes("wire")) return "Wire";
  if (raw.includes("check")) return "Check";
  if (raw.includes("transfer")) return "Transfer";
  return "Other";
}

/** Six UTC calendar months, including the current partial month. */
export function analyticsStart(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 5, 1);
}

export function buildLedgerAnalytics(transactions: readonly LedgerRow[], now = Date.now()) {
  const ranges = { 7: buildCashFlow(transactions, 7, now), 30: buildCashFlow(transactions, 30, now), 90: buildCashFlow(transactions, 90, now) };
  const date = new Date(now);
  const months = Array.from({ length: 6 }, (_, i) => {
    const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 5 + i, 1);
    const end = Math.min(now, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 4 + i, 1));
    let incoming = 0, outgoing = 0;
    const categories = new Map<string, number>();
    for (const row of transactions) {
      if (row.status !== "cleared" || !Number.isFinite(row.date) || !Number.isFinite(row.amount) || row.date < at || row.date > now || row.date >= Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 4 + i, 1)) continue;
      const cents = Math.round(Math.abs(row.amount) * 100);
      if (!cents) continue;
      if (row.amount > 0) incoming += cents;
      else { outgoing += cents; categories.set(row.category || "Other", (categories.get(row.category || "Other") ?? 0) + cents); }
    }
    return { at, end, month: new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), inflow: incoming / 100, outflow: outgoing / 100, categories: [...categories].map(([name, cents]) => ({ name, total: cents / 100 })) };
  });
  const previous = buildCashFlow(transactions, 30, now - 30 * DAY).net;
  return { asOf: now, ranges, months, movement: previous === 0 ? null : ((ranges[30].net - previous) / Math.abs(previous)) * 100 };
}
export type LedgerAnalytics = ReturnType<typeof buildLedgerAnalytics>;
