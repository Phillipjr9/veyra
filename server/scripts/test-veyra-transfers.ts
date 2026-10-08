import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";

process.env.NODE_ENV = "development";
process.env.MAIL_PROVIDER = "off";
process.env.ADMIN_EMAIL = "veyra-transfer-admin@veyra.test"; process.env.ADMIN_PASSWORD = "veyra-transfer-admin";
process.env.RECAPTCHA_SITE_KEY = ""; process.env.FIREBASE_PROJECT_ID = "";

const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any = {}; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: r.status, json };
};

let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };

try {
  const admin = (await api("POST", "/api/auth/login", undefined, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).json.token;
  const register = async (type: "personal" | "business", name: string) => {
    const r = await api("POST", "/api/auth/register", undefined, { name, email: `${name.toLowerCase()}@veyra.test`, password: "veyra-transfer-member", accountType: type, business: type === "business" ? `${name} Ltd` : "", profile: applicationFor(type, name, `${name.toLowerCase()}@veyra.test`) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await api("POST", `/api/admin/kyc/${r.json.user.id}/decision`, admin, { decision: "approved" });
    return { token: r.json.token as string, id: r.json.user.id as string, email: `${name.toLowerCase()}@veyra.test` };
  };
  const ana = await register("personal", "Ana");
  const ben = await register("personal", "Ben");
  const biz = await register("business", "Corin");

  const ids = db.prepare("SELECT veyra_id FROM users").all() as Array<{ veyra_id: string }>;
  check("every member has a Veyra ID at sign-up", ids.every(row => /^VYR\d{9}$/.test(row.veyra_id)));
  check("Veyra IDs are unique", new Set(ids.map(row => row.veyra_id)).size === ids.length);
  const me = await api("GET", "/api/me/state", ana.token);
  check("member state carries the Veyra ID and login email", /^VYR\d{9}$/.test(me.json.account.veyraId) && me.json.account.veyraEmail === ana.email);

  db.prepare("UPDATE accounts SET balance_cents = 50000 WHERE user_id = ?").run(ana.id);
  const anaId = (db.prepare("SELECT veyra_id FROM users WHERE id = ?").get(ben.id) as { veyra_id: string }).veyra_id;

  const byEmail = await api("POST", "/api/me/veyra-transfers/lookup", ana.token, { identifier: ben.email });
  check("lookup by email finds the recipient", byEmail.status === 200 && byEmail.json.recipient.veyraId === anaId);
  check("lookup masks the recipient email", byEmail.json.recipient.email !== ben.email);
  const byId = await api("POST", "/api/me/veyra-transfers/lookup", ana.token, { identifier: anaId.toLowerCase() });
  check("lookup by Veyra ID finds the recipient (case-insensitive)", byId.status === 200 && byId.json.recipient.email !== undefined);
  check("lookup of an unknown identifier is refused", (await api("POST", "/api/me/veyra-transfers/lookup", ana.token, { identifier: "VYR000000000" })).status === 400);
  check("lookup of yourself is refused", (await api("POST", "/api/me/veyra-transfers/lookup", ana.token, { identifier: ana.email })).status === 400);

  const key = randomUUID();
  const sent = await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: anaId, amount: "25.50", requestKey: key, note: "Lunch" });
  check("transfer by Veyra ID returns 201", sent.status === 201);
  check("transfer carries zero fee and balances", sent.json.result.fee === 0 && sent.json.result.balanceBefore === 500 && sent.json.result.balanceAfter === 474.5);
  const benBalance = (await api("GET", "/api/me/state", ben.token)).json.account.balance;
  check("recipient is credited the same amount", benBalance === 25.5);
  const retry = await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "25.50", requestKey: key, note: "Lunch" });
  check("a retried request replays the original result without a second debit", retry.status === 200 && retry.json.replayed === true && retry.json.result.reference === sent.json.result.reference);
  check("the retry did not debit again", (await api("GET", "/api/me/state", ana.token)).json.account.balance === 474.5);

  check("insufficient funds are refused", (await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "9999", requestKey: randomUUID() })).status === 400);
  check("a non-positive amount is refused", (await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "0", requestKey: randomUUID() })).status === 400);
  check("a malformed amount is refused", (await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "1.999", requestKey: randomUUID() })).status === 400);
  check("a missing request key is refused", (await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ben.email, amount: "1" })).status === 400);
  check("paying yourself is refused", (await api("POST", "/api/me/veyra-transfers", ana.token, { identifier: ana.email, amount: "1", requestKey: randomUUID() })).status === 400);

  const bizTransfer = await api("POST", "/api/me/veyra-transfers", biz.token, { identifier: ben.email, amount: "1", requestKey: randomUUID() });
  check("business transfers require a category", bizTransfer.status === 400);
  const poor = await api("POST", "/api/me/veyra-transfers", biz.token, { identifier: ben.email, amount: "1", requestKey: randomUUID(), category: "Supplies" });
  check("business transfers are refused without funds", poor.status === 400);
  db.prepare("UPDATE accounts SET balance_cents = 10000 WHERE user_id = ?").run(biz.id);
  const categorised = await api("POST", "/api/me/veyra-transfers", biz.token, { identifier: ben.email, amount: "10", requestKey: randomUUID(), category: "Supplies" });
  check("business transfers succeed with a category and funds", categorised.status === 201);
  const bizRow = db.prepare("SELECT category, method FROM transactions WHERE user_id = ? AND method = 'Veyra'").get(biz.id) as { category: string; method: string } | undefined;
  check("the business ledger keeps the chosen category", bizRow?.category === "Supplies");

  const benRows = db.prepare("SELECT amount_cents, category FROM transactions WHERE user_id = ? AND method = 'Veyra' ORDER BY created_at").all(ben.id) as Array<{ amount_cents: number; category: string }>;
  const anaRows = db.prepare("SELECT amount_cents, category FROM transactions WHERE user_id = ? AND method = 'Veyra' ORDER BY created_at").all(ana.id) as Array<{ amount_cents: number; category: string }>;
  check("the recipient ledger records each credit once", benRows.length === 2 && benRows[0].amount_cents === 2550 && benRows[1].amount_cents === 1000);
  check("the sender ledger records the debit once", anaRows.length === 1 && anaRows[0].amount_cents === -2550 && anaRows[0].category === "Uncategorized");
  check("the sender balance is exactly the original minus the single transfer", (await api("GET", "/api/me/state", ana.token)).json.account.balance === 474.5);

  console.log(`\nALL VEYRA TRANSFER CHECKS PASSED (${checks} checks)`);
} finally {
  server.close();
}
