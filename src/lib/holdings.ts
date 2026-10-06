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
  reservedUnits?: string;
  reservedQuantity?: string;
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

export const fetchHoldings = () => apiGet<HoldingsResponse>("/api/me/holdings");

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

/**
 * 3D rendered mark per asset, keyed by code.
 *
 * These are stylised interpretations rendered for Veyra, not official brand
 * assets pulled from each project's press kit. Bitcoin's mark is effectively
 * public domain and Ethereum's is published for free use, but Solana and USDC
 * are trademarks of their respective owners — swap in the official artwork
 * before this is used commercially.
 */
const ASSET_ICONS: Record<string, string> = {
  BTC: "/images/icon-btc-3d.webp",
  ETH: "/images/icon-eth-3d.webp",
  SOL: "/images/icon-sol-3d.webp",
  USDC: "/images/icon-usdc-3d.webp",
};

/**
 * The mark for an asset, falling back to the generic coin.
 *
 * The registry lives in the database, so a migration can add an asset before
 * anyone draws its logo. Falling back keeps that card rendering instead of
 * leaving a broken image where a balance should be.
 */
export const assetIcon = (code: string): string =>
  ASSET_ICONS[code.toUpperCase()] ?? "/images/icon-crypto-3d.webp";

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

export const fetchCandles = (asset: string, range: CandleRange) =>
  apiGet<{ asset: string; range: CandleRange; candles: Candle[] }>(
    `/api/me/holdings/${encodeURIComponent(asset)}/candles?range=${range}`,
  );

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
  quoteStatus?: "current" | "stale" | "unavailable";
  markets: MarketRow[];
  quotedAt: number | null;
  tradingEnabled: boolean;
  disclosure: string;
};

export const fetchMarkets = () => apiGet<MarketsResponse>("/api/me/markets");

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
