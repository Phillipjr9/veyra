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

const PORT = Number(process.env.PORT ?? 8787);

const { app } = createApp(undefined);

if (process.env.NODE_ENV === "production" && !process.env.TOKEN_SECRET) {
  console.error("Refusing to start: TOKEN_SECRET is required in production.");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Veyra API listening on http://0.0.0.0:${PORT}`);
  console.log("Mode: production (clean database — members sign up through the API)");
  if (!process.env.ADMIN_EMAIL) {
    console.log("No ADMIN_EMAIL set — create the first Super Admin by starting with ADMIN_EMAIL + ADMIN_PASSWORD.");
  }
});
