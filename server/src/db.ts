/**
 * SQLite database layer for the Veyra backend.
 *
 * Uses Node's built-in `node:sqlite` (zero native dependencies). Money is
 * stored as integer cents everywhere — no floating point drift, ever.
 *
 * Migrations are versioned in the `schema_migrations` table; v1 creates the
 * full banking schema. The audit_log table is made append-only at the
 * DATABASE level with triggers, so even a bug or SQL injection cannot rewrite
 * history.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DB_PATH = resolve(process.env.DB_PATH ?? "server/veyra.db");

export function openDb(path = DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(r => r.version),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, Date.now());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

type Migration = { version: number; sql: string };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
-- Users: the single authentication/identity table (mirrors the frontend User model)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT NOT NULL DEFAULT '',
  business      TEXT NOT NULL DEFAULT '',
  account_type  TEXT NOT NULL CHECK (account_type IN ('personal','business')),
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','support','compliance','admin','superadmin')),
  plan          TEXT NOT NULL DEFAULT 'Pro' CHECK (plan IN ('Starter','Pro')),
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email COLLATE NOCASE);

-- Bank accounts (one checking account per user in v1)
CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  account_number  TEXT NOT NULL UNIQUE,
  routing_number  TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  balance_cents   INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  pending_cents   INTEGER NOT NULL DEFAULT 0,
  rewards_cents   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

-- Ledger: every movement of money, immutable by convention (insert-only)
CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  merchant     TEXT NOT NULL,
  category     TEXT NOT NULL,
  method       TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared','pending','failed')),
  reference    TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  performed_by TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_txns_user_date ON transactions(user_id, created_at DESC);
CREATE INDEX idx_txns_status ON transactions(status);
CREATE INDEX idx_txns_merchant ON transactions(merchant);

CREATE TABLE cards (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  label        TEXT NOT NULL,
  last4        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('virtual','physical')),
  limit_cents  INTEGER NOT NULL DEFAULT 0,
  spent_cents  INTEGER NOT NULL DEFAULT 0,
  frozen       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_cards_user ON cards(user_id);

CREATE TABLE kyc_records (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','requested','in_review','approved','needs_attention')),
  completeness    INTEGER NOT NULL DEFAULT 0,
  document_type   TEXT NOT NULL DEFAULT '',
  country         TEXT NOT NULL DEFAULT '',
  requested_by    TEXT,
  requested_at    INTEGER,
  request_reason  TEXT,
  submission_json TEXT,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_kyc_status ON kyc_records(status);

CREATE TABLE disputes (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  transaction_id TEXT,
  merchant       TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewing','resolved','denied')),
  opened_at      INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_user ON disputes(user_id);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifs_user ON notifications(user_id, created_at DESC);

-- Append-only audit trail. The triggers below make UPDATE/DELETE physically
-- impossible — integrity is enforced by the database engine, not app code.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  admin_id     TEXT NOT NULL,
  admin_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  category     TEXT NOT NULL,
  target       TEXT NOT NULL,
  summary      TEXT NOT NULL,
  before_value TEXT,
  after_value  TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at DESC);
CREATE INDEX idx_audit_admin ON audit_log(admin_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- RBAC overrides per role (defaults live in code; superadmin is hardwired to all)
CREATE TABLE role_permissions (
  role             TEXT PRIMARY KEY CHECK (role IN ('support','compliance','admin','superadmin')),
  permissions_json TEXT NOT NULL
);

-- Key/value system settings (APY, payment rails, …)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- Sessions enable token revocation (logout / forced sign-out)
CREATE TABLE sessions (
  token_id   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
`,
  },
];

/* ---------- shared helpers ---------- */

export const now = () => Date.now();
export const rid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Runs fn inside an IMMEDIATE transaction (write lock) — financial ops must be atomic. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DatabaseSync, key: string, value: string, updatedBy: string): void {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).run(key, value, now(), updatedBy);
}

export function dollarsToCents(input: number | string): number {
  const value = typeof input === "string" ? parseFloat(input) : input;
  if (!Number.isFinite(value)) throw new Error("Invalid amount.");
  return Math.round(value * 100);
}

export const centsToDecimal = (cents: number) => (cents / 100).toFixed(2);
