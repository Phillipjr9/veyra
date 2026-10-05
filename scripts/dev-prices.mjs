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
 *   /prices              the /coins/markets response (array of market rows)
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

/**
 * A plausible top-of-market list. The first four are Veyra's tradeable
 * registry; the rest exist so the markets table looks like a market rather
 * than a four-row stub. Caps and volumes are order-of-magnitude realistic.
 */
const COINS = [
  ["bitcoin", "BTC", "Bitcoin", 102_480.25, 2.03e12, 48.2e9],
  ["ethereum", "ETH", "Ethereum", 3_412.66, 411e9, 24.8e9],
  ["tether", "USDT", "Tether", 1.0, 142e9, 71.4e9],
  ["ripple", "XRP", "XRP", 2.38, 137e9, 6.1e9],
  ["binancecoin", "BNB", "BNB", 648.12, 94e9, 2.3e9],
  ["solana", "SOL", "Solana", 214.08, 103e9, 5.7e9],
  ["usd-coin", "USDC", "USD Coin", 1.0, 43e9, 9.2e9],
  ["cardano", "ADA", "Cardano", 0.94, 33e9, 1.4e9],
  ["dogecoin", "DOGE", "Dogecoin", 0.36, 53e9, 3.2e9],
  ["tron", "TRX", "TRON", 0.26, 22e9, 0.9e9],
  ["chainlink", "LINK", "Chainlink", 22.41, 14e9, 1.1e9],
  ["avalanche-2", "AVAX", "Avalanche", 38.72, 15e9, 0.8e9],
  ["stellar", "XLM", "Stellar", 0.41, 12e9, 0.5e9],
  ["polkadot", "DOT", "Polkadot", 7.18, 10e9, 0.4e9],
  ["litecoin", "LTC", "Litecoin", 104.55, 7.9e9, 0.6e9],
  ["uniswap", "UNI", "Uniswap", 13.27, 7.9e9, 0.3e9],
  ["aave", "AAVE", "Aave", 331.80, 4.9e9, 0.4e9],
  ["cosmos", "ATOM", "Cosmos Hub", 6.44, 2.5e9, 0.2e9],
  ["filecoin", "FIL", "Filecoin", 5.12, 3.1e9, 0.2e9],
  ["arbitrum", "ARB", "Arbitrum", 0.82, 3.5e9, 0.3e9],
];

const STABLE = new Set(["usd-coin", "tether"]);

/** Rough spot levels; the exact numbers don't matter, the movement does. */
const prices = Object.fromEntries(COINS.map(([id, , , usd]) => [id, usd]));

/** A stablecoin that wanders is a broken stablecoin, so those are pinned. */
const drift = (id, value) => {
  if (STABLE.has(id)) return 1.0;
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
    const wobble = (seeded(Math.floor(t / stepMs) + id.length) - 0.5) * (STABLE.has(id) ? 0.0015 : 0.05);
    const open = STABLE.has(id) ? 1 : close * (1 + wobble);
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

  // /coins/markets shape. image is null on purpose: the sandbox has no egress,
  // and a dead URL would exercise the client's fallback worse than an honest
  // absence does.
  json(COINS.map(([id, symbol, name, , cap, vol], i) => {
    const price = prices[id];
    const spark = candles(id, 7).map(row => row[4]);
    const ch = (n) => STABLE.has(id) ? Number(((seeded(i + n) - 0.5) * 0.08).toFixed(2))
                                     : Number(((seeded(i + n) - 0.45) * 14).toFixed(2));
    return {
      id, symbol: symbol.toLowerCase(), name, image: null,
      current_price: price,
      market_cap: Math.round(cap * (price / COINS[i][3])),
      total_volume: Math.round(vol),
      market_cap_rank: i + 1,
      price_change_percentage_1h_in_currency: ch(1) / 6,
      price_change_percentage_24h_in_currency: ch(2),
      price_change_percentage_7d_in_currency: ch(3) * 1.8,
      sparkline_in_7d: { price: spark },
    };
  }));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Dev price feed on http://127.0.0.1:${PORT}`);
  console.log(`  CRYPTO_PRICES_URL=http://127.0.0.1:${PORT}/prices`);
  console.log(`  CRYPTO_OHLC_URL=http://127.0.0.1:${PORT}/ohlc/{id}?days={days}`);
});
