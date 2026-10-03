/**
 * Veyra backend API — Express + SQLite.
 *
 * Every mutation:
 *   1. authenticates the bearer token (session checked — revocable),
 *   2. loads the user's role FRESH from the database (privilege changes are
 *      instant; nothing is trusted from the client),
 *   3. enforces permissions server-side (rbac.ts),
 *   4. runs financial operations inside IMMEDIATE transactions (atomic),
 *   5. writes an audit entry with before/after values.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, inTransaction, getSetting, setSetting, dollarsToCents, centsToDecimal, now, rid, BadInputError } from "./db.js";
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimit, failureBudgetExceeded, recordFailure, clearFailures, TOKEN_TTL_MS } from "./security.js";
import { demoLoginOptions, demoLoginsEnabled } from "./demo.js";
import {
  can, isStaffRole, rolePermissions, setRolePermissions, resetRolePermissions,
  PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, type Permission, type StaffRole,
} from "./rbac.js";
import { logAdminAction } from "./audit.js";
import { seed } from "./seed.js";
import { buildMemberState, cardNumbers, rewardRate, makeReference } from "./state.js";

export type AuthedUser = {
  id: string; name: string; email: string; role: string;
  accountType: "personal" | "business"; status: string; business: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

type Handler = (req: Request, res: Response) => void | Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

/** A route failure with an explicit HTTP status (declines are 403, limits 400). */
class RouteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Maps a thrown error to its response: RouteError keeps its status, anything else is a 400. */
const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof RouteError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof BadInputError) return void res.status(400).json({ error: err.message });
  res.status(400).json({ error: err instanceof Error ? err.message : fallback });
};

const MAX_TRANSFER_CENTS = 250_000_00;      // $250k per transfer
const MAX_DEPOSIT_CENTS = 100_000_00;       // $100k per deposit
const MAX_ADJUSTMENT_CENTS = 10_000_000_00; // $10M per admin adjustment

export function createApp(dbPath?: string) {
  const db = openDb(dbPath);
  seed(db);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    });
    if (_req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  /* ============================== auth middleware ============================== */

  function loadUser(userId: string): AuthedUser | null {
    const row = db.prepare(
      "SELECT id, name, email, role, account_type, status, business FROM users WHERE id = ?",
    ).get(userId) as (AuthedUser & { account_type: string }) | undefined;
    if (!row) return null;
    return { ...row, accountType: row.account_type as "personal" | "business" };
  }

  /** Full user shape — mirrors the frontend User model (used by /api/auth/me). */
  function fullUser(userId: string) {
    const row = db.prepare(
      "SELECT id, name, email, phone, business, account_type, role, plan, avatar_url, created_at FROM users WHERE id = ?",
    ).get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id), name: String(row.name), email: String(row.email), phone: String(row.phone ?? ""),
      business: String(row.business ?? ""), accountType: row.account_type as "personal" | "business",
      avatarUrl: String(row.avatar_url ?? "/images/avatar-3d-default.svg"),
      role: row.role as string, plan: row.plan as "Starter" | "Pro", createdAt: row.created_at as number,
    };
  }

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return void res.status(401).json({ error: "Authentication required." });
    const payload = verifyToken(header.slice(7));
    if (!payload) return void res.status(401).json({ error: "Invalid or expired token." });
    const session = db.prepare("SELECT revoked, expires_at FROM sessions WHERE token_id = ?").get(payload.jti) as
      | { revoked: number; expires_at: number }
      | undefined;
    if (!session || session.revoked || session.expires_at < Date.now()) {
      return void res.status(401).json({ error: "Session revoked — sign in again." });
    }
    const user = loadUser(payload.sub);
    if (!user) return void res.status(401).json({ error: "Account no longer exists." });
    req.user = user;
    next();
  }

  function requirePerm(permission: Permission) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!isStaffRole(req.user?.role ?? "")) return void res.status(403).json({ error: "Admin access required." });
      if (!can(db, req.user!.role, permission)) {
        return void res.status(403).json({ error: `Access denied — your role does not permit you to ${permission}.` });
      }
      next();
    };
  }

  /**
   * A route reachable through any one of several permissions, for endpoints
   * whose data is legitimately in more than one operator's remit — the
   * transaction ledger export is both a report (`reports.view`) and the
   * transactions console's export (`transactions.export`).
   */
  function requireAnyPerm(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!isStaffRole(req.user?.role ?? "")) return void res.status(403).json({ error: "Admin access required." });
      if (!permissions.some(permission => can(db, req.user!.role, permission))) {
        return void res.status(403).json({ error: `Access denied — your role does not permit you to ${permissions.join(" or ")}.` });
      }
      next();
    };
  }

  const audit = (req: Request, action: string, category: Parameters<typeof logAdminAction>[1]["category"], target: string, summary: string, before?: string, after?: string) =>
    logAdminAction(db, { adminId: req.user!.id, adminName: req.user!.name, action, category, target, summary, before, after });

  const notify = (userId: string, type: string, title: string, detail: string) =>
    db.prepare("INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .run(rid("n"), userId, type, title, detail, now());

  /**
   * Member-management routes operate on member accounts only. Staff and Super
   * Admin accounts are not member surface: an operator with customer
   * permissions must not be able to credit, debit or restrict a colleague
   * (including the Super Admin) through them. Unknown and non-member ids both
   * answer 404 so the route can't be used to enumerate staff.
   */
  const memberRow = (id: string) =>
    db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id) as Record<string, unknown> | undefined;

  /* ============================== health ============================== */

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get(); // prove the database handle is alive
    res.json({ ok: true, service: "veyra-api", db: "sqlite", uptimeSec: Math.floor(process.uptime()), time: now() });
  });

  /* ============================== auth routes ============================== */

  app.post("/api/auth/login", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return void res.status(400).json({ error: "Email and password are required." });
    }
    // Only failed credentials spend the budget, so signing in successfully —
    // repeatedly, from a shared address, which is how a preview proxy looks to
    // the server — can never lock anyone out. Two buckets: one per account
    // (stops guessing a password) and a looser one per address (stops spraying
    // many accounts).
    const accountKey = `login:acct:${email.trim().toLowerCase()}`;
    const ipKey = `login:ip:${ip}`;
    if (failureBudgetExceeded(accountKey, 6) || failureBudgetExceeded(ipKey, 30)) {
      return void res.status(429).json({ error: "Too many failed attempts — wait a minute, then try again." });
    }
    const row = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as
      | (AuthedUser & { password_hash: string; account_type: string })
      | undefined;
    // Constant-ish response regardless of which factor failed.
    if (!row || !verifyPassword(password, row.password_hash)) {
      recordFailure(accountKey);
      recordFailure(ipKey);
      return void res.status(401).json({ error: "Email or password doesn't match our records." });
    }
    clearFailures(accountKey);
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, row.id, now(), now() + TOKEN_TTL_MS);
    const user = loadUser(row.id)!;
    res.json({ token: signToken({ sub: row.id, jti: tokenId, role: user.role }), user: publicUser(user) });
  }));

  app.post("/api/auth/register", wrap((req, res) => {
    const { name, email, password, accountType, business, phone, plan } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) return void res.status(400).json({ error: "Name is required." });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return void res.status(400).json({ error: "A valid email is required." });
    if (typeof password !== "string" || password.length < 8) return void res.status(400).json({ error: "Use at least 8 characters for your password." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      return void res.status(409).json({ error: "An account with that email already exists." });
    }
    const type = accountType === "personal" ? "personal" : "business";
    // A business account must name the business (empty/whitespace/non-string
    // values are rejected, not silently stored as "").
    if (type === "business" && (typeof business !== "string" || !business.trim())) {
      return void res.status(400).json({ error: "Business name is required for a business account." });
    }
    const id = rid("u");
    const accountNumber = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, 'active', ?)`,
      ).run(id, name.trim(), email, typeof phone === "string" ? phone.trim() : "", typeof business === "string" ? business : "", type,
        plan === "Starter" ? "Starter" : "Pro", hashPassword(password), now());
      // Production start: a real, empty account — $0 balance, no cards, no history.
      db.prepare(
        `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
         VALUES (?, ?, '091408735', 'Northfield Bank', 0, 0, 0, ?, ?)`,
      ).run(id, accountNumber, now(), now());
      db.prepare("INSERT INTO kyc_records (user_id, status, completeness, updated_at) VALUES (?, 'not_started', 0, ?)").run(id, now());
      db.prepare("INSERT INTO preferences (user_id, two_factor, login_alerts, scout_auto, weekly_digest) VALUES (?, 1, 1, 1, 0)").run(id);
      db.prepare(
        `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status) VALUES (?, ?, ?, ?, 'Owner', 0, 0, 'active')`,
      ).run(rid("tm"), id, name.trim(), email);
      db.prepare(
        `INSERT INTO security_sessions (id, user_id, device, browser, location, last_active, current, trusted) VALUES (?, ?, 'This device', 'Web', '', ?, 1, 1)`,
      ).run(rid("session"), id, now());
    });
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, id, now(), now() + TOKEN_TTL_MS);
    res.status(201).json({ token: signToken({ sub: id, jti: tokenId, role: "user" }), user: fullUser(id) });
  }));

  app.post("/api/auth/logout", requireAuth, wrap((req, res) => {
    const token = req.headers.authorization!.slice(7);
    const payload = verifyToken(token);
    if (payload) db.prepare("UPDATE sessions SET revoked = 1 WHERE token_id = ?").run(payload.jti);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", requireAuth, wrap((req, res) => {
    res.json({ user: fullUser(req.user!.id) });
  }));

  app.post("/api/auth/change-password", requireAuth, wrap(async (req, res) => {
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 8) return void res.status(400).json({ error: "Use at least 8 characters." });
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(current, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), req.user!.id);
    res.json({ ok: true });
  }));

  // Password reset — production flow. Requesting a reset always returns the
  // same generic response (never reveals whether the email exists). The token
  // is stored hashed with a 30-minute expiry and is single-use. Delivery of
  // the email requires an SMTP provider (see README).
  app.post("/api/auth/forgot-password", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`forgot:${ip}`)) return void res.status(429).json({ error: "Too many attempts — try again in a minute." });
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const row = typeof email === "string" && email
      ? (db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email) as { id: string } | undefined)
      : undefined;
    if (row) {
      const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      db.prepare(
        "INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)",
      ).run(tokenHash, row.id, Date.now() + 30 * 60_000, now());
      // TODO(send-email): deliver the token to `email` via the transactional
      // email provider. Until a provider is configured it is only logged in
      // development mode so the flow stays testable.
      if (process.env.NODE_ENV !== "production") console.log(`[dev] password reset token for ${email}: ${token}`);
    }
    res.json({ ok: true, message: "If an account exists for that email, reset instructions have been sent." });
  }));

  app.post("/api/auth/reset-password", wrap((req, res) => {
    const token = String(req.body?.token ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!token) return void res.status(400).json({ error: "A reset token is required." });
    if (password.length < 8) return void res.status(400).json({ error: "Use at least 8 characters for your password." });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(tokenHash) as
      | { user_id: string; expires_at: number; used: number }
      | undefined;
    if (!row || row.used || row.expires_at < Date.now()) {
      return void res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
    }
    inTransaction(db, () => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), row.user_id);
      db.prepare("UPDATE password_resets SET used = 1 WHERE token_hash = ?").run(tokenHash);
      // A reset invalidates every existing session.
      db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?").run(row.user_id);
    });
    res.json({ ok: true });
  }));

  /**
   * The accounts the login page may offer with one click.
   *
   * Public and unauthenticated on purpose (it is what a signed-out visitor
   * needs), but it only ever answers on a server that holds demo accounts —
   * a production build returns an empty list, so no credentials are advertised
   * where members sign up for real. See server/src/demo.ts.
   */
  app.get("/api/demo/accounts", wrap((_req, res) => {
    if (!demoLoginsEnabled()) return void res.json({ accounts: [] });
    const known = new Set(
      (db.prepare("SELECT email FROM users").all() as Array<{ email: string }>).map(r => r.email.toLowerCase()),
    );
    const accounts = demoLoginOptions().filter(a => known.has(a.email.toLowerCase()));
    res.json({ accounts });
  }));

  /* ============================== member routes ============================== */

  app.get("/api/me/account", requireAuth, wrap((req, res) => {
    const account = db.prepare(
      `SELECT a.*, u.status AS user_status FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?`,
    ).get(req.user!.id) as Record<string, unknown>;
    if (!account) return void res.status(404).json({ error: "No account found." });
    res.json({
      accountNumber: account.account_number,
      routingNumber: account.routing_number,
      bankName: account.bank_name,
      balance: money(account.balance_cents as number),
      pending: money(account.pending_cents as number),
      rewards: money(account.rewards_cents as number),
      status: account.user_status,
    });
  }));

  app.get("/api/me/transactions", requireAuth, wrap((req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const rows = db.prepare(
      "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    ).all(req.user!.id, limit);
    res.json({ transactions: rows.map(txnOut) });
  }));

  app.post("/api/me/deposits", requireAuth, wrap((req, res) => {
    const cents = dollarsToCents(req.body?.amount ?? 0);
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (cents > MAX_DEPOSIT_CENTS) return void res.status(400).json({ error: "Deposits are limited to $100,000 per transaction." });
    const isCheck = typeof req.body?.checkNumber === "string" && String(req.body.checkNumber).trim() !== "";
    const merchant = isCheck
      ? `Check #${String(req.body.checkNumber).trim()} · ${String(req.body?.issuer ?? "Issuer")}`
      : String(req.body?.source ?? "External transfer");
    const method = isCheck ? "Mobile Check" : "ACH";
    const note = isCheck ? (String(req.body?.memo ?? "") || `Mobile check deposit from ${String(req.body?.issuer ?? "issuer")}`) : "Incoming ACH deposit";
    try {
      const result = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number }
          | undefined;
        if (!account) throw new Error("No account found.");
        const before = account.balance_cents;
        const after = before + cents;
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(after, now(), account.id);
        const txn = { id: rid("txn"), reference: makeReference() };
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, 'Operations', ?, ?, 'cleared', ?, ?, ?)`,
        ).run(txn.id, account.id, req.user!.id, merchant, method, cents, txn.reference, note, now());
        notify(req.user!.id, "transfer", "Deposit received", `+${centsToDecimal(cents)} from ${merchant} is available now.`);
        return { id: txn.id, reference: txn.reference, before, after };
      });
      res.status(201).json({
        result: { reference: result.reference, date: now(), amount: cents / 100, balanceBefore: result.before / 100, balanceAfter: result.after / 100, reward: 0, scout: 0 },
        transaction: { id: result.id, merchant, amount: money(cents), reference: result.reference, status: "cleared" },
        balance: money(result.after),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Deposit failed." });
    }
  }));

  app.post("/api/me/transfers", requireAuth, wrap((req, res) => {
    const cents = dollarsToCents(req.body?.amount ?? 0);
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (cents > MAX_TRANSFER_CENTS) return void res.status(400).json({ error: "Transfers are limited to $250,000 per transaction." });
    const counterparty = String(req.body?.counterparty ?? "").trim();
    if (!counterparty) return void res.status(400).json({ error: "A recipient is required." });
    if (req.user!.status === "restricted") {
      return void res.status(403).json({ error: "Your account is restricted. Outgoing transfers are paused — contact support." });
    }
    if (getSetting(db, "payment_rails") === "halted") {
      return void res.status(503).json({ error: "Payment rails are temporarily halted. Please try again shortly." });
    }
    const category = String(req.body?.category ?? "Operations");
    const method = String(req.body?.method ?? "ACH");
    const note = String(req.body?.note ?? `${method} payment`);
    const cardId = typeof req.body?.cardId === "string" ? req.body.cardId : null;
    const reward = Math.round(cents * rewardRate(category));
    const prefs = db.prepare("SELECT scout_auto FROM preferences WHERE user_id = ?").get(req.user!.id) as { scout_auto: number } | undefined;
    const scoutOn = prefs?.scout_auto !== 0;
    const scout = scoutOn && Math.random() < 0.65 ? Math.round(cents * (0.03 + Math.random() * 0.07)) : 0;
    try {
      const result = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents, rewards_cents, lifetime_rewards_cents, scout_saved_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number; rewards_cents: number; lifetime_rewards_cents: number; scout_saved_cents: number }
          | undefined;
        if (!account) throw new Error("No account found.");
        if (account.balance_cents < cents) throw new Error("Insufficient funds for this transfer.");
        // Card spending honours the card's own controls. Freeze, limits and
        // locks are security controls the member sets in the UI — the server is
        // the system of record, so it enforces them instead of trusting that
        // nothing will spend on a frozen card. (contactless/atm/magstripe are
        // terminal-side controls with no meaning for a ledger transfer.)
        if (cardId) {
          const card = db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").get(cardId, req.user!.id) as Record<string, unknown> | undefined;
          if (!card) throw new RouteError(404, "Card not found.");
          if (card.frozen === 1) throw new RouteError(403, "This card is frozen. Unfreeze it before spending.");
          const controls = JSON.parse(String(card.controls_json ?? "{}")) as { online?: boolean };
          if (controls.online === false) throw new RouteError(403, "Online payments are turned off for this card.");
          const limit = card.limit_cents as number;
          if ((card.spent_cents as number) + cents > limit) {
            throw new RouteError(400, `This payment exceeds the card's ${centsToDecimal(limit)} monthly limit.`);
          }
          const perTxn = card.single_txn_limit_cents as number;
          if (cents > perTxn) {
            throw new RouteError(400, `This payment exceeds the card's ${centsToDecimal(perTxn)} per-transaction limit.`);
          }
          const merchantLock = card.merchant_lock ? String(card.merchant_lock) : null;
          if (merchantLock && merchantLock.toLowerCase() !== counterparty.toLowerCase()) {
            throw new RouteError(400, `This card is locked to ${merchantLock}.`);
          }
          const categoryLock = card.category_lock ? String(card.category_lock) : null;
          if (categoryLock && categoryLock !== category) {
            throw new RouteError(400, `This card is locked to the ${categoryLock} category.`);
          }
        }
        const before = account.balance_cents;
        const after = before - cents + scout; // Scout savings are credited immediately
        if (after < 0) throw new Error("Insufficient funds for this transfer.");
        db.prepare("UPDATE accounts SET balance_cents = ?, rewards_cents = ?, lifetime_rewards_cents = ?, scout_saved_cents = ?, updated_at = ? WHERE id = ?")
          .run(after, account.rewards_cents + reward, account.lifetime_rewards_cents + reward, account.scout_saved_cents + scout, now(), account.id);
        const txn = { id: rid("txn"), reference: makeReference() };
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, reward_cents, scout_cents, card_id, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cleared', ?, ?, ?)`,
        ).run(txn.id, account.id, req.user!.id, counterparty, category, method, -cents, reward, scout, cardId, txn.reference, note, now());
        if (cardId) db.prepare("UPDATE cards SET spent_cents = spent_cents + ? WHERE id = ? AND user_id = ?").run(cents, cardId, req.user!.id);
        if (scout > 0) notify(req.user!.id, "scout", `Scout saved ${(scout / 100).toFixed(2)}`, `Found a better rate on your ${counterparty} payment.`);
        notify(req.user!.id, "transfer", `Sent ${(cents / 100).toFixed(2)} to ${counterparty}`, `${method} · +${(reward / 100).toFixed(2)} rewards earned.`);
        return { id: txn.id, reference: txn.reference, before, after };
      });
      res.status(201).json({
        result: { reference: result.reference, date: now(), amount: cents / 100, balanceBefore: result.before / 100, balanceAfter: result.after / 100, reward: reward / 100, scout: scout / 100 },
        transaction: { id: result.id, merchant: counterparty, amount: money(-cents), reference: result.reference, status: "cleared" },
        balance: money(result.after),
      });
    } catch (err) {
      fail(res, err, "Transfer failed.");
    }
  }));

  app.get("/api/me/notifications", requireAuth, wrap((req, res) => {
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40").all(req.user!.id);
    res.json({ notifications: rows, unread: rows.filter((r) => (r as { read: number }).read === 0).length });
  }));

  app.post("/api/me/notifications/read-all", requireAuth, wrap((req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(req.user!.id);
    res.json({ ok: true });
  }));

  app.get("/api/me/kyc", requireAuth, wrap((req, res) => {
    const row = db.prepare("SELECT status, completeness, document_type, country, requested_by, requested_at, request_reason, submission_json, updated_at FROM kyc_records WHERE user_id = ?").get(req.user!.id);
    res.json({ kyc: row ?? { status: "not_started", completeness: 0 } });
  }));

  app.post("/api/me/kyc/submit", requireAuth, wrap((req, res) => {
    const { legalName, dob, country, documentType, source, taxId, documents } = req.body ?? {};
    if (typeof legalName !== "string" || !legalName.trim()) return void res.status(400).json({ error: "Legal name is required." });
    if (!Array.isArray(documents) || documents.length === 0) return void res.status(400).json({ error: "At least one document is required." });
    const submission = {
      legalName, dob: String(dob ?? ""), country: String(country ?? ""), documentType: String(documentType ?? ""),
      source: String(source ?? ""), taxId: String(taxId ?? ""), documents,
      submittedAt: now(),
    };
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, submission_json, updated_at)
         VALUES (?, 'in_review', 100, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'in_review', completeness = 100,
           document_type = excluded.document_type, country = excluded.country,
           submission_json = excluded.submission_json, updated_at = excluded.updated_at`,
      ).run(req.user!.id, submission.documentType, submission.country, JSON.stringify(submission), now());
    });
    res.status(201).json({ ok: true, status: "in_review" });
  }));

  app.post("/api/me/disputes", requireAuth, wrap((req, res) => {
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return void res.status(400).json({ error: "A reason is required." });
    const txnId = typeof req.body?.transactionId === "string" ? req.body.transactionId : null;
    const txn = txnId
      ? (db.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?").get(txnId, req.user!.id) as Record<string, unknown> | undefined)
      : undefined;
    const cents = txn ? Math.abs(txn.amount_cents as number) : dollarsToCents(req.body?.amount ?? 0);
    if (cents <= 0) return void res.status(400).json({ error: "A disputed transaction or amount is required." });
    // One open case per transaction — the app hides the action, the server is
    // the one that guarantees it (retries and second tabs included).
    const alreadyOpen = txnId
      ? db.prepare("SELECT id FROM disputes WHERE user_id = ? AND transaction_id = ? AND status != 'denied'").get(req.user!.id, txnId)
      : undefined;
    if (alreadyOpen) return void res.status(409).json({ error: "A dispute for this transaction is already open." });
    const id = rid("dsp");
    db.prepare(
      `INSERT INTO disputes (id, user_id, transaction_id, merchant, amount_cents, reason, detail, status, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
    ).run(id, req.user!.id, txnId, txn ? (txn.merchant as string) : String(req.body?.merchant ?? "Unknown merchant"),
      cents, reason, String(req.body?.detail ?? ""), now(), now());
    res.status(201).json({ dispute: { id, status: "submitted" } });
  }));

  /* ============================== member: full state ============================== */

  // One round trip: the complete Account snapshot in the exact shape the
  // frontend consumes (see src/lib/store.tsx → Account).
  app.get("/api/me/state", requireAuth, wrap((req, res) => {
    const state = buildMemberState(db, req.user!.id);
    if (!state) return void res.status(404).json({ error: "No account found." });
    res.json({ account: state });
  }));

  /* ---------- profile & preferences ---------- */

  app.patch("/api/me/profile", requireAuth, wrap((req, res) => {
    const patch = req.body ?? {};
    const sets: string[] = [];
    const vals: Array<string | number> = [];
    if (typeof patch.name === "string" && patch.name.trim()) { sets.push("name = ?"); vals.push(patch.name.trim()); }
    if (typeof patch.phone === "string") { sets.push("phone = ?"); vals.push(patch.phone.trim()); }
    if (typeof patch.business === "string" && req.user!.accountType === "business") { sets.push("business = ?"); vals.push(patch.business.trim()); }
    if (typeof patch.avatarUrl === "string" && patch.avatarUrl.length < 1_500_000) { sets.push("avatar_url = ?"); vals.push(patch.avatarUrl); }
    if (patch.plan === "Starter" || patch.plan === "Pro") { sets.push("plan = ?"); vals.push(patch.plan); }
    if (!sets.length) return void res.status(400).json({ error: "Nothing to update." });
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, req.user!.id);
    res.json({ user: fullUser(req.user!.id) });
  }));

  app.put("/api/me/preferences", requireAuth, wrap((req, res) => {
    const key = String(req.body?.key ?? "");
    const value = req.body?.value === true;
    const map: Record<string, string> = { twoFactor: "two_factor", loginAlerts: "login_alerts", scoutAuto: "scout_auto", weeklyDigest: "weekly_digest" };
    const col = map[key];
    if (!col) return void res.status(400).json({ error: "Unknown preference." });
    db.prepare(`INSERT INTO preferences (user_id, ${col}) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ${col} = excluded.${col}`)
      .run(req.user!.id, value ? 1 : 0);
    res.json({ ok: true });
  }));

  /* ---------- cards ---------- */

  const cardRow = (id: string, userId: string) =>
    db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined;

  app.post("/api/me/cards", requireAuth, wrap((req, res) => {
    const label = String(req.body?.label ?? "").trim();
    const type = req.body?.type === "physical" ? "physical" : "virtual";
    const limit = dollarsToCents(req.body?.limit ?? 0);
    const cardholder = String(req.body?.cardholder ?? req.user!.name);
    if (!label) return void res.status(400).json({ error: "A label is required." });
    if (limit <= 0) return void res.status(400).json({ error: "A monthly limit is required." });
    const id = rid("card");
    const nums = cardNumbers();
    const controls = { online: true, contactless: true, atm: type === "physical", international: false, magstripe: type === "physical" };
    const shipping = type === "physical"
      ? { status: "processing", carrier: "ParcelPost", tracking: `VP${Math.random().toString().slice(2, 14)}`, orderedAt: now(), estimatedDelivery: now() + 6 * 86_400_000, address: String(req.body?.shippingAddress ?? "125 Market Street · San Francisco, CA 94105") }
      : { status: "not_applicable" };
    db.prepare(
      `INSERT INTO cards (id, user_id, label, last4, full_number, expiry, cvv, type, cardholder, merchant_lock, category_lock,
         limit_cents, spent_cents, single_txn_limit_cents, daily_atm_limit_cents, pin, frozen, wallet_status, controls_json, shipping_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 'not_added', ?, ?, ?)`,
    ).run(id, req.user!.id, label, nums.last4, nums.fullNumber, nums.exp, nums.cvv, type, cardholder,
      typeof req.body?.merchantLock === "string" && req.body.merchantLock.trim() ? req.body.merchantLock.trim() : null, null,
      limit, Math.min(limit, 500_000), type === "physical" ? 100_000 : 0, String(Math.floor(1000 + Math.random() * 9000)),
      JSON.stringify(controls), JSON.stringify(shipping), now());
    notify(req.user!.id, "card", `${type === "virtual" ? "Virtual" : "Physical"} card issued`, `${label} •••• ${nums.last4} · ${centsToDecimal(limit)} monthly limit.`);
    res.status(201).json({ card: { id, last4: nums.last4, fullNumber: nums.fullNumber, exp: nums.exp, cvv: nums.cvv } });
  }));

  app.patch("/api/me/cards/:id", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    const patch = req.body ?? {};
    const sets: string[] = [];
    const vals: Array<string | number> = [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
    if (typeof patch.label === "string" && patch.label.trim()) { sets.push("label = ?"); vals.push(patch.label.trim()); }
    if (typeof patch.frozen === "boolean") { sets.push("frozen = ?"); vals.push(patch.frozen ? 1 : 0); }
    if (patch.limit != null) { const c = num(patch.limit); if (c == null || c < 0) return void res.status(400).json({ error: "Invalid limit." }); sets.push("limit_cents = ?"); vals.push(c); }
    if (patch.singleTransactionLimit != null) { const c = num(patch.singleTransactionLimit); if (c == null || c < 0) return void res.status(400).json({ error: "Invalid limit." }); sets.push("single_txn_limit_cents = ?"); vals.push(c); }
    if (patch.dailyAtmLimit != null) { const c = num(patch.dailyAtmLimit); if (c == null || c < 0) return void res.status(400).json({ error: "Invalid limit." }); sets.push("daily_atm_limit_cents = ?"); vals.push(c); }
    if (typeof patch.pin === "string") { if (!/^\d{4}$/.test(patch.pin)) return void res.status(400).json({ error: "PIN must be 4 digits." }); sets.push("pin = ?"); vals.push(patch.pin); }
    if (patch.walletStatus === "added" || patch.walletStatus === "not_added") { sets.push("wallet_status = ?"); vals.push(patch.walletStatus); }
    if ("merchantLock" in patch) { sets.push("merchant_lock = ?"); vals.push(typeof patch.merchantLock === "string" && patch.merchantLock.trim() ? patch.merchantLock.trim() : null); }
    if ("categoryLock" in patch) { sets.push("category_lock = ?"); vals.push(typeof patch.categoryLock === "string" && patch.categoryLock.trim() ? patch.categoryLock.trim() : null); }
    if (patch.controls && typeof patch.controls === "object") {
      const current = JSON.parse(String(card.controls_json ?? "{}"));
      sets.push("controls_json = ?"); vals.push(JSON.stringify({ ...current, ...patch.controls }));
    }
    if (!sets.length) return void res.status(400).json({ error: "Nothing to update." });
    db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals, id, req.user!.id);
    res.json({ ok: true });
  }));

  app.delete("/api/me/cards/:id", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const info = db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(id, req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Card not found." });
    res.json({ ok: true });
  }));

  app.post("/api/me/cards/freeze-all", requireAuth, wrap((req, res) => {
    db.prepare("UPDATE cards SET frozen = 1 WHERE user_id = ?").run(req.user!.id);
    notify(req.user!.id, "security", "All cards frozen", "New card purchases will be declined until you unfreeze a card.");
    res.json({ ok: true });
  }));

  app.post("/api/me/cards/:id/replace", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    const reason = String(req.body?.reason ?? "Replacement requested");
    const newId = rid("card");
    const nums = cardNumbers();
    const shipping = card.type === "physical"
      ? { status: "processing", carrier: "ParcelPost", tracking: `VP${Math.random().toString().slice(2, 14)}`, orderedAt: now(), estimatedDelivery: now() + 6 * 86_400_000, address: "125 Market Street · San Francisco, CA 94105" }
      : { status: "not_applicable" };
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO cards (id, user_id, label, last4, full_number, expiry, cvv, type, cardholder, merchant_lock, category_lock,
           limit_cents, spent_cents, single_txn_limit_cents, daily_atm_limit_cents, pin, frozen, wallet_status, controls_json, shipping_json, created_at)
         SELECT ?, user_id, ?, ?, ?, ?, ?, type, cardholder, merchant_lock, category_lock,
           limit_cents, 0, single_txn_limit_cents, daily_atm_limit_cents, ?, 0, 'not_added', controls_json, ?, ? FROM cards WHERE id = ?`,
      ).run(newId, `${String(card.label)} replacement`, nums.last4, nums.fullNumber, nums.exp, nums.cvv,
        String(Math.floor(1000 + Math.random() * 9000)), JSON.stringify(shipping), now(), id);
      db.prepare("UPDATE cards SET frozen = 1 WHERE id = ?").run(id);
    });
    notify(req.user!.id, "card", `${String(card.label)} replacement issued`, `${reason}. The old card is frozen and •••• ${nums.last4} is ready.`);
    res.status(201).json({ card: { id: newId, last4: nums.last4, fullNumber: nums.fullNumber, exp: nums.exp, cvv: nums.cvv } });
  }));

  app.post("/api/me/cards/:id/shipping/advance", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    if (card.type !== "physical") return void res.status(400).json({ error: "Virtual cards have no shipment." });
    const order = ["processing", "printing", "shipped", "in_transit", "delivered"] as const;
    const shipping = JSON.parse(String(card.shipping_json ?? "{}"));
    const index = Math.max(0, order.indexOf(shipping.status ?? "processing"));
    const status = order[Math.min(index + 1, order.length - 1)];
    const nextShipping = { ...shipping, status, deliveredAt: status === "delivered" ? now() : shipping.deliveredAt };
    db.prepare("UPDATE cards SET shipping_json = ? WHERE id = ?").run(JSON.stringify(nextShipping), id);
    notify(req.user!.id, "card", `${String(card.label)} shipment updated`, status === "delivered" ? "Your card was delivered." : `Card status: ${status.replace("_", " ")}.`);
    res.json({ status });
  }));

  /* ---------- invoices ---------- */

  app.post("/api/me/invoices", requireAuth, wrap((req, res) => {
    const client = String(req.body?.client ?? "").trim();
    const clientEmail = String(req.body?.clientEmail ?? "").trim();
    const cents = dollarsToCents(req.body?.amount ?? 0);
    const dueDays = Math.round(Number(req.body?.dueDays ?? 0));
    if (!client) return void res.status(400).json({ error: "A client is required." });
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (!Number.isFinite(dueDays) || dueDays < 0) return void res.status(400).json({ error: "A due date is required." });
    const maxRow = db.prepare("SELECT MAX(CAST(id AS INTEGER)) AS n FROM invoices WHERE user_id = ?").get(req.user!.id) as { n: number | null };
    const id = String((maxRow.n ?? 1047) + 1);
    db.prepare(
      `INSERT INTO invoices (id, user_id, client, client_email, amount_cents, status, due_at, description, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(id, req.user!.id, client, clientEmail, cents, now() + dueDays * 86_400_000, String(req.body?.description ?? ""), now());
    notify(req.user!.id, "invoice", `Invoice #${id} sent`, `${centsToDecimal(cents)} to ${client} · due in ${dueDays} days.`);
    res.status(201).json({ invoice: { id, client, amount: cents / 100, status: "open", due: now() + dueDays * 86_400_000 } });
  }));

  app.post("/api/me/invoices/:id/paid", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
    if (!inv) return void res.status(404).json({ error: "Invoice not found." });
    if (inv.status === "paid") return void res.status(409).json({ error: "Invoice is already paid." });
    const cents = inv.amount_cents as number;
    try {
      inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as { id: number; balance_cents: number };
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents + cents, now(), account.id);
        db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(id);
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, 'Operations', 'ACH', ?, 'cleared', ?, ?, ?)`,
        ).run(rid("txn"), account.id, req.user!.id, String(inv.client), cents, makeReference(), `Invoice #${id} payment`, now());
        notify(req.user!.id, "invoice", `${String(inv.client)} paid ${centsToDecimal(cents)}`, `Invoice #${id} is settled and the funds are available.`);
      });
      res.json({ ok: true, status: "paid" });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to mark paid." });
    }
  }));

  app.post("/api/me/invoices/:id/remind", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
    if (!inv) return void res.status(404).json({ error: "Invoice not found." });
    notify(req.user!.id, "invoice", `Reminder sent to ${String(inv.client)}`, `We emailed ${String(inv.client_email)} about invoice #${id}.`);
    res.json({ ok: true });
  }));

  /* ---------- team ---------- */

  app.post("/api/me/team", requireAuth, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim();
    const role = String(req.body?.role ?? "Member");
    const monthlyLimit = dollarsToCents(req.body?.monthlyLimit ?? 0);
    if (!name || !email) return void res.status(400).json({ error: "Name and email are required." });
    if (!["Admin", "Member", "Bookkeeper"].includes(role)) return void res.status(400).json({ error: "Invalid role." });
    const id = rid("tm");
    db.prepare(
      `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'invited')`,
    ).run(id, req.user!.id, name, email, role, role === "Bookkeeper" ? 0 : 1, monthlyLimit);
    notify(req.user!.id, "security", `Invite sent to ${name}`, `${role} · ${monthlyLimit ? `${centsToDecimal(monthlyLimit)} monthly limit` : "view-only access"}.`);
    res.status(201).json({ member: { id, name, email, role, cardCount: role === "Bookkeeper" ? 0 : 1, monthlyLimit: monthlyLimit / 100, status: "invited" } });
  }));

  app.delete("/api/me/team/:id", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const member = db.prepare("SELECT role FROM team_members WHERE id = ? AND user_id = ?").get(id, req.user!.id) as { role: string } | undefined;
    if (!member) return void res.status(404).json({ error: "Team member not found." });
    if (member.role === "Owner") return void res.status(400).json({ error: "The account owner cannot be removed." });
    db.prepare("DELETE FROM team_members WHERE id = ? AND user_id = ?").run(id, req.user!.id);
    res.json({ ok: true });
  }));

  /* ---------- savings pockets (money ops) ---------- */

  app.post("/api/me/pockets", requireAuth, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const target = dollarsToCents(req.body?.target ?? 0);
    if (!name) return void res.status(400).json({ error: "A name is required." });
    const id = rid("pocket");
    db.prepare(
      `INSERT INTO savings_pockets (id, user_id, name, balance_cents, target_cents, color, icon, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(id, req.user!.id, name, target, String(req.body?.color ?? "#7558dc"), String(req.body?.icon ?? "general"), now());
    res.status(201).json({ pocket: { id, name, balance: 0, target: target / 100 } });
  }));

  app.post("/api/me/pockets/:id/move", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const cents = dollarsToCents(req.body?.amount ?? 0);
    const direction = req.body?.direction;
    if (direction !== "to_pocket" && direction !== "to_checking") {
      return void res.status(400).json({ error: "direction must be 'to_pocket' or 'to_checking'." });
    }
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    // A pocket that isn't the caller's is a 404 — never a 400 that hides an
    // ownership check (and never a write).
    if (!db.prepare("SELECT 1 FROM savings_pockets WHERE id = ? AND user_id = ?").get(id, req.user!.id)) {
      return void res.status(404).json({ error: "Pocket not found." });
    }
    try {
      inTransaction(db, () => {
        const pocket = db.prepare("SELECT * FROM savings_pockets WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
        if (!pocket) throw new Error("Pocket not found.");
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as { id: number; balance_cents: number };
        if (direction === "to_pocket") {
          if (account.balance_cents < cents) throw new Error("Insufficient funds in checking.");
          db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents - cents, now(), account.id);
          db.prepare("UPDATE savings_pockets SET balance_cents = balance_cents + ? WHERE id = ?").run(cents, id);
          db.prepare(
            `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
             VALUES (?, ?, ?, ?, 'Operations', 'Internal', ?, 'cleared', ?, 'Moved to savings pocket', ?)`,
          ).run(rid("txn"), account.id, req.user!.id, String(pocket.name), -cents, makeReference(), now());
        } else {
          if ((pocket.balance_cents as number) < cents) throw new Error("Insufficient funds in the pocket.");
          db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents + cents, now(), account.id);
          db.prepare("UPDATE savings_pockets SET balance_cents = balance_cents - ? WHERE id = ?").run(cents, id);
          db.prepare(
            `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
             VALUES (?, ?, ?, ?, 'Operations', 'Internal', ?, 'cleared', ?, 'Moved from savings pocket', ?)`,
          ).run(rid("txn"), account.id, req.user!.id, String(pocket.name), cents, makeReference(), now());
        }
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Transfer failed." });
    }
  }));

  app.delete("/api/me/pockets/:id", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    if (!db.prepare("SELECT 1 FROM savings_pockets WHERE id = ? AND user_id = ?").get(id, req.user!.id)) {
      return void res.status(404).json({ error: "Pocket not found." });
    }
    try {
      inTransaction(db, () => {
        const pocket = db.prepare("SELECT * FROM savings_pockets WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
        if (!pocket) throw new Error("Pocket not found.");
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as { id: number; balance_cents: number };
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents + (pocket.balance_cents as number), now(), account.id);
        db.prepare("DELETE FROM savings_pockets WHERE id = ?").run(id);
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to delete pocket." });
    }
  }));

  /* ---------- payees & scheduled payments ---------- */

  app.post("/api/me/payees", requireAuth, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const bankName = String(req.body?.bankName ?? "").trim();
    const routingNumber = String(req.body?.routingNumber ?? "").trim();
    const accountLast4 = String(req.body?.accountLast4 ?? "").trim();
    if (!name || !bankName || !/^\d{9}$/.test(routingNumber) || !/^\d{4}$/.test(accountLast4)) {
      return void res.status(400).json({ error: "Complete bank details are required." });
    }
    const id = rid("payee");
    db.prepare(
      `INSERT INTO payees (id, user_id, name, nickname, bank_name, routing_number, account_last4, account_type, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, req.user!.id, name, String(req.body?.nickname ?? "").trim(), bankName, routingNumber, accountLast4,
      req.body?.accountType === "Savings" ? "Savings" : "Checking", now());
    res.status(201).json({ payee: { id, name } });
  }));

  app.delete("/api/me/payees/:id", requireAuth, wrap((req, res) => {
    const info = db.prepare("DELETE FROM payees WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Payee not found." });
    res.json({ ok: true });
  }));

  app.post("/api/me/scheduled", requireAuth, wrap((req, res) => {
    const payeeName = String(req.body?.payeeName ?? "").trim();
    const cents = dollarsToCents(req.body?.amount ?? 0);
    const nextDate = Number(req.body?.nextDate ?? 0);
    if (!payeeName) return void res.status(400).json({ error: "A payee is required." });
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (!Number.isFinite(nextDate) || nextDate <= 0) return void res.status(400).json({ error: "A next payment date is required." });
    const frequency = req.body?.frequency ?? "monthly";
    if (!["once", "weekly", "monthly"].includes(String(frequency))) {
      return void res.status(400).json({ error: "frequency must be once, weekly or monthly." });
    }
    const id = rid("bill");
    db.prepare(
      `INSERT INTO scheduled_payments (id, user_id, payee_id, payee_name, amount_cents, category, frequency, next_date, status, autopay, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, req.user!.id, typeof req.body?.payeeId === "string" ? req.body.payeeId : null, payeeName, cents,
      String(req.body?.category ?? "Operations"), frequency, nextDate, req.body?.autopay === true ? 1 : 0, String(req.body?.memo ?? ""));
    res.status(201).json({ payment: { id, payeeName, amount: cents / 100, status: "active" } });
  }));

  app.patch("/api/me/scheduled/:id", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    const payment = db.prepare("SELECT status FROM scheduled_payments WHERE id = ? AND user_id = ?").get(id, req.user!.id) as { status: string } | undefined;
    if (!payment) return void res.status(404).json({ error: "Payment not found." });
    if (payment.status === "completed") return void res.status(400).json({ error: "Completed payments cannot be changed." });
    // Pause/resume. An explicit status wins (the app sends the state its
    // optimistic update already applied); no body keeps the toggle behaviour.
    const requested = req.body?.status;
    if (requested !== undefined && requested !== "active" && requested !== "paused") {
      return void res.status(400).json({ error: "status must be 'active' or 'paused'." });
    }
    const next = requested ?? (payment.status === "paused" ? "active" : "paused");
    db.prepare("UPDATE scheduled_payments SET status = ? WHERE id = ?").run(next, id);
    res.json({ status: next });
  }));

  app.delete("/api/me/scheduled/:id", requireAuth, wrap((req, res) => {
    const info = db.prepare("DELETE FROM scheduled_payments WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Payment not found." });
    res.json({ ok: true });
  }));

  app.post("/api/me/scheduled/:id/pay", requireAuth, wrap((req, res) => {
    const id = String(req.params.id);
    if (!db.prepare("SELECT 1 FROM scheduled_payments WHERE id = ? AND user_id = ?").get(id, req.user!.id)) {
      return void res.status(404).json({ error: "Payment not found." });
    }
    try {
      const txnId = inTransaction(db, () => {
        const payment = db.prepare("SELECT * FROM scheduled_payments WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
        if (!payment) throw new Error("Payment not found.");
        if (payment.status === "completed") throw new Error("This payment is already completed.");
        const cents = payment.amount_cents as number;
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as { id: number; balance_cents: number };
        if (account.balance_cents < cents) throw new Error("Insufficient funds for this payment.");
        const base = Number(payment.next_date);
        const nextDate = payment.frequency === "weekly"
          ? base + 7 * 86_400_000
          : payment.frequency === "monthly"
            ? new Date(base).setMonth(new Date(base).getMonth() + 1)
            : base;
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents - cents, now(), account.id);
        db.prepare("UPDATE scheduled_payments SET next_date = ?, status = ? WHERE id = ?")
          .run(nextDate, payment.frequency === "once" ? "completed" : String(payment.status), id);
        const txn = rid("txn");
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, ?, 'ACH', ?, 'cleared', ?, ?, ?)`,
        ).run(txn, account.id, req.user!.id, String(payment.payee_name), String(payment.category), -cents,
          makeReference(), String(payment.memo ?? "Scheduled payment"), now());
        notify(req.user!.id, "transfer", `${centsToDecimal(cents)} paid to ${String(payment.payee_name)}`,
          payment.frequency === "once" ? "One-time payment completed." : "Next payment scheduled.");
        return txn;
      });
      // The ledger row's id, so the client can act on the payment the server
      // just wrote (dispute it) before the refreshed snapshot lands.
      res.json({ ok: true, transaction: { id: txnId } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Payment failed." });
    }
  }));

  /* ---------- rewards, Scout, perks, sessions, notifications ---------- */

  app.post("/api/me/rewards/redeem", requireAuth, wrap((req, res) => {
    try {
      const amount = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents, rewards_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number; rewards_cents: number }
          | undefined;
        if (!account) throw new Error("No account found.");
        if (account.rewards_cents <= 0) return 0;
        db.prepare("UPDATE accounts SET balance_cents = ?, rewards_cents = 0, updated_at = ? WHERE id = ?")
          .run(account.balance_cents + account.rewards_cents, now(), account.id);
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, 'Rewards redemption', 'Operations', 'Internal', ?, 'cleared', ?, 'Cash back redeemed 1:1', ?)`,
        ).run(rid("txn"), account.id, req.user!.id, account.rewards_cents, makeReference(), now());
        notify(req.user!.id, "transfer", `Redeemed ${centsToDecimal(account.rewards_cents)}`, "Cash back moved to your available balance.");
        return account.rewards_cents;
      });
      res.json({ amount: amount / 100 });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Redemption failed." });
    }
  }));

  app.post("/api/me/scout/apply", requireAuth, wrap((req, res) => {
    const opportunityId = String(req.body?.opportunityId ?? "");
    const merchant = String(req.body?.merchant ?? "merchant");
    const note = String(req.body?.note ?? "");
    if (!opportunityId) return void res.status(400).json({ error: "An opportunity id is required." });
    try {
      const applied = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents, scout_saved_cents, scout_applied_json FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number; scout_saved_cents: number; scout_applied_json: string }
          | undefined;
        if (!account) throw new Error("No account found.");
        const already = JSON.parse(account.scout_applied_json ?? "[]") as string[];
        if (already.includes(opportunityId)) return false;
        const cents = dollarsToCents(req.body?.amount ?? 0);
        if (cents <= 0) return false;
        db.prepare("UPDATE accounts SET balance_cents = ?, scout_saved_cents = ?, scout_applied_json = ?, updated_at = ? WHERE id = ?")
          .run(account.balance_cents + cents, account.scout_saved_cents + cents, JSON.stringify([...already, opportunityId]), now(), account.id);
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, reward_cents, scout_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, 'Operations', 'Scout credit', ?, 0, ?, 'cleared', ?, ?, ?)`,
        ).run(rid("txn"), account.id, req.user!.id, `Scout savings · ${merchant}`, cents, cents, makeReference(), note, now());
        notify(req.user!.id, "scout", `Scout credited ${centsToDecimal(cents)}`, `Savings from ${merchant} were credited to checking.`);
        return true;
      });
      res.json({ applied });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to apply savings." });
    }
  }));

  app.post("/api/me/perks/:id/redeem", requireAuth, wrap((req, res) => {
    const info = db.prepare("UPDATE perks SET status = 'redeemed' WHERE id = ? AND user_id = ? AND status = 'available'")
      .run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Perk not available." });
    res.json({ ok: true });
  }));

  app.post("/api/me/notifications/:id/read", requireAuth, wrap((req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  }));

  app.post("/api/me/sessions/:id/revoke", requireAuth, wrap((req, res) => {
    db.prepare("DELETE FROM security_sessions WHERE id = ? AND user_id = ? AND current = 0").run(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  }));

  app.patch("/api/me/sessions/:id", requireAuth, wrap((req, res) => {
    if (typeof req.body?.trusted !== "boolean") return void res.status(400).json({ error: "Nothing to update." });
    db.prepare("UPDATE security_sessions SET trusted = ? WHERE id = ? AND user_id = ?").run(req.body.trusted ? 1 : 0, String(req.params.id), req.user!.id);
    res.json({ ok: true });
  }));

  /* ---------- KYC wizard progress + member dispute tracking ---------- */

  app.patch("/api/me/kyc", requireAuth, wrap((req, res) => {
    const patch = req.body ?? {};
    const sets: string[] = [];
    const vals: Array<string | number> = [];
    if (typeof patch.nextStep === "string") { sets.push("next_step = ?"); vals.push(patch.nextStep); }
    if (typeof patch.documentType === "string") { sets.push("document_type = ?"); vals.push(patch.documentType); }
    if (typeof patch.country === "string") { sets.push("country = ?"); vals.push(patch.country); }
    if (typeof patch.completeness === "number" && patch.completeness >= 0 && patch.completeness <= 100) { sets.push("completeness = ?"); vals.push(Math.round(patch.completeness)); }
    if (!sets.length) return void res.status(400).json({ error: "Nothing to update." });
    db.prepare(
      `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, next_step, updated_at)
       VALUES (?, 'not_started', 0, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET ${sets.join(", ")}, updated_at = excluded.updated_at`,
    ).run(req.user!.id, String(patch.documentType ?? ""), String(patch.country ?? ""), String(patch.nextStep ?? ""), now(), ...vals);
    res.json({ ok: true });
  }));

  /* ============================== admin: overview & members ============================== */

  app.get("/api/admin/overview", requireAuth, requirePerm("dashboard.view"), wrap((_req, res) => {
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const recentAudit = db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT 6").all();
    const recentTxns = db.prepare(
      `SELECT t.*, u.name AS member_name FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 6`,
    ).all();
    res.json({
      totals: {
        customers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'user'"),
        openAccounts: one("SELECT COUNT(*) AS n FROM accounts"),
        totalBalanceCents: one("SELECT COALESCE(SUM(balance_cents),0) AS n FROM accounts"),
        pendingCents: one("SELECT COALESCE(SUM(pending_cents),0) AS n FROM accounts"),
        transactions: one("SELECT COUNT(*) AS n FROM transactions"),
        pendingTransactions: one("SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'"),
        kycPending: one("SELECT COUNT(*) AS n FROM kyc_records WHERE status IN ('requested','in_review')"),
        riskAlerts:
          one("SELECT COUNT(*) AS n FROM disputes WHERE status IN ('submitted','reviewing')") +
          one("SELECT COUNT(*) AS n FROM users WHERE status = 'restricted'"),
      },
      recentAudit,
      recentTransactions: recentTxns.map(txnOut),
    });
  }));

  app.get("/api/admin/members", requireAuth, requirePerm("customers.view"), wrap((req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const rows = db.prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.business, u.account_type, u.plan, u.status,
              a.balance_cents, a.pending_cents, k.status AS kyc_status
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       LEFT JOIN kyc_records k ON k.user_id = u.id
       WHERE u.role = 'user'
       ORDER BY u.created_at DESC`,
    ).all() as Array<Record<string, unknown>>;
    const filtered = q
      ? rows.filter(r => `${r.name} ${r.email} ${r.business}`.toLowerCase().includes(q))
      : rows;
    res.json({
      members: filtered.map(r => ({
        id: r.id, name: r.name, email: r.email, phone: r.phone, business: r.business,
        accountType: r.account_type, plan: r.plan, status: r.status,
        balance: money((r.balance_cents as number) ?? 0),
        pending: money((r.pending_cents as number) ?? 0),
        kycStatus: r.kyc_status ?? "not_started",
      })),
    });
  }));

  app.get("/api/admin/members/:id", requireAuth, requirePerm("customers.view"), wrap((req, res) => {
    const user = memberRow(String(req.params.id));
    if (!user) return void res.status(404).json({ error: "Member not found." });
    const account = db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    const txns = db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(String(req.params.id));
    const kyc = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(String(req.params.id));
    res.json({
      member: {
        id: user.id, name: user.name, email: user.email, phone: user.phone, business: user.business,
        accountType: user.account_type, plan: user.plan, status: user.status, createdAt: user.created_at,
        balance: money((account?.balance_cents as number) ?? 0),
        accountNumber: account?.account_number, routingNumber: account?.routing_number,
      },
      transactions: txns.map(txnOut),
      kyc,
    });
  }));

  /** Cross-account treasury adjustment (deposit / withdrawal). */
  app.post("/api/admin/members/:id/adjust", requireAuth, requirePerm("customers.adjust_balance"), wrap((req, res) => {
    const target = memberRow(String(req.params.id));
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const cents = dollarsToCents(req.body?.amount ?? 0);
    // Money direction is never guessed: a typo must not silently credit.
    const direction = req.body?.direction;
    if (direction !== "credit" && direction !== "debit") {
      return void res.status(400).json({ error: "direction must be 'credit' or 'debit'." });
    }
    const requestedDescription = String(req.body?.description ?? "").trim();
    const memo = String(req.body?.memo ?? "").trim();
    const fallbackDescription = direction === "credit" ? "Direct deposit" : "ACH withdrawal";
    const hasTransferDescription = requestedDescription.length > 0;
    if (!memo && !hasTransferDescription) return void res.status(400).json({ error: "A transfer description or reference note is required." });
    const sanitizeTransferDescription = (label: string) => {
      const stripped = label
        .replace(/\b(?:by|the|platform|bank|team|staff|super|admin|administrator)\b/gi, " ")
        .replace(/\b(?:admin|administrator|staff|compliance|support|super admin)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/\s+[–—-]+\s+/g, " ")
        .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
        .trim();
      return stripped || fallbackDescription;
    };
    const normalizedDescription = (() => {
      const label = sanitizeTransferDescription(requestedDescription || fallbackDescription);
      const clean = label.replace(/\s+/g, " ").trim();
      return clean.length > 80 ? clean.slice(0, 77).trim() + "..." : clean;
    })();
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (cents > MAX_ADJUSTMENT_CENTS) return void res.status(400).json({ error: "Adjustments are limited to $10,000,000." });
    try {
      const result = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(String(req.params.id)) as
          | { id: number; balance_cents: number }
          | undefined;
        if (!account) throw new Error("Member has no account.");
        const delta = direction === "credit" ? cents : -cents;
        const after = account.balance_cents + delta;
        if (after < 0) throw new Error("Withdrawal rejected — it would overdraw the member's account.");
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(after, now(), account.id);
        const txn = { id: rid("txn"), reference: rid("VYR").toUpperCase().replace("_", "-") };
        const fullNote = memo ? `${normalizedDescription} — ${memo}` : normalizedDescription;
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, performed_by, created_at)
           VALUES (?, ?, ?, ?, 'Operations', 'Adjustment', ?, 'cleared', ?, ?, ?, ?)`,
        ).run(txn.id, account.id, String(req.params.id), normalizedDescription, delta,
          txn.reference, fullNote, req.user!.id, now());
        return { before: account.balance_cents, after, reference: txn.reference };
      });
      audit(req, "balance.adjust", "Financial", `user:${String(req.params.id)} · ${target.name}`,
        `${direction === "credit" ? "Credited" : "Debited"} ${centsToDecimal(cents)} — ${normalizedDescription}${memo ? ` · ${memo}` : ""}.`,
        centsToDecimal(result.before), centsToDecimal(result.after));
      notify(String(req.params.id), direction === "credit" ? "transfer" : "security",
        direction === "credit" ? "Funds credited by Veyra" : "Adjustment applied to your account",
        `${direction === "credit" ? "+" : "−"}$${centsToDecimal(cents)} · ${normalizedDescription}${memo ? ` · ${memo}` : ""}. New balance $${centsToDecimal(result.after)}.`);
      res.json({ before: money(result.before), after: money(result.after), reference: result.reference });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Adjustment failed." });
    }
  }));

  /** Restrict / restore an account. Restriction blocks the member's transfers server-side. */
  app.post("/api/admin/members/:id/status", requireAuth, requirePerm("accounts.set_status"), wrap((req, res) => {
    const target = memberRow(String(req.params.id));
    if (!target) return void res.status(404).json({ error: "Member not found." });
    // Never guess a security control: an explicit, known status is required.
    const status = req.body?.status;
    if (status !== "active" && status !== "restricted") {
      return void res.status(400).json({ error: "status must be 'active' or 'restricted'." });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (status === "restricted" && !reason) return void res.status(400).json({ error: "A reason is required to restrict an account." });
    const before = target.status as string;
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, String(req.params.id));
    audit(req, "account.status", "Financial", `user:${String(req.params.id)} · ${target.name}`,
      status === "restricted" ? `Restricted account — ${reason}.` : "Restored account to active.", before, status);
    notify(String(req.params.id), "security",
      status === "restricted" ? "Your account is restricted" : "Your account is fully active",
      status === "restricted"
        ? `${reason} Outgoing transfers are paused while we review.`
        : "Restrictions were lifted — all features are available again.");
    res.json({ status });
  }));

  /* ============================== admin: KYC ============================== */

  app.post("/api/admin/kyc/request", requireAuth, requirePerm("kyc.request"), wrap((req, res) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.body?.userId ?? "")) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "Member not found." });
    if (target.role !== "user") return void res.status(400).json({ error: "Verification can only be requested from members." });
    const requirements = Array.isArray(req.body?.requirements) ? req.body.requirements.map(String) : ["identity", "address"];
    const reason = String(req.body?.reason ?? "").trim() || "Identity verification is required to lift your account limits.";
    const targetId = String(target.id);
    const before = (db.prepare("SELECT status FROM kyc_records WHERE user_id = ?").get(targetId) as { status: string } | undefined)?.status ?? "not_started";
    if (before === "approved") return void res.status(409).json({ error: "This member is already verified." });
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO kyc_records (user_id, status, completeness, updated_at, requested_by, requested_at, request_reason, request_reqs_json)
         VALUES (?, 'requested', 72, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'requested', requested_by = excluded.requested_by,
           requested_at = excluded.requested_at, request_reason = excluded.request_reason,
           request_reqs_json = excluded.request_reqs_json, updated_at = excluded.updated_at`,
      ).run(targetId, now(), req.user!.id, now(), reason, JSON.stringify(requirements));
    });
    audit(req, "kyc.request", "KYC", `user:${targetId} · ${target.name}`,
      `Requested verification (${requirements.join(", ")}).`, before, "requested");
    notify(targetId, "security", "Identity verification requested",
      `${req.user!.name} asked you to verify your identity. ${reason}`);
    res.json({ status: "requested" });
  }));

  app.get("/api/admin/kyc/queue", requireAuth, requirePerm("kyc.review"), wrap((_req, res) => {
    const rows = db.prepare(
      `SELECT u.id, u.name, u.email, u.account_type, k.submission_json, k.updated_at
       FROM kyc_records k JOIN users u ON u.id = k.user_id
       WHERE k.status = 'in_review' ORDER BY k.updated_at ASC`,
    ).all() as Array<Record<string, unknown>>;
    res.json({
      queue: rows.map(r => ({
        userId: r.id, name: r.name, email: r.email, accountType: r.account_type,
        submission: r.submission_json ? JSON.parse(r.submission_json as string) : null,
        submittedAt: r.updated_at,
      })),
    });
  }));

  app.post("/api/admin/kyc/:userId/decision", requireAuth, requirePerm("kyc.review"), wrap((req, res) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.userId)) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const decision = req.body?.decision === "needs_attention" ? "needs_attention" : "approved";
    const note = String(req.body?.note ?? "").trim();
    if (decision === "needs_attention" && !note) {
      return void res.status(400).json({ error: "A note is required when requesting changes." });
    }
    const record = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(String(req.params.userId)) as Record<string, unknown> | undefined;
    if (!record || record.status !== "in_review") return void res.status(409).json({ error: "This member has no verification awaiting review." });
    inTransaction(db, () => {
      if (decision === "approved") {
        db.prepare(
          `UPDATE kyc_records SET status = 'approved', completeness = 100, requested_by = NULL,
             requested_at = NULL, request_reason = NULL, updated_at = ? WHERE user_id = ?`,
        ).run(now(), String(req.params.userId));
      } else {
        db.prepare("UPDATE kyc_records SET status = 'needs_attention', updated_at = ? WHERE user_id = ?").run(now(), String(req.params.userId));
      }
    });
    audit(req, decision === "approved" ? "kyc.approve" : "kyc.request_changes", "KYC",
      `user:${String(req.params.userId)} · ${target.name}`,
      decision === "approved" ? "Approved identity verification." : `Requested changes — ${note}`,
      "in_review", decision);
    notify(String(req.params.userId), "security",
      decision === "approved" ? "Identity verification approved" : "Verification changes requested",
      decision === "approved"
        ? `Your identity is verified and all account limits are now unlocked. Reviewed by ${req.user!.name}.`
        : `${note} Reviewed by ${req.user!.name}.`);
    res.json({ status: decision });
  }));

  /* ============================== admin: risk & fraud ============================== */

  app.get("/api/admin/risk/disputes", requireAuth, requirePerm("risk.view"), wrap((_req, res) => {
    const rows = db.prepare(
      `SELECT d.*, u.name AS member_name FROM disputes d JOIN users u ON u.id = d.user_id
       WHERE d.status IN ('submitted','reviewing') ORDER BY d.opened_at ASC`,
    ).all();
    const restricted = db.prepare("SELECT id, name, email, status FROM users WHERE status = 'restricted' AND role = 'user'").all();
    const largeTxns = db.prepare(
      `SELECT t.*, u.name AS member_name FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE ABS(t.amount_cents) >= 1000000 ORDER BY t.created_at DESC LIMIT 5`,
    ).all();
    res.json({ disputes: rows.map(d => ({ ...d, amount: money(d.amount_cents as number) })), restricted, largeTransactions: largeTxns.map(txnOut) });
  }));

  app.post("/api/admin/risk/disputes/:id/advance", requireAuth, requirePerm("risk.resolve"), wrap((req, res) => {
    const dispute = db.prepare("SELECT * FROM disputes WHERE id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!dispute) return void res.status(404).json({ error: "Dispute not found." });
    if (dispute.status === "resolved" || dispute.status === "denied") {
      return void res.status(409).json({ error: "This dispute is already closed." });
    }
    const disputeUserId = String(dispute.user_id);
    const disputeId = String(dispute.id);
    const disputeCents = dispute.amount_cents as number;
    const nextStatus = dispute.status === "submitted" ? "reviewing" : "resolved";
    try {
      inTransaction(db, () => {
        db.prepare("UPDATE disputes SET status = ?, updated_at = ? WHERE id = ?").run(nextStatus, now(), disputeId);
        if (nextStatus === "resolved") {
          const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(disputeUserId) as
            | { id: number; balance_cents: number }
            | undefined;
          if (account) {
            db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?")
              .run(account.balance_cents + disputeCents, now(), account.id);
            db.prepare(
              `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, performed_by, created_at)
               VALUES (?, ?, ?, ?, 'Operations', 'Adjustment', ?, 'cleared', ?, ?, ?, ?)`,
            ).run(rid("txn"), account.id, disputeUserId, `Dispute credit · ${dispute.merchant}`,
              disputeCents, rid("VYR").toUpperCase().replace("_", "-"),
              `Resolved dispute ${disputeId}`, req.user!.id, now());
          }
        }
      });
      audit(req, "dispute.resolve", "Risk", `user:${disputeUserId} · ${dispute.merchant}`,
        `${nextStatus === "resolved" ? "Resolved" : "Moved to reviewing"} dispute for ${dispute.merchant} ($${centsToDecimal(disputeCents)}).`);
      if (nextStatus === "resolved") {
        notify(disputeUserId, "security", "Dispute resolved",
          `$${centsToDecimal(disputeCents)} was returned to your account.`);
      }
      res.json({ status: nextStatus });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Action failed." });
    }
  }));

  /* ============================== admin: staff & roles ============================== */

  app.get("/api/admin/staff", requireAuth, requirePerm("staff.manage"), wrap((_req, res) => {
    const staff = db.prepare("SELECT id, name, email, role, status FROM users WHERE role != 'user' ORDER BY role").all();
    const members = db.prepare("SELECT id, name, email, account_type FROM users WHERE role = 'user' ORDER BY created_at DESC LIMIT 50").all();
    res.json({ staff, members });
  }));

  app.post("/api/admin/staff/:id/role", requireAuth, requirePerm("staff.manage"), wrap((req, res) => {
    if (String(req.params.id) === req.user!.id) return void res.status(400).json({ error: "You cannot change your own role." });
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "User not found." });
    const role = String(req.body?.role ?? "");
    if (!["user", "support", "compliance", "admin", "superadmin"].includes(role)) {
      return void res.status(400).json({ error: "Unknown role." });
    }
    if (target.role === "superadmin" && role !== "superadmin") {
      return void res.status(400).json({ error: "A Super Admin cannot be demoted from here." });
    }
    const before = target.role as string;
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, String(req.params.id));
    audit(req, role === "user" ? "staff.demote" : "staff.promote", "Access",
      `user:${String(req.params.id)} · ${target.name}`, "Changed role.", ROLE_LABELS[before as keyof typeof ROLE_LABELS] ?? before, ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role);
    res.json({ role });
  }));

  app.get("/api/admin/roles", requireAuth, requirePerm("roles.manage"), wrap((_req, res) => {
    const roles = (["support", "compliance", "admin", "superadmin"] as StaffRole[]).map(role => ({
      role,
      label: ROLE_LABELS[role],
      permissions: rolePermissions(db, role),
      defaults: ROLE_DEFAULTS[role],
      hasOverride: Boolean(db.prepare("SELECT 1 FROM role_permissions WHERE role = ?").get(role)),
    }));
    res.json({ roles, permissions: PERMISSIONS });
  }));

  app.put("/api/admin/roles", requireAuth, requirePerm("roles.manage"), wrap((req, res) => {
    const role = String(req.body?.role ?? "") as StaffRole;
    if (!["support", "compliance", "admin"].includes(role)) {
      return void res.status(400).json({ error: "Only support, compliance and admin grants can be edited — Super Admin always has every permission." });
    }
    if (!Array.isArray(req.body?.permissions)) return void res.status(400).json({ error: "A permissions list is required." });
    const before = rolePermissions(db, role);
    const after = setRolePermissions(db, role, req.body.permissions as Permission[]);
    audit(req, "roles.update", "Access", `role:${role}`,
      `Updated permissions (${after.length} granted).`, `${before.length} granted`, `${after.length} granted`);
    res.json({ role, permissions: after });
  }));

  app.post("/api/admin/roles/reset", requireAuth, requirePerm("roles.manage"), wrap((req, res) => {
    const role = String(req.body?.role ?? "") as StaffRole;
    if (!["support", "compliance", "admin"].includes(role)) return void res.status(400).json({ error: "Unknown role." });
    const before = rolePermissions(db, role);
    const after = resetRolePermissions(db, role);
    audit(req, "roles.reset", "Access", `role:${role}`, "Reset to default grants.", `${before.length} granted`, `${after.length} granted`);
    res.json({ role, permissions: after });
  }));

  /* ============================== admin: audit, broadcasts, reports, settings ============================== */

  app.get("/api/admin/audit", requireAuth, requirePerm("audit.view"), wrap((req, res) => {
    const category = String(req.query.category ?? "all");
    const q = String(req.query.q ?? "").toLowerCase();
    let rows = db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT 500").all() as Array<Record<string, unknown>>;
    if (category !== "all") rows = rows.filter(r => r.category === category);
    if (q) rows = rows.filter(r => `${r.admin_name} ${r.action} ${r.target} ${r.summary}`.toLowerCase().includes(q));
    res.json({ entries: rows.slice(0, 200) });
  }));

  app.get("/api/admin/audit/export.csv", requireAuth, requirePerm("audit.view"), wrap((_req, res) => {
    const rows = db.prepare("SELECT * FROM audit_log ORDER BY at DESC").all() as Array<Record<string, unknown>>;
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="veyra-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv([
      ["Timestamp", "Admin", "Action", "Category", "Target", "Summary", "Before", "After"],
      ...rows.map((r): Array<string | number> => [new Date(r.at as number).toISOString(), String(r.admin_name ?? ""), String(r.action ?? ""), String(r.category ?? ""), String(r.target ?? ""), String(r.summary ?? ""), r.before_value == null ? "" : String(r.before_value), r.after_value == null ? "" : String(r.after_value)]),
    ]));
  }));

  app.post("/api/admin/broadcasts", requireAuth, requirePerm("notifications.broadcast"), wrap((req, res) => {
    const title = String(req.body?.title ?? "").trim();
    const detail = String(req.body?.detail ?? "").trim();
    const audience = req.body?.audience ?? "all";
    if (!title || !detail) return void res.status(400).json({ error: "Title and message are required." });
    // A mistyped audience must not silently broadcast platform-wide.
    if (!["all", "business", "personal", "unverified"].includes(String(audience))) {
      return void res.status(400).json({ error: "audience must be all, business, personal or unverified." });
    }
    const targets = db.prepare("SELECT id, account_type FROM users WHERE role = 'user'").all() as Array<{ id: string; account_type: string }>;
    const audienceFilter = (u: { id: string; account_type: string }) => {
      if (audience === "business") return u.account_type === "business";
      if (audience === "personal") return u.account_type === "personal";
      if (audience === "unverified") {
        const kyc = db.prepare("SELECT status FROM kyc_records WHERE user_id = ?").get(u.id) as { status: string } | undefined;
        return kyc?.status !== "approved";
      }
      return true;
    };
    let delivered = 0;
    inTransaction(db, () => {
      for (const u of targets.filter(audienceFilter)) {
        notify(u.id, "info", title, detail);
        delivered++;
      }
    });
    audit(req, "notification.broadcast", "Comms", `platform · ${audience}`,
      `Broadcast "${title}" delivered to ${delivered} member${delivered === 1 ? "" : "s"}.`);
    res.json({ delivered });
  }));

  // The ledger export serves the Reports tab and the Transactions console, so
  // either of their permissions opens it (`transactions.export` gated only the
  // button before this, and the button's holder was refused by the route).
  app.get("/api/admin/reports/:kind.csv", requireAuth, requireAnyPerm("reports.view", "transactions.export"), wrap((req, res) => {
    const kind = String(req.params.kind);
    // `transactions.export` is the ledger console's export permission: it opens
    // the ledger file only, not the customer directory, balances or KYC status.
    if (kind !== "transactions" && !can(db, req.user!.role, "reports.view")) {
      return void res.status(403).json({ error: "Access denied — exporting reports requires the reports.view permission." });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    let rows: Array<Array<string | number>>;
    if (kind === "customers") {
      rows = [["ID", "Name", "Email", "Phone", "Business", "Type", "Plan", "Status", "Role"],
        ...db.prepare("SELECT id, name, email, phone, business, account_type, plan, status, role FROM users ORDER BY created_at").all()
          .map((r: any) => [r.id, r.name, r.email, r.phone, r.business, r.account_type, r.plan, r.status, r.role])];
    } else if (kind === "accounts") {
      // Columns mirror the Accounts console: the same counts (cards, frozen
      // cards, transactions incl. how many are pending), KYC standing, status
      // and last activity, computed from the same source of truth.
      rows = [["User ID", "Member", "Email", "Business", "Type", "Account number", "Balance", "Pending", "Rewards", "Cards", "Frozen cards", "Transactions", "Pending transactions", "KYC", "Status", "Last activity"],
        ...db.prepare(`SELECT a.user_id, u.name, u.email, u.business, u.account_type, u.status, a.account_number,
                              a.balance_cents, a.pending_cents, a.rewards_cents,
                              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS card_count,
                              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.frozen = 1) AS frozen_count,
                              (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txn_count,
                              (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.status = 'pending') AS pending_count,
                              (SELECT status FROM kyc_records k WHERE k.user_id = u.id) AS kyc_status,
                              (SELECT MAX(created_at) FROM transactions t WHERE t.user_id = u.id) AS last_activity
                       FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY a.balance_cents DESC`).all()
          .map((r: any) => [r.user_id, r.name, r.email, r.business ?? "", r.account_type, r.account_number,
            centsToDecimal(r.balance_cents), centsToDecimal(r.pending_cents), centsToDecimal(r.rewards_cents),
            r.card_count, r.frozen_count, r.txn_count, r.pending_count, r.kyc_status ?? "not_started", r.status,
            r.last_activity ? new Date(r.last_activity).toISOString() : "Never"])];
    } else if (kind === "transactions") {
      rows = [["Date", "Member", "Merchant", "Category", "Method", "Amount", "Status", "Reference"],
        ...db.prepare(`SELECT t.*, u.name AS member FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`).all()
          .map((r: any) => [new Date(r.created_at).toISOString(), r.member, r.merchant, r.category, r.method, centsToDecimal(r.amount_cents), r.status, r.reference])];
    } else if (kind === "kyc") {
      // Status columns plus the columns the review queue shows for a submitted
      // case (submitted date, legal name, document, file count, source of
      // funds) — one file covers both KYC views in the console.
      rows = [["User ID", "Member", "Email", "Type", "KYC status", "Completeness", "Submitted", "Legal name", "Document", "Files", "Source of funds", "Requested at", "Updated"],
        ...db.prepare(`SELECT k.user_id, u.name, u.email, u.account_type, k.status, k.completeness,
                              k.document_type, k.submission_json, k.requested_at, k.updated_at
                       FROM kyc_records k JOIN users u ON u.id = k.user_id`).all()
          .map((r: any) => {
            let submission: { submittedAt?: number; legalName?: string; documentType?: string; documents?: unknown[]; source?: string } = {};
            try { submission = r.submission_json ? JSON.parse(String(r.submission_json)) : {}; } catch { /* unreadable submission — export the status columns only */ }
            return [r.user_id, r.name, r.email, r.account_type, r.status, `${r.completeness}%`,
              submission.submittedAt ? new Date(submission.submittedAt).toISOString() : "—",
              submission.legalName || "—",
              submission.documentType || r.document_type || "—",
              Array.isArray(submission.documents) ? submission.documents.length : 0,
              submission.source || "—",
              r.requested_at ? new Date(r.requested_at).toISOString() : "—", new Date(r.updated_at).toISOString()];
          })];
    } else {
      return void res.status(404).json({ error: "Unknown report. Use customers|accounts|transactions|kyc." });
    }
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="veyra-${kind}-${stamp}.csv"`);
    res.send(toCsv(rows));
  }));

  app.get("/api/admin/settings", requireAuth, requirePerm("settings.manage"), wrap((_req, res) => {
    const rows = db.prepare("SELECT key, value, updated_at, updated_by FROM settings").all();
    res.json({ settings: Object.fromEntries(rows.map((r: any) => [r.key, r.value])) });
  }));

  app.put("/api/admin/settings", requireAuth, requirePerm("settings.manage"), wrap((req, res) => {
    const { coreApy, paymentRails } = req.body ?? {};
    const updates: Array<[string, string]> = [];
    if (coreApy !== undefined) {
      const apy = parseFloat(String(coreApy));
      if (!Number.isFinite(apy) || apy < 0 || apy > 25) return void res.status(400).json({ error: "APY must be between 0 and 25." });
      updates.push(["core_apy", apy.toFixed(2)]);
    }
    if (paymentRails !== undefined) {
      if (paymentRails !== "operational" && paymentRails !== "halted") {
        return void res.status(400).json({ error: "paymentRails must be 'operational' or 'halted'." });
      }
      updates.push(["payment_rails", paymentRails]);
    }
    for (const [key, value] of updates) {
      const before = getSetting(db, key);
      setSetting(db, key, value, req.user!.id);
      audit(req, key === "payment_rails" ? (value === "halted" ? "system.halt" : "system.resume") : "settings.save",
        "System", "platform", `Updated ${key} to ${value}.`, before, value);
    }
    res.json({ settings: Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r: any) => [r.key, r.value])) });
  }));

  /* ============================== admin: aggregate state ============================== */

  // One round trip for the Super Admin console: users, account summaries,
  // platform ledger, disputes, KYC queue, audit trail, role matrix and
  // settings — in the exact shapes src/pages/SuperAdmin.tsx consumes.
  app.get("/api/admin/state", requireAuth, requirePerm("dashboard.view"), wrap((_req, res) => {
    const users = (db.prepare(
      "SELECT id, name, email, phone, business, account_type, role, plan, avatar_url, created_at FROM users ORDER BY created_at",
    ).all() as Array<Record<string, unknown>>).map(u => ({
      id: String(u.id), name: String(u.name), email: String(u.email), phone: String(u.phone ?? ""),
      business: String(u.business ?? ""), accountType: u.account_type as "personal" | "business",
      avatarUrl: String(u.avatar_url ?? "/images/avatar-3d-default.svg"), role: u.role as string,
      plan: u.plan as "Starter" | "Pro", createdAt: u.created_at as number,
    }));

    const accounts = (db.prepare(`
      SELECT u.id, u.name, u.email, u.business, u.account_type, u.status,
             a.balance_cents, a.pending_cents, a.rewards_cents,
             (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS card_count,
             (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.frozen = 1) AS frozen_count,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txn_count,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.status = 'pending') AS pending_txn_count,
             (SELECT MAX(created_at) FROM transactions t WHERE t.user_id = u.id) AS last_activity,
             (SELECT status FROM kyc_records k WHERE k.user_id = u.id) AS kyc_status
      FROM users u LEFT JOIN accounts a ON a.user_id = u.id
      WHERE u.role = 'user' OR u.role IS NULL
      ORDER BY u.created_at
    `).all() as Array<Record<string, unknown>>).map(a => ({
      userId: String(a.id), name: String(a.name), email: String(a.email), business: String(a.business ?? ""),
      accountType: a.account_type as "personal" | "business",
      hasAccount: a.balance_cents != null,
      balance: Math.round((a.balance_cents as number ?? 0)) / 100,
      pendingBalance: Math.round((a.pending_cents as number ?? 0)) / 100,
      rewards: Math.round((a.rewards_cents as number ?? 0)) / 100,
      cards: a.card_count as number,
      frozenCards: a.frozen_count as number,
      txnCount: a.txn_count as number,
      pendingTxns: a.pending_txn_count as number,
      kycStatus: (a.kyc_status as string) ?? "not_started",
      accountStatus: a.status === "restricted" ? "restricted" : "active",
      lastActivity: (a.last_activity as number) ?? 0,
    }));

    const transactions = (db.prepare(`
      SELECT t.*, u.name AS member_name FROM transactions t JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 400
    `).all() as Array<Record<string, unknown>>).map(t => ({
      id: String(t.id), merchant: String(t.merchant), category: String(t.category),
      amount: Math.round(t.amount_cents as number) / 100,
      reward: Math.round((t.reward_cents as number ?? 0)) / 100,
      scout: Math.round((t.scout_cents as number ?? 0)) / 100,
      date: t.created_at as number, cardId: t.card_id ? String(t.card_id) : undefined,
      note: String(t.note ?? ""), method: String(t.method ?? ""), reference: String(t.reference ?? ""),
      status: t.status as string, userId: String(t.user_id), memberName: String(t.member_name),
    }));

    const disputes = (db.prepare(`
      SELECT d.*, u.name AS member_name FROM disputes d JOIN users u ON u.id = d.user_id
      ORDER BY d.opened_at DESC
    `).all() as Array<Record<string, unknown>>).map(d => ({
      id: String(d.id), transactionId: d.transaction_id ? String(d.transaction_id) : undefined,
      merchant: String(d.merchant), amount: Math.round(d.amount_cents as number) / 100,
      reason: String(d.reason), detail: String(d.detail ?? ""), status: d.status as string,
      openedAt: d.opened_at as number, updatedAt: d.updated_at as number,
      userId: String(d.user_id), memberName: String(d.member_name),
    }));

    const kycQueue = (db.prepare(`
      SELECT u.id, u.name, u.email, u.business, u.account_type, k.*
      FROM users u JOIN kyc_records k ON k.user_id = u.id
      WHERE k.status = 'in_review' AND u.role = 'user'
      ORDER BY k.updated_at
    `).all() as Array<Record<string, unknown>>).map(r => {
      const requester = r.requested_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(String(r.requested_by)) as { name: string } | undefined) : undefined;
      return {
        userId: String(r.id), name: String(r.name), email: String(r.email), business: String(r.business ?? ""),
        accountType: r.account_type as "personal" | "business",
        kyc: {
          status: r.status, completeness: r.completeness, lastUpdated: r.updated_at,
          nextStep: String(r.next_step ?? ""), documentType: String(r.document_type ?? ""),
          country: String(r.country ?? ""), requestedAt: r.requested_at as number | undefined,
          requestedBy: requester?.name, requestReason: r.request_reason ? String(r.request_reason) : undefined,
          requirements: JSON.parse(String(r.request_reqs_json ?? "[]")),
          submission: r.submission_json ? JSON.parse(String(r.submission_json)) : undefined,
        },
      };
    });

    const auditEntries = (db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT 500").all() as Array<Record<string, unknown>>).map(e => ({
      id: String(e.id), at: e.at as number, adminId: String(e.admin_id), adminName: String(e.admin_name),
      action: String(e.action), category: e.category as string, target: String(e.target),
      summary: String(e.summary), before: e.before_value ? String(e.before_value) : undefined,
      after: e.after_value ? String(e.after_value) : undefined,
    }));

    const roles = Object.fromEntries(
      (["support", "compliance", "admin", "superadmin"] as const).map(r => [r, rolePermissions(db, r)]),
    );

    const settingsRows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

    res.json({ users, accounts, transactions, disputes, kycQueue, audit: auditEntries, roles, settings });
  }));

  /* ============================== errors ============================== */

  /**
   * Serve the built app from the same origin as the API when `dist/` exists
   * (`npm run build`). One process, one port, no proxy: the preview — and any
   * deployment of the built bundle — gets the app and `/api` together, which
   * removes the whole class of "the frontend is up but its API isn't" failures.
   * Registered before the JSON 404 so a page request is never answered with
   * `{"error":"Not found."}`, and never for /api so routes above always win.
   */
  const distIndex = resolve("dist/index.html");
  if (existsSync(distIndex)) {
    app.use(express.static(resolve("dist"), { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(distIndex);
    });
  }

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err: Error & { status?: number; statusCode?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    // Malformed caller input is a 400, not a server fault. Everything else is
    // an internal error, logged server-side and never leaked as a stack trace.
    if (err instanceof BadInputError) return void res.status(400).json({ error: err.message });
    // body-parser tags its own client errors: malformed JSON (400) and bodies
    // over the 256 kb limit (413). Passing them through would mask a caller
    // mistake as a 500.
    const status = Number(err.status ?? err.statusCode);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const message = status === 413 ? "Request body is too large." : "Malformed request body.";
      return void res.status(status).json({ error: message });
    }
    console.error("[api]", err.message);
    res.status(500).json({ error: "Internal server error." });
  });

  return { app, db };
}

/* ---------- helpers ---------- */

const money = (cents: number) => ({ cents, amount: centsToDecimal(cents) });

function publicUser(u: AuthedUser) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, accountType: u.accountType, business: u.business, status: u.status };
}

function txnOut(t: any) {
  return {
    id: t.id, merchant: t.merchant, category: t.category, method: t.method,
    amount: money(t.amount_cents), status: t.status, reference: t.reference,
    note: t.note, date: t.created_at, memberName: t.member_name ?? undefined,
  };
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
