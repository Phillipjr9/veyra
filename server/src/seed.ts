/**
 * Database seeding — production-first.
 *
 * DEFAULT (production): no demo data. The only user created is the Super
 * Admin bootstrap account from environment variables:
 *
 *   ADMIN_EMAIL=ops@yourco.com
 *   ADMIN_PASSWORD=<at least 8 chars>
 *   ADMIN_NAME=Optional display name
 *
 * DEMO MODE (DEMO_SEED=1 or seed(db, { demo: true })): additionally seeds the
 * demo identities (Hana / Alex / compliance / support) with the full demo
 * dataset via seedMemberState() — used for development and the test suite.
 */
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";
import { setSetting } from "./db.js";
import { logAdminAction } from "./audit.js";
import { ROLE_DEFAULTS, setRolePermissions } from "./rbac.js";
import { seedMemberState } from "./state.js";

const DAY = 86_400_000;

export function seed(db: DatabaseSync, { force = false, demo = false }: { force?: boolean; demo?: boolean } = {}): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0 && !force) {
    // Upgrade path: a v1/v2 database (users exist, but no member-state rows).
    if (demo) {
      const prefs = (db.prepare("SELECT COUNT(*) AS n FROM preferences").get() as { n: number }).n;
      if (prefs === 0) backfill(db);
    }
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

  if (demo) seedDemoIdentities(db);

  logAdminAction(db, {
    adminId: "seed", adminName: "System", action: "system.seed", category: "System",
    target: "platform", summary: demo
      ? "Database seeded (demo mode: demo identities + platform settings)."
      : "Database initialized (production mode: platform settings only).",
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
    `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at)
     VALUES (?, ?, ?, '', 'Veyra Financial HQ', 'business', 'superadmin', 'Pro', ?, 'active', ?)`,
  ).run(`admin_${Date.now().toString(36)}`, name, email, hashPassword(password), Date.now());
  logAdminAction(db, {
    adminId: "seed", adminName: "System", action: "system.seed", category: "System",
    target: `user:${email}`, summary: `Super Admin bootstrap account created from ADMIN_EMAIL (${email}).`,
  });
  return { email, created: true };
}

/** Demo identities — only when demo mode is explicitly enabled. */
function seedDemoIdentities(db: DatabaseSync): void {
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
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(u.email)) continue;
    insertUser.run(u.id, u.name, u.email, u.phone, u.business, "business", u.role, "Pro", hashPassword(u.password), now - 90 * DAY);
  }
  if (!db.prepare("SELECT 1 FROM users WHERE email = 'demo@veyra.com'").get()) {
    insertUser.run("demo", "Hana Park", "demo@veyra.com", "+1 (555) 389-2041", "Park & Co Studio", "business", "user", "Pro", hashPassword("veyra123"), now - 90 * DAY);
    seedMemberState(db, "demo", { name: "Hana Park", business: "Park & Co Studio", email: "demo@veyra.com", accountType: "business" });
  }
  if (!db.prepare("SELECT 1 FROM users WHERE email = 'personal@veyra.com'").get()) {
    insertUser.run("personal-demo", "Alex Morgan", "personal@veyra.com", "+1 (555) 714-8920", "", "personal", "user", "Pro", hashPassword("veyra123"), now - 90 * DAY);
    seedMemberState(db, "personal-demo", { name: "Alex Morgan", business: "", email: "personal@veyra.com", accountType: "personal" });
  }
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
