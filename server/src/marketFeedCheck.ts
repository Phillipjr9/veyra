import { fetchMarketFeed, marketFeedUrl, candleFeedUrl, MarketFeedError } from "./marketFeed.js";

export type FeedCheck = {
  endpoint: "markets" | "bitcoin-chart";
  ok: boolean;
  records?: number;
  reason?: string;
  httpStatus?: number;
  networkCode?: string;
};

/** Read-only readiness probe: no database, no fixture fallback, no secrets in results. */
export async function checkMarketFeed(): Promise<FeedCheck[]> {
  return Promise.all((["markets", "bitcoin-chart"] as const).map(async endpoint => {
    try {
      const url = endpoint === "markets" ? marketFeedUrl() : candleFeedUrl("bitcoin", 7);
      const body = await fetchMarketFeed(url, AbortSignal.timeout(8000));
      const valid = Array.isArray(body) && body.length > 0 && (endpoint === "markets"
        ? body.some(row => row?.id === "bitcoin" && row.symbol === "btc" && typeof row.current_price === "number" && Number.isFinite(row.current_price) && row.current_price > 0)
        : body.every(row => Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every(value => typeof value === "number" && Number.isFinite(value) && value > 0)));
      if (!valid) return { endpoint, ok: false, reason: "Response does not contain usable market data" };
      return { endpoint, ok: true, records: body.length };
    } catch (error) {
      return {
        endpoint, ok: false,
        reason: error instanceof MarketFeedError ? error.message : "Invalid feed configuration",
        ...(error instanceof MarketFeedError && error.httpStatus ? { httpStatus: error.httpStatus } : {}),
        ...(error instanceof MarketFeedError && error.networkCode ? { networkCode: error.networkCode } : {}),
      };
    }
  }));
}
