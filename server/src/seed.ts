/**
 * Deterministic seed: the same demo identities the frontend uses, now with
 * real rows in a real database. Idempotent — safe to run repeatedly.
 *
 * Demo members (demo / personal-demo) get the FULL demo dataset via
 * seedMemberState() — identical cards, transactions, invoices, team, pockets,
 * payees, scheduled bills, perks and sessions to the standalone frontend
 * demo, so running on the API looks exactly the same.
 */
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";
import { setSetting } from "./db.js";
import { logAdminAction } from "./audit.js";
import { ROLE_DEFAULTS, setRolePermissions } from "./rbac.js";
import { seedMemberState } from "./state.js";

const DAY = 86_400_000;

export function seed(db: DatabaseSync, { force = false }: { force?: boolean } = {}): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0 && !force) {
    // Upgrade path: a v1 database (users exist, but no member-state rows).
    // Backfill the demo members so /api/me/state serves the full dataset.
    const prefs = (db.prepare("SELECT COUNT(*) AS n FROM preferences").get() as { n: number }).n;
    if (prefs === 0) backfill(db);
    return;
  }

  if (force) {
    for (const table of [
      "sessions", "security_sessions", "notifications", "audit_log", "disputes", "kyc_records", "cards",
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

  const now = Date.now();
  const insertUser = db.prepare(
    `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  );

  const staff: Array<{ id: string; name: string; email: string; phone: string; business: string; role: string; password: string }> = [
    {
      id: "superadmin-master", name: "Chief System Admin", email: "admin@veyra.com", phone: "+1 (800) 555-0199",
      business: "Veyra Financial HQ", role: "superadmin", password: "admin123",
    },
    {
      id: "compliance", name: "Mira Osei", email: "compliance@veyra.com", phone: "+1 (555) 204-7781",
      business: "Veyra Financial HQ", role: "compliance", password: "veyra123",
    },
    {
      id: "support-desk", name: "Theo Park", email: "support@veyra.com", phone: "+1 (555) 204-7782",
      business: "Veyra Financial HQ", role: "support", password: "veyra123",
    },
  ];
  for (const u of staff) {
    insertUser.run(u.id, u.name, u.email, u.phone, u.business, "business", u.role, "Pro", hashPassword(u.password), now - 90 * DAY);
  }

  insertUser.run("demo", "Hana Park", "demo@veyra.com", "+1 (555) 389-2041", "Park & Co Studio", "business", "user", "Pro", hashPassword("veyra123"), now - 90 * DAY);
  insertUser.run("personal-demo", "Alex Morgan", "personal@veyra.com", "+1 (555) 714-8920", "", "personal", "user", "Pro", hashPassword("veyra123"), now - 90 * DAY);

  seedMemberState(db, "demo", { name: "Hana Park", business: "Park & Co Studio", email: "demo@veyra.com", accountType: "business" });
  seedMemberState(db, "personal-demo", { name: "Alex Morgan", business: "", email: "personal@veyra.com", accountType: "personal" });

  setSetting(db, "core_apy", "4.25", "seed");
  setSetting(db, "payment_rails", "operational", "seed");

  // Store the non-default grants explicitly so the matrix reflects any drift.
  for (const role of ["admin", "compliance", "support"] as const) {
    setRolePermissions(db, role, ROLE_DEFAULTS[role]);
  }

  logAdminAction(db, {
    adminId: "seed", adminName: "System", action: "system.seed", category: "System",
    target: "platform", summary: "Database seeded with demo identities and platform settings.",
  });
}

/** v1 → v2 upgrade: recreate member state for the demo identities. */
function backfill(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, name, business, email, account_type FROM users WHERE id IN ('demo', 'personal-demo')").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    seedMemberState(db, String(row.id), {
      name: String(row.name), business: String(row.business ?? ""), email: String(row.email),
      accountType: row.account_type === "personal" ? "personal" : "business",
    });
  }
}
