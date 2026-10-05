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
export const tradeHolding = (asset: string, side: "buy" | "sell", amount: string) =>
  apiPost<TradeResult>("/api/me/holdings/trade", { asset, side, amount });

/** Formats a quote timestamp as "as of 14:32", or null when there is nothing to date. */
export function quoteAge(quotedAt: number | null): string | null {
  if (!quotedAt) return null;
  return `as of ${new Date(quotedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

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
