import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchMarketFeed, marketFeedUrl, candleFeedUrl, describeMarketFeed } from "../src/marketFeed.js";
import { loadMarkets, loadCandles, resetPrices, tradableQuote, describePrices } from "../src/prices.js";

// Artificial credentials only. No requests to CoinGecko and no real secrets.
const KEY = "synthetic-key-for-transport-tests";
const envNames = ["COINGECKO_API_KEY", "COINGECKO_API_PLAN", "CRYPTO_PRICES_URL", "CRYPTO_OHLC_URL",
  "CRYPTO_PRICES_TTL_MS", "CRYPTO_PRICE_MAX_AGE_MS", "PREVIEW_CRYPTO_DATA"];
const savedEnv = new Map(envNames.map(name => [name, process.env[name]]));
const realFetch = globalThis.fetch;
const realWarn = console.warn;
const realNow = Date.now;
const warnings: string[] = [];
type Seen = { url: URL; headers: Headers; redirect: "error" | "follow" | "manual" | undefined };
const seen: Seen[] = [];
let status = 200;
let mode: "normal" | "network" | "invalid-json" = "normal";
let checks = 0;
function check(label: string, value: unknown) { assert.ok(value, label); console.log(`✓ ${label}`); checks++; }
function configure(values: Record<string, string> = {}) {
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, { PREVIEW_CRYPTO_DATA: "0" }, values);
  status = 200; mode = "normal"; seen.length = 0;
  resetPrices();
}
const signal = () => new AbortController().signal;
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  seen.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
  if (mode === "network") throw new Error(`Network detail that must stay private: ${KEY}`);
  if (mode === "invalid-json") return new Response(`Invalid response with ${KEY}`, { status });
  const body = status !== 200 ? { error: `Provider response must stay private: ${KEY}` } :
    url.pathname.includes("/ohlc") ? [[1700000000000, 100, 110, 90, 105]] :
      [{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 50000 }];
  return Response.json(body, { status });
};

try {
  configure();
  check("no-key configuration preserves unauthenticated prices", (await loadMarkets()).markets[0]?.priceCents === 5000000 && !seen[0].headers.has("x-cg-demo-api-key"));
  check("default origin and full market endpoint are retained", seen[0].url.origin === "https://api.coingecko.com" && seen[0].url.pathname === "/api/v3/coins/markets" && seen[0].url.searchParams.get("per_page") === "250");

  configure({ COINGECKO_API_KEY: `  ${KEY}  ` });
  const markets = await loadMarkets();
  const candles = await loadCandles("BTC", "7d");
  check("free-key authentication covers both market prices and candles", markets.markets.length === 1 && candles?.[0].c === 10500 && seen.length === 2 && seen.every(r => r.headers.get("x-cg-demo-api-key") === KEY && !r.headers.has("x-cg-pro-api-key")));
  check("keys never enter URLs or returned market/chart data", seen.every(r => !r.url.href.includes(KEY)) && !JSON.stringify({ markets, candles }).includes(KEY));
  check("all requests reject redirects", seen.every(r => r.redirect === "error"));
  check("diagnostics show authentication, not the key", describePrices().includes("authenticated") && !describePrices().includes(KEY));
  await loadMarkets(); await loadCandles("BTC", "7d");
  check("authenticated results retain market/chart caching", seen.length === 2);

  process.env.COINGECKO_API_PLAN = "pro";
  await loadMarkets(); await loadCandles("BTC", "7d");
  check("plan change invalidates both caches and switches to Pro origin/header", seen.length === 4 && seen.slice(2).every(r => r.url.origin === "https://pro-api.coingecko.com" && r.headers.get("x-cg-pro-api-key") === KEY && !r.headers.has("x-cg-demo-api-key")));
  process.env.COINGECKO_API_KEY = "synthetic-replacement";
  await loadMarkets(); await loadCandles("BTC", "7d");
  check("key rotation invalidates both cached responses", seen.length === 6 && seen.slice(4).every(r => r.headers.get("x-cg-pro-api-key") === "synthetic-replacement"));

  configure({ COINGECKO_API_KEY: KEY, CRYPTO_PRICES_URL: "http://127.0.0.1:9876/markets", CRYPTO_OHLC_URL: "http://127.0.0.1:9876/coins/{id}/ohlc?days={days}" });
  await loadMarkets(); await loadCandles("BTC", "1d");
  check("custom feed overrides never receive CoinGecko credentials", seen.length === 2 && seen.every(r => !r.headers.has("x-cg-demo-api-key") && !r.headers.has("x-cg-pro-api-key")));
  check("chart overrides retain asset/window substitutions", seen[1].url.pathname === "/coins/bitcoin/ohlc" && seen[1].url.searchParams.get("days") === "1");
  await fetchMarketFeed("https://api.coingecko.com.untrusted.example/api/v3/coins/markets", signal());
  check("lookalike hosts receive no key", !seen[2].headers.has("x-cg-demo-api-key"));

  configure({ COINGECKO_API_KEY: KEY });
  for (const [label, url] of [
    ["query-string API key", `https://api.coingecko.com/api/v3/coins/markets?x_cg_demo_api_key=${KEY}`],
    ["case-insensitive query key", `https://api.coingecko.com/api/v3/coins/markets?X-CG-PRO-API-KEY=${KEY}`],
    ["URL password", `https://member:${KEY}@api.coingecko.com/api/v3/coins/markets`],
    ["HTTP CoinGecko origin", "http://api.coingecko.com/api/v3/coins/markets"],
    ["nonstandard CoinGecko port", "https://api.coingecko.com:8443/api/v3/coins/markets"],
    ["mismatched plan origin", "https://pro-api.coingecko.com/api/v3/coins/markets"],
    ["non-API CoinGecko path", "https://api.coingecko.com/other"],
    ["unsupported protocol", "file:///private/key"],
    ["invalid URL", `malformed-${KEY}`],
  ]) {
    await assert.rejects(fetchMarketFeed(url, signal()), error => error instanceof Error && !error.message.includes(KEY));
    check(`rejects ${label} before any network request`, seen.length === 0);
  }
  process.env.CRYPTO_PRICES_URL = `malformed-${KEY}`;
  check("invalid configuration diagnostics never echo the raw URL", describeMarketFeed() === "invalid server configuration" && !describePrices().includes(KEY));

  configure({ COINGECKO_API_KEY: KEY, COINGECKO_API_PLAN: "invalid" });
  check("invalid plan returns unavailable instead of fetching with the wrong credentials", (await loadMarkets()).markets.length === 0 && seen.length === 0);
  assert.throws(() => candleFeedUrl("bitcoin", 7), /must be demo or pro/);

  for (const code of [401, 403, 429, 500]) {
    configure({ COINGECKO_API_KEY: KEY }); status = code;
    check(`HTTP ${code} never becomes a zero or fabricated price`, (await loadMarkets()).markets.length === 0 && await tradableQuote("BTC") === null && await loadCandles("BTC", "7d") === null);
  }
  for (const failure of ["network", "invalid-json"] as const) {
    configure({ COINGECKO_API_KEY: KEY }); mode = failure;
    check(`${failure} failures leave prices unavailable`, (await loadMarkets()).fetchedAt === 0 && await loadCandles("BTC", "7d") === null);
  }

  configure({ COINGECKO_API_KEY: KEY, CRYPTO_PRICES_TTL_MS: "100", CRYPTO_PRICE_MAX_AGE_MS: "120" });
  let now = realNow(); Date.now = () => now;
  const good = await loadMarkets();
  const goodCandles = await loadCandles("BTC", "1d");
  now += 300001; status = 429;
  const stale = await loadMarkets();
  check("provider failure preserves last-known prices and their original timestamp", stale.fetchedAt === good.fetchedAt && stale.markets[0].priceCents === good.markets[0].priceCents);
  check("stale quotes still cannot authorize account trading", await tradableQuote("BTC") === null);
  check("failed chart refresh retains last-known history", JSON.stringify(await loadCandles("BTC", "1d")) === JSON.stringify(goodCandles));
  Date.now = realNow;
  check("failure logs never contain credentials or provider response bodies", warnings.length > 0 && warnings.every(line => !line.includes(KEY) && !line.includes("Provider response")));

  // Exercise native fetch redirect handling against a disposable local server.
  globalThis.fetch = realFetch;
  configure({ COINGECKO_API_KEY: KEY });
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/target" }); res.end(); }
    else { redirected = true; res.end("[]"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    await assert.rejects(fetchMarketFeed(`http://127.0.0.1:${address.port}/redirect`, signal()), /Market feed request failed/);
    check("native fetch refuses redirects without contacting the target", !redirected);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetchMarketFeed(marketFeedUrl(), controller.signal), /Market feed request timed out/);
    checks++; console.log("✓ aborted request returns a sanitized timeout error");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log(`\n${checks} market-feed checks passed.`);
} finally {
  globalThis.fetch = realFetch; console.warn = realWarn; Date.now = realNow;
  for (const [name, value] of savedEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  resetPrices();
}
