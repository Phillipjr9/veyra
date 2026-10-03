/**
 * Deterministic seed: the same demo identities the frontend uses, now with
 * real rows in a real database. Idempotent — safe to run repeatedly.
 */
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";
import { setSetting } from "./db.js";
import { logAdminAction } from "./audit.js";
import { ROLE_DEFAULTS, setRolePermissions } from "./rbac.js";

const DAY = 86_400_000;

export function seed(db: DatabaseSync, { force = false }: { force?: boolean } = {}): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0 && !force) return;

  if (force) {
    for (const table of [
      "sessions", "notifications", "audit_log", "disputes", "kyc_records", "cards",
      "transactions", "accounts", "users", "settings", "role_permissions",
    ]) {
      // audit_log is append-only — drop the triggers first to allow reseeding.
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
  const insertAccount = db.prepare(
    `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTxn = db.prepare(
    `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'cleared', ?, ?, ?)`,
  );
  const insertCard = db.prepare(
    `INSERT INTO cards (id, user_id, label, last4, type, limit_cents, spent_cents, frozen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertKyc = db.prepare(
    `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, detail, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const users: Array<{
    id: string; name: string; email: string; phone: string; business: string;
    type: "personal" | "business"; role: string; password: string;
    account?: { number: string; balance: number; pending: number; rewards: number };
    txns?: Array<[string, string, string, number, number]>; // merchant, category, method, cents, daysAgo
    cards?: Array<[string, string, "virtual" | "physical", number, number, boolean]>; // label, last4, type, limit, spent, frozen
    kyc?: ["approved" | "in_review", number, string, string];
  }> = [
    {
      id: "superadmin-master", name: "Chief System Admin", email: "admin@veyra.com", phone: "+1 (800) 555-0199",
      business: "Veyra Financial HQ", type: "business", role: "superadmin", password: "admin123",
    },
    {
      id: "compliance", name: "Mira Osei", email: "compliance@veyra.com", phone: "+1 (555) 204-7781",
      business: "Veyra Financial HQ", type: "business", role: "compliance", password: "veyra123",
    },
    {
      id: "support-desk", name: "Theo Park", email: "support@veyra.com", phone: "+1 (555) 204-7782",
      business: "Veyra Financial HQ", type: "business", role: "support", password: "veyra123",
    },
    {
      id: "demo", name: "Hana Park", email: "demo@veyra.com", phone: "+1 (555) 389-2041",
      business: "Park & Co Studio", type: "business", role: "user", password: "veyra123",
      account: { number: "409281729014", balance: 8_429_042, pending: 217_450, rewards: 8_640 },
      txns: [
        ["Fable Cloud", "Software", "Card", -21_800, 1],
        ["Northstar Ads", "Advertising", "Card", -124_050, 3],
        ["Orbit Mobile", "Utilities", "Card", -9_200, 5],
        ["Harbor Studio", "Operations", "ACH", -148_000, 11],
        ["Mono Labs", "Operations", "ACH", 680_000, 21],
        ["Deskwork Supply", "Equipment", "Card", -41_260, 29],
        ["Card processor payout", "Operations", "ACH", 1_245_000, 45],
      ],
      cards: [
        ["Subscriptions", "2903", "virtual", 400_000, 118_240, false],
        ["Advertising", "7741", "virtual", 1_200_000, 562_050, false],
        ["Metal debit", "5118", "physical", 1_500_000, 41_000, false],
      ],
      kyc: ["approved", 92, "Business registration", "United States"],
    },
    {
      id: "personal-demo", name: "Alex Morgan", email: "personal@veyra.com", phone: "+1 (555) 714-8920",
      business: "", type: "personal", role: "user", password: "veyra123",
      account: { number: "509381726142", balance: 682_465, pending: 32_500, rewards: 2_142 },
      txns: [
        ["Northstar Air", "Travel", "Card", -32_875, 2],
        ["Daily Grind", "Dining", "Card", -4_850, 4],
        ["Payroll · Ellery Studio", "Income", "ACH", 325_000, 6],
        ["Oak Street Properties", "Housing", "ACH", -145_000, 12],
        ["City Electric", "Utilities", "Card", -9_612, 19],
      ],
      cards: [
        ["Everyday debit", "1842", "physical", 500_000, 68_271, false],
        ["Online spending", "6219", "virtual", 150_000, 12_855, false],
        ["Travel", "9086", "virtual", 300_000, 0, true],
      ],
      kyc: ["in_review", 72, "Passport", "United States"],
    },
  ];

  for (const u of users) {
    insertUser.run(u.id, u.name, u.email, u.phone, u.business, u.type, u.role, "Pro", hashPassword(u.password), now - 90 * DAY);
    if (!u.account) continue;
    const info = insertAccount.run(
      u.id, u.account.number, "091408735", "Northfield Bank",
      u.account.balance, u.account.pending, u.account.rewards, now - 90 * DAY, now,
    );
    const accountId = Number(info.lastInsertRowid);
    for (const [merchant, category, method, cents, daysAgo] of u.txns ?? []) {
      insertTxn.run(`txn_${u.id}_${daysAgo}_${Math.abs(cents)}`, accountId, u.id, merchant, category, method, cents,
        `VYR-${u.id.slice(0, 3).toUpperCase()}${Math.abs(cents).toString(36).slice(-5).toUpperCase()}`,
        "", now - daysAgo * DAY);
    }
    for (const [i, [label, last4, type, limit, spent, frozen]] of (u.cards ?? []).entries()) {
      insertCard.run(`card_${u.id}_${i}`, u.id, label, last4, type, limit, spent, frozen ? 1 : 0, now - 60 * DAY);
    }
    if (u.kyc) insertKyc.run(u.id, u.kyc[0], u.kyc[1], u.kyc[2], u.kyc[3], now - 2 * DAY);
  }

  // A seeded open dispute for the risk queue
  db.prepare(
    `INSERT INTO disputes (id, user_id, transaction_id, merchant, amount_cents, reason, detail, status, opened_at, updated_at)
     VALUES ('dsp_seed_1', 'personal-demo', NULL, 'Northstar Air', 32_875, 'Duplicate charge', 'Charged twice for the same booking.', 'submitted', ?, ?)`,
  ).run(now - 2 * DAY, now - 2 * DAY);

  insertNotif.run("notif_seed_1", "demo", "scout", "Scout saved $148.86", "Negotiated an annual rate on your Northstar Ads plan.", 0, now - 2 * 3_600_000);
  insertNotif.run("notif_seed_2", "demo", "invoice", "Invoice #1050 is overdue", "Lumen Retail hasn't paid $1,150.00 yet.", 0, now - 9 * 3_600_000);
  insertNotif.run("notif_seed_3", "personal-demo", "transfer", "Paycheck deposited", "+$3,250.00 is available in checking.", 1, now - 3 * DAY);

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
