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
  ensureAccountNumbers(db);
  return db;
}

/**
 * The 12-digit number every user's account is opened with.
 *
 * Generated rather than guessed: a collision is retried instead of surfacing the
 * UNIQUE constraint as a 500, because a sign-up must always end with a usable
 * account number. The last resort derives from the clock so it cannot loop.
 */
export function generateAccountNumber(db: DatabaseSync): string {
  const taken = db.prepare("SELECT 1 FROM accounts WHERE account_number = ?");
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
    if (!taken.get(candidate)) return candidate;
  }
  return String(Date.now()).padStart(12, "0").slice(-12);
}

/**
 * Boot sweep: nobody is left without an account row. Sign-up and the demo
 * fixtures create one inline; this catches users who predate that — including
 * any member whose row predates the number, and staff accounts created by the
 * bootstrap.
 */
function ensureAccountNumbers(db: DatabaseSync): void {
  const missing = db.prepare(
    `SELECT u.id FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE a.id IS NULL`,
  ).all() as Array<{ id: string }>;
  if (!missing.length) return;
  const insert = db.prepare(
    `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
     VALUES (?, ?, '091408735', 'Northfield Bank', 0, 0, 0, ?, ?)`,
  );
  const ts = Date.now();
  for (const row of missing) insert.run(row.id, generateAccountNumber(db), ts, ts);
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
  {
    version: 2,
    sql: `
-- v2: full member-banking surface so the frontend runs entirely on the API.
-- cards in v1 was a stub column set; recreate it with the real card model.
DROP TABLE IF EXISTS cards;
CREATE TABLE cards (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  label                   TEXT NOT NULL,
  last4                   TEXT NOT NULL,
  full_number             TEXT NOT NULL DEFAULT '',
  expiry                  TEXT NOT NULL DEFAULT '',
  cvv                     TEXT NOT NULL DEFAULT '',
  type                    TEXT NOT NULL CHECK (type IN ('virtual','physical')),
  cardholder              TEXT NOT NULL DEFAULT '',
  merchant_lock           TEXT,
  category_lock           TEXT,
  limit_cents             INTEGER NOT NULL DEFAULT 0,
  spent_cents             INTEGER NOT NULL DEFAULT 0,
  single_txn_limit_cents  INTEGER NOT NULL DEFAULT 0,
  daily_atm_limit_cents   INTEGER NOT NULL DEFAULT 0,
  pin                     TEXT NOT NULL DEFAULT '',
  frozen                  INTEGER NOT NULL DEFAULT 0,
  wallet_status           TEXT NOT NULL DEFAULT 'not_added' CHECK (wallet_status IN ('not_added','added')),
  controls_json           TEXT NOT NULL DEFAULT '{}',
  shipping_json           TEXT NOT NULL DEFAULT '{}',
  created_at              INTEGER NOT NULL
);
CREATE INDEX idx_cards_user_v2 ON cards(user_id);

CREATE TABLE invoices (
  user_id     TEXT NOT NULL REFERENCES users(id),
  id          TEXT NOT NULL,
  client      TEXT NOT NULL,
  client_email TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','overdue','paid')),
  due_at      INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_invoices_user ON invoices(user_id);

CREATE TABLE team_members (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('Owner','Admin','Member','Bookkeeper')),
  card_count         INTEGER NOT NULL DEFAULT 0,
  monthly_limit_cents INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('active','invited'))
);
CREATE INDEX idx_team_user ON team_members(user_id);

CREATE TABLE savings_pockets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  target_cents INTEGER NOT NULL DEFAULT 0,
  color        TEXT NOT NULL DEFAULT '#7558dc',
  icon         TEXT NOT NULL DEFAULT 'shield',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_pockets_user ON savings_pockets(user_id);

CREATE TABLE payees (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  nickname       TEXT NOT NULL DEFAULT '',
  bank_name      TEXT NOT NULL,
  routing_number TEXT NOT NULL,
  account_last4  TEXT NOT NULL,
  account_type   TEXT NOT NULL DEFAULT 'Checking',
  verified       INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_payees_user ON payees(user_id);

CREATE TABLE scheduled_payments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  payee_id    TEXT,
  payee_name  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Operations',
  frequency   TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once','weekly','monthly')),
  next_date   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  autopay     INTEGER NOT NULL DEFAULT 1,
  memo        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_scheduled_user ON scheduled_payments(user_id);

CREATE TABLE perks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  partner     TEXT NOT NULL,
  category    TEXT NOT NULL,
  value       TEXT NOT NULL,
  description TEXT NOT NULL,
  code        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','redeemed'))
);
CREATE INDEX idx_perks_user ON perks(user_id);

CREATE TABLE security_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  device      TEXT NOT NULL,
  browser     TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  last_active INTEGER NOT NULL,
  current     INTEGER NOT NULL DEFAULT 0,
  trusted     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sec_sessions_user ON security_sessions(user_id);

CREATE TABLE preferences (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  two_factor    INTEGER NOT NULL DEFAULT 1,
  login_alerts  INTEGER NOT NULL DEFAULT 1,
  scout_auto    INTEGER NOT NULL DEFAULT 1,
  weekly_digest INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE accounts ADD COLUMN lifetime_rewards_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN scout_saved_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN scout_applied_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE transactions ADD COLUMN reward_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN scout_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN card_id TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '/images/avatar-3d-default.svg';
ALTER TABLE kyc_records ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
ALTER TABLE kyc_records ADD COLUMN request_reqs_json TEXT NOT NULL DEFAULT '[]';
`,
  },
  {
    version: 3,
    sql: `
-- v3: production password reset — tokens are stored hashed, expire, and are
-- single-use. The raw token only ever exists in the reset email.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pw_resets_user ON password_resets(user_id);
`,
  },
  {
    version: 4,
    sql: `
-- v4: the account application. Everything a bank must collect before it can
-- open a checking or business account: the applicant's legal identity and
-- government ID, where they live, the business's registration details, and the
-- beneficial owner. One row per member; the applicant's own account is created
-- in the same transaction. Tax IDs (SSN / EIN) are stored whole because
-- compliance has to read them back, but they are masked on every member-facing
-- response — only staff with customers.view see the full value.
CREATE TABLE identity_profiles (
  user_id            TEXT PRIMARY KEY REFERENCES users(id),
  -- Applicant (both account types)
  first_name         TEXT NOT NULL DEFAULT '',
  middle_name        TEXT NOT NULL DEFAULT '',
  last_name          TEXT NOT NULL DEFAULT '',
  dob                TEXT NOT NULL DEFAULT '',
  ssn                TEXT NOT NULL DEFAULT '',
  citizenship        TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  address_line1      TEXT NOT NULL DEFAULT '',
  address_line2      TEXT NOT NULL DEFAULT '',
  city               TEXT NOT NULL DEFAULT '',
  state              TEXT NOT NULL DEFAULT '',
  postal_code        TEXT NOT NULL DEFAULT '',
  country            TEXT NOT NULL DEFAULT '',
  id_type            TEXT NOT NULL DEFAULT '',
  id_number          TEXT NOT NULL DEFAULT '',
  id_issuer          TEXT NOT NULL DEFAULT '',
  id_expiry          TEXT NOT NULL DEFAULT '',
  occupation         TEXT NOT NULL DEFAULT '',
  employer           TEXT NOT NULL DEFAULT '',
  income_range       TEXT NOT NULL DEFAULT '',
  source_of_funds    TEXT NOT NULL DEFAULT '',
  -- Business applicants only
  legal_name         TEXT NOT NULL DEFAULT '',
  dba                TEXT NOT NULL DEFAULT '',
  ein                TEXT NOT NULL DEFAULT '',
  business_type      TEXT NOT NULL DEFAULT '',
  formation_state    TEXT NOT NULL DEFAULT '',
  formation_date     TEXT NOT NULL DEFAULT '',
  industry           TEXT NOT NULL DEFAULT '',
  website            TEXT NOT NULL DEFAULT '',
  monthly_volume     TEXT NOT NULL DEFAULT '',
  biz_address_line1  TEXT NOT NULL DEFAULT '',
  biz_address_line2  TEXT NOT NULL DEFAULT '',
  biz_city           TEXT NOT NULL DEFAULT '',
  biz_state          TEXT NOT NULL DEFAULT '',
  biz_postal_code    TEXT NOT NULL DEFAULT '',
  biz_country        TEXT NOT NULL DEFAULT '',
  owner_name         TEXT NOT NULL DEFAULT '',
  owner_title        TEXT NOT NULL DEFAULT '',
  owner_dob          TEXT NOT NULL DEFAULT '',
  owner_ssn          TEXT NOT NULL DEFAULT '',
  owner_ownership    INTEGER NOT NULL DEFAULT 0,
  submitted_at       INTEGER
);
CREATE INDEX idx_identity_submitted ON identity_profiles(submitted_at);
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

/**
 * A bad request from the caller (malformed amount, unknown enum, …). The error
 * middleware maps this to 400 with the message, so client mistakes never
 * surface as 500s.
 */
export class BadInputError extends Error {}

/**
 * Converts a dollar amount to integer cents. Accepts numbers and numeric
 * strings only — objects, arrays, booleans and trailing-garbage strings
 * ("12abc") are rejected instead of being coerced.
 */
export function dollarsToCents(input: number | string): number {
  const value = typeof input === "string" ? (input.trim() === "" ? NaN : Number(input)) : typeof input === "number" ? input : NaN;
  if (!Number.isFinite(value)) throw new BadInputError("Invalid amount.");
  return Math.round(value * 100);
}

export const centsToDecimal = (cents: number) => (cents / 100).toFixed(2);
