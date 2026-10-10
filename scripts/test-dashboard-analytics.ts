import assert from "node:assert/strict";
import { buildCashFlow, type FlowRange } from "../src/lib/dashboardAnalytics";
import type { Txn } from "../src/lib/store";
const now = Date.UTC(2026, 9, 5, 12);
const day = 86_400_000;
const txn = (id: string, amount: number, date: number, status: Txn["status"] = "cleared"): Txn => ({ id, amount, date, status, merchant: id, category: "Operations", reward: 0 });
const items = [txn("in", .1, now), txn("in2", .2, now - day), txn("out", -.15, now - day), txn("pending", 900, now, "pending"), txn("future", 800, now + 1), txn("old", 700, now - 91 * day), txn("boundary", 2, now - 7 * day), txn("month", 4, now - 15 * day), txn("quarter", 8, now - 60 * day)];
const seven = buildCashFlow(items, 7, now);
assert.equal(seven.inflow, .3);
assert.equal(seven.outflow, .15);
assert.equal(seven.net, .15);
assert.equal(seven.pending, 1);
assert.equal(seven.included, 3);
assert.equal(seven.buckets.length, 7);
assert.equal(buildCashFlow(items, 30, now).buckets.length, 30);
assert.equal(buildCashFlow(items, 90, now).buckets.length, 90);
assert.equal(buildCashFlow(items, 30, now).inflow, 6.3);
assert.equal(buildCashFlow(items, 90, now).inflow, 14.3);
assert.equal(seven.buckets[6].inflow, .1);
assert.equal(seven.buckets[5].inflow, .2);
assert.equal(seven.buckets[5].outflow, .15);
for (const range of [7, 30, 90] as FlowRange[]) {
  const result = buildCashFlow(items, range, now);
  assert.equal(Math.round(result.buckets.reduce((sum, bucket) => sum + bucket.inflow, 0) * 100), Math.round(result.inflow * 100));
  assert.equal(buildCashFlow([], range, now).included, 0);
  assert.equal(buildCashFlow([], range, now).net, 0);
}
assert.equal(buildCashFlow([txn("invalid", NaN, now)], 7, now).included, 0);
assert.equal(buildCashFlow([txn("invalid-date", 1, NaN)], 7, now).included, 0);
console.log("Dashboard analytics: cents, periods, boundaries, pending/future exclusions, totals, and empty states passed.");

// Every visualization uses the same cleared rows, cents, and date window.
const { buildLedgerAnalytics } = await import("../shared/ledgerAnalytics.js");
const rails = ["Debit card", "ACH", "Wire", "Zelle", "Check", "Internal", "Transfer", "Unknown"];
const mixed = rails.flatMap((method, index) => [
  { ...txn(`credit-${index}`, 10.01, now), method },
  { ...txn(`debit-${index}`, -3.17, now), method, category: `Category ${index}` },
]);
const rejected = [{ ...txn("failed", 10000, now), status: "failed" }, { ...txn("unknown", -5000, now), status: undefined }, txn("zero", 0, now)];
const complete = buildLedgerAnalytics([...mixed, ...rejected, txn("waiting", -50, now, "pending")], now);
for (const range of [7, 30, 90] as const) {
  const flow = complete.ranges[range];
  assert.equal(flow.inflow, 80.08);
  assert.equal(flow.outflow, 25.36);
  assert.equal(flow.included, 16);
  assert.equal(flow.pending, 1);
  assert.equal(flow.channels.length, 8, "No smaller channel gets dropped");
  assert.equal(Math.round(flow.channels.reduce((sum, c) => sum + c.share, 0)), 100);
  assert.equal(Math.round(flow.categories.reduce((sum, c) => sum + c.total, 0) * 100), 2536);
  assert.equal(Math.round(flow.channels.reduce((sum, c) => sum + c.inflow, 0) * 100), 8008);
  assert.equal(Math.round(flow.channels.reduce((sum, c) => sum + c.outflow, 0) * 100), 2536);
}
assert.equal(complete.months[5].inflow, 80.08);
assert.equal(complete.months[5].outflow, 25.36);
assert.equal(buildLedgerAnalytics([], now).ranges[30].channels.length, 0, "Empty rails must not show a fabricated 100% share");
assert.equal(buildLedgerAnalytics([], now).movement, null);
const monthBoundary = Date.UTC(2026, 9, 1);
const boundary = buildLedgerAnalytics([txn("sept", .1, monthBoundary - 1), txn("oct", .2, monthBoundary)], now);
assert.equal(boundary.months[4].inflow, .1);
assert.equal(boundary.months[5].inflow, .2);
assert.equal(boundary.months[5].categories.length, 0);
const firstSeven = Date.UTC(2026, 8, 29);
assert.equal(buildCashFlow([txn("on-start", 1, firstSeven), txn("before", 2, firstSeven - 1)], 7, now).inflow, 1);
assert.equal(buildCashFlow([txn("aged", 1, now - 7 * day + 1)], 7, now + 2).inflow, 0);
const split = buildCashFlow([txn("oct5", 10, Date.UTC(2026, 9, 5, 8)), txn("oct4", 20, Date.UTC(2026, 9, 4, 22))], 30, now);
assert.equal(split.buckets.length, 30);
assert.equal(split.buckets[29].inflow, 10);
assert.equal(split.buckets[28].inflow, 20);
assert.equal(split.buckets[0].label, "Sep 6");
assert.equal(split.buckets[29].label, "Oct 5");
console.log("Ledger breakdowns: all rails, status whitelist, zero/empty states, UTC month boundaries, aging and cent reconciliation passed.");

assert.equal(seven.buckets[seven.buckets.length - 1].label, new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), "The newest chart interval is labeled with that UTC calendar day");
