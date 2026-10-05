/**
 * Digital asset registry and the switch that governs trading.
 *
 * ---------------------------------------------------------------------------
 * REGULATORY NOTE — read before enabling this in production.
 *
 * Holding digital assets on a member's behalf and letting them buy and sell is
 * "virtual currency business activity" under 23 NYCRR 200.2(q): both *storing,
 * holding, or maintaining custody or control of virtual currency on behalf of
 * others* and *buying and selling virtual currency as a customer business*.
 * In New York that requires a BitLicense or a limited-purpose trust charter.
 *
 * Veyra's own README says it is a financial technology product, not a bank, so
 * the NY Banking Law charter exemption does not apply. NYDFS issued
 * cease-and-desist orders with six-figure penalties to unlicensed platforms
 * serving New Yorkers in early 2026.
 *
 * That is why CRYPTO_TRADING_ENABLED defaults ON in development and OFF in
 * production. It is an interlock, not an opinion: the product is built and
 * demonstrable, and turning it on for real customers is a deliberate act taken
 * with counsel, not something that ships by forgetting to look.
 *
 * Nothing here is FDIC insured, and the UI must never imply otherwise.
 * ---------------------------------------------------------------------------
 */
import type { DatabaseSync } from "node:sqlite";

export type Asset = {
  code: string;
  name: string;
  /** Decimal places in one whole unit. BTC 8, ETH 18, USDC 6, SOL 9. */
  decimals: number;
  kind: "crypto" | "stablecoin";
  sortOrder: number;
};

type AssetRow = { code: string; name: string; decimals: number; kind: string; sort_order: number };

const shape = (row: AssetRow): Asset => ({
  code: row.code, name: row.name, decimals: row.decimals,
  kind: row.kind as Asset["kind"], sortOrder: row.sort_order,
});

/**
 * The registry is read from SQLite rather than hardcoded so that adding an
 * asset is a migration — the decimals travel with the data that depends on
 * them, and a holding can never reference a scale nobody recorded.
 */
export function listAssets(db: DatabaseSync): Asset[] {
  return (db.prepare(
    "SELECT code, name, decimals, kind, sort_order FROM crypto_assets ORDER BY sort_order",
  ).all() as unknown as AssetRow[]).map(shape);
}

export function assetByCode(db: DatabaseSync, code: string): Asset | null {
  const row = db.prepare(
    "SELECT code, name, decimals, kind, sort_order FROM crypto_assets WHERE code = ?",
  ).get(String(code).toUpperCase()) as unknown as AssetRow | undefined;
  return row ? shape(row) : null;
}

/**
 * Whether members may buy and sell.
 *
 * Viewing holdings is always allowed — reading a balance is not a licensable
 * activity. Only movement is gated.
 */
export function tradingEnabled(): boolean {
  const raw = (process.env.CRYPTO_TRADING_ENABLED ?? "").trim();
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function describeCrypto(): string {
  return tradingEnabled()
    ? "Digital assets: trading ON — licensable activity (23 NYCRR 200.2(q)); not FDIC insured"
    : "Digital assets: view only (set CRYPTO_TRADING_ENABLED=1 to allow buying and selling)";
}
