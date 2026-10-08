/**
 * Database bootstrap — production only.
 *
 * Bootstraps platform settings, the default role grants and the first Super
 * Admin account from environment variables:
 *
 *   ADMIN_EMAIL=ops@yourco.com
 *   ADMIN_PASSWORD=<at least 8 chars>
 *   ADMIN_NAME=Optional display name
 *
 * Nothing else is ever created here: members sign up through the API and
 * start with a real, empty account.
 */
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";
import { setSetting, generateVeyraId } from "./db.js";
import { logAdminAction } from "./audit.js";
import { ROLE_DEFAULTS, setRolePermissions } from "./rbac.js";

export function seed(db: DatabaseSync, { force = false }: { force?: boolean } = {}): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0 && !force) {
    bootstrapAdmin(db);
    return;
  }

  if (force) {
    for (const table of [
      "password_resets", "sessions", "security_sessions", "notifications", "audit_log", "disputes", "kyc_records", "cards",
      "scheduled_payments", "payees", "savings_pockets", "team_members", "invoices", "perks", "preferences",
      "transactions", "accounts", "users", "settings", "role_permissions",
    ]) {
      db.exec(`DROP TRIGGER IF EXISTS audit_no_update; DROP TRIGGER IF EXISTS audit_no_delete;`);
      db.exec(`DELETE FROM ${table};`);
    }
    db.exec(`CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`);
  }

  setSetting(db, "core_apy", "4.25", "seed");
  setSetting(db, "payment_rails", "operational", "seed");

  // Store the non-default grants explicitly so the matrix reflects any drift.
  for (const role of ["admin", "compliance", "support"] as const) {
    setRolePermissions(db, role, ROLE_DEFAULTS[role]);
  }

  bootstrapAdmin(db);

  logAdminAction(db, {
    adminId: "seed", adminName: "System", action: "system.seed", category: "System",
    target: "platform", summary: "Database initialized (platform settings only).",
  });
}

/** Creates the first Super Admin from ADMIN_EMAIL / ADMIN_PASSWORD env vars. */
export function bootstrapAdmin(db: DatabaseSync): { email: string; created: boolean } | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;
  const existing = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email) as { id: string } | undefined;
  if (existing) {
    // Ensure the configured bootstrap account is always a superadmin.
    db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(existing.id);
    return { email, created: false };
  }
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  const name = process.env.ADMIN_NAME?.trim() || "System Admin";
  db.prepare(
    `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at, veyra_id)
     VALUES (?, ?, ?, '', 'Veyra Financial HQ', 'business', 'superadmin', 'Pro', ?, 'active', ?, ?)`,
  ).run(`admin_${Date.now().toString(36)}`, name, email, hashPassword(password), Date.now(), generateVeyraId(db));
  logAdminAction(db, {
    adminId: "seed", adminName: "System", action: "system.seed", category: "System",
    target: `user:${email}`, summary: `Super Admin bootstrap account created from ADMIN_EMAIL (${email}).`,
  });
  return { email, created: true };
}
