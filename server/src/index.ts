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
import { resolve } from "node:path";

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

import { createApp } from "./app.js";
import { seedDemoAccounts, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_PASSWORD } from "./demo.js";

const PORT = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === "production";

/**
 * Development defaults, applied only when nothing else is set (a real .env
 * always wins, and production never takes these paths):
 *
 *   - ADMIN_EMAIL/PASSWORD: the pair the login page's one-click Super Admin
 *     button uses, so a fresh dev database still has a console to sign into.
 *   - Demo members are seeded after listen (see below).
 */
if (!isProduction) {
  process.env.ADMIN_EMAIL ??= DEMO_ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD ??= DEMO_ADMIN_PASSWORD;
  process.env.ADMIN_NAME ??= "System Admin";
}

const { app } = createApp(undefined);

if (process.env.NODE_ENV === "production" && !process.env.TOKEN_SECRET) {
  console.error("Refusing to start: TOKEN_SECRET is required in production.");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Veyra API listening on http://0.0.0.0:${PORT}`);

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
    .then(result => {
      console.log(`  ready: ${result.created} created, ${result.seeded} seeded, ${result.skipped} already had data`);
      console.log(`  demo logins: demo.personal@veyra.dev, demo.business@veyra.dev (${DEMO_PASSWORD}), ${result.adminEmail}`);
    })
    .catch(err => {
      console.error(`  demo seeding failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("  Retry with: npm run demo:seed");
    });
});
