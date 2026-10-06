import { ASSETS } from "../../shared/catalog.js";
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
import { dollarsToCentsExact, centsToDecimalExact } from "./money.js";

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

  /**
   * Reconcile a database built by this branch before it merged main.
   *
   * Main and this branch each numbered their first two migrations 4 and 5 (and
   * later, independently, 8 through 10), so a database that predates a merge
   * can hold one numbering for work the other numbering describes — the
   * account application (identity_profiles) and the review columns where the
   * current list has spending plans and casework, or TOTP sign-in where the
   * current list has federated identities.
   * Applying a migration whose result is already present aborts boot
   * ("table ... already exists"), and skipping one whose result is missing
   * leaves the tables the UI queries nowhere to be found.
   *
   * The shapes decide, not the recorded versions: anything already present is
   * recorded as applied, and anything missing is left for the runner below.
   */
  const tableExists = (name: string) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const columnExists = (table: string, column: string) =>
    Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));
  const shapes: Array<[number, boolean]> = [
    [4, tableExists("budgets")],
    [5, tableExists("operation_cases")],
    [6, tableExists("identity_profiles")],
    [7, columnExists("kyc_records", "review_state")],
    [8, tableExists("federated_identities")],
    [9, tableExists("passkeys")],
    [10, tableExists("crypto_assets")],
    [11, tableExists("support_messages")],
    [12, columnExists("users", "team_owner_id")],
    // 13–15 were numbered 8–10 on the branch that introduced them (suspension
    // reasons, TOTP sign-in, recovery codes) before it merged main's 8–12.
    [13, columnExists("users", "status_reason")],
    [14, columnExists("users", "totp_secret_encrypted")],
    [15, tableExists("totp_recovery_codes")],
  ];
  const recordApplied = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  const forgetApplied = db.prepare("DELETE FROM schema_migrations WHERE version = ?");
  for (const [version, present] of shapes) {
    if (present && !applied.has(version)) {
      recordApplied.run(version, Date.now());
      applied.add(version);
    } else if (!present && applied.has(version)) {
      // Recorded under this number by the other lineage, but the schema it
      // describes is not here: let the runner below create it.
      forgetApplied.run(version);
      applied.delete(version);
    }
  }

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
  two_factor    INTEGER NOT NULL DEFAULT 0,
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
-- v4: member-owned spending plans. A budget is deliberately separate from
-- transactions so both personal and business workspaces can compare live
-- activity to a member-configured monthly operating limit.
CREATE TABLE budgets (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'All spending',
  monthly_limit_cents   INTEGER NOT NULL CHECK (monthly_limit_cents > 0),
  alert_percent         INTEGER NOT NULL DEFAULT 80 CHECK (alert_percent BETWEEN 50 AND 100),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_budgets_user ON budgets(user_id, created_at DESC);
`,
  },
  {
    version: 5,
    sql: `
-- v5: durable back-office casework. Alerts alone are not an operations
-- workflow: each investigation needs an owner, lifecycle, SLA target, and an
-- immutable working timeline. Source links let the console connect a case to
-- a dispute, KYC review, transaction, or account without duplicating it.
CREATE TABLE operation_cases (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('kyc','dispute','account','transaction','support','other')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','low')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','waiting','resolved')),
  summary      TEXT NOT NULL DEFAULT '',
  user_id      TEXT REFERENCES users(id),
  source_type  TEXT,
  source_id    TEXT,
  assigned_to  TEXT REFERENCES users(id),
  due_at       INTEGER,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  closed_at    INTEGER
);
CREATE INDEX idx_operation_cases_status ON operation_cases(status, priority, updated_at DESC);
CREATE INDEX idx_operation_cases_assignee ON operation_cases(assigned_to, status);
CREATE INDEX idx_operation_cases_user ON operation_cases(user_id, updated_at DESC);
CREATE UNIQUE INDEX idx_operation_cases_source ON operation_cases(source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE operation_case_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL REFERENCES operation_cases(id),
  at           INTEGER NOT NULL,
  actor_id     TEXT NOT NULL REFERENCES users(id),
  actor_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_operation_events_case ON operation_case_events(case_id, at DESC);
CREATE TRIGGER operation_events_no_update BEFORE UPDATE ON operation_case_events
  BEGIN SELECT RAISE(ABORT, 'operation_case_events are append-only'); END;
CREATE TRIGGER operation_events_no_delete BEFORE DELETE ON operation_case_events
  BEGIN SELECT RAISE(ABORT, 'operation_case_events are append-only'); END;

CREATE TABLE operation_case_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL REFERENCES operation_cases(id),
  author_id    TEXT NOT NULL REFERENCES users(id),
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_operation_notes_case ON operation_case_notes(case_id, created_at DESC);
CREATE TRIGGER operation_notes_no_update BEFORE UPDATE ON operation_case_notes
  BEGIN SELECT RAISE(ABORT, 'operation_case_notes are append-only'); END;
CREATE TRIGGER operation_notes_no_delete BEFORE DELETE ON operation_case_notes
  BEGIN SELECT RAISE(ABORT, 'operation_case_notes are append-only'); END;
`,
  },
  {
    version: 6,
    sql: `
-- v6: the account application. Everything a bank must collect before it can
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
  {
    version: 7,
    sql: `
-- v7: the application review. Opening an account is a decision a human makes,
-- so a new application waits in review instead of granting dashboard access.
--
-- This is deliberately separate from kyc_records.status, which tracks document
-- verification for accounts that are already open. Someone already banking with
-- us who is asked for an extra document must not lose access to their money.
--
-- DEFAULT 'approved' is what every existing row gets: accounts created before
-- this migration are open and stay open.
ALTER TABLE kyc_records ADD COLUMN review_state TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE kyc_records ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE kyc_records ADD COLUMN review_reqs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE kyc_records ADD COLUMN reviewed_by TEXT;
ALTER TABLE kyc_records ADD COLUMN reviewed_at INTEGER;
`,
  },
  {
    version: 8,
    sql: `
-- v8: federated sign-in links (Google via Firebase, see server/src/federated.ts).
--
-- Firebase is an identity provider, never the authority: this table only
-- records that an external subject is allowed to sign in AS an existing member.
-- There is no password here and no account is ever created from one of these
-- rows — opening an account still requires the full application in
-- identity_profiles.
--
-- PRIMARY KEY (provider, subject): one external identity can unlock exactly one
-- Veyra account, so a Google account cannot be pointed at a second member.
-- UNIQUE (provider, user_id): and a member holds at most one identity per
-- provider, so "which Google account opens this?" has one answer.
--
-- email is stored as it was at link time for the audit story only. Matching
-- after the first link is by subject, which is stable — an email is not.
CREATE TABLE federated_identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  email       TEXT NOT NULL DEFAULT '',
  linked_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX idx_federated_user ON federated_identities(provider, user_id);
CREATE INDEX idx_federated_lookup ON federated_identities(user_id);
`,
  },
  {
    version: 9,
    sql: `
-- v9: passkeys (WebAuthn credentials). See server/src/webauthn.ts.
--
-- Each row is a public key an authenticator generated and kept the private half
-- of. Nothing here is a secret: a stolen copy of this table lets an attacker
-- verify signatures, not produce them. That is the whole point of the method —
-- there is no shared secret to breach, phish or reuse.
--
-- id is the credential ID as base64url, and it is the PRIMARY KEY rather than a
-- surrogate: credential IDs are globally unique, so making it the key means one
-- physical credential can unlock exactly one Veyra account, enforced by SQLite
-- instead of by a check someone can forget to write.
--
-- sign_count is the authenticator's own counter, stored to detect a cloned
-- device. Synced passkeys report 0 forever, so it is advisory — see the note in
-- verifyAuthentication().
--
-- A passkey is ADDED to an account that already exists and is never a way to
-- create one, which is why there is no application data here.
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  public_key   TEXT NOT NULL,
  alg          INTEGER NOT NULL,
  sign_count   INTEGER NOT NULL DEFAULT 0,
  transports   TEXT NOT NULL DEFAULT '',
  aaguid       TEXT NOT NULL DEFAULT '',
  backed_up    INTEGER NOT NULL DEFAULT 0,
  label        TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);
`,
  },
  {
    version: 10,
    sql: `
-- v10: digital asset holdings. See server/src/money.ts and server/src/assets.ts.
--
-- These are deliberately NOT part of the deposit account. A deposit balance is
-- authoritative — the bank owes you that number. A digital asset balance is a
-- quantity whose worth is a market quote that changes every second. Putting
-- them in one column is how a customer ends up arguing about what their
-- account was worth at 3pm, so they stay separate objects end to end.
--
-- units is TEXT, holding an integer count of the asset's smallest unit
-- (satoshi, wei). It is NOT an INTEGER column, and that is not a style
-- choice: SQLite INTEGER is 64-bit, ETH has 18 decimals, so an INTEGER column
-- overflows at 9 ETH. Arithmetic happens in JS with bigint, which also means
-- SQL cannot SUM this column — aggregate in the application.
--
-- The CHECK is a cheap non-negativity guard that works on a decimal string:
-- a negative amount is the only way to get a leading '-'.
CREATE TABLE crypto_assets (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  decimals   INTEGER NOT NULL CHECK (decimals >= 0 AND decimals <= 30),
  kind       TEXT NOT NULL CHECK (kind IN ('crypto','stablecoin')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO crypto_assets (code, name, decimals, kind, sort_order) VALUES
  ('BTC',  'Bitcoin',   8, 'crypto',     1),
  ('ETH',  'Ethereum', 18, 'crypto',     2),
  ('SOL',  'Solana',    9, 'crypto',     3),
  ('USDC', 'USD Coin',  6, 'stablecoin', 4);

CREATE TABLE holdings (
  user_id    TEXT NOT NULL REFERENCES users(id),
  asset      TEXT NOT NULL REFERENCES crypto_assets(code),
  units      TEXT NOT NULL DEFAULT '0' CHECK (units NOT LIKE '-%'),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset)
);
CREATE INDEX idx_holdings_user ON holdings(user_id);

-- One row per movement, append-only in practice. usd_cents is the deposit-account
-- leg and price_cents is the quoted price of one whole unit at execution, both
-- kept so a trade can be explained months later without a price-history lookup.
CREATE TABLE holding_transactions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  asset       TEXT NOT NULL REFERENCES crypto_assets(code),
  side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
  units       TEXT NOT NULL,
  usd_cents   INTEGER NOT NULL,
  price_cents TEXT NOT NULL,
  reference   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_holding_txn_user ON holding_transactions(user_id, created_at DESC);
`,
  },
  {
    version: 11,
    sql: `
-- v11: customer support conversations. A support ticket is an operations case
-- (kind = 'support') so staff work it in the same queue, with the same owner,
-- SLA and audit timeline as every other case. What the case lacked was a
-- customer-visible thread: operation_case_notes are internal-only, so replies
-- the customer may read live in support_messages instead.
--
-- Tickets from the public Support / Contact forms have no member account, so
-- the sender's name and email are kept on the case itself (contact_*). When
-- the email matches a member, user_id links the case to that member too.
ALTER TABLE operation_cases ADD COLUMN contact_name TEXT;
ALTER TABLE operation_cases ADD COLUMN contact_email TEXT;
ALTER TABLE operation_cases ADD COLUMN category TEXT;

CREATE TABLE support_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT NOT NULL REFERENCES operation_cases(id),
  author_kind  TEXT NOT NULL CHECK (author_kind IN ('customer','staff')),
  author_id    TEXT REFERENCES users(id),
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_support_messages_case ON support_messages(case_id, created_at);
CREATE TRIGGER support_messages_no_update BEFORE UPDATE ON support_messages
  BEGIN SELECT RAISE(ABORT, 'support_messages are append-only'); END;
CREATE TRIGGER support_messages_no_delete BEFORE DELETE ON support_messages
  BEGIN SELECT RAISE(ABORT, 'support_messages are append-only'); END;
`,
  },
  {
    version: 12,
    sql: `
-- v12: team access. A business owner invites teammates; an invitee who accepts
-- gets their OWN login (own password, own sessions) that acts on the OWNER's
-- business account with a role: Admin, Member or Bookkeeper. users.team_owner_id
-- links the login to the owner; the role lives on users.team_role and
-- team_members.role. Invite tokens are stored hashed, single-use, with expiry.
ALTER TABLE users ADD COLUMN team_owner_id TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN team_role TEXT;
CREATE INDEX idx_users_team_owner ON users(team_owner_id);
ALTER TABLE team_members ADD COLUMN invite_token_hash TEXT;
ALTER TABLE team_members ADD COLUMN invite_expires_at INTEGER;
ALTER TABLE team_members ADD COLUMN member_user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX idx_team_members_invite ON team_members(invite_token_hash) WHERE invite_token_hash IS NOT NULL;
`,
  },
  {
    version: 13,
    sql: `
-- v13: why an account is suspended.
--
-- The status column has always said *that* an account is restricted; the member
-- dashboard now says *why*, and the console picks the reason from a catalogue
-- instead of typing one. The stored text is the sentence the member reads, kept
-- as written at suspend time so a later edit to the catalogue cannot change
-- history.
ALTER TABLE users ADD COLUMN status_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status_changed_at INTEGER;
ALTER TABLE users ADD COLUMN status_changed_by TEXT;
`,
  },
  {
    version: 14,
    sql: `
-- v14: real authenticator-backed two-step sign-in and revocable device sessions.
-- Old preference-only 2FA switches never gated authentication, so turn them
-- off rather than claim an account is protected without an enrolled secret.
ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN totp_pending_expires_at INTEGER;
ALTER TABLE security_sessions ADD COLUMN auth_token_id TEXT;
ALTER TABLE security_sessions ADD COLUMN device_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_security_sessions_auth_token ON security_sessions(auth_token_id) WHERE auth_token_id IS NOT NULL;
CREATE TABLE login_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_login_challenges_expiry ON login_challenges(expires_at);
DELETE FROM security_sessions;
UPDATE preferences SET two_factor = 0;
`,
  },
  {
    version: 15,
    sql: `
-- v15: one-time hashed account recovery codes for authenticator lockout recovery.
CREATE TABLE totp_recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, code_hash)
);
CREATE INDEX idx_totp_recovery_codes_user ON totp_recovery_codes(user_id);
`,
  },
  {
    version: 16,
    sql: `
-- Prospective actor-attributed spend enforcement. Do not invent actors for
-- historical transactions. applied_at records when tracking became available.
CREATE INDEX idx_txns_actor_spend ON transactions(user_id, performed_by, created_at)
  WHERE amount_cents < 0;
`,
  },
  {
    version: 17,
    sql: `
ALTER TABLE accounts ADD COLUMN bank_account_type TEXT NOT NULL DEFAULT 'Checking' CHECK (bank_account_type IN ('Checking','Savings'));
CREATE TABLE funding_methods (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('bank','wire','card','check','other')), instructions TEXT NOT NULL,
 bank_name TEXT NOT NULL DEFAULT '', routing_number TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '',
 recipient TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_funding_methods_user ON funding_methods(user_id);
CREATE TABLE funding_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method_id TEXT NOT NULL REFERENCES funding_methods(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
 reference TEXT NOT NULL, method_snapshot TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
 request_key TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id),
 UNIQUE(user_id, request_key)
);
CREATE INDEX idx_funding_requests_user ON funding_requests(user_id, created_at);
CREATE TABLE crypto_withdrawals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), asset TEXT NOT NULL REFERENCES crypto_assets(code),
 units TEXT NOT NULL CHECK(units NOT LIKE '-%'), network TEXT NOT NULL, address TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','cancelled')),
 reference TEXT NOT NULL, request_key TEXT NOT NULL, created_at INTEGER NOT NULL, cancelled_at INTEGER,
 UNIQUE(user_id, request_key)
);
CREATE INDEX idx_crypto_withdrawals_user ON crypto_withdrawals(user_id, status);
${ASSETS.map((a, i) => `INSERT OR IGNORE INTO crypto_assets(code,name,decimals,kind,sort_order) VALUES ('${a.code}','${a.name}',${a.decimals},'${'stable' in a ? 'stablecoin' : 'crypto'}',${i+1});`).join("\n")}
`,
  },

  {
    version: 18,
    sql: `
-- Rebuild both sides of the FK to extend the method kinds without disabling
-- foreign-key enforcement. Preserve all identifiers, requests and snapshots.
CREATE TABLE funding_methods_v18 (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('bank','wire','card','check','other','ach','zelle','direct_deposit')), instructions TEXT NOT NULL,
 bank_name TEXT NOT NULL DEFAULT '', routing_number TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '',
 recipient TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 recipient_contact TEXT NOT NULL DEFAULT ''
);
INSERT INTO funding_methods_v18 (id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at)
 SELECT id,user_id,label,kind,instructions,bank_name,routing_number,account_number,recipient,enabled,updated_at FROM funding_methods;
CREATE TABLE funding_requests_v18 (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method_id TEXT NOT NULL REFERENCES funding_methods_v18(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
 reference TEXT NOT NULL, method_snapshot TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
 request_key TEXT NOT NULL, created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id),
 UNIQUE(user_id, request_key)
);
INSERT INTO funding_requests_v18 SELECT * FROM funding_requests;
DROP TABLE funding_requests;
DROP TABLE funding_methods;
ALTER TABLE funding_methods_v18 RENAME TO funding_methods;
ALTER TABLE funding_requests_v18 RENAME TO funding_requests;
CREATE INDEX idx_funding_methods_user ON funding_methods(user_id);
CREATE INDEX idx_funding_requests_user ON funding_requests(user_id, created_at);
`,
  },
  {
    version: 19,
    sql: `
CREATE TABLE account_bulk_previews (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES users(id), snapshot_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, applied_at INTEGER, changed_count INTEGER
);
CREATE INDEX idx_account_bulk_admin ON account_bulk_previews(admin_id,expires_at);
`,
  },

  {
    version: 20,
    sql: `
CREATE TABLE demo_wallets (
 user_id TEXT PRIMARY KEY REFERENCES users(id), balance_cents INTEGER NOT NULL CHECK(balance_cents >= 0 AND balance_cents <= 100000000),
 bank_status TEXT NOT NULL DEFAULT 'unlinked', card_linked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE demo_payment_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','completed','declined')), reference TEXT NOT NULL,
 description TEXT NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE INDEX idx_demo_events_owner ON demo_payment_events(user_id,created_at);
CREATE TABLE demo_payment_previews (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT REFERENCES users(id),
 identifier TEXT NOT NULL, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, method TEXT NOT NULL,
 category TEXT NOT NULL, expires_at INTEGER NOT NULL, result_event_id TEXT REFERENCES demo_payment_events(id)
);
CREATE TABLE demo_payment_inbox (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), recipient TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX idx_demo_inbox_owner ON demo_payment_inbox(user_id,created_at);
`,
  },
  {
    version: 21,
    sql: `
-- Separate namespace prevents an old playground review from debiting an account.
CREATE TABLE demo_account_payment_previews (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), recipient_id TEXT REFERENCES users(id),
 identifier TEXT NOT NULL, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, method TEXT NOT NULL,
 category TEXT NOT NULL, note TEXT NOT NULL, expires_at INTEGER NOT NULL, result_json TEXT
);
CREATE INDEX idx_demo_account_review_owner ON demo_account_payment_previews(user_id,expires_at);
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
 *
 * The arithmetic is exact (see money.ts). The previous implementation was
 * `Math.round(value * 100)`, which disagrees with correct half-up rounding on
 * 0.57% of three-decimal amounts — always a cent short, because those values
 * land just below the midpoint once a binary float gets hold of them:
 *
 *     Math.round(1.005 * 100) === 100   // should be 101
 *     Math.round(0.145 * 100) === 14    // should be 15
 */
export function dollarsToCents(input: number | string): number {
  try {
    return dollarsToCentsExact(input);
  } catch {
    throw new BadInputError("Invalid amount.");
  }
}

export const centsToDecimal = (cents: number) => centsToDecimalExact(cents);
