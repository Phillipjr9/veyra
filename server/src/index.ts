/**
 * Server bootstrap. Run with: npm run server   (tsx server/src/index.ts)
 *
 * Environment:
 *   PORT          — listen port            (default 8787)
 *   DB_PATH       — SQLite file            (default server/veyra.db)
 *   TOKEN_SECRET  — HMAC secret for tokens (REQUIRED in production)
 *   CORS_ORIGIN   — allowed origin         (default *)
 */
import { createApp } from "./app.js";
import { IS_DEV_SECRET } from "./security.js";

const PORT = parseInt(process.env.PORT ?? "8787", 10);

if (process.env.NODE_ENV === "production" && IS_DEV_SECRET) {
  console.error("FATAL: TOKEN_SECRET must be set in production. Refusing to start.");
  process.exit(1);
}

const { app } = createApp();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Veyra API listening on http://0.0.0.0:${PORT}`);
  if (IS_DEV_SECRET) console.warn("WARNING: using the development token secret — set TOKEN_SECRET before deploying.");
});
