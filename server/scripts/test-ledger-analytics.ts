/** Disposable real-API regression: analytics never inherit the 400-row feed cap. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { readLedgerAnalytics } from "../src/ledgerAnalytics.js";

process.env.NODE_ENV = "development";
process.env.DEMO_SEED = "0";
process.env.MAIL_PROVIDER = "off";
process.env.RECAPTCHA_SITE_KEY = "";
process.env.FIREBASE_PROJECT_ID = "";
process.env.ADMIN_EMAIL = "analytics-admin@veyra.test";
process.env.ADMIN_PASSWORD = "Analytics-Admin-2026!";
const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
async function api(path: string, token?: string, data?: unknown) {
  const res = await fetch(base + path, { method: data ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return { status: res.status, json: await res.json() as any };
}
try {
  const admin = (await api("/api/auth/login", undefined, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).json.token;
  async function member(name: string) {
    const res = await api("/api/auth/register", undefined, { name, email: `${name.replaceAll(" ", "")}@veyra.test`, password: "Analytics-Member-2026!", accountType: "personal", profile: applicationFor("personal", name) });
    assert.equal(res.status, 201);
    assert.equal((await api(`/api/admin/kyc/${res.json.user.id}/decision`, admin, { decision: "approved" })).status, 200);
    return { id: res.json.user.id as string, token: res.json.token as string };
  }
  const alice = await member("Chart Alice"), bob = await member("Chart Bob");
  const now = Date.now();
  const insert = db.prepare("INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  function row(id: string, cents: number, at: number, status = "cleared", owner = alice, method = "ACH") {
    const account = db.prepare("SELECT id FROM accounts WHERE user_id = ?").get(owner.id)!;
    insert.run(id, account.id, owner.id, "Test merchant", "Operations", method, cents, status, id, at);
  }
  db.exec("BEGIN");
  for (let i = 0; i < 450; i++) row(`credit-${i}`, 101, now - i - 1000);
  row("debit", -173, now - 1);
  row("waiting", -10000, now, "pending");
  row("failed", 99999999, now, "failed");
  row("future", 99999999, now + 86_400_000);
  row("bob-credit", 902, now - 1, "cleared", bob, "Zelle");
  db.exec("COMMIT");
  const own = (await api(`/api/me/state?userId=${bob.id}`, alice.token)).json.account;
  assert.equal(own.transactions.length, 400);
  assert.equal(own.analytics.ranges[30].inflow, 454.5);
  assert.equal(own.analytics.ranges[30].outflow, 1.73);
  assert.equal(own.analytics.ranges[30].included, 451);
  assert.equal(own.analytics.ranges[30].pending, 1);
  assert.equal(own.analytics.ranges[30].categories[0].total, 1.73);
  assert.equal(own.analytics.ranges[30].channels.length, 1);
  assert.equal((await api("/api/me/state", bob.token)).json.account.analytics.ranges[30].inflow, 9.02);
  assert.equal((await api("/api/me/state")).status, 401);
  assert.equal((await api("/api/admin/state", alice.token)).status, 403);
  const platform = (await api("/api/admin/state", admin)).json;
  assert.equal(platform.transactions.length, 400);
  assert.equal(platform.analytics.ranges[30].inflow, 463.52);
  assert.equal(platform.analytics.ranges[30].included, 452);
  assert.equal(platform.analytics.ranges[30].channels.length, 2);
  db.prepare("UPDATE transactions SET status = 'cleared' WHERE id = 'waiting'").run();
  assert.equal((await api("/api/me/state", alice.token)).json.account.analytics.ranges[7].outflow, 101.73);
  const beyondWindow = readLedgerAnalytics(db, alice.id, now + 92 * 86_400_000);
  assert.equal(beyondWindow.ranges[90].included, 0, "Old records age out without a new transaction");
  const empty = readLedgerAnalytics(db, "nonexistent-owner", now);
  assert.equal(empty.ranges[7].included, 0);
  assert.equal(empty.months.length, 6);
  console.log("Ledger API: >400 rows, complete member/platform totals, status transitions, isolation, permissions, time aging and empty-state checks passed.");
} finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
