/** Server-only CoinGecko transport. Never expose keys through URLs or client config. */
const ORIGINS = {
  demo: "https://api.coingecko.com",
  pro: "https://pro-api.coingecko.com",
} as const;

function plan(): keyof typeof ORIGINS {
  const value = (process.env.COINGECKO_API_PLAN ?? "").trim() || "demo";
  if (value !== "demo" && value !== "pro") throw new Error("COINGECKO_API_PLAN must be demo or pro");
  return value;
}

export function marketFeedUrl(): string {
  return (process.env.CRYPTO_PRICES_URL ?? "").trim() ||
    `${ORIGINS[plan()]}/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
}

export function candleFeedUrl(id: string, days: number): string {
  return ((process.env.CRYPTO_OHLC_URL ?? "").trim() ||
    `${ORIGINS[plan()]}/api/v3/coins/{id}/ohlc?vs_currency=usd&days={days}`)
    .replace("{id}", encodeURIComponent(id)).replace("{days}", String(days));
}

function requestConfig(rawUrl: string): { url: URL; headers: Record<string, string> } {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid market feed URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid market feed protocol");
  // Refuse credentials in URLs: even a failed request can leak these into logs.
  if (url.username || url.password || [...url.searchParams.keys()].some(name =>
    /^(x[-_]cg[-_](demo|pro)[-_]api[-_]key|api[-_]?key)$/i.test(name))) {
    throw new Error("Market feed credentials must use server-side COINGECKO_API_KEY, not a URL");
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const key = (process.env.COINGECKO_API_KEY ?? "").trim();
  const selectedPlan = plan();
  const isCoinGeckoHost = Object.values(ORIGINS).some(origin => new URL(origin).hostname === url.hostname);
  if (isCoinGeckoHost) {
    if (url.origin !== ORIGINS[selectedPlan] || !url.pathname.startsWith("/api/v3/")) {
      throw new Error("CoinGecko URL must match the configured plan and use its HTTPS API origin");
    }
    if (key) headers[`x-cg-${selectedPlan}-api-key`] = key;
  }
  // Custom feed/proxy overrides remain usable, but NEVER receive the CoinGecko key.
  return { url, headers };
}

export async function fetchMarketFeed(rawUrl: string, signal: AbortSignal): Promise<unknown> {
  const { url, headers } = requestConfig(rawUrl);
  let response: Response;
  try {
    // Custom authentication headers must never follow a redirect to another host.
    response = await fetch(url, { signal, headers, redirect: "error" });
  } catch {
    throw new Error(signal.aborted ? "Market feed request timed out" : "Market feed request failed");
  }
  if (!response.ok) throw new Error(`Market feed returned HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error("Market feed returned invalid JSON"); }
}

/** Safe for logs: no key, URL query, response body or raw transport errors. */
export function describeMarketFeed(): string {
  try {
    const { url, headers } = requestConfig(marketFeedUrl());
    const authenticated = !!(headers["x-cg-demo-api-key"] || headers["x-cg-pro-api-key"]);
    return `${url.host} · ${authenticated ? "authenticated" : "unauthenticated"}`;
  } catch {
    return "invalid server configuration";
  }
}
