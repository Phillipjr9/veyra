/**
 * Audit writer — the only code path that inserts into audit_log.
 * The table itself rejects UPDATE/DELETE via DB triggers (see db.ts).
 */
import type { DatabaseSync } from "node:sqlite";

export type AuditCategory = "Financial" | "KYC" | "Risk" | "Access" | "System" | "Comms";

export type AuditInput = {
  adminId: string;
  adminName: string;
  action: string;
  category: AuditCategory;
  target: string;
  summary: string;
  before?: string;
  after?: string;
};

export function logAdminAction(db: DatabaseSync, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (at, admin_id, admin_name, action, category, target, summary, before_value, after_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(), input.adminId, input.adminName, input.action, input.category,
    input.target, input.summary, input.before ?? null, input.after ?? null,
  );
}
