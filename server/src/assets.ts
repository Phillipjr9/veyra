/**
 * Digital asset registry and internal account-trading switch.
 *
 * This release does not establish custody, asset backing or external execution.
 * Production defaults off. Enabling the ledger is not activation of a live
 * financial service: identified providers, reconciliation, security controls
 * and qualified jurisdiction-specific legal review are required first.
 * Digital assets are not FDIC insured; the UI must never imply otherwise.
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
 * Whether internal account trading is enabled. Read-only holdings remain
 * available to authenticated users; mutations have additional authorization.
 */
export function tradingEnabled(): boolean {
  const raw = (process.env.CRYPTO_TRADING_ENABLED ?? "").trim();
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function describeCrypto(): string {
  const account = tradingEnabled()
    ? "Digital assets: account trading ON"
    : "Digital assets: view only (CRYPTO_TRADING_ENABLED controls internal account trading)";
  const sepolia = process.env.NODE_ENV !== "production" && process.env.CRYPTO_TESTNET_SEND === "1"
    ? "; direct-wallet Sepolia test sends ON (no Veyra balance changes)"
    : "";
  return `${account}${sepolia}; custody and mainnet execution not connected; not FDIC insured`;
}
