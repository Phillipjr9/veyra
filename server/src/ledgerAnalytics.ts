import type { DatabaseSync } from "node:sqlite";
import { analyticsStart, buildLedgerAnalytics, type LedgerRow } from "../../shared/ledgerAnalytics.js";

/** Financial aggregates must not depend on the 400-row activity-feed cap.
 * Read only the fields needed for analytics over the supported horizon. The
 * response contains bounded bucket summaries, never the full underlying ledger.
 * Member callers MUST pass the authenticated account owner's id; undefined is
 * reserved for the permission-protected platform snapshot.
 */
export function readLedgerAnalytics(db: DatabaseSync, ownerId: string | undefined, now = Date.now()) {
  const query = `SELECT amount_cents, created_at, status, category, method FROM transactions
    WHERE created_at >= ? AND created_at <= ? ${ownerId === undefined ? "" : "AND user_id = ?"}`;
  const params = ownerId === undefined ? [analyticsStart(now), now] : [analyticsStart(now), now, ownerId];
  const rows = db.prepare(query).all(...params).map(row => ({
    amount: Number(row.amount_cents) / 100, date: Number(row.created_at),
    status: String(row.status), category: String(row.category ?? "Other"), method: String(row.method ?? ""),
  } satisfies LedgerRow));
  return buildLedgerAnalytics(rows, now);
}
