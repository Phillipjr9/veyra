import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { INTEGRATIONS } from "../../shared/integrations.js";

process.env.NODE_ENV = "development";
process.env.MAIL_PROVIDER = "off";
process.env.ADMIN_EMAIL = "integrations-admin@veyra.test"; process.env.ADMIN_PASSWORD = "integrations-test-password";
process.env.RECAPTCHA_SITE_KEY = ""; process.env.FIREBASE_PROJECT_ID = ""; process.env.CRYPTO_TRADING_ENABLED = "1";
delete process.env.STRIPE_SECRET_KEY;

const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any = {}; try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  return { status: r.status, json, text };
};
let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };

try {
  const admin = (await api("POST", "/api/auth/login", undefined, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).json.token as string;
  const name = "Integra";
  const reg = await api("POST", "/api/auth/register", undefined, { name, email: `${name}@veyra.test`, password: "integrations-member-password", accountType: "personal", business: "", profile: applicationFor("personal", name, "") });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const member = reg.json.token as string, memberId = reg.json.user.id as string;
  await api("POST", `/api/admin/kyc/${memberId}/decision`, admin, { decision: "approved" });

  const listed = await api("GET", "/api/admin/integrations", admin);
  check("admin sees every integration with setup checks", listed.status === 200 && listed.json.integrations.length === INTEGRATIONS.length);
  check("member cannot read integration switches", (await api("GET", "/api/admin/integrations", member)).status === 403);
  check("member cannot change integration switches", (await api("PUT", "/api/admin/integrations/wire", member, { enabled: false })).status === 403);
  const ach = listed.json.integrations.find((i: any) => i.id === "ach");
  check("bank linking stays unavailable until its provider build is verified", ach && ach.ready === false && ach.available === false && ach.checks.some((c: any) => /built and verified/.test(c.label)));

  const funding = async () => (await api("GET", "/api/me/funding", member)).json;
  const kinds = (await funding()).availableKinds as string[];
  check("member is offered switched-on, ready funding kinds", ["wire", "direct_deposit", "bank", "check", "other"].every(k => kinds.includes(k)));
  check("member is not offered unbuilt bank linking or debit cards", !kinds.includes("ach") && !kinds.includes("card"));

  check("unknown integration is 404", (await api("PUT", "/api/admin/integrations/nope", admin, { enabled: false })).status === 404);
  check("switch value must be boolean", (await api("PUT", "/api/admin/integrations/wire", admin, { enabled: "no" })).status === 400);

  const off = await api("PUT", "/api/admin/integrations/bank_transfer", admin, { enabled: false });
  check("admin can switch an integration off", off.status === 200 && off.json.integration.available === false);
  check("switched-off integration disappears for members", !(await funding()).availableKinds.includes("bank"));
  check("switch changes are audit-logged", !!db.prepare("SELECT 1 FROM audit_log WHERE action='integration.toggle' AND summary LIKE '%Bank transfer off%'").get());
  await api("PUT", "/api/admin/integrations/bank_transfer", admin, { enabled: true });
  check("admin can switch it back on at any time", (await funding()).availableKinds.includes("bank"));

  const caps = async () => (await api("GET", "/api/me/crypto/capabilities", member)).json;
  check("crypto trading is on for members by default", (await caps()).accountTrading === true);
  await api("PUT", "/api/admin/integrations/crypto_trading", admin, { enabled: false });
  const c2 = await caps();
  check("switching crypto trading off closes trading and withdrawals", c2.accountTrading === false && c2.withdrawals === false);
  const quote = await api("POST", "/api/me/crypto/quote", member, { action: "buy", asset: "BTC", amount: "1" });
  check("trade routes refuse while crypto trading is off", quote.status === 503);
  check("member refusal carries no provider or setup wording", !/provider|connected|configured|activation|integration/i.test(quote.text));
  await api("PUT", "/api/admin/integrations/crypto_trading", admin, { enabled: true });

  await api("PUT", "/api/admin/integrations/crypto_send", admin, { enabled: false });
  const c3 = await caps();
  check("switching crypto send off keeps trading but closes withdrawals", c3.accountTrading === true && c3.withdrawals === false);
  const send = await api("POST", "/api/me/crypto-withdrawals", member, { asset: "BTC", network: "Bitcoin", amount: "0.001", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", requestKey: randomUUID() });
  check("withdrawal route refuses while crypto send is off", send.status === 503);
  await api("PUT", "/api/admin/integrations/crypto_send", admin, { enabled: true });

  const detail = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='integration.toggle'").get() as { n: number };
  check("every switch change produced an audit entry", detail.n >= 5);
  console.log(`\nALL INTEGRATION TESTS PASSED (${checks} checks)`);
} finally {
  await new Promise<void>(r => server.close(() => r()));
  db.close();
}
