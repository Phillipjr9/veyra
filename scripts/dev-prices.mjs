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
 * Serves two shapes:
 *   /prices              the /simple/price response
 *   /ohlc/<id>?days=N    the /coins/{id}/ohlc response (candle arrays)
 *
 *   node scripts/dev-prices.mjs                # listens on :8799
 *   PORT=9100 node scripts/dev-prices.mjs
 *
 * Then set in .env:
 *   CRYPTO_PRICES_URL=http://127.0.0.1:8799/prices
 *   CRYPTO_OHLC_URL=http://127.0.0.1:8799/ohlc/{id}?days={days}
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

/**
 * Deterministic pseudo-random walk so a given coin and day always produce the
 * same candle. A chart that reshuffles itself on every poll makes it
 * impossible to tell a rendering bug from new data.
 */
const seeded = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** Builds OHLC rows matching CoinGecko's granularity rules for a day window. */
function candles(id, days) {
  const stepMs = days <= 2 ? 30 * 60_000 : days <= 30 ? 4 * 3600_000 : 4 * 86400_000;
  const count = Math.max(8, Math.min(240, Math.floor((days * 86400_000) / stepMs)));
  const now = Date.now();
  const base = prices[id] ?? 100;
  const rows = [];
  // Walk backwards from today's price so the last candle meets the live quote.
  let close = base;
  for (let i = 0; i < count; i++) {
    const t = now - i * stepMs;
    const wobble = (seeded(Math.floor(t / stepMs) + id.length) - 0.5) * (id === "usd-coin" ? 0.0015 : 0.05);
    const open = id === "usd-coin" ? 1 : close * (1 + wobble);
    const high = Math.max(open, close) * (1 + Math.abs(wobble) * 0.45);
    const low = Math.min(open, close) * (1 - Math.abs(wobble) * 0.45);
    const r = (v) => Math.round(v * 100) / 100;
    rows.push([t, r(open), r(high), r(low), r(close)]);
    close = open;
  }
  return rows.reverse();
}

createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (body) => {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const ohlc = url.pathname.match(/^\/ohlc\/([^/]+)$/);
  if (ohlc) {
    const id = decodeURIComponent(ohlc[1]);
    const days = Number(url.searchParams.get("days")) || 7;
    if (!prices[id]) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"unknown id"}'); }
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} — ${id} ${days}d candles`);
    return json(candles(id, days));
  }

  for (const id of Object.keys(prices)) prices[id] = drift(id, prices[id]);
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url} — BTC ${prices.bitcoin}`);
  json(Object.fromEntries(Object.entries(prices).map(([id, usd]) => [id, { usd }])));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Dev price feed on http://127.0.0.1:${PORT}`);
  console.log(`  CRYPTO_PRICES_URL=http://127.0.0.1:${PORT}/prices`);
  console.log(`  CRYPTO_OHLC_URL=http://127.0.0.1:${PORT}/ohlc/{id}?days={days}`);
});
