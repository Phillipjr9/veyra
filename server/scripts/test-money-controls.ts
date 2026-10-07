/** Real disposable API/SQLite tests; no requests go to the preview or live providers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { createPriceFixture } from "./price-fixture.js";
import { inTransaction, openDb, rid } from "../src/db.js";
import { quoteFee } from "../../shared/fees.js";
import { enforceTeamSpend, TeamSpendingError, teamSpendByActor, teamSpendWindow } from "../src/teamSpending.js";

process.env.NODE_ENV = "development";
process.env.DEMO_SEED = "0";
process.env.ADMIN_EMAIL = "controls-admin@veyra.test";
process.env.ADMIN_PASSWORD = "controls-admin-password";
process.env.RECAPTCHA_SITE_KEY = "";
process.env.FIREBASE_PROJECT_ID = "";
process.env.MAIL_PROVIDER = "";
process.env.CRYPTO_TRADING_ENABLED = "1";
const temp = mkdtempSync(join(tmpdir(), "veyra-money-controls-"));
const prices = createPriceFixture();
await new Promise<void>(resolve => prices.listen(0, "127.0.0.1", resolve));
process.env.CRYPTO_PRICES_URL = `http://127.0.0.1:${(prices.address() as { port: number }).port}/prices`;
const { app, db } = createApp(join(temp, "controls.db"));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "0.0.0.0", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as any };
};
let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };
try {
  const admin = (await api("POST", "/api/auth/login", undefined, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).json.token;
  const registration = await api("POST", "/api/auth/register", undefined, {
    name: "Controls Owner", email: "controls-owner@veyra.test", password: "controls-owner-password", accountType: "business", business: "Controls Ltd",
    profile: applicationFor("business", "Controls Owner", "Controls Ltd"),
  });
  check("business registration succeeds", registration.status === 201);
  const owner = registration.json.token as string, ownerId = registration.json.user.id as string;
  const approval = await api("POST", `/api/admin/kyc/${ownerId}/decision`, admin, { decision: "approved" });
  check("real review endpoint approves owner", approval.status === 200);
  check("fixture account funded by authorized staff", (await api("POST", `/api/admin/members/${ownerId}/adjust`, admin, { direction: "credit", amount: 10000, memo: "Test fixture" })).status === 200);
  const state = async () => (await api("GET", "/api/me/state", owner)).json.account;
  const spend = (token: string, amount: number, extra = {}) => api("POST", "/api/me/transfers", token, { amount, counterparty: "Test vendor", method: "ACH", category: "Operations", ...extra });
  const transferFee = (amount: number) => quoteFee("transfer", Math.round(amount * 100)).feeCents / 100;
  const invite = async (name: string, role: "Admin" | "Member" | "Bookkeeper", cap: number) => {
    const sent = await api("POST", "/api/me/team", owner, { name, email: `${name.toLowerCase()}@veyra.test`, role, monthlyLimit: cap });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    const token = new URL(`http://fixture${sent.json.inviteUrl.replace('/#', '')}`).searchParams.get("token");
    const accepted = await api("POST", `/api/invites/${token}/accept`, undefined, { name, password: "teammate-controls-password" });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.json));
    return { token: accepted.json.token as string, id: accepted.json.user.id as string, memberId: sent.json.member.id as string };
  };
  const ada = await invite("Ada", "Admin", 100);
  const ben = await invite("Ben", "Member", 50);
  const zero = await invite("Zero", "Member", 0);
  const book = await invite("Books", "Bookkeeper", 0);
  const usage = async (id: string) => (await state()).team.find((m: any) => m.id === id);

  const scoutBefore = await state();
  for (const body of [{ amount: 999999, opportunityId: "forged", merchant: "Fake" }, { amount: -10, opportunityId: "x" }, {}]) {
    const reply = await api("POST", "/api/me/scout/apply", owner, body);
    check("all untrusted Scout credit requests are disabled", reply.status === 410 && reply.json.code === "scout_credit_disabled");
  }
  const scoutAfter = await state();
  check("Scout refusal does not mutate funds, rewards, savings, applied IDs or ledger", JSON.stringify([scoutBefore.balance, scoutBefore.rewards, scoutBefore.scoutSaved, scoutBefore.scoutApplied, scoutBefore.transactions]) === JSON.stringify([scoutAfter.balance, scoutAfter.rewards, scoutAfter.scoutSaved, scoutAfter.scoutApplied, scoutAfter.transactions]));
  for (const enabled of [true, false]) {
    await api("PUT", "/api/me/preferences", owner, { key: "scoutAuto", value: enabled });
    const before = await state(); const paid = await spend(owner, 5);
    check("monitoring preference never generates a savings credit", paid.status === 201 && paid.json.result.scout === 0 && paid.json.result.balanceAfter === before.balance - 5 - transferFee(5) && (await state()).scoutSaved === before.scoutSaved);
  }

  const capZero = await spend(zero.token, .01);
  check("a zero cap means no outgoing spending, never unlimited", capZero.status === 403 && capZero.json.code === "team_monthly_limit" && capZero.json.remaining === 0);
  check("Bookkeeper remains read-only", (await spend(book.token, 1)).status === 403);
  const first = await spend(ada.token, 40, { performedBy: ownerId, performed_by: ownerId, userId: ownerId, monthlyLimit: 999999 });
  check("Admin teammate is capped and cannot spoof attribution", first.status === 201 && (db.prepare("SELECT performed_by FROM transactions WHERE id = ?").get(first.json.transaction.id) as { performed_by: string }).performed_by === ada.id);
  check("usage API reports exact remaining cents", (await usage(ada.memberId)).monthlySpent === 40 && (await usage(ada.memberId)).monthlyRemaining === 60);
  const scheduled = await api("POST", "/api/me/scheduled", owner, { payeeName: "Scheduled vendor", amount: 30, nextDate: Date.now(), frequency: "once", category: "Operations", autopay: false });
  check("schedule creation itself does not reserve a teammate allowance", scheduled.status === 201 && (await usage(ada.memberId)).monthlySpent === 40);
  check("manual bill payment shares the cap of its authenticated executor", (await api("POST", `/api/me/scheduled/${scheduled.json.payment.id}/pay`, ada.token)).status === 200 && (await usage(ada.memberId)).monthlySpent === 70);
  const buy = await api("POST", "/api/me/holdings/trade", ada.token, { asset: "USDC", side: "buy", amount: 30 });
  check("crypto buys share the same limit, including the exact cap", buy.status === 201 && (await usage(ada.memberId)).monthlyRemaining === 0);
  const beforeDenied = await state();
  const over = await spend(ada.token, .01);
  check("one cent over the limit is denied with a machine-readable response", over.status === 403 && over.json.code === "team_monthly_limit" && over.json.spent === 100 && over.json.remaining === 0 && over.json.resetsAt > Date.now());
  check("over-limit debit leaves ledger, balance and rewards unchanged", (await state()).balance === beforeDenied.balance && (await state()).transactions.length === beforeDenied.transactions.length && (await state()).rewards === beforeDenied.rewards);
  const failBill = await api("POST", "/api/me/scheduled", owner, { payeeName: "Blocked bill", amount: 1, nextDate: Date.now(), frequency: "weekly", category: "Operations" });
  const billBefore = (await state()).scheduledPayments.find((p: any) => p.id === failBill.json.payment.id);
  const deniedBill = await api("POST", `/api/me/scheduled/${failBill.json.payment.id}/pay`, ada.token);
  check("denied bill does not advance its date/status", deniedBill.status === 403 && JSON.stringify((await state()).scheduledPayments.find((p: any) => p.id === failBill.json.payment.id)) === JSON.stringify(billBefore));
  const holdingsBefore = (await api("GET", "/api/me/holdings", ada.token)).json.holdings;
  const deniedBuy = await api("POST", "/api/me/holdings/trade", ada.token, { asset: "USDC", side: "buy", amount: 1 });
  check("denied crypto purchase cannot change holdings", deniedBuy.status === 403 && JSON.stringify((await api("GET", "/api/me/holdings", ada.token)).json.holdings) === JSON.stringify(holdingsBefore));
  await api("POST", `/api/admin/members/${ownerId}/adjust`, admin, { direction: "credit", amount: 50, memo: "Verified fixture incoming credit" });
  const sold = await api("POST", "/api/me/holdings/trade", ada.token, { asset: "USDC", side: "sell", amount: "10" });
  check("credits and asset sales do not replenish a gross-spend allowance", sold.status === 201 && (await usage(ada.memberId)).monthlySpent === 100 && (await spend(ada.token, 1)).status === 403);
  check("owners are not bound by a teammate cap", (await spend(owner, 120)).status === 201 && (await usage(ada.memberId)).monthlySpent === 100);

  const beforeRace = await state();
  const race = await Promise.all(Array.from({ length: 12 }, () => spend(ben.token, 10)));
  check("concurrent requests cannot exceed the available monthly allowance", race.filter(r => r.status === 201).length === 5 && race.filter(r => r.status === 403).length === 7);
  check("race writes exactly five debits and $50 of spend", (await state()).balance === beforeRace.balance - 50 - 5 * transferFee(10) && (await state()).transactions.length === beforeRace.transactions.length + 5 && (await usage(ben.memberId)).monthlySpent === 50);
  check("different teammates do not consume each other's cap", (await usage(ada.memberId)).monthlySpent === 100);
  const anotherLogin = await api("POST", "/api/auth/login", undefined, { email: "ben@veyra.test", password: "teammate-controls-password" });
  check("a fresh session cannot reset usage", (await spend(anotherLogin.json.token, 1)).status === 403);

  const cardMember = await invite("Cards", "Member", 10);
  const card = await api("POST", "/api/me/cards", owner, { label: "Budget test", limit: 100, type: "virtual", cardholder: "Cards" });
  const cardId = card.json.card?.id;
  assert.ok(cardId, JSON.stringify(card.json));
  check("card payments also count toward the teammate cap", (await spend(cardMember.token, 7, { cardId, method: "Card" })).status === 201);
  const deniedCard = await spend(cardMember.token, 4, { cardId, method: "Card" });
  check("declined card payment rolls back card spend as well as account spend", deniedCard.status === 403 && (await state()).cards.find((c: any) => c.id === cardId).spent === 7 && (await usage(cardMember.memberId)).monthlySpent === 7);
  await api("PATCH", `/api/me/cards/${cardId}`, owner, { frozen: true });
  check("card-specific refusals do not consume the remaining team allowance", (await spend(cardMember.token, 1, { cardId })).status === 403 && (await usage(cardMember.memberId)).monthlyRemaining === 3);

  for (const limit of [-1, 250000.01, "bad"]) {
    check("invalid invite limits are rejected", (await api("POST", "/api/me/team", owner, { name: "Invalid", email: "invalid@veyra.test", role: "Member", monthlyLimit: limit })).status === 400);
  }
  check("Bookkeeper cannot be assigned a misleading spend allowance", (await api("POST", "/api/me/team", owner, { name: "Invalid", email: "invalid@veyra.test", role: "Bookkeeper", monthlyLimit: 50 })).status === 400);

  // Unit boundary tests against the same real SQLite schema; timestamps are
  // supplied to the helper, never accepted from HTTP spend requests.
  const calendar = await invite("Calendar", "Member", 100);
  const at = Date.UTC(2027, 0, 31, 23, 59, 59, 999);
  const window = teamSpendWindow(at);
  check("month bounds are UTC and handle year rollover", window.startsAt === Date.UTC(2027, 0, 1) && window.resetsAt === Date.UTC(2027, 1, 1) && teamSpendWindow(Date.UTC(2026, 11, 31)).resetsAt === Date.UTC(2027, 0, 1));
  const accountId = (db.prepare("SELECT id FROM accounts WHERE user_id = ?").get(ownerId) as { id: number }).id;
  const insert = (cents: number, date: number, status = "cleared", actor: string | null = calendar.id) => db.prepare(`INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, performed_by, created_at) VALUES (?, ?, ?, 'Boundary fixture', 'Operations', 'ACH', ?, ?, 'test', '', ?, ?)`).run(rid("bound"), accountId, ownerId, cents, status, actor, date);
  insert(-2000, window.startsAt); insert(-3000, at, "pending");
  insert(-9000, window.startsAt - 1); insert(-9000, window.resetsAt);
  insert(-9000, at, "failed"); insert(7000, at); insert(-9000, at, "cleared", null);
  check("inclusive start, exclusive next month; count pending, exclude failed/credits/unattributed history", teamSpendByActor(db, ownerId, at).get(calendar.id) === 5000);
  inTransaction(db, () => enforceTeamSpend(db, ownerId, calendar.id, 5000, at));
  assert.throws(() => inTransaction(db, () => enforceTeamSpend(db, ownerId, calendar.id, 5001, at)), TeamSpendingError);
  check("next UTC month uses its own debits, not the previous month", teamSpendByActor(db, ownerId, window.resetsAt).get(calendar.id) === 9000);
  assert.throws(() => enforceTeamSpend(db, ownerId, calendar.id, 1, at), /write transaction/);
  check("guard refuses use outside a transaction", true);
  inTransaction(db, () => { db.prepare("UPDATE team_members SET monthly_limit_cents = 0 WHERE id = ?").run(calendar.memberId); });
  assert.throws(() => inTransaction(db, () => enforceTeamSpend(db, ownerId, calendar.id, 1, at)), TeamSpendingError);
  check("caps are read fresh, not trusted from the session or body", true);
  await api("DELETE", `/api/me/team/${calendar.memberId}`, owner);
  assert.throws(() => inTransaction(db, () => enforceTeamSpend(db, ownerId, calendar.id, 1, at)), TeamSpendingError);
  check("revoked membership is rechecked inside the write lock", true);
  check("removed teammate cannot spend through HTTP", (await spend(calendar.token, 1)).status === 401);
  // Simulate an existing v15 checkout with real historical rows. Migration 16
  // must add only an index/activation timestamp, never rewrite financial data.
  // Complete the pre-existing boot sweep for newly created teammate logins
  // before isolating the migration itself. It creates zero-balance account rows.
  const bootSweep = openDb(join(temp, "controls.db")); bootSweep.close();
  const unchanged = JSON.stringify({ balances: db.prepare("SELECT * FROM accounts ORDER BY id").all(), ledger: db.prepare("SELECT * FROM transactions ORDER BY id").all() });
  db.exec("DROP INDEX idx_txns_actor_spend; DELETE FROM schema_migrations WHERE version = 16");
  const upgraded = openDb(join(temp, "controls.db"));
  check("v15 upgrade preserves every balance and historical ledger field", unchanged === JSON.stringify({ balances: upgraded.prepare("SELECT * FROM accounts ORDER BY id").all(), ledger: upgraded.prepare("SELECT * FROM transactions ORDER BY id").all() }));
  const activation = upgraded.prepare("SELECT applied_at FROM schema_migrations WHERE version = 16").get();
  check("spend index and tracking activation are installed", Boolean(activation) && Boolean(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_txns_actor_spend'").get()));
  upgraded.close();
  const reopened = openDb(join(temp, "controls.db"));
  check("reopening does not reset tracking activation", JSON.stringify(reopened.prepare("SELECT applied_at FROM schema_migrations WHERE version = 16").get()) === JSON.stringify(activation));
  reopened.close();
  const bindFailure = spawnSync(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, DB_PATH: join(temp, "bind-test.db"), PORT: String((server.address() as { port: number }).port), DEMO_SEED: "1" },
  });
  check("bootstrap bind failure exits nonzero and cannot seed against the occupied port", bindFailure.status === 1 && bindFailure.stderr.includes("could not bind port") && !bindFailure.stdout.includes("seeding demo accounts"));
  console.log(`\nALL MONEY-CONTROL TESTS PASSED (${checks} checks)`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await new Promise<void>(resolve => prices.close(() => resolve()));
  db.close(); rmSync(temp, { recursive: true, force: true });
}
