/**
 * Digital asset holdings, as the browser sees them.
 *
 * Every quantity crossing this boundary is a string. A holding of 0.1 ETH is
 * 100000000000000000 wei, which is larger than Number.MAX_SAFE_INTEGER, so
 * parsing it into a JS number would quietly corrupt it. The server has already
 * formatted the display values; the client's job is to render them, not to do
 * arithmetic on them.
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "./api";

export type Holding = {
  asset: string;
  name: string;
  kind: "crypto" | "stablecoin";
  decimals: number;
  /** Integer base units as a decimal string. Not safe as a number. */
  units: string;
  totalQuantity?: string;
  withdrawalNetwork?: string | null;
  /** Human quantity, trailing zeros trimmed — "0.25", not "0.250000000000000000". */
  quantity: string;
  /** USD price of one whole unit, or null when no quote is available. */
  priceUsd: string | null;
  /** USD worth of the position, or null when unpriced. Never 0 as a stand-in. */
  valueUsd: string | null;
  quotedAt: number | null;
  updatedAt: number | null;
};

export type HoldingsResponse = {
  previewData?: boolean;
  quoteStatus?: "current" | "stale" | "unavailable";
  holdings: Holding[];
  totalUsd: string;
  /** True when a held asset could not be priced, so totalUsd understates reality. */
  partial: boolean;
  tradingEnabled: boolean;
  disclosure: string;
};

export type TradeResult = {
  ok: true;
  asset: string;
  side: "buy" | "sell";
  quantity: string;
  amountUsd: string;
  priceUsd: string;
};

export async function fetchHoldings(): Promise<HoldingsResponse> {
  const data = await apiGet<HoldingsResponse>("/api/me/holdings");
  // Generated server fixtures are never shown as current market prices in the
  // customer UI. Preserve owned quantities, but mark all valuations unavailable.
  if (!data.previewData) return data;
  return { ...data, disclosure: "Current market quotes are unavailable. Digital assets are not deposits or FDIC insured.", quoteStatus: "unavailable", partial: true, tradingEnabled: false, totalUsd: "0.00",
    holdings: data.holdings.map(holding => ({ ...holding, priceUsd: null, valueUsd: null, quotedAt: null })) };
}

/**
 * Buys are priced in dollars, sells in units of the asset — the same asymmetry
 * the server enforces, so a member can sell a position to exactly zero.
 */
export const tradeHolding = (asset: string, side: "buy" | "sell", amount: string, expectedPriceUsd?: string | null) =>
  apiPost<TradeResult>("/api/me/holdings/trade", { asset, side, amount, ...(expectedPriceUsd ? { expectedPriceUsd } : {}) });

/** Formats a quote timestamp as "as of 14:32", or null when there is nothing to date. */
export function quoteAge(quotedAt: number | null): string | null {
  if (!quotedAt) return null;
  return `as of ${new Date(quotedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export { assetIcon } from "../../shared/assetIcons";

/**
 * Shared holdings state for any surface that needs it.
 *
 * A failed refresh keeps the last good snapshot rather than blanking the UI —
 * the same reasoning as the server's price cache. `loading` is only true for
 * the first load, so a background refresh never flashes a placeholder over
 * numbers the member is already reading.
 */
export function useHoldings() {
  const [data, setData] = useState<HoldingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await fetchHoldings());
    } catch {
      // Keep whatever was last known; the caller decides how to degrade.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, reload };
}

/* ---------- price history ---------- */

/** Open/high/low/close in USD cents, with the period start in epoch ms. */
export type Candle = { t: number; o: number; h: number; l: number; c: number };

export const CANDLE_RANGES = ["1d", "7d", "30d", "90d"] as const;
export type CandleRange = (typeof CANDLE_RANGES)[number];

export const RANGE_LABEL: Record<CandleRange, string> = {
  "1d": "24H", "7d": "7D", "30d": "30D", "90d": "90D",
};

export async function fetchCandles(asset: string, range: CandleRange) {
  const data = await apiGet<{ previewData?: boolean; asset: string; range: CandleRange; candles: Candle[] }>(`/api/me/holdings/${encodeURIComponent(asset)}/candles?range=${range}`);
  if (data.previewData) throw new Error("Current market history is unavailable.");
  return data;
}

/**
 * Candles for one asset and range.
 *
 * `candles` stays null — never an empty array — when history cannot be had,
 * because an empty series draws a flat line and a flat line claims the asset
 * did not move. The caller renders the difference.
 */
export function useCandles(asset: string | null, range: CandleRange) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!asset) { setCandles(null); setFailed(false); return; }
    let live = true;
    setLoading(true); setFailed(false);
    fetchCandles(asset, range)
      .then(res => { if (live) { setCandles(res.candles); setFailed(false); } })
      .catch(() => { if (live) { setCandles(null); setFailed(true); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [asset, range]);

  return { candles, loading, failed };
}

/* ---------- markets ---------- */

export type MarketRow = {
  code: string;
  name: string;
  /** Upstream logo URL. May be null; the UI falls back to a 3D mark or a monogram. */
  image: string | null;
  rank: number | null;
  priceUsd: string;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCapUsd: string | null;
  volumeUsd: string | null;
  /** Downsampled 7-day closes in cents. */
  sparkline: number[] | null;
  /** Only assets in the local registry can be bought or sold. */
  tradeable: boolean;
  decimals: number | null;
  kind: "crypto" | "stablecoin" | null;
  units: string;
  quantity: string | null;
  valueUsd: string | null;
};

export type MarketsResponse = {
  previewData?: boolean;
  quoteStatus?: "current" | "stale" | "unavailable";
  markets: MarketRow[];
  quotedAt: number | null;
  tradingEnabled: boolean;
  disclosure: string;
};

export async function fetchMarkets(): Promise<MarketsResponse> {
  const data = await apiGet<MarketsResponse>("/api/me/markets");
  return data.previewData ? { ...data, disclosure: "Current market quotes are unavailable. Digital assets are not deposits or FDIC insured.", markets: [], quotedAt: null, quoteStatus: "unavailable", tradingEnabled: false } : data;
}

export function useMarkets() {
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try { setData(await fetchMarkets()); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, failed, reload };
}

/** Compact money for table cells: $2.03T, $48.2B, $1.4M. */
export function compactUsd(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const [div, suffix] = n >= 1e12 ? [1e12, "T"] : n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  return `$${(n / div).toFixed(suffix ? 2 : 0)}${suffix}`;
}

/** Price with a sensible number of decimals: $102,400.91 but $0.3612. */
export function marketPrice(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const digits = n >= 1000 ? 2 : n >= 1 ? 2 : 4;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
