/**
 * Offline price source for local development.
 *
 * Serves the same JSON shape as the CoinGecko endpoint the server calls in
 * production, so nothing in server/src/prices.ts needs a development branch —
 * point CRYPTO_PRICES_URL at this and the real fetch, cache, timeout and
 * staleness logic all still run.
 *
 * Useful when the machine has no outbound network, when CoinGecko is rate
 * limiting, or when you want prices that visibly move without waiting on the
 * market. Prices drift by a small random walk so the UI can be seen updating.
 *
 *   node scripts/dev-prices.mjs                # listens on :8799
 *   PORT=9100 node scripts/dev-prices.mjs
 *
 * Then set in .env:  CRYPTO_PRICES_URL=http://127.0.0.1:8799/prices
 *
 * This is a development convenience, never a production fallback: a bank must
 * show a real quote or none at all, never an invented one.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT) || 8799;

/** Rough spot levels; the exact numbers don't matter, the movement does. */
const prices = { bitcoin: 102_480.25, ethereum: 3_412.66, solana: 214.08, "usd-coin": 1.0 };

/** A stablecoin that wanders is a broken stablecoin, so USDC is pinned. */
const drift = (id, value) => {
  if (id === "usd-coin") return 1.0;
  const next = value * (1 + (Math.random() - 0.5) * 0.004);
  return Math.round(next * 100) / 100;
};

setInterval(() => {
  for (const id of Object.keys(prices)) prices[id] = drift(id, prices[id]);
}, 5_000).unref?.();

createServer((req, res) => {
  for (const id of Object.keys(prices)) prices[id] = drift(id, prices[id]);
  const body = Object.fromEntries(Object.entries(prices).map(([id, usd]) => [id, { usd }]));
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} — BTC ${prices.bitcoin}`);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Dev price feed on http://127.0.0.1:${PORT}`);
  console.log(`Set CRYPTO_PRICES_URL=http://127.0.0.1:${PORT}/prices in .env`);
});
