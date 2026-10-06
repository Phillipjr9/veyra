import type { Txn } from "./store";

const DAY = 86_400_000;
export type FlowRange = 7 | 30 | 90;

/** Read-only rolling-window analytics. Aggregate cents, exclude pending and
 * future-dated records, and never manufacture a trend for an empty account. */
export function buildCashFlow(transactions: Txn[], days: FlowRange, now = Date.now()) {
  const start = now - days * DAY;
  const count = days === 7 ? 7 : days === 30 ? 10 : 12;
  const step = days * DAY / count;
  const buckets = Array.from({ length: count }, (_, i) => ({
    at: start + i * step, end: start + (i + 1) * step,
    inflowCents: 0, outflowCents: 0,
  }));
  let included = 0;
  let pending = 0;
  for (const transaction of transactions) {
    if (transaction.date <= start || transaction.date > now || !Number.isFinite(transaction.amount) || !Number.isFinite(transaction.date)) continue;
    if (transaction.status === "pending") { pending++; continue; }
    const index = Math.min(count - 1, Math.floor((transaction.date - start) / step));
    const cents = Math.round(Math.abs(transaction.amount) * 100);
    if (transaction.amount > 0) buckets[index].inflowCents += cents;
    else buckets[index].outflowCents += cents;
    included++;
  }
  const inflowCents = buckets.reduce((sum, bucket) => sum + bucket.inflowCents, 0);
  const outflowCents = buckets.reduce((sum, bucket) => sum + bucket.outflowCents, 0);
  return {
    start, end: now, included, pending,
    inflow: inflowCents / 100, outflow: outflowCents / 100,
    net: (inflowCents - outflowCents) / 100,
    buckets: buckets.map(bucket => ({
      at: bucket.at, end: bucket.end,
      label: new Date(bucket.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      inflow: bucket.inflowCents / 100, outflow: bucket.outflowCents / 100,
    })),
  };
}
