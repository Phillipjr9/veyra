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
 *   CRYPTO_PRICES_TTL_MS    Cache lifetime. Default 60s.
 *   CRYPTO_PRICE_MAX_AGE_MS Oldest quote a trade may execute against. Default 120s.
 *   CRYPTO_PRICES_TIMEOUT_MS Request timeout. Default 4s.
 */

/** CoinGecko ids for the seeded registry — free, keyless, widely mirrored. */
const UPSTREAM_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDC: "usd-coin",
};

const DEFAULT_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,usd-coin&vs_currencies=usd";

export type Quote = {
  /** USD cents for one whole unit. bigint so a $100k BTC price stays exact. */
  cents: bigint;
  fetchedAt: number;
};

type Cache = { quotes: Map<string, Quote>; fetchedAt: number; inFlight: Promise<void> | null };
let cache: Cache = { quotes: new Map(), fetchedAt: 0, inFlight: null };

const ttlMs = () => Number(process.env.CRYPTO_PRICES_TTL_MS) || 60_000;
const maxAgeMs = () => Number(process.env.CRYPTO_PRICE_MAX_AGE_MS) || 120_000;
const timeoutMs = () => Number(process.env.CRYPTO_PRICES_TIMEOUT_MS) || 4_000;
const upstreamUrl = () => (process.env.CRYPTO_PRICES_URL ?? "").trim() || DEFAULT_URL;

/** Test helper: drops every cached quote and forces the next read to refetch. */
export function resetPrices(): void {
  cache = { quotes: new Map(), fetchedAt: 0, inFlight: null };
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

async function refresh(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(upstreamUrl(), { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`upstream returned ${res.status}`);
    const body = (await res.json()) as Record<string, { usd?: unknown }>;

    const fetchedAt = Date.now();
    const quotes = new Map<string, Quote>();
    for (const [code, id] of Object.entries(UPSTREAM_IDS)) {
      const cents = toCents(body?.[id]?.usd);
      if (cents !== null) quotes.set(code, { cents, fetchedAt });
    }
    // An empty response is a failed response. Keeping the previous quotes is
    // strictly better than replacing them with nothing.
    if (quotes.size === 0) throw new Error("upstream carried no usable prices");
    cache = { quotes, fetchedAt, inFlight: null };
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
export async function loadPrices(): Promise<Map<string, Quote>> {
  const fresh = cache.fetchedAt > 0 && Date.now() - cache.fetchedAt < ttlMs();
  if (fresh) return cache.quotes;
  if (!cache.inFlight) cache.inFlight = refresh();
  await cache.inFlight;
  return cache.quotes;
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
  const url = upstreamUrl();
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  return `Asset prices: ${host} · cache ${ttlMs() / 1000}s · trades refuse quotes older than ${maxAgeMs() / 1000}s`;
}
