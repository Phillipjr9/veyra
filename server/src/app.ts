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
import { randomUUID } from "node:crypto";
import { openDb, inTransaction, getSetting, setSetting, dollarsToCents, centsToDecimal, now, rid } from "./db.js";
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimit, TOKEN_TTL_MS } from "./security.js";
import {
  can, isStaffRole, rolePermissions, setRolePermissions, resetRolePermissions,
  PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, type Permission, type StaffRole,
} from "./rbac.js";
import { logAdminAction } from "./audit.js";
import { seed } from "./seed.js";

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

  const audit = (req: Request, action: string, category: Parameters<typeof logAdminAction>[1]["category"], target: string, summary: string, before?: string, after?: string) =>
    logAdminAction(db, { adminId: req.user!.id, adminName: req.user!.name, action, category, target, summary, before, after });

  const notify = (userId: string, type: string, title: string, detail: string) =>
    db.prepare("INSERT INTO notifications (id, user_id, type, title, detail, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .run(rid("n"), userId, type, title, detail, now());

  /* ============================== health ============================== */

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get(); // prove the database handle is alive
    res.json({ ok: true, service: "veyra-api", db: "sqlite", uptimeSec: Math.floor(process.uptime()), time: now() });
  });

  /* ============================== auth routes ============================== */

  app.post("/api/auth/login", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`login:${ip}`)) return void res.status(429).json({ error: "Too many attempts — try again in a minute." });
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return void res.status(400).json({ error: "Email and password are required." });
    }
    const row = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as
      | (AuthedUser & { password_hash: string; account_type: string })
      | undefined;
    // Constant-ish response regardless of which factor failed.
    if (!row || !verifyPassword(password, row.password_hash)) {
      return void res.status(401).json({ error: "Email or password doesn't match our records." });
    }
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, row.id, now(), now() + TOKEN_TTL_MS);
    const user = loadUser(row.id)!;
    res.json({ token: signToken({ sub: row.id, jti: tokenId, role: user.role }), user: publicUser(user) });
  }));

  app.post("/api/auth/register", wrap((req, res) => {
    const { name, email, password, accountType, business } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) return void res.status(400).json({ error: "Name is required." });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return void res.status(400).json({ error: "A valid email is required." });
    if (typeof password !== "string" || password.length < 8) return void res.status(400).json({ error: "Use at least 8 characters for your password." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      return void res.status(409).json({ error: "An account with that email already exists." });
    }
    const type = accountType === "personal" ? "personal" : "business";
    if (type === "business" && typeof business !== "string" && !business) {
      return void res.status(400).json({ error: "Business name is required for a business account." });
    }
    const id = rid("u");
    const accountNumber = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join("");
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at)
         VALUES (?, ?, ?, '', ?, ?, 'user', 'Pro', ?, 'active', ?)`,
      ).run(id, name.trim(), email, typeof business === "string" ? business : "", type, hashPassword(password), now());
      db.prepare(
        `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
         VALUES (?, ?, '091408735', 'Northfield Bank', 0, 0, 0, ?, ?)`,
      ).run(id, accountNumber, now(), now());
      db.prepare("INSERT INTO kyc_records (user_id, status, completeness, updated_at) VALUES (?, 'not_started', 0, ?)").run(id, now());
    });
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, id, now(), now() + TOKEN_TTL_MS);
    const user = loadUser(id)!;
    res.status(201).json({ token: signToken({ sub: id, jti: tokenId, role: user.role }), user: publicUser(user) });
  }));

  app.post("/api/auth/logout", requireAuth, wrap((req, res) => {
    const token = req.headers.authorization!.slice(7);
    const payload = verifyToken(token);
    if (payload) db.prepare("UPDATE sessions SET revoked = 1 WHERE token_id = ?").run(payload.jti);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", requireAuth, wrap((req, res) => {
    res.json({ user: publicUser(req.user!) });
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
    const source = String(req.body?.source ?? "External transfer");
    const result = inTransaction(db, () => {
      const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
        | { id: number; balance_cents: number }
        | undefined;
      if (!account) throw new Error("No account found.");
      const after = account.balance_cents + cents;
      db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(after, now(), account.id);
      const txn = {
        id: rid("txn"), accountId: account.id, merchant: source, category: "Operations",
        method: "ACH", cents, reference: rid("VYR").toUpperCase().replace("_", "-"),
      };
      db.prepare(
        `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
         VALUES (?, ?, ?, ?, 'Operations', 'ACH', ?, 'cleared', ?, 'External deposit', ?)`,
      ).run(txn.id, account.id, req.user!.id, txn.merchant, cents, txn.reference, now());
      return { ...txn, balanceAfter: after };
    });
    res.status(201).json({ transaction: { id: result.id, merchant: result.merchant, amount: money(result.cents), reference: result.reference, status: "cleared" }, balance: money(result.balanceAfter) });
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
    try {
      const result = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number }
          | undefined;
        if (!account) throw new Error("No account found.");
        if (account.balance_cents < cents) throw new Error("Insufficient funds for this transfer.");
        const after = account.balance_cents - cents;
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(after, now(), account.id);
        const txn = {
          id: rid("txn"), accountId: account.id, reference: rid("VYR").toUpperCase().replace("_", "-"),
        };
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'cleared', ?, '', ?)`,
        ).run(txn.id, account.id, req.user!.id, counterparty,
          String(req.body?.category ?? "Operations"), String(req.body?.method ?? "ACH"), -cents, txn.reference, now());
        return { ...txn, balanceAfter: after };
      });
      res.status(201).json({ transaction: { id: result.id, merchant: counterparty, amount: money(-cents), reference: result.reference, status: "cleared" }, balance: money(result.balanceAfter) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Transfer failed." });
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
    const id = rid("dsp");
    db.prepare(
      `INSERT INTO disputes (id, user_id, transaction_id, merchant, amount_cents, reason, detail, status, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
    ).run(id, req.user!.id, txnId, txn ? (txn.merchant as string) : String(req.body?.merchant ?? "Unknown merchant"),
      cents, reason, String(req.body?.detail ?? ""), now(), now());
    res.status(201).json({ dispute: { id, status: "submitted" } });
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
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
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
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const cents = dollarsToCents(req.body?.amount ?? 0);
    const direction = req.body?.direction === "debit" ? "debit" : "credit";
    const memo = String(req.body?.memo ?? "").trim();
    if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
    if (cents > MAX_ADJUSTMENT_CENTS) return void res.status(400).json({ error: "Adjustments are limited to $10,000,000." });
    if (!memo) return void res.status(400).json({ error: "An audit reason is required." });
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
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, status, reference, note, performed_by, created_at)
           VALUES (?, ?, ?, ?, 'Operations', 'Adjustment', ?, 'cleared', ?, ?, ?, ?)`,
        ).run(txn.id, account.id, String(req.params.id), `Treasury adjustment (${direction})`, delta,
          txn.reference, memo, req.user!.id, now());
        return { before: account.balance_cents, after, reference: txn.reference };
      });
      audit(req, "balance.adjust", "Financial", `user:${String(req.params.id)} · ${target.name}`,
        `${direction === "credit" ? "Credited" : "Debited"} ${centsToDecimal(cents)} — ${memo}.`,
        centsToDecimal(result.before), centsToDecimal(result.after));
      notify(String(req.params.id), direction === "credit" ? "transfer" : "security",
        direction === "credit" ? "Funds credited by Veyra" : "Adjustment applied to your account",
        `${direction === "credit" ? "+" : "−"}$${centsToDecimal(cents)} · ${memo}. New balance $${centsToDecimal(result.after)}.`);
      res.json({ before: money(result.before), after: money(result.after), reference: result.reference });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Adjustment failed." });
    }
  }));

  /** Restrict / restore an account. Restriction blocks the member's transfers server-side. */
  app.post("/api/admin/members/:id/status", requireAuth, requirePerm("accounts.set_status"), wrap((req, res) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const status = req.body?.status === "restricted" ? "restricted" : "active";
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
        `INSERT INTO kyc_records (user_id, status, completeness, updated_at, requested_by, requested_at, request_reason)
         VALUES (?, 'requested', 72, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'requested', requested_by = excluded.requested_by,
           requested_at = excluded.requested_at, request_reason = excluded.request_reason, updated_at = excluded.updated_at`,
      ).run(targetId, now(), req.user!.name, now(), reason);
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
    const audience = String(req.body?.audience ?? "all");
    if (!title || !detail) return void res.status(400).json({ error: "Title and message are required." });
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

  app.get("/api/admin/reports/:kind.csv", requireAuth, requirePerm("reports.view"), wrap((req, res) => {
    const kind = String(req.params.kind);
    const stamp = new Date().toISOString().slice(0, 10);
    let rows: Array<Array<string | number>>;
    if (kind === "customers") {
      rows = [["ID", "Name", "Email", "Phone", "Business", "Type", "Plan", "Status", "Role"],
        ...db.prepare("SELECT id, name, email, phone, business, account_type, plan, status, role FROM users ORDER BY created_at").all()
          .map((r: any) => [r.id, r.name, r.email, r.phone, r.business, r.account_type, r.plan, r.status, r.role])];
    } else if (kind === "accounts") {
      rows = [["User ID", "Member", "Account number", "Balance", "Pending", "Rewards"],
        ...db.prepare(`SELECT a.user_id, u.name, a.account_number, a.balance_cents, a.pending_cents, a.rewards_cents
                       FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY a.balance_cents DESC`).all()
          .map((r: any) => [r.user_id, r.name, r.account_number, centsToDecimal(r.balance_cents), centsToDecimal(r.pending_cents), centsToDecimal(r.rewards_cents)])];
    } else if (kind === "transactions") {
      rows = [["Date", "Member", "Merchant", "Category", "Method", "Amount", "Status", "Reference"],
        ...db.prepare(`SELECT t.*, u.name AS member FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`).all()
          .map((r: any) => [new Date(r.created_at).toISOString(), r.member, r.merchant, r.category, r.method, centsToDecimal(r.amount_cents), r.status, r.reference])];
    } else if (kind === "kyc") {
      rows = [["User ID", "Member", "Status", "Completeness", "Updated"],
        ...db.prepare(`SELECT k.user_id, u.name, k.status, k.completeness, k.updated_at FROM kyc_records k JOIN users u ON u.id = k.user_id`).all()
          .map((r: any) => [r.user_id, r.name, r.status, `${r.completeness}%`, new Date(r.updated_at).toISOString()])];
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

  /* ============================== errors ============================== */

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err.message);
    res.status(500).json({ error: "Internal server error." }); // never leak stack traces
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
