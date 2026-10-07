/**
 * Veyra API bootstrap.
 *
 * Environment (also read from a .env file next to package.json):
 *   PORT           — HTTP port (default 8787)
 *   DB_PATH        — SQLite file (default server/veyra.db)
 *   TOKEN_SECRET   — HMAC secret for bearer tokens (REQUIRED in production)
 *   ADMIN_EMAIL    — first Super Admin account email
 *   ADMIN_PASSWORD — first Super Admin password (min 8 chars)
 *   ADMIN_NAME     — optional display name for the bootstrap admin
 *   CORS_ORIGIN    — allow a non-proxied browser origin
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";

// Minimal zero-dependency .env loader (KEY=VALUE lines, # comments).
(function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.replace(/^["']|["']$/g, "");
  }
})();

// These imports are intentionally dynamic. Static ESM imports are evaluated
// before this module's body, which would let security.ts read a development
// fallback before the local .env loader above had populated TOKEN_SECRET.
// Loading configuration first makes `npm run server` and host-provided env
// behave identically, including key rotation and TOTP encryption settings.
const { previewCryptoEnabled } = await import("./previewCrypto.js");
const { seedPreviewCrypto } = await import("./previewCryptoSeed.js");
const { createApp } = await import("./app.js");
const { describeRecaptcha, recaptchaConfig } = await import("./recaptcha.js");
const { describeFederated } = await import("./federated.js");
const { describeWebauthn } = await import("./webauthn.js");
const { describeCrypto } = await import("./assets.js");
const { describePrices } = await import("./prices.js");
const { describeMail } = await import("./mail.js");
const { describeStripe } = await import("./stripe.js");
const { productionRuntimeReport } = await import("./runtime.js");
const { seedDemoAccounts, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_PASSWORD } = await import("./demo.js");

const PORT = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === "production";

/**
 * Development defaults, applied only when nothing else is set (a real .env
 * always wins, and production never takes these paths):
 *
 *   - ADMIN_EMAIL/PASSWORD: a local administrator account for development.
 *   - Account-ledger operations work before external provider integration.
 *   - Development members are seeded after listen (see below).
 */
if (!isProduction) {
  process.env.PREVIEW_LOGIN_SHORTCUTS ??= "1";
  // Honor explicit configuration, including the older switch. Tests that call
  // createApp directly opt in separately; this is only the normal dev entrypoint.
  if (!process.env.ACCOUNT_LEDGER_ENABLED && !process.env.DEMO_PAYMENTS_ENABLED) process.env.ACCOUNT_LEDGER_ENABLED = "1";
  process.env.ADMIN_EMAIL ??= DEMO_ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD ??= DEMO_ADMIN_PASSWORD;
  process.env.ADMIN_NAME ??= "System Admin";
}

// Preview balances must never share the ordinary or production database.
const previewDb = resolve(process.cwd(), "server/preview-crypto.db");
if (isProduction && (process.env.PREVIEW_CRYPTO_DATA === "1" || basename(process.env.DB_PATH ?? "") === "preview-crypto.db")) {
  throw new Error("Preview crypto data/database cannot be used in production.");
}
if (previewCryptoEnabled()) {
  if (process.env.DB_PATH && resolve(process.env.DB_PATH) !== previewDb) throw new Error("Preview crypto requires the isolated server/preview-crypto.db database.");
  process.env.DB_PATH = previewDb;
}

const runtimeReport = productionRuntimeReport();
for (const warning of runtimeReport.warnings) console.warn(`Warning: ${warning}`);
if (runtimeReport.errors.length) {
  for (const error of runtimeReport.errors) console.error(`Refusing to start: ${error}`);
  process.exit(1);
}

const { app, db } = createApp(process.env.DB_PATH);

if (process.env.NODE_ENV === "production" && !process.env.TOKEN_SECRET) {
  console.error("Refusing to start: TOKEN_SECRET is required in production.");
  process.exit(1);
}

/**
 * Unlike TOKEN_SECRET this is a warning, not a refusal to boot: reCAPTCHA is
 * defence in depth over the anonymous routes, and a deployment that has not
 * provisioned keys yet is still correct — just more exposed to scripted
 * sign-ups. The per-address budgets in security.ts stay in force either way.
 */
if (isProduction && !recaptchaConfig().enabled) {
  console.warn("Warning: reCAPTCHA is not configured — the public auth routes are protected by rate limits alone.");
  console.warn("  Set RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY (classic v3), or + RECAPTCHA_PROJECT_ID/RECAPTCHA_API_KEY (Enterprise).");
}

const server = createServer(app);
server.on("error", (error: NodeJS.ErrnoException) => {
  // Never announce readiness or seed against another process that already owns the requested port.
  console.error(`Veyra API could not bind port ${PORT}: ${error.message}`);
  process.exitCode = 1;
});
server.listen(PORT, "0.0.0.0");
server.on("listening", () => {
  console.log(`Veyra API listening on http://0.0.0.0:${PORT}`);
  console.log(describeRecaptcha());
  console.log(describeFederated());
  console.log(describeWebauthn());
  console.log(describeCrypto());
  console.log(describePrices());
  console.log(describeMail());
  console.log(describeStripe());

  if (isProduction) {
    console.log("Mode: production (members sign up through the API)");
    if (!process.env.ADMIN_EMAIL) {
      console.log("No ADMIN_EMAIL set — create the first Super Admin by starting with ADMIN_EMAIL + ADMIN_PASSWORD.");
    }
    return;

  }

  if (process.env.DEMO_SEED === "0") {
    console.log("Mode: development (demo seeding disabled by DEMO_SEED=0)");
    return;
  }

  // The dev database is disposable (server/veyra.db is gitignored), so a fresh
  // one is seeded on boot: the login page's one-click accounts always exist.
  console.log("Mode: development — seeding demo accounts…");
  void seedDemoAccounts({ baseUrl: `http://127.0.0.1:${PORT}`, log: line => console.log(`  ${line}`) })
    .then(async result => {
      await seedPreviewCrypto(db, `http://127.0.0.1:${PORT}`, line => console.log(`  ${line}`));
      console.log(`  ready: ${result.created} created, ${result.seeded} seeded, ${result.skipped} already had data`);
      console.log(`  demo logins: demo.personal@veyra.dev, demo.business@veyra.dev (${DEMO_PASSWORD}), ${result.adminEmail}`);
    })
    .catch(err => {
      console.error(`  demo seeding failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("  Retry with: npm run demo:seed");
    });
});
