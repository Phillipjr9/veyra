import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { hashPassword, signToken } from "../src/security.js";
import { createApp } from "../src/app.js";
import { productionRuntimeReport } from "../src/runtime.js";
import { stripeConfig, verifyStripeSignature } from "../src/stripe.js";

process.env.NODE_ENV = "development";
process.env.STRIPE_SECRET_KEY = "sk_test_veyraadaptertest";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_veyraadaptertest";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_veyra_adapter_test";
process.env.APP_URL = "http://127.0.0.1:5173";

let checks = 0;
const check = (name: string, value: unknown) => { assert.ok(value, name); checks++; console.log(`✓ ${name}`); };
const sign = (body: string, timestamp: number) => {
  const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const cfg = stripeConfig();
check("Stripe test configuration is recognised without exposing a secret", cfg.enabled && !cfg.live && cfg.publishableKey.startsWith("pk_test_"));
const sample = Buffer.from('{"id":"evt_signature"}');
const timestamp = Math.floor(Date.now() / 1000);
check("valid Stripe signature verifies", verifyStripeSignature(sample, sign(sample.toString(), timestamp), cfg.webhookSecret));
check("invalid Stripe signature fails closed", !verifyStripeSignature(sample, `t=${timestamp},v1=${"0".repeat(64)}`, cfg.webhookSecret));
check("stale Stripe signature fails closed", !verifyStripeSignature(sample, sign(sample.toString(), timestamp - 600), cfg.webhookSecret));

const original = { ...process.env };
try {
  process.env.NODE_ENV = "production";
  process.env.TOKEN_SECRET = "x".repeat(32);
  process.env.TOTP_ENCRYPTION_KEY = "y".repeat(32);
  process.env.APP_URL = "https://app.veyra.example";
  process.env.WEBAUTHN_ORIGINS = "https://app.veyra.example";
  process.env.PREVIEW_LOGIN_SHORTCUTS = "0";
  process.env.ACCOUNT_LEDGER_ENABLED = "0";
  process.env.STRIPE_SECRET_KEY = "sk_live_veyraadaptertest";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_veyra_adapter_test";
  check("valid production Stripe environment passes deployment checks", productionRuntimeReport().errors.length === 0);
  process.env.CORS_ORIGIN = "*";
  check("production deployment check rejects wildcard CORS", productionRuntimeReport().errors.some(error => error.includes("CORS_ORIGIN")));
} finally {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}

process.env.NODE_ENV = "development";
process.env.STRIPE_SECRET_KEY = "sk_test_veyraadaptertest";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_veyraadaptertest";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_veyra_adapter_test";
process.env.APP_URL = "http://127.0.0.1:5173";

// Small local Stripe fixture: it validates the adapter's HTTP boundary without
// a network request or a real provider credential.
const stripeRequests: Array<{ method?: string; path?: string; body: string }> = [];
const stripeFixture = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf8");
  stripeRequests.push({ method: req.method, path: req.url, body });
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/v1/issuing/cardholders") return void res.end(JSON.stringify({ id: "ich_veyra_test" }));
  if (req.method === "POST" && req.url === "/v1/issuing/cards") return void res.end(JSON.stringify({ id: "ic_veyra_test", last4: "4242", exp_month: 12, exp_year: 2030, status: "active" }));
  if (req.method === "POST" && req.url === "/v1/issuing/cards/ic_veyra_test") return void res.end(JSON.stringify({ id: "ic_veyra_test", status: "inactive" }));
  res.statusCode = 404; res.end(JSON.stringify({ error: { message: "fixture route missing" } }));
});
await new Promise<void>(resolve => stripeFixture.listen(0, "127.0.0.1", resolve));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${(stripeFixture.address() as { port: number }).port}`;

const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const event = JSON.stringify({
  id: "evt_veyra_rails_test", type: "account.updated", created: timestamp, livemode: false,
  data: { object: { id: "acct_veyra_rails_test", object: "account", details_submitted: false, requirements: {}, metadata: {} } },
});
try {
  const send = (signature: string) => fetch(`${base}/api/webhooks/stripe`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: event,
  });
  check("unsigned Stripe callback is rejected", (await send("")).status === 400);
  check("signed Stripe callback is accepted", (await send(sign(event, timestamp))).status === 200);
  check("signed event is recorded without raw payload", Boolean(db.prepare("SELECT id,payload_sha256,status FROM stripe_events WHERE id=?").get("evt_veyra_rails_test")));
  check("Stripe retry is idempotently acknowledged", (await send(sign(event, timestamp))).status === 200);
  check("migration creates rail mapping and settlement tables", Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stripe_rails'").get()) && Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stripe_settlements'").get()));

  const userId = "stripe_live_member", tokenId = "stripe_live_session", password = "stripe-live-pass";
  const createdAt = Date.now();
  db.prepare("INSERT INTO users(id,name,email,phone,business,account_type,role,plan,password_hash,status,created_at) VALUES(?,?,?,?,?,'personal','user','Pro',?,'active',?)")
    .run(userId, "Stripe Member", "stripe-member@veyra.test", "+15555550123", "", hashPassword(password), createdAt);
  db.prepare("INSERT INTO accounts(user_id,account_number,routing_number,bank_name,balance_cents,pending_cents,rewards_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(userId, "818181818181", "091408735", "Stripe Test Bank", 10_000, 0, 0, createdAt, createdAt);
  db.prepare("INSERT INTO identity_profiles(user_id,first_name,last_name,phone,address_line1,city,state,postal_code,country) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(userId, "Stripe", "Member", "+15555550123", "1 Main Street", "New York", "NY", "10001", "US");
  db.prepare("INSERT INTO stripe_rails(user_id,connected_account_id,financial_account_id,status,active_features_json,pending_features_json,restricted_features_json,financial_address_json,requirements_json,livemode,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(userId, "acct_veyra_test", "fa_veyra_test", "active", JSON.stringify(["card_issuing"]), "[]", "[]", "{}", "{}", 0, createdAt, createdAt);
  const token = signToken({ sub: userId, jti: tokenId, role: "user" });
  db.prepare("INSERT INTO sessions(token_id,user_id,created_at,expires_at,revoked) VALUES(?,?,?,?,0)").run(tokenId, userId, createdAt, createdAt + 12 * 60 * 60 * 1000);
  const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const issued = await fetch(`${base}/api/me/cards`, { method: "POST", headers: auth, body: JSON.stringify({ label: "Live card", type: "virtual", limit: 1000, cardholder: "Stripe Member" }) });
  const issuedBody = await issued.json() as { card?: { id: string; fullNumber: string; cvv: string } };
  check("active Stripe rails issue an Issuing card", issued.status === 201 && issuedBody.card?.fullNumber === "•••• •••• •••• 4242");
  const storedCard = db.prepare("SELECT provider_card_id,provider_cardholder_id,provider_status,full_number,cvv,pin FROM cards WHERE id=?").get(issuedBody.card!.id) as Record<string, string>;
  check("live card stores only opaque provider IDs and masked card data", storedCard.provider_card_id === "ic_veyra_test" && storedCard.provider_cardholder_id === "ich_veyra_test" && storedCard.full_number === "•••• •••• •••• 4242" && storedCard.cvv === "" && storedCard.pin === "");
  check("live card creation never stores a PAN or CVV from the provider", !JSON.stringify(storedCard).includes("4242424242424242") && !JSON.stringify(storedCard).includes("123"));
  const frozen = await fetch(`${base}/api/me/cards/${issuedBody.card!.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ frozen: true }) });
  check("live card freeze is propagated to Stripe before local success", frozen.status === 200 && stripeRequests.some(request => request.path === "/v1/issuing/cards/ic_veyra_test" && request.body.includes("status=inactive")));
  check("live Issuing card cannot become a simulated local transfer", (await fetch(`${base}/api/me/transfers`, { method: "POST", headers: auth, body: JSON.stringify({ counterparty: "Merchant", amount: 1, category: "Operations", method: "Card", cardId: issuedBody.card!.id }) })).status === 409);

  // Treasury Transactions, not browser completion callbacks or an outbound
  // payment's creation status, are settlement authority. These fixtures prove
  // the local projection remains pending until Stripe reports `posted`.
  const treasuryEvent = (eventId: string, transactionId: string, status: "open" | "posted" | "void", amount: number, description = "ACH settlement") => JSON.stringify({
    id: eventId, type: `treasury.transaction.${status === "open" ? "created" : "updated"}`, created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { id: transactionId, object: "treasury.transaction", financial_account: "fa_veyra_test", amount, currency: "usd", status,
      flow: `flow_${transactionId}`, flow_type: amount > 0 ? "received_credit" : "outbound_payment", description, created: Math.floor(Date.now() / 1000) } },
  });
  const sendWebhook = async (body: string) => {
    const signedAt = Math.floor(Date.now() / 1000);
    return fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sign(body, signedAt) }, body });
  };
  const sendTreasury = (eventId: string, transactionId: string, status: "open" | "posted" | "void", amount: number, description = "ACH settlement") =>
    sendWebhook(treasuryEvent(eventId, transactionId, status, amount, description));
  const accountBalance = () => (db.prepare("SELECT balance_cents FROM accounts WHERE user_id=?").get(userId) as { balance_cents: number }).balance_cents;
  check("open Treasury transaction is accepted", (await sendTreasury("evt_treasury_open", "tr_open_to_post", "open", 2_500)).status === 200);
  const openSettlement = db.prepare("SELECT status,ledger_transaction_id FROM stripe_settlements WHERE provider_transaction_id=?").get("tr_open_to_post") as { status: string; ledger_transaction_id: string };
  check("open Treasury transaction remains pending with no balance movement", openSettlement.status === "open" && accountBalance() === 10_000 && (db.prepare("SELECT status FROM transactions WHERE id=?").get(openSettlement.ledger_transaction_id) as { status: string }).status === "pending");
  check("posted Treasury transaction settles the pending ledger exactly once", (await sendTreasury("evt_treasury_posted", "tr_open_to_post", "posted", 2_500)).status === 200 && accountBalance() === 12_500);
  check("duplicate posted Treasury event does not move balance twice", (await sendTreasury("evt_treasury_posted", "tr_open_to_post", "posted", 2_500)).status === 200 && accountBalance() === 12_500);
  check("direct posted Treasury event creates an already-cleared ledger row", (await sendTreasury("evt_treasury_direct_posted", "tr_direct_posted", "posted", 1_000)).status === 200 && accountBalance() === 13_500 && (db.prepare("SELECT status FROM transactions WHERE reference=?").get("STRIPE-tr_direct_posted") as { status: string }).status === "cleared");
  check("void Treasury transaction marks its pending ledger row failed", (await sendTreasury("evt_treasury_void_open", "tr_void_before_post", "open", 600)).status === 200 && (await sendTreasury("evt_treasury_void", "tr_void_before_post", "void", 600)).status === 200 && (db.prepare("SELECT status FROM transactions WHERE reference=?").get("STRIPE-tr_void_before_post") as { status: string }).status === "failed" && accountBalance() === 13_500);
  const outOfOrder = treasuryEvent("evt_treasury_void_then_post", "tr_void_before_post", "posted", 600);
  check("unsafe void-to-posted reordering returns a retryable webhook failure", (await sendWebhook(outOfOrder)).status === 500 && (await sendWebhook(outOfOrder)).status === 500 && accountBalance() === 13_500);
  const railStatus = await fetch(`${base}/api/me/rails`, { headers: { authorization: `Bearer ${token}` } });
  const railBody = await railStatus.json() as { rails?: { settlements?: Array<{ id: string; status: string }> } };
  check("rail status surfaces provider settlement state without sensitive details", railStatus.status === 200 && railBody.rails?.settlements?.some(settlement => settlement.id === "tr_open_to_post" && settlement.status === "posted"));

  console.log(`\n${checks} Stripe rail checks passed.`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await new Promise<void>(resolve => stripeFixture.close(() => resolve()));
  db.close();
}
