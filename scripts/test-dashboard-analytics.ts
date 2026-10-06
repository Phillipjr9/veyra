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
assert.equal(buildCashFlow(items, 30, now).inflow, 6.3);
assert.equal(buildCashFlow(items, 90, now).inflow, 14.3);
for (const range of [7, 30, 90] as FlowRange[]) {
  const result = buildCashFlow(items, range, now);
  assert.equal(Math.round(result.buckets.reduce((sum, bucket) => sum + bucket.inflow, 0) * 100), Math.round(result.inflow * 100));
  assert.equal(buildCashFlow([], range, now).included, 0);
  assert.equal(buildCashFlow([], range, now).net, 0);
}
assert.equal(buildCashFlow([txn("invalid", NaN, now)], 7, now).included, 0);
assert.equal(buildCashFlow([txn("invalid-date", 1, NaN)], 7, now).included, 0);
console.log("Dashboard analytics: cents, periods, boundaries, pending/future exclusions, totals, and empty states passed.");
