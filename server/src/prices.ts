import { previewCryptoEnabled, previewMarketRows, previewCandles } from "./previewCrypto.js";
import { ASSETS } from "../../shared/catalog.js";
import { marketFeedUrl, candleFeedUrl, fetchMarketFeed, describeMarketFeed } from "./marketFeed.js";
/**
 * Market prices for digital assets.
 *
 * One job: turn an asset code into a price in USD cents per whole unit, as a
 * bigint. Everything downstream is integer arithmetic (see money.ts), so the
 * float the upstream API hands us is converted exactly once, here, at the edge.
 *
 * Three rules shape this module, and all three exist because a price feed is
 * the least trustworthy thing in a banking system:
 *
 *   1. A missing price is never zero. Zero is a number, and a number will
 *      happily be multiplied by a balance to produce a confident, wrong
 *      valuation. Absent prices are `null` and the UI must say so.
 *
 *   2. A stale price is labelled, not hidden. Every quote carries the moment
 *      it was fetched, so a page can show "as of 14:32" rather than implying
 *      it is live.
 *
 *   3. Trading refuses to execute on a stale or missing quote. Displaying an
 *      old number is a cosmetic problem; pricing a trade off one spends real
 *      money at the wrong rate.
 *
 * Environment:
 *   CRYPTO_PRICES_URL   Override the upstream (tests, or an egress proxy).
 *   COINGECKO_API_KEY  Server-only key, sent in the matching authentication header.
 *   COINGECKO_API_PLAN demo (default) or pro; selects both market/chart origins.
 *   CRYPTO_PRICES_TTL_MS    Cache lifetime. Default 300s.
 *   CRYPTO_PRICE_MAX_AGE_MS Oldest quote a trade may execute against. Default 1.2x cache TTL.
 *   CRYPTO_PRICES_TIMEOUT_MS Request timeout. Default 4s.
 */

/** CoinGecko ids for the supported asset registry. */
export const UPSTREAM_IDS: Record<string, string> = Object.fromEntries(ASSETS.map(a => [a.code, a.id]));

// One call does everything. /coins/markets returns price, 1h/24h/7d change,
// market cap, volume and a 7-day sparkline for up to 250 coins — so the
// markets page and the holdings valuations share a single upstream request
// rather than each paying for their own.
export type Quote = {
  /** USD cents for one whole unit. bigint so a $100k BTC price stays exact. */
  cents: bigint;
  fetchedAt: number;
};

/** One row of the market table. Money is integer cents; percentages are floats. */
export type MarketRow = {
  id: string;
  code: string;
  name: string;
  /** Upstream logo URL. The browser can reach it even when the server cannot. */
  image: string | null;
  rank: number | null;
  priceCents: number;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCapCents: number | null;
  volumeCents: number | null;
  /** Downsampled 7-day closes in cents — enough to draw a sparkline, not 168 points per row. */
  sparkline: number[] | null;
};

type Cache = {
  quotes: Map<string, Quote>;
  markets: MarketRow[];
  fetchedAt: number;
  inFlight: Promise<void> | null;
};
let cache: Cache = { quotes: new Map(), markets: [], fetchedAt: 0, inFlight: null };

// 5 minutes. At 60s this endpoint alone bills 43,200 calls/month against a
// 10,000 free-tier cap — the quota is gone in a week. See README.
const ttlMs = () => Number(process.env.CRYPTO_PRICES_TTL_MS) || 300_000;
/**
 * Oldest quote a trade may execute against.
 *
 * Derived from the cache TTL rather than fixed, because the two must not
 * drift apart. A cache that serves 300s-old quotes against a 120s trading
 * limit refuses every trade in the last 60% of each cycle — the feed looks
 * healthy, prices render fine, and buying just fails. The 1.2x grace covers
 * the gap between a quote expiring and the refetch landing.
 */
const maxAgeMs = () => Number(process.env.CRYPTO_PRICE_MAX_AGE_MS) || Math.round(ttlMs() * 1.2);
export const quoteValidUntil = (at: number) => at + maxAgeMs();
export const quoteIsFresh = (at: number | null) => !!at && Date.now() - at <= maxAgeMs();
const timeoutMs = () => Number(process.env.CRYPTO_PRICES_TIMEOUT_MS) || 4_000;

/** Test helper: drops every cached quote and forces the next read to refetch. */
export function resetPrices(): void {
  cache = { quotes: new Map(), markets: [], fetchedAt: 0, inFlight: null };
  candleCache.clear();
}

/**
 * Converts an upstream USD float to exact cents.
 *
 * `String(value)` gives the shortest round-tripping decimal, so this never
 * re-enters float arithmetic — the same reasoning as money.ts.
 */
function toCents(usd: unknown): bigint | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
  const text = String(usd);
  if (text.includes("e") || text.includes("E")) return null; // absurd magnitude; refuse rather than guess
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole + fraction.slice(0, 2).padEnd(2, "0"));
  return cents > 0n ? cents : null;
}

/** Picks `count` evenly spaced samples so a sparkline costs 32 numbers, not 168. */
function downsample(values: number[], count = 32): number[] {
  if (values.length <= count) return values;
  const step = (values.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => values[Math.round(i * step)]);
}

/** Percentages stay floats — they are display-only and never touch a balance. */
const pct = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;

async function refresh(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const body = await (previewCryptoEnabled() ? previewMarketRows() :
      fetchMarketFeed(marketFeedUrl(), controller.signal));
    if (!Array.isArray(body)) throw new Error("upstream did not return a market array");

    const fetchedAt = Date.now();
    const byId = new Map<string, bigint>();
    const markets: MarketRow[] = [];

    for (const row of body) {
      if (!row || typeof row !== "object") continue;
      const id = typeof row.id === "string" ? row.id : null;
      const code = typeof row.symbol === "string" ? row.symbol.toUpperCase() : null;
      const cents = toCents(row.current_price);
      // A row with no usable price is dropped rather than carried as a zero.
      if (!id || !code || cents === null) continue;

      // A reused ticker must never borrow a supported asset's identity/price.
      if ((UPSTREAM_IDS[code] && UPSTREAM_IDS[code] !== id) || markets.some(m => m.code === code)) continue;
      byId.set(id, cents);
      const spark = Array.isArray(row.sparkline_in_7d?.price)
        ? downsample(row.sparkline_in_7d.price.map((v: unknown) => toCents(v)).filter((v: bigint | null): v is bigint => v !== null).map(Number))
        : null;

      markets.push({
        id,
        code,
        name: typeof row.name === "string" ? row.name : code,
        image: typeof row.image === "string" ? row.image : null,
        rank: typeof row.market_cap_rank === "number" ? row.market_cap_rank : null,
        priceCents: Number(cents),
        change1h: pct(row.price_change_percentage_1h_in_currency),
        change24h: pct(row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h),
        change7d: pct(row.price_change_percentage_7d_in_currency),
        marketCapCents: toCents(row.market_cap) === null ? null : Number(toCents(row.market_cap)),
        volumeCents: toCents(row.total_volume) === null ? null : Number(toCents(row.total_volume)),
        sparkline: spark && spark.length > 1 ? spark : null,
      });
    }

    // Quotes for the tradeable registry are derived from the same payload, so
    // valuing a holding and rendering the market table cost one call between
    // them rather than one each.
    const quotes = new Map<string, Quote>();
    for (const [code, id] of Object.entries(UPSTREAM_IDS)) {
      const cents = byId.get(id);
      if (cents !== undefined) quotes.set(code, { cents, fetchedAt });
    }
    // An empty response is a failed response. Keeping the previous quotes is
    // strictly better than replacing them with nothing.
    if (quotes.size === 0 && markets.length === 0) throw new Error("upstream carried no usable prices");
    cache = { quotes, markets, fetchedAt, inFlight: null };
  } catch (err) {
    // Deliberately non-fatal: the last good quotes stay in place and keep
    // their original timestamp, so they age visibly instead of vanishing.
    console.warn(`[prices] refresh failed — ${(err as Error).message}`);
    cache.inFlight = null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches if the cache is cold or stale; concurrent callers share one request. */
let cacheSource = "";
function syncPriceSource() {
  // Include chart overrides and auth changes so neither cache crosses sources.
  // This identity stays in server memory and is never logged or returned.
  const source = previewCryptoEnabled() ? "preview" : JSON.stringify([
    process.env.CRYPTO_PRICES_URL, process.env.CRYPTO_OHLC_URL,
    process.env.COINGECKO_API_PLAN, process.env.COINGECKO_API_KEY,
  ]);
  if (source !== cacheSource) { resetPrices(); cacheSource = source; }
}
export async function loadPrices(): Promise<Map<string, Quote>> {
  syncPriceSource();
  const fresh = cache.fetchedAt > 0 && Date.now() - cache.fetchedAt < ttlMs();
  if (fresh) return cache.quotes;
  if (!cache.inFlight) cache.inFlight = refresh();
  await cache.inFlight;
  return cache.quotes;
}

/**
 * Every market row we know about, newest fetch first.
 *
 * Returns the cached rows with the moment they were fetched, so the page can
 * label its own staleness instead of implying the table is live.
 */
export async function loadMarkets(): Promise<{ markets: MarketRow[]; fetchedAt: number }> {
  await loadPrices();
  return { markets: cache.markets, fetchedAt: cache.fetchedAt };
}

/** The current quote for one asset, or null when none is known. */
export async function quoteFor(code: string): Promise<Quote | null> {
  return (await loadPrices()).get(code) ?? null;
}

/**
 * The quote a trade may execute against.
 *
 * Returns null for a quote older than CRYPTO_PRICE_MAX_AGE_MS. Showing a stale
 * balance is cosmetic; filling an order at a stale price moves real money at
 * the wrong rate, so this fails closed where display fails open.
 */
export async function tradableQuote(code: string): Promise<Quote | null> {
  const quote = await quoteFor(code);
  if (!quote) return null;
  return Date.now() - quote.fetchedAt <= maxAgeMs() ? quote : null;
}

export function describePrices(): string {
  if (previewCryptoEnabled()) return "Asset prices: TEST DATA · 24 sample markets and charts · NOT LIVE";
  return `Asset prices: ${describeMarketFeed()} · cache ${ttlMs() / 1000}s · trades refuse quotes older than ${maxAgeMs() / 1000}s`;
}

/* ---------- OHLC candles ---------- */

/**
 * Candlestick history.
 *
 * Kept deliberately separate from the spot cache above. A spot price is one
 * small batched call for every asset at once; candles are one call per asset
 * per range, which is the expensive shape. Each (asset, range) pair therefore
 * gets its own entry with a TTL matched to its candle width — refetching
 * four-day candles every minute buys nothing but quota burn.
 *
 * Budget, against the 10,000 call/month free tier:
 *   spot at 5min  = 8,640/month, leaving ~1,360 for everything else.
 * Candles are fetched only when someone actually opens a chart, and a warm
 * cache serves every other viewer, but a busy product will still need the
 * paid plan. README carries the arithmetic.
 */
export type Candle = {
  /** Period start, epoch ms. */
  t: number;
  /** Open/high/low/close in USD cents. Integers — never floats. */
  o: number; h: number; l: number; c: number;
};

/** Supported ranges, with the upstream window and how long a result stays fresh. */
const RANGES = {
  "1d":  { days: 1,   ttlMs: 5 * 60_000 },
  "7d":  { days: 7,   ttlMs: 30 * 60_000 },
  "30d": { days: 30,  ttlMs: 60 * 60_000 },
  "90d": { days: 90,  ttlMs: 6 * 60 * 60_000 },
} as const;

export type CandleRange = keyof typeof RANGES;
export const CANDLE_RANGES = Object.keys(RANGES) as CandleRange[];
export const isCandleRange = (value: unknown): value is CandleRange =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(RANGES, value);

type CandleEntry = { candles: Candle[]; fetchedAt: number; inFlight: Promise<void> | null };
const candleCache = new Map<string, CandleEntry>();

/** Dollars to integer cents without re-entering float math. Mirrors toCents above. */
function centsFrom(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole + fraction.slice(0, 2).padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

async function refreshCandles(code: string, range: CandleRange, key: string): Promise<void> {
  const id = UPSTREAM_IDS[code];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    if (!id) throw new Error(`no upstream id for ${code}`);
    const body = await (previewCryptoEnabled() ? previewCandles(code, RANGES[range].days) :
      fetchMarketFeed(candleFeedUrl(id, RANGES[range].days), controller.signal));
    if (!Array.isArray(body)) throw new Error("upstream did not return an array");

    const candles: Candle[] = [];
    for (const row of body) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [t, o, h, l, c] = row;
      const cents = [o, h, l, c].map(centsFrom);
      // One malformed row is dropped; it must not poison the series with a
      // zero that would render as a candle crashing to the x-axis.
      if (typeof t !== "number" || cents.some(v => v === null)) continue;
      candles.push({ t, o: cents[0]!, h: cents[1]!, l: cents[2]!, c: cents[3]! });
    }
    if (candles.length === 0) throw new Error("upstream carried no usable candles");

    candles.sort((a, b) => a.t - b.t);
    candleCache.set(key, { candles, fetchedAt: Date.now(), inFlight: null });
  } catch (err) {
    console.warn(`[prices] candles ${code}/${range} failed — ${(err as Error).message}`);
    const existing = candleCache.get(key);
    if (existing) existing.inFlight = null; else candleCache.delete(key);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Candles for one asset and range, or null when none can be had.
 *
 * Null rather than an empty array on purpose: an empty series renders as a
 * flat line, and a flat line says "this asset did not move", which is a lie
 * when the truth is "we do not know". The caller must show the difference.
 */
export async function loadCandles(code: string, range: CandleRange): Promise<Candle[] | null> {
  syncPriceSource();
  const key = `${code}:${range}`;
  const entry = candleCache.get(key);
  if (entry && Date.now() - entry.fetchedAt < RANGES[range].ttlMs) return entry.candles;

  if (entry?.inFlight) await entry.inFlight;
  else {
    const task = refreshCandles(code, range, key);
    if (entry) entry.inFlight = task;
    await task;
  }
  return candleCache.get(key)?.candles ?? null;
}
