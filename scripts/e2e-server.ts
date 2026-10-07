import { seedPreviewCrypto } from "../server/src/previewCryptoSeed.js";
/**
 * Disposable browser-test fixture. This is never imported by the real server.
 * Runs the real app/API, real SQLite, real auth, and real demo seed against an
 * offline price feed. No auth/ledger handlers are mocked or bypassed.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/src/app.js";
import { seedDemoAccounts, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "../server/src/demo.js";
import { applicationFor } from "../server/scripts/fixtures.js";
import { createPriceFixture } from "../server/scripts/price-fixture.js";

const port = Number(process.env.PORT || 8877);
const temp = mkdtempSync(join(tmpdir(), "veyra-e2e-"));
process.env.NODE_ENV = "development";
process.env.CRYPTO_TESTNET_SEND = "1"; // Separate user-signed Sepolia path; never production or Veyra ledger.
process.env.DEMO_SEED = "1";
process.env.TOKEN_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = DEMO_ADMIN_PASSWORD;
process.env.ADMIN_NAME = "E2E Admin";
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_ORIGINS = `http://localhost:${port}`;
process.env.CRYPTO_TRADING_ENABLED = "1";
process.env.SOLANA_RPC_URL = ""; // Wallet tests must never contact a real RPC.
process.env.RECAPTCHA_SITE_KEY = "";
process.env.FIREBASE_PROJECT_ID = "";
process.env.GOOGLE_MAPS_API_KEY = "";
process.env.MAIL_PROVIDER = "off";

const prices = createPriceFixture();
await new Promise<void>(resolve => prices.listen(0, "0.0.0.0", resolve));
const pricePort = (prices.address() as { port: number }).port;
process.env.CRYPTO_PRICES_URL = `http://127.0.0.1:${pricePort}/prices`;
process.env.CRYPTO_OHLC_URL = `http://127.0.0.1:${pricePort}/ohlc/{id}?days={days}`;

const { app, db } = createApp(join(temp, "test.db"));
let ready = false;
const server = createServer((req, res) => {
  // Readiness is outside Express, so the suite cannot race the demo seed.
  if (req.url === "/__e2e/ready") {
    res.statusCode = ready ? 200 : 503;
    res.setHeader("content-type", "application/json");
    return void res.end(JSON.stringify({ ready }));
  }
  app(req, res);
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close(() => {
    prices.close(() => {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    });
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
await new Promise<void>(resolve => server.listen(port, "0.0.0.0", resolve));
try {
  const result = await seedDemoAccounts({ baseUrl: `http://localhost:${port}` });
  if (result.created !== 2 || result.seeded !== 2 || !result.adminOk) {
    throw new Error("Browser-test seed did not create both approved member accounts and an admin.");
  }
  // Also exercise databases written before signup submissions gained a
  // documents array. The console must still review these existing records.
  const legacy = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Legacy Applicant", email: "legacy@veyra.test",
      password: "Legacy-Test-2026!", accountType: "personal", profile: applicationFor("personal", "Legacy Applicant") }),
  });
  if (legacy.status !== 201) throw new Error("Could not create the legacy review fixture.");
  const legacyId = (await legacy.json()).user.id;
  const row = db.prepare("SELECT submission_json FROM kyc_records WHERE user_id = ?").get(legacyId) as { submission_json: string };
  const submission = JSON.parse(row.submission_json);
  delete submission.documents;
  db.prepare("UPDATE kyc_records SET submission_json = ? WHERE user_id = ?").run(JSON.stringify(submission), legacyId);
  if (process.env.E2E_LINKED_ACCOUNTS === "1") {
    const owner = db.prepare("SELECT id FROM users WHERE email='demo.personal@veyra.dev'").get() as {id: string};
    db.prepare("INSERT INTO external_accounts(id,user_id,bank_name,account_name,last4,account_type,status,provider_reference,created_at,updated_at) VALUES('browser-bank',?,'Connected Bank','Everyday checking','7890','Checking','verified','offline-browser-provider',1,1)").run(owner.id);
  }
  await seedPreviewCrypto(db, `http://localhost:${port}`);
  ready = true;
  console.log(`E2E app ready on http://localhost:${port} (disposable database, offline prices)`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
  close();
}
