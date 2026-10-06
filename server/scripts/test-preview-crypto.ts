import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createApp } from "../src/app.js";
import { seedDemoAccounts, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_PASSWORD } from "../src/demo.js";
import { seedPreviewCrypto } from "../src/previewCryptoSeed.js";
import { previewCryptoEnabled, previewMarketRows } from "../src/previewCrypto.js";
import { loadPrices, loadMarkets, loadCandles, resetPrices } from "../src/prices.js";

process.env.NODE_ENV = "development";
process.env.PREVIEW_CRYPTO_DATA = "1";
process.env.ACCOUNT_LEDGER_ENABLED = "1";
process.env.CRYPTO_TRADING_ENABLED = "1";
process.env.ADMIN_EMAIL = DEMO_ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = DEMO_ADMIN_PASSWORD;
process.env.MAIL_PROVIDER = "off";
let checks = 0;
function check(label: string, value: unknown) { assert.ok(value, label); checks++; console.log(`✓ ${label}`); }
resetPrices();
check("all 24 catalog assets have explicit sample quotes", (await loadPrices()).size === 24);
check("sample markets include charts and statistics", (await loadMarkets()).markets.every(row => (row.sparkline?.length ?? 0) > 1 && row.volumeCents !== null));
for (const code of ["BTC", "ETH", "SOL", "USDC"]) check(`${code} has usable sample candles`, (await loadCandles(code, "7d"))?.length === 64);
process.env.CRYPTO_PRICES_TTL_MS = "1";
const before = (await loadMarkets()).fetchedAt;
await new Promise(resolve => setTimeout(resolve, 10));
check("sample prices refresh after cache expiry rather than getting stuck", (await loadMarkets()).fetchedAt > before);
delete process.env.CRYPTO_PRICES_TTL_MS;
process.env.NODE_ENV = "production";
check("production disables sample data even when requested", !previewCryptoEnabled());
assert.throws(() => previewMarketRows()); checks++;
for (const extra of [{ PREVIEW_CRYPTO_DATA: "1", DB_PATH: "" }, { PREVIEW_CRYPTO_DATA: "0", DB_PATH: "server/preview-crypto.db" }]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/index.ts"], { env: { ...process.env, ...extra, NODE_ENV: "production" }, timeout: 10000, encoding: "utf8" });
  check("production bootstrap refuses preview prices/database", result.status !== 0 && result.stderr.includes("cannot be used in production"));
}
process.env.NODE_ENV = "development";
resetPrices();
const dir = mkdtempSync(join(tmpdir(), "veyra-preview-crypto-"));
const { app, db } = createApp(join(dir, "test.db"));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  await seedDemoAccounts({ baseUrl: url });
  const snapshots = () => JSON.stringify({
    holdings: db.prepare("SELECT * FROM holdings ORDER BY user_id,asset").all(),
    accounts: db.prepare("SELECT balance_cents FROM accounts ORDER BY user_id").all(),
    orders: db.prepare("SELECT id,result_json FROM crypto_orders ORDER BY id").all(),
  });
  await seedPreviewCrypto(db, url);
  check("both fixture owners receive five holdings", db.prepare("SELECT COUNT(*) AS n FROM holdings WHERE units!='0'").get()?.n === 10);
  check("seeded buys are real completed account orders", db.prepare("SELECT COUNT(*) AS n FROM crypto_orders WHERE result_json IS NOT NULL").get()?.n === 10);
  const first = snapshots();
  await seedPreviewCrypto(db, url);
  check("restarting seed does not credit again or reset holdings", first === snapshots());
  const login = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "demo.personal@veyra.dev", password: DEMO_PASSWORD }) });
  const session = await login.json() as { token: string };
  const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
  const read = async <T>(path: string) => { const r = await fetch(url + path, { headers }); assert.equal(r.status, 200); return r.json() as Promise<T>; };
  type Holdings = { previewData: boolean; totalUsd: string; holdings: { asset: string; quantity: string }[] };
  const holdings = await read<Holdings>("/api/me/holdings");
  check("personal crypto value is $3,000 with sample-data metadata", holdings.previewData && holdings.totalUsd === "3000.00");
  const markets = await read<{ previewData: boolean; markets: unknown[]; disclosure: string }>("/api/me/markets");
  check("markets endpoint marks all 24 rows as sample data", markets.previewData && markets.markets.length === 24 && markets.disclosure.includes("not live"));
  const candles = await read<{ previewData: boolean; candles: unknown[] }>("/api/me/holdings/BTC/candles?range=7d");
  check("candle endpoint labels generated history", candles.previewData && candles.candles.length === 64);
  const sell = await fetch(`${url}/api/me/crypto/quote`, { method: "POST", headers, body: JSON.stringify({ action: "sell", fromAsset: "USDC", toAsset: "USD", amount: "10" }) });
  assert.equal(sell.status, 201);
  const quote = await sell.json() as { quote: { id: string } };
  assert.equal((await fetch(`${url}/api/me/crypto/confirm`, { method: "POST", headers, body: JSON.stringify({ quoteId: quote.quote.id }) })).status, 200);
  const changed = snapshots(); await seedPreviewCrypto(db, url);
  check("user trades survive seed replay without topping balances back up", changed === snapshots());
  check("sold USDC remains 490 units", (await read<Holdings>("/api/me/holdings")).holdings.find((h: { asset: string }) => h.asset === "USDC")?.quantity === "490");
  const pending = await fetch(`${url}/api/me/crypto/quote`, { method: "POST", headers, body: JSON.stringify({ action: "buy", fromAsset: "USD", toAsset: "USDC", amount: "10" }) });
  const pendingBody = await pending.json() as { quote: { id: string; previewData: boolean } };
  check("reviewed quotes retain their test-price provenance", pendingBody.quote.previewData);
  const beforeSourceSwitch = snapshots();
  process.env.PREVIEW_CRYPTO_DATA = "0";
  const blocked = await fetch(`${url}/api/me/crypto/confirm`, { method: "POST", headers, body: JSON.stringify({ quoteId: pendingBody.quote.id }) });
  check("test quotes cannot execute after preview mode is disabled", blocked.status === 400 && beforeSourceSwitch === snapshots());
  await seedPreviewCrypto(db, url);
  check("disabled preview seed cannot mutate accounts", beforeSourceSwitch === snapshots());
  console.log(`\n${checks} preview crypto checks passed.`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close(); rmSync(dir, { recursive: true, force: true });
}
