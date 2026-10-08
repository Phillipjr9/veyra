import { sendCryptoNotification } from "./cryptoNotifications.js";
import { previewCryptoEnabled } from "./previewCrypto.js";
import { createPreviewAccess } from "./previewAccess.js";
import { createCryptoWorkspace } from "./cryptoWorkspace.js";
import { readLedgerAnalytics } from "./ledgerAnalytics.js";
import { createDemoPayments, demoPaymentsEnabled } from "./demoPayments.js";
import { createBulkAccounts } from "./bulkAccounts.js";
import { sendZelleNotification } from "./zelleNotifications.js";
import { ASSETS } from "../../shared/catalog.js";
import { createBanking } from "./banking.js";
import { createIntegrations } from "./integrations.js";
import { integrationById } from "../../shared/integrations.js";
import { createStripeRails, StripeError } from "./stripe.js";
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
import { addressConfig, createAddressService } from "./addresses.js";
import { enforceTeamSpend, TeamSpendingError } from "./teamSpending.js";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, inTransaction, getSetting, setSetting, dollarsToCents, centsToDecimal, now, rid, BadInputError, generateAccountNumber, generateVeyraId } from "./db.js";
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimit, failureBudgetExceeded, recordFailure, clearFailures, TOKEN_TTL_MS } from "./security.js";
import { requireRecaptcha, publicRecaptchaConfig, RECAPTCHA_ACTIONS } from "./recaptcha.js";
import { verifyFirebaseIdToken, federatedConfig, publicFederatedConfig, PROVIDER_REGISTRY } from "./federated.js";
import {
  webauthnConfig, issueChallenge, verifyRegistration, verifyAuthentication,
  registrationOptions, authenticationOptions,
} from "./webauthn.js";
import {
  can, isStaffRole, rolePermissions, setRolePermissions, resetRolePermissions,
  PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, type Permission, type StaffRole,
} from "./rbac.js";
import { logAdminAction } from "./audit.js";
import { validateApplication, rowToApplication, memberIdentity, submissionFor, PROFILE_COLUMNS } from "./identity.js";
import { seed } from "./seed.js";
import { sendMail, mailDelivers, passwordResetMail, applicationReceivedMail, kycDecisionMail, supportReceivedMail, supportReplyMail, supportInboxMail, teamInviteMail } from "./mail.js";
import { buildMemberState, cardNumbers, rewardRate, makeReference } from "./state.js";
import { createVeyraTransfers } from "./veyraTransfers.js";
import { parseUnits, formatUnitsTrimmed, valueInCents, unitsForCents } from "./money.js";
import { listAssets, assetByCode, tradingEnabled } from "./assets.js";
import { loadPrices, loadMarkets, quoteIsFresh, tradableQuote, loadCandles, isCandleRange, CANDLE_RANGES } from "./prices.js";
import { OTHER_REASON_CODE, SUSPENSION_REASONS, resolveSuspensionReason } from "./suspension.js";
import { authenticatorUri, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, verifyTotp } from "./totp.js";
import { applyFee, quoteFee } from "../../shared/fees.js";

export type AuthedUser = {
  id: string; name: string; email: string; role: string;
  accountType: "personal" | "business"; status: string; business: string;
  /**
   * Team access: when a teammate is signed in, `id` (and the account fields)
   * are the business OWNER's — every /api/me route then acts on the shared
   * business — while `loginId` is the teammate's own user id, used for
   * anything that belongs to the person (password, sessions, audit actor).
   */
  loginId?: string;
  teamRole?: TeamRole;
};
export type TeamRole = "Admin" | "Member" | "Bookkeeper";

/**
 * What each team role may do on the owner's account. Allow-list: anything not
 * listed is refused. Identity-bound routes (the owner's ID application,
 * passkeys, device sessions and two-step sign-in) are never available to
 * teammates.
 */
const TEAM_NEVER = /^\/api\/me\/(profile|kyc|passkeys|sessions|security|rails)(\/|$)/;
const TEAM_ALL_WRITE = /^\/api\/me\/(notifications|support)(\/|$)/;
const TEAM_MEMBER_WRITE = /^\/api\/me\/(transfers|deposits|holdings\/trade|cards|invoices|payees|scheduled|pockets|budgets|disputes|scout\/apply|perks)(\/|$)/;
const TEAM_ADMIN_WRITE = /^\/api\/me\/(team|preferences|rewards\/redeem)(\/|$)/;
export function teamAllows(method: string, path: string, role: TeamRole): boolean {
  if (path.startsWith("/api/auth/")) return true; // me / logout / change-password — scoped to the login below
  if (!path.startsWith("/api/me/")) return false;
  if (TEAM_NEVER.test(path)) return false;
  if (method === "GET" || method === "HEAD") return true;
  if (method === "POST" && path === "/api/me/crypto/wallet-balance") return true; // Read-only RPC adapter, no financial mutation.
  if (TEAM_ALL_WRITE.test(path)) return true;
  if (role === "Bookkeeper") return false;
  if (TEAM_MEMBER_WRITE.test(path)) return true;
  return role === "Admin" && TEAM_ADMIN_WRITE.test(path);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      /** Raw credential accepted by requireAuth (Authorization or X-Veyra-Token header). */
      authToken?: string;
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
  if (err instanceof TeamSpendingError) return void res.status(err.status).json({ error: err.message, code: err.code, ...err.details });
  if (err instanceof RouteError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof BadInputError) return void res.status(400).json({ error: err.message });
  res.status(400).json({ error: err instanceof Error ? err.message : fallback });
};

const MAX_TRANSFER_CENTS = 250_000_00;      // $250k per transfer

/**
 * What a reviewer can ask an applicant for. Deliberately a short, closed list:
 * these map onto the documents the member's application screen knows how to ask
 * for, so "we need more" never turns into an unactionable sentence.
 */
const REVIEW_REQUIREMENTS: readonly string[] = ["identity", "address", "selfie", "funds"];
const requirementLabel = (key: string | number): string =>
  ({ identity: "a government photo ID", address: "proof of address", selfie: "a selfie holding your ID", funds: "proof of the funds" } as Record<string, string>)[key] ?? key;
const MAX_ADJUSTMENT_CENTS = 10_000_000_00; // $10M per admin adjustment

export function createApp(dbPath?: string) {
  const db = openDb(dbPath);
  seed(db);

  const app = express();
  const stripeRails = createStripeRails(db);
  app.disable("x-powered-by");
  // Stripe signs the exact bytes it sends. This route MUST precede express.json
  // so the signature is checked against the unparsed payload. It is unauthenticated
  // by design; the Stripe signature is its credential.
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeRails.webhook);
  // Every /api response is per-session and may be read on a shared computer:
  // an ETag/304 lets the browser replay one member's cached body after another
  // member signs in, so responses are never stored and never revalidated.
  app.disable("etag");
  // A proxy is trusted only when the deployment says the process is not directly
  // internet-facing. This makes req.ip useful for rate limits without accepting
  // attacker-controlled X-Forwarded-For headers on a directly exposed server.
  app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
  app.use(express.json({ limit: "256kb" }));
  const corsOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map(origin => origin.trim().replace(/\/$/, "")).filter(Boolean);
  const production = process.env.NODE_ENV === "production";
  app.use((req, res, next) => {
    const origin = String(req.header("origin") ?? "").replace(/\/$/, "");
    const host = req.get("host");
    const requestOrigin = host ? `${req.protocol}://${host}`.replace(/\/$/, "") : "";
    // Same-origin requests are always safe; a browser only gets CORS permission
    // for an explicitly configured secondary origin. Development retains its
    // open preview behavior, while production never emits a wildcard.
    const sameOrigin = Boolean(origin && requestOrigin && origin === requestOrigin);
    const wildcardDev = !production && (corsOrigins.includes("*") || !corsOrigins.length);
    const allowedCrossOrigin = Boolean(origin && (wildcardDev || corsOrigins.includes(origin)));
    if (origin && !sameOrigin && !allowedCrossOrigin) {
      if (req.method === "OPTIONS") return void res.status(403).json({ error: "Origin is not allowed." });
      return void res.status(403).json({ error: "Origin is not allowed." });
    }

    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      // The app uses hash routing, so no user input belongs in a path that can
      // drive navigation. This also prevents hostile <base> elements if an XSS
      // is ever found elsewhere.
      "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://apis.google.com; connect-src 'self' https://www.google.com https://www.recaptcha.net https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com; frame-src https://www.google.com https://www.recaptcha.net;",
    });
    if (production) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (origin && (sameOrigin || allowedCrossOrigin)) {
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Origin", wildcardDev ? "*" : origin);
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veyra-Token, X-Veyra-Device");
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return void res.sendStatus(204);
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
      "SELECT id, name, email, phone, business, account_type, role, plan, avatar_url, created_at, team_owner_id, team_role, veyra_id FROM users WHERE id = ?",
    ).get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    // The account the user just opened, so the sign-up response is already
    // complete: the member never sees a blank account number.
    const account = db.prepare(
      "SELECT account_number, routing_number, bank_name FROM accounts WHERE user_id = ?",
    ).get(userId) as Record<string, unknown> | undefined;
    return {
      id: String(row.id), name: String(row.name), email: String(row.email), phone: String(row.phone ?? ""),
      business: String(row.business ?? ""), accountType: row.account_type as "personal" | "business",
      veyraId: String(row.veyra_id ?? ""),
      avatarUrl: String(row.avatar_url ?? "/images/avatar-3d-default.svg"),
      role: row.role as string, plan: row.plan as "Starter" | "Pro", createdAt: row.created_at as number,
      ...(row.team_owner_id ? { teamRole: row.team_role as TeamRole, teamOwnerId: String(row.team_owner_id) } : {}),
      bankDetails: {
        accountNumber: String(account?.account_number ?? ""),
        routingNumber: String(account?.routing_number ?? ""),
        bankName: String(account?.bank_name ?? ""),
      },
    };
  }

  /**
   * The bearer token is accepted from `Authorization: Bearer …` **or** from the
   * `X-Veyra-Token` header.
   *
   * The second header is not decoration: preview hosts and other reverse
   * proxies sometimes consume or rewrite `Authorization` for their own access
   * control, so the app's token never reaches this process and every
   * authenticated request fails with "Authentication required." — a sign-in
   * loop that looks like a client bug from the outside. A custom header passes
   * through untouched, so the client sends both and works either way.
   */
  function bearerToken(req: Request): { token: string | null; via: string | null } {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return { token: header.slice(7), via: "authorization" };
    const custom = req.headers["x-veyra-token"];
    if (typeof custom === "string" && custom.trim()) return { token: custom.trim(), via: "x-veyra-token" };
    return { token: null, via: null };
  }

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const { token, via } = bearerToken(req);
    // `code` lets the client react precisely (and explain itself) instead of
    // treating every 401 as the same thing.
    if (!token) return void res.status(401).json({ error: "Authentication required.", code: "no_token" });
    const payload = verifyToken(token);
    if (!payload) return void res.status(401).json({ error: "Invalid or expired token.", code: "bad_token" });
    const session = db.prepare("SELECT revoked, expires_at FROM sessions WHERE token_id = ?").get(payload.jti) as
      | { revoked: number; expires_at: number }
      | undefined;
    if (!session || session.revoked || session.expires_at < Date.now()) {
      return void res.status(401).json({ error: "Session revoked — sign in again.", code: "session_revoked" });
    }
    let user = loadUser(payload.sub);
    if (!user) return void res.status(401).json({ error: "Account no longer exists.", code: "no_account" });
    const team = db.prepare(
      `SELECT u.team_owner_id, u.team_role, m.status AS member_status FROM users u
       LEFT JOIN team_members m ON m.member_user_id = u.id AND m.user_id = u.team_owner_id
       WHERE u.id = ? AND u.team_owner_id IS NOT NULL`,
    ).get(user.id) as { team_owner_id: string; team_role: TeamRole; member_status: string | null } | undefined;
    if (team) {
      const owner = loadUser(team.team_owner_id);
      if (!owner || team.member_status !== "active") {
        return void res.status(401).json({ error: "Your access to this business was removed.", code: "team_removed" });
      }
      if (!teamAllows(req.method, req.path, team.team_role)) {
        return void res.status(403).json({ error: `Your team role (${team.team_role}) can't do this — ask the account owner.`, code: "team_role" });
      }
      user = { ...owner, name: user.name, email: user.email, loginId: user.id, teamRole: team.team_role };
    }
    if (process.env.NODE_ENV !== "production" && via === "x-veyra-token") {
      // Worth knowing in dev: it means a proxy between the browser and this
      // process is eating the Authorization header.
      console.warn(`[auth] ${req.method} ${req.path}: Authorization was missing — authenticated via X-Veyra-Token`);
    }
    req.user = user;
    // The credential that authenticated this request, whatever header carried
    // it: logout and device revocation must target exactly this session.
    req.authToken = token;
    // Keep the visible device list backed by actual live auth sessions, not a
    // synthetic row created only at registration.
    rememberSession(req, personOf(user), payload.jti);
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
   * The person behind a request: a teammate's own user id when they are acting
   * on an owner's business, else the member. Sessions, authenticator secrets
   * and recovery codes are keyed by this, never by the account acted on.
   */
  const personOf = (user: AuthedUser) => user.loginId ?? user.id;

  /** Store only hashes; plaintext recovery codes are returned once to the member. */
  const storeRecoveryCodes = (userId: string, codes: string[]) => {
    db.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO totp_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)");
    for (const code of codes) {
      const digest = hashRecoveryCode(code);
      if (!digest) throw new Error("Could not create an account recovery code.");
      insert.run(rid("rc"), userId, digest, now());
    }
  };

  type SessionDevice = { device: string; browser: string; deviceKey: string };
  const sessionDevice = (req: Request, userId: string): SessionDevice => {
    const ua = req.get("user-agent") ?? "";
    const suppliedId = req.get("x-veyra-device") ?? "";
    // This id is only a label/grouping key for the member's own device list and
    // sign-in alerts; it is never an authentication credential or an MFA bypass.
    const fingerprint = suppliedId.length >= 16 && suppliedId.length <= 128 ? `device:${suppliedId}` : `ua:${ua || "unknown"}`;
    const deviceKey = createHash("sha256").update(`${userId}\0${fingerprint}`).digest("hex");
    const browser = /edg\//i.test(ua) ? "Microsoft Edge"
      : /firefox\//i.test(ua) ? "Firefox"
        : /opr\//i.test(ua) || /opera/i.test(ua) ? "Opera"
          : /chrome\//i.test(ua) ? "Chrome"
            : /safari\//i.test(ua) ? "Safari"
              : "Web browser";
    const device = /ipad/i.test(ua) ? "iPad"
      : /iphone/i.test(ua) ? "iPhone"
        : /android/i.test(ua) ? "Android device"
          : /mobile/i.test(ua) ? "Mobile device"
            : "Desktop computer";
    return { device, browser, deviceKey };
  };

  /** Records a real auth-token session and returns whether this browser was already recognized. */
  const rememberSession = (req: Request, userId: string, tokenId: string) => {
    const meta = sessionDevice(req, userId);
    const prior = db.prepare(`
      SELECT ss.trusted FROM security_sessions ss JOIN sessions s ON s.token_id = ss.auth_token_id
      WHERE ss.user_id = ? AND ss.device_key = ? AND s.revoked = 0 AND s.expires_at > ?
      ORDER BY ss.last_active DESC LIMIT 1
    `).get(userId, meta.deviceKey, now()) as { trusted: number } | undefined;
    const existing = db.prepare("SELECT id FROM security_sessions WHERE auth_token_id = ?").get(tokenId) as { id: string } | undefined;
    const trusted = prior?.trusted === 1 ? 1 : 0;
    if (existing) {
      db.prepare("UPDATE security_sessions SET device = ?, browser = ?, last_active = ?, device_key = ? WHERE id = ? AND user_id = ?")
        .run(meta.device, meta.browser, now(), meta.deviceKey, existing.id, userId);
    } else {
      db.prepare(`
        INSERT INTO security_sessions (id, user_id, device, browser, location, last_active, current, trusted, auth_token_id, device_key)
        VALUES (?, ?, ?, ?, '', ?, 0, ?, ?, ?)
      `).run(tokenId, userId, meta.device, meta.browser, now(), trusted, tokenId, meta.deviceKey);
    }
    return { ...meta, isNewDevice: !prior, trusted: trusted === 1 };
  };

  const createLoginSession = (req: Request, user: AuthedUser) => {
    const tokenId = randomUUID();
    const createdAt = now();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, user.id, createdAt, createdAt + TOKEN_TTL_MS);
    const device = rememberSession(req, user.id, tokenId);
    const alertSetting = db.prepare("SELECT login_alerts FROM preferences WHERE user_id = ?").get(user.id) as { login_alerts: number } | undefined;
    if (alertSetting?.login_alerts !== 0 && !device.trusted) {
      notify(user.id, "security", "New sign-in detected",
        `A sign-in was completed from ${device.device} using ${device.browser}. If this wasn't you, change your password and sign out that session in Security Center.`);
    }
    // The full user shape, so the client never has to fetch /api/auth/me
    // before it can render an account number or avatar.
    return { token: signToken({ sub: user.id, jti: tokenId, role: user.role }), user: { ...fullUser(user.id), status: user.status } };
  };

  /**
   * Passkeys as the browser sees them. The public key, algorithm and signature
   * counter stay server-side: they are useless to the UI and listing them
   * would only widen what a stolen session can read.
   */
  type PasskeyRow = {
    id: string; label: string; transports: string; backed_up: number;
    created_at: number; last_used_at: number | null;
  };
  const shapePasskey = (row: PasskeyRow) => ({
    id: row.id,
    label: row.label,
    transports: row.transports ? row.transports.split(",").filter(Boolean) : [],
    /** Synced to a provider keychain, so it survives losing the device. */
    syncedToCloud: row.backed_up === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  });
  const passkeyRow = (id: string) => shapePasskey(db.prepare(
    "SELECT id, label, transports, backed_up, created_at, last_used_at FROM passkeys WHERE id = ?",
  ).get(id) as PasskeyRow);

  /**
   * Member-management routes operate on member accounts only. Staff and Super
   * Admin accounts are not member surface: an operator with customer
   * permissions must not be able to credit, debit or restrict a colleague
   * (including the Super Admin) through them. Unknown and non-member ids both
   * answer 404 so the route can't be used to enumerate staff.
   */
  /**
   * Typed access to the application decision.
   *
   * `approved` covers every account that existed before the review queue (the
   * migration defaults it that way) and every member a human has cleared, so
   * this never locks out an established customer.
   */
  const reviewRow = (userId: string) =>
    db.prepare("SELECT review_state, review_note, review_reqs_json FROM kyc_records WHERE user_id = ?")
      .get(userId) as { review_state?: string; review_note?: string; review_reqs_json?: string } | undefined;
  const reviewState = (userId: string) => String(reviewRow(userId)?.review_state ?? "approved");

  /**
   * Money and account changes wait until the application is approved. The
   * dashboard is already hidden from an unapproved member; this is the part that
   * holds when the request comes straight to the API instead of the UI.
   */
  const requireApproved: RequestHandler = (req, res, next) => {
    const state = reviewState(req.user!.id);
    if (state === "approved") return void next();
    res.status(403).json({
      error: state === "rejected"
        ? "This account application was declined, so the account cannot be used."
        : "Your account is still in review. You'll be able to move money as soon as it's approved.",
      code: "review_pending",
      reviewState: state,
    });
  };

  const memberRow = (id: string) =>
    db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id) as Record<string, unknown> | undefined;

  /* ============================== health ============================== */

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get(); // prove the database handle is alive
    res.json({ ok: true, service: "veyra-api", db: "sqlite", uptimeSec: Math.floor(process.uptime()), time: now() });
  });

  /* ============================== auth routes ============================== */

  /**
   * Public client configuration, read before the sign-in form is usable.
   *
   * The site key is public by design (it ships in the page that renders the
   * widget), but *whether* reCAPTCHA is enforced is a server fact. Serving it
   * from here rather than a build-time VITE_ variable means the browser and
   * the API can never disagree: turning the gate on does not need a rebuild,
   * and a stale bundle cannot start withholding tokens the server now demands.
   */
  const previewAccess = createPreviewAccess(db);
  app.get("/api/auth/config", wrap((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ recaptcha: publicRecaptchaConfig(), federated: publicFederatedConfig(), addresses: addressConfig(), previewLogins: previewAccess() });
  }));

  // Signup address lookup is intentionally public, but bounded and server-keyed.
  const addresses = createAddressService();
  app.post("/api/address/autocomplete", addresses.autocomplete);
  app.post("/api/address/details", addresses.details);

  /**
   * Federated sign-in — Google, via a Firebase ID token.
   *
   * Firebase is an identity provider, not the authority: the token only proves
   * who the caller is. This route maps that onto an existing member and mints
   * Veyra's own session, so revocation, RBAC and the audit trail are untouched
   * (see server/src/federated.ts for the full policy and its reasoning).
   *
   * Not reCAPTCHA-gated, unlike the password routes: a valid Firebase ID token
   * is already a strong anti-automation signal, and an invalid one is rejected
   * by a signature check costing a fraction of a scrypt hash. The per-address
   * budget below bounds the rest.
   */
  app.post("/api/auth/federated", wrap(async (req, res) => {
    const config = federatedConfig();
    if (!config.enabled) {
      return void res.status(503).json({ error: "Federated sign-in is not enabled.", code: "federated_disabled" });
    }
    const ip = req.ip ?? "unknown";
    // 60/min per address. Each request costs one cached-key signature verify,
    // so the budget is about bounding abuse, not protecting scarce work — and
    // a whole office behind one NAT address must not trip it.
    if (!rateLimit(`federated:${ip}`, 60, 60_000)) {
      return void res.status(429).json({ error: "Too many attempts — wait a minute, then try again." });
    }

    const verdict = await verifyFirebaseIdToken(String(req.body?.idToken ?? ""));
    if (!verdict.ok) {
      console.warn(`[federated] rejected — ${verdict.detail}`);
      return void res.status(verdict.status).json({ error: verdict.error, code: "federated_rejected" });
    }
    const { subject, email, emailVerified, providerId, privateRelay } = verdict.identity;
    const providerLabel = PROVIDER_REGISTRY[providerId].label;

    // An unverified address must never be able to claim an existing account.
    if (!emailVerified) {
      return void res.status(403).json({
        error: `That ${providerLabel} account's email address isn't verified, so it can't be used to sign in.`,
        code: "federated_unverified",
      });
    }

    const existing = db.prepare(
      "SELECT user_id FROM federated_identities WHERE provider = ? AND subject = ?",
    ).get(providerId, subject) as { user_id: string } | undefined;

    let userId: string;
    let linkedNow = false;

    if (existing) {
      userId = existing.user_id;
    } else {
      // First time this Google account has been seen: it may only attach to an
      // account that already exists, and only by verified email.
      if (!email) {
        return void res.status(403).json({ error: `That ${providerLabel} account did not share an email address.`, code: "federated_no_email" });
      }
      // Apple's "Hide My Email" mints a per-app relay address, which by design
      // matches nothing. Saying "no account found" would send someone hunting
      // for a problem that isn't theirs.
      if (privateRelay) {
        return void res.status(409).json({
          error: "Apple is hiding your email address, so we can't match it to your Veyra account. Sign in with your email and password, then choose \"Share My Email\" when linking Apple.",
          code: "federated_private_relay",
        });
      }
      const match = db.prepare("SELECT id, role FROM users WHERE email = ? COLLATE NOCASE").get(email) as
        | { id: string; role: string }
        | undefined;
      // No auto-provisioning: opening an account needs the full application.
      if (!match) {
        return void res.status(404).json({
          error: "No Veyra account uses that email address. Open an account first, then link Google from your security settings.",
          code: "federated_no_account",
        });
      }
      if (match.role !== "user" && !config.allowStaff) {
        return void res.status(403).json({
          error: "Staff accounts sign in with a password. Contact an administrator if you need this changed.",
          code: "federated_staff_blocked",
        });
      }
      try {
        db.prepare(
          "INSERT INTO federated_identities (provider, subject, user_id, email, linked_at) VALUES (?, ?, ?, ?, ?)",
        ).run(providerId, subject, match.id, email, now());
      } catch {
        // The UNIQUE(provider, user_id) index: this member already has a
        // different account attached for this same provider.
        return void res.status(409).json({
          error: `This account is already linked to a different ${providerLabel} account.`,
          code: "federated_already_linked",
        });
      }
      userId = match.id;
      linkedNow = true;
    }

    const user = loadUser(userId);
    if (!user) return void res.status(404).json({ error: "That account no longer exists.", code: "federated_no_account" });

    db.prepare("UPDATE federated_identities SET last_used_at = ? WHERE provider = ? AND subject = ?")
      .run(now(), providerId, subject);

    // Attaching a new way into the account is security-relevant, so the member
    // is told the first time it happens.
    if (linkedNow) {
      notify(userId, "security", `${providerLabel} sign-in linked to your account`,
        `You can now sign in with ${providerLabel} (${email}). If this wasn't you, change your password and contact support immediately.`);
    }

    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, userId, now(), now() + TOKEN_TTL_MS);
    res.json({
      token: signToken({ sub: userId, jti: tokenId, role: user.role }),
      user: { ...fullUser(user.id), status: user.status },
      linked: linkedNow,
      provider: providerId,
    });
  }));

  /* ---------- passkeys (WebAuthn) ----------
   *
   * Four ceremonies. Two are public because signing in necessarily happens
   * before there is a session; two require one because a passkey is added to
   * an account that already exists.
   *
   * The security story lives in server/src/webauthn.ts. What matters here is
   * that a challenge is minted server-side, consumed exactly once, and the
   * user it belongs to is read from the challenge rather than the request.
   */

  app.post("/api/auth/passkey/challenge", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`passkey-challenge:${ip}`, 60, 60_000)) {
      return void res.status(429).json({ error: "Too many attempts — wait a minute, then try again." });
    }
    // No email is asked for and none is accepted. The browser already knows
    // which passkeys it holds for this site, so requiring one would add an
    // enumeration oracle for nothing.
    res.json({ challenge: issueChallenge("login"), ...authenticationOptions() });
  }));

  app.post("/api/auth/passkey/login", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`passkey-login:${ip}`, 30, 60_000)) {
      return void res.status(429).json({ error: "Too many attempts — wait a minute, then try again." });
    }
    const { id, clientDataJSON, authenticatorData, signature } = req.body ?? {};
    if (!id || !clientDataJSON || !authenticatorData || !signature) {
      return void res.status(400).json({ error: "That sign-in was incomplete. Try again.", code: "passkey_incomplete" });
    }

    const stored = db.prepare(
      "SELECT id, user_id, public_key, alg, sign_count FROM passkeys WHERE id = ?",
    ).get(String(id)) as { id: string; user_id: string; public_key: string; alg: number; sign_count: number } | undefined;
    // Same wording as a bad signature: whether a credential ID is known is not
    // something an unauthenticated caller should be able to probe.
    if (!stored) {
      console.warn(`[passkey] rejected — unknown credential ${String(id).slice(0, 16)}…`);
      return void res.status(401).json({ error: "That passkey isn't registered here.", code: "passkey_unknown" });
    }

    const verdict = verifyAuthentication({
      clientDataJSON: String(clientDataJSON),
      authenticatorData: String(authenticatorData),
      signature: String(signature),
      credential: {
        credentialId: stored.id, publicKeyJwk: stored.public_key,
        alg: stored.alg, signCount: stored.sign_count,
      },
    });
    if (!verdict.ok) {
      console.warn(`[passkey] rejected — ${verdict.detail}`);
      return void res.status(verdict.status).json({ error: verdict.error, code: "passkey_rejected" });
    }

    const user = loadUser(stored.user_id);
    if (!user) return void res.status(404).json({ error: "That account no longer exists.", code: "passkey_no_account" });
    if (user.status === "suspended") {
      return void res.status(403).json({ error: "This account is suspended. Contact support.", code: "passkey_suspended" });
    }

    db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?")
      .run(verdict.value.signCount, now(), stored.id);

    // A counter that went backwards is the one signal WebAuthn gives that a
    // credential may have been copied. It is too unreliable to block on (see
    // webauthn.ts), but the member should hear about it.
    if (verdict.value.clonedWarning) {
      console.warn(`[passkey] sign counter did not advance for credential ${stored.id.slice(0, 16)}… — possible clone`);
      notify(user.id, "security", "Unusual passkey activity",
        "A passkey on your account reported a counter that did not advance, which can indicate a copied device. " +
        "If you did not just sign in, remove your passkeys and change your password.");
    }

    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, user.id, now(), now() + TOKEN_TTL_MS);
    res.json({ token: signToken({ sub: user.id, jti: tokenId, role: user.role }), user: { ...fullUser(user.id), status: user.status } });
  }));

  app.post("/api/me/passkeys/challenge", requireAuth, wrap((req, res) => {
    const me = req.user!;
    const existing = db.prepare("SELECT id FROM passkeys WHERE user_id = ?").all(me.id) as Array<{ id: string }>;
    const user = loadUser(me.id);
    res.json({
      // The challenge carries the user id, so the registration that follows
      // cannot be pointed at a different account by editing the request.
      challenge: issueChallenge("register", me.id),
      ...registrationOptions(
        { id: me.id, email: me.email, name: user?.name ?? me.email },
        existing.map(row => row.id),
      ),
    });
  }));

  app.post("/api/me/passkeys", requireAuth, wrap((req, res) => {
    const me = req.user!;
    const { clientDataJSON, attestationObject, transports, label } = req.body ?? {};
    if (!clientDataJSON || !attestationObject) {
      return void res.status(400).json({ error: "That passkey was incomplete. Try again.", code: "passkey_incomplete" });
    }

    const verdict = verifyRegistration({
      clientDataJSON: String(clientDataJSON),
      attestationObject: String(attestationObject),
    });
    if (!verdict.ok) {
      console.warn(`[passkey] registration rejected — ${verdict.detail}`);
      return void res.status(verdict.status).json({ error: verdict.error, code: "passkey_rejected" });
    }
    // The challenge was issued to a session; this request arrived on one. If
    // they disagree, someone is replaying a challenge across accounts.
    if (verdict.value.userId !== me.id) {
      console.warn(`[passkey] registration rejected — challenge belongs to ${verdict.value.userId}, not ${me.id}`);
      return void res.status(403).json({ error: "That passkey could not be verified. Try again.", code: "passkey_rejected" });
    }

    const taken = db.prepare("SELECT user_id FROM passkeys WHERE id = ?").get(verdict.value.credentialId) as
      | { user_id: string } | undefined;
    if (taken) {
      return void res.status(409).json({
        error: taken.user_id === me.id
          ? "That passkey is already on your account."
          : "That passkey is already registered to another account.",
        code: "passkey_duplicate",
      });
    }

    const clean = String(label ?? "").trim().slice(0, 60) || "Passkey";
    db.prepare(
      `INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, transports, aaguid, backed_up, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      verdict.value.credentialId, me.id, verdict.value.publicKeyJwk, verdict.value.alg,
      verdict.value.signCount,
      Array.isArray(transports) ? transports.map(String).join(",").slice(0, 120) : "",
      verdict.value.aaguid, verdict.value.backedUp ? 1 : 0, clean, now(),
    );

    notify(me.id, "security", "Passkey added",
      `"${clean}" can now sign in to your account. If this wasn't you, remove it and change your password immediately.`);
    res.status(201).json({ passkey: passkeyRow(verdict.value.credentialId) });
  }));

  app.get("/api/me/passkeys", requireAuth, wrap((req, res) => {
    const rows = db.prepare(
      "SELECT id, label, transports, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC",
    ).all(req.user!.id) as PasskeyRow[];
    res.json({ passkeys: rows.map(shapePasskey), rpId: webauthnConfig().rpId });
  }));

  app.delete("/api/me/passkeys/:id", requireAuth, wrap((req, res) => {
    const me = req.user!;
    // Scoped by user_id as well as id: a credential ID from another account
    // must read as "not found", not as someone else's row.
    const row = db.prepare("SELECT id, label FROM passkeys WHERE id = ? AND user_id = ?")
      .get(String(req.params.id), me.id) as { id: string; label: string } | undefined;
    if (!row) return void res.status(404).json({ error: "That passkey isn't on your account." });

    db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(row.id, me.id);
    notify(me.id, "security", "Passkey removed",
      `"${row.label}" can no longer sign in to your account.`);
    res.json({ ok: true });
  }));

  app.post("/api/auth/login", requireRecaptcha(RECAPTCHA_ACTIONS.login), wrap((req, res) => {
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
      | (AuthedUser & { password_hash: string; account_type: string; totp_secret_encrypted: string | null })
      | undefined;
    // Constant-ish response regardless of which factor failed.
    if (!row || !verifyPassword(password, row.password_hash)) {
      recordFailure(accountKey);
      recordFailure(ipKey);
      return void res.status(401).json({ error: "Email or password doesn't match our records." });
    }
    clearFailures(accountKey);
    const prefs = db.prepare("SELECT two_factor FROM preferences WHERE user_id = ?").get(row.id) as { two_factor: number } | undefined;
    if (prefs?.two_factor === 1 && row.totp_secret_encrypted) {
      if (!rateLimit(`login:mfa:${row.id}`, 8, 60_000)) {
        return void res.status(429).json({ error: "Too many verification requests. Wait a minute, then try again." });
      }
      db.prepare("DELETE FROM login_challenges WHERE expires_at <= ?").run(now());
      const challengeId = randomUUID();
      const created = now();
      db.prepare("INSERT INTO login_challenges (id, user_id, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, 0)")
        .run(challengeId, row.id, created, created + 5 * 60_000);
      return void res.json({ twoFactorRequired: true, challengeId, expiresIn: 300 });
    }
    const user = loadUser(row.id)!;
    res.json(createLoginSession(req, user));
  }));

  app.post("/api/auth/login/verify", wrap((req, res) => {
    const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!challengeId || !code) return void res.status(400).json({ error: "Enter your authenticator or recovery code." });
    const challenge = db.prepare("SELECT * FROM login_challenges WHERE id = ?").get(challengeId) as
      | { id: string; user_id: string; created_at: number; expires_at: number; attempts: number }
      | undefined;
    if (!challenge || challenge.expires_at <= now() || challenge.attempts >= 5) {
      if (challenge) db.prepare("DELETE FROM login_challenges WHERE id = ?").run(challengeId);
      return void res.status(400).json({ error: "This sign-in challenge expired. Start again with your email and password." });
    }
    if (!rateLimit(`login:mfa-verify:${challenge.user_id}`, 10, 60_000)) {
      return void res.status(429).json({ error: "Too many authenticator checks. Wait a minute, then try again." });
    }
    const row = db.prepare("SELECT totp_secret_encrypted FROM users WHERE id = ?").get(challenge.user_id) as { totp_secret_encrypted: string | null } | undefined;
    let validTotp = false;
    if (row?.totp_secret_encrypted) {
      try { validTotp = verifyTotp(decryptTotpSecret(row.totp_secret_encrypted), code); } catch { validTotp = false; }
    }
    const recoveryCodeHash = validTotp ? null : hashRecoveryCode(code);
    if (!validTotp && !recoveryCodeHash) {
      const attempts = challenge.attempts + 1;
      if (attempts >= 5) db.prepare("DELETE FROM login_challenges WHERE id = ?").run(challengeId);
      else db.prepare("UPDATE login_challenges SET attempts = ? WHERE id = ?").run(attempts, challengeId);
      return void res.status(401).json({ error: attempts >= 5 ? "Too many incorrect codes. Start sign-in again." : "That code didn't match. Check your authenticator or recovery code and try again." });
    }
    const user = loadUser(challenge.user_id);
    if (!user) {
      db.prepare("DELETE FROM login_challenges WHERE id = ?").run(challengeId);
      return void res.status(401).json({ error: "This account is no longer available." });
    }
    const result = inTransaction(db, () => {
      const live = db.prepare("SELECT id FROM login_challenges WHERE id = ? AND expires_at > ? AND attempts < 5").get(challengeId, now());
      if (!live) return { kind: "expired" as const };
      if (recoveryCodeHash) {
        const consumed = db.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ?")
          .run(challenge.user_id, recoveryCodeHash);
        if (consumed.changes !== 1) return { kind: "invalid-recovery" as const };
      }
      db.prepare("DELETE FROM login_challenges WHERE id = ?").run(challengeId);
      return { kind: "ok" as const, session: createLoginSession(req, user) };
    });
    if (result.kind === "invalid-recovery") {
      const attempts = challenge.attempts + 1;
      if (attempts >= 5) db.prepare("DELETE FROM login_challenges WHERE id = ?").run(challengeId);
      else db.prepare("UPDATE login_challenges SET attempts = ? WHERE id = ?").run(attempts, challengeId);
      return void res.status(401).json({ error: attempts >= 5 ? "Too many incorrect codes. Start sign-in again." : "That code didn't match. Check your authenticator or recovery code and try again." });
    }
    if (result.kind !== "ok") return void res.status(400).json({ error: "This sign-in challenge expired. Start again with your email and password." });
    res.json(result.session);
  }));

  app.post("/api/auth/register", requireRecaptcha(RECAPTCHA_ACTIONS.register), wrap((req, res) => {
    const { name, email, password, accountType, business, phone, plan, profile } = req.body ?? {};
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
    // Opening an account requires a complete application: legal identity, tax
    // ID, address and government ID (plus the business and its beneficial
    // owner for business accounts). The account is never created without it.
    const application = validateApplication(type, {
      ...(profile && typeof profile === "object" ? profile : {}),
      email: (typeof profile?.email === "string" && profile.email.trim()) ? profile.email : email,
      phone: (typeof profile?.phone === "string" && profile.phone.trim()) ? profile.phone : phone,
    });
    if (!application.ok) return void res.status(422).json({ error: application.error, field: application.field });
    // Opening an account is the most expensive thing an anonymous caller can ask
    // for (scrypt + five inserts), so the budget counts only applications that
    // got this far — a typo costs nothing, a scripted sign-up run does not.
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`register:${ip}`, 20, 60 * 60_000)) {
      return void res.status(429).json({ error: "Too many accounts opened from this connection — try again in an hour." });
    }
    const values = application.value;
    const id = rid("u");
    const accountNumber = generateAccountNumber(db);
    inTransaction(db, () => {
      // Every member gets a unique Veyra ID at sign-up: the code other members
      // scan or type to send money without knowing the account number.
      db.prepare(
        `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at, veyra_id)
         VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, 'active', ?, ?)`,
      ).run(id, name.trim(), email, values.phone, typeof business === "string" ? business : "", type,
        plan === "Starter" ? "Starter" : "Pro", hashPassword(password), now(), generateVeyraId(db));
      // The application itself. One row, one shape, normalised by identity.ts.
      const columns = PROFILE_COLUMNS.map(([, column]) => column);
      db.prepare(
        `INSERT INTO identity_profiles (user_id, ${columns.join(", ")}, submitted_at)
         VALUES (?, ${columns.map(() => "?").join(", ")}, ?)`,
      ).run(id, ...PROFILE_COLUMNS.map(([key]) => values[key]), now());
      // Production start: a real, empty account — $0 balance, no cards, no history.
      db.prepare(
        `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
         VALUES (?, ?, '091408735', 'Northfield Bank', 0, 0, 0, ?, ?)`,
      ).run(id, accountNumber, now(), now());
      // The application is complete and goes straight into compliance's queue —
      // nothing to chase, nothing missing. `review_state` is what actually holds
      // the dashboard shut until a human decides; `status` records the documents.
      db.prepare(
        `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, submission_json, updated_at, review_state)
         VALUES (?, 'in_review', 100, ?, ?, ?, ?, 'in_review')`,
      ).run(id, values.idType, values.country, JSON.stringify(submissionFor(type, values, now())), now());
      db.prepare("INSERT INTO preferences (user_id, two_factor, login_alerts, scout_auto, weekly_digest) VALUES (?, 0, 1, 1, 0)").run(id);
      db.prepare(
        `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status) VALUES (?, ?, ?, ?, 'Owner', 0, 0, 'active')`,
      ).run(rid("tm"), id, name.trim(), email);
    });
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenId, id, now(), now() + TOKEN_TTL_MS);
    rememberSession(req, id, tokenId);
    notify(id, "security", "Application received — we're reviewing it",
      "Thanks, we have your details. A specialist is reviewing your application now: most take 1–2 business days. We'll email you the moment there's news, and your dashboard unlocks as soon as you're approved.");
    void sendMail(applicationReceivedMail(email, name.trim()));
    res.status(201).json({ token: signToken({ sub: id, jti: tokenId, role: "user" }), user: fullUser(id) });

  }));

  app.post("/api/auth/logout", requireAuth, wrap((req, res) => {
    const payload = verifyToken(req.authToken ?? "");
    if (payload) db.prepare("UPDATE sessions SET revoked = 1 WHERE token_id = ?").run(payload.jti);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", requireAuth, wrap((req, res) => {
    res.json({ user: fullUser(req.user!.loginId ?? req.user!.id) });
  }));

  app.post("/api/auth/change-password", requireAuth, wrap(async (req, res) => {
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 8) return void res.status(400).json({ error: "Use at least 8 characters." });
    // Always the signed-in person's own password — never a team owner's.
    const loginId = req.user!.loginId ?? req.user!.id;
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(loginId) as { password_hash: string };
    if (!verifyPassword(current, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    const currentTokenId = req.authToken ? verifyToken(req.authToken)?.jti : undefined;
    if (!currentTokenId) return void res.status(401).json({ error: "Your session could not be verified. Sign in again." });
    // Sessions belong to the login too, so a teammate changing their password
    // signs out their other devices — never the owner's or other teammates'.
    inTransaction(db, () => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), loginId);
      db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND token_id <> ? AND revoked = 0").run(loginId, currentTokenId);
      db.prepare("DELETE FROM login_challenges WHERE user_id = ?").run(loginId);
      notify(loginId, "security", "Password changed", "Your password was updated. Other signed-in sessions have been signed out.");
    });
    res.json({ ok: true, signedOutOtherSessions: true });
  }));

  // Password reset — production flow. Requesting a reset always returns the
  // same generic response (never reveals whether the email exists). The token
  // is stored hashed with a 30-minute expiry and is single-use. Delivery of
  // the email requires an SMTP provider (see README).
  app.post("/api/auth/forgot-password", requireRecaptcha(RECAPTCHA_ACTIONS.forgotPassword), wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`forgot:${ip}`)) return void res.status(429).json({ error: "Too many attempts — try again in a minute." });
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const row = typeof email === "string" && email
      ? (db.prepare("SELECT id, name, email FROM users WHERE email = ? COLLATE NOCASE").get(email) as { id: string; name: string; email: string } | undefined)
      : undefined;
    /** Development only — see the note on the TODO below. */
    let devCode = "";
    if (row) {
      const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      db.prepare(
        "INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)",
      ).run(tokenHash, row.id, Date.now() + 30 * 60_000, now());
      void sendMail(passwordResetMail(row.email, row.name, token));
      // Without a mail provider, development hands the code back in the
      // response (and logs it) so the reset screen is not left waiting for mail
      // that never arrives. Production never puts a reset token in a response.
      if (process.env.NODE_ENV !== "production" && !mailDelivers()) {
        console.log(`[dev] password reset token for ${email}: ${token}`);
        devCode = token;
      }
    }
    res.json({
      ok: true,
      message: "If an account exists for that email, reset instructions have been sent.",
      ...(devCode ? { devCode } : {}),
    });
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

  const bulkAccounts = createBulkAccounts(db, audit);
  app.post("/api/admin/accounts/bulk-preview", requireAuth, requirePerm("accounts.edit_number"), wrap(bulkAccounts.preview));
  app.post("/api/admin/accounts/bulk-apply", requireAuth, requirePerm("accounts.edit_number"), wrap(bulkAccounts.apply));
  const integrations = createIntegrations(db);
  // Gate a member route on an administrator switch. Off or not-ready integrations return a neutral message.
  const requireIntegration = (id: string): RequestHandler => (_req, res, next) => {
    if (!integrations.available(id)) return void res.status(503).json({ error: "This is not available right now." });
    next();
  };
  const banking = createBanking(db, audit, integrations);
  app.get("/api/admin/members/:id/account-details", requireAuth, requirePerm("accounts.view"), wrap(banking.accountGet));
  app.patch("/api/admin/members/:id/account-details", requireAuth, requirePerm("accounts.edit_number"), wrap(banking.accountSave));
  app.get("/api/admin/members/:id/funding", requireAuth, requirePerm("accounts.view"), wrap(banking.adminFundingGet));
  app.put("/api/admin/members/:id/funding", requireAuth, requirePerm("accounts.edit_number"), wrap(banking.fundingSave));
  app.post("/api/admin/members/:id/funding/:requestId/review", requireAuth, requirePerm("customers.adjust_balance"), wrap(banking.reviewDeposit));
  const demoPayments = createDemoPayments(db);
  app.get("/api/me/demo-payments", requireAuth, wrap((req, res) => {
    res.json(demoPayments.snapshot(req.user!.loginId ?? req.user!.id));
  }));
  app.post("/api/me/demo-payments/action", requireAuth, requireApproved, wrap((req, res) => {
    res.json(demoPayments.action(req.user!.loginId ?? req.user!.id, req.body));
  }));
  const guardDemoLedger: RequestHandler = (_req, res, next) => {
    if (demoPaymentsEnabled()) return void res.status(400).json({ error: "Review the payment before confirming it." });
    next();
  };
  app.post("/api/me/external-accounts", requireAuth, requireApproved, wrap(banking.requestExternalAccount));
  app.post("/api/admin/members/:id/external-accounts/:accountId/review", requireAuth, requirePerm("accounts.edit_number"), wrap(banking.reviewExternalAccount));
  app.get("/api/me/external-accounts", requireAuth, wrap(banking.externalAccountsGet));

  // Live banking stays inside the existing account experience. Only an
  // approved account owner may start a Stripe Connect / Treasury ceremony;
  // teammates cannot create a financial account, view an onboarding link, or
  // obtain an embedded-component client secret for the owner.
  const stripeOwner = (req: Request, res: Response): AuthedUser | null => {
    if (req.user!.role !== "user" || req.user!.loginId) {
      res.status(403).json({ error: "Only the approved account owner can manage live banking rails." });
      return null;
    }
    return req.user!;
  };
  const stripeFailure = (res: Response, error: unknown): boolean => {
    if (error instanceof StripeError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return true;
    }
    return false;
  };
  app.get("/api/me/rails", requireAuth, wrap((req, res) => {
    res.json({ rails: stripeRails.status(req.user!.id) });
  }));
  app.post("/api/me/rails/stripe/onboarding", requireAuth, requireApproved, wrap(async (req, res) => {
    const user = stripeOwner(req, res); if (!user) return;
    try { res.json(await stripeRails.onboarding(user)); }
    catch (error) { if (!stripeFailure(res, error)) throw error; }
  }));
  app.post("/api/me/rails/stripe/financial-account", requireAuth, requireApproved, wrap(async (req, res) => {
    const user = stripeOwner(req, res); if (!user) return;
    try { res.json(await stripeRails.provisionFinancialAccount(user)); }
    catch (error) { if (!stripeFailure(res, error)) throw error; }
  }));
  app.post("/api/me/rails/stripe/refresh", requireAuth, requireApproved, wrap(async (req, res) => {
    const user = stripeOwner(req, res); if (!user) return;
    try { res.json(await stripeRails.refresh(user.id)); }
    catch (error) { if (!stripeFailure(res, error)) throw error; }
  }));
  app.post("/api/me/rails/stripe/account-session", requireAuth, requireApproved, wrap(async (req, res) => {
    const user = stripeOwner(req, res); if (!user) return;
    try { res.json(await stripeRails.accountSession(user.id)); }
    catch (error) { if (!stripeFailure(res, error)) throw error; }
  }));

  app.get("/api/me/funding", requireAuth, wrap(banking.fundingGet));
  app.post("/api/me/deposits", requireAuth, requireApproved, wrap(banking.deposit));
  app.get("/api/me/crypto-withdrawals", requireAuth, wrap(banking.withdrawalsGet));
  app.post("/api/me/crypto-withdrawals", requireAuth, requireApproved, requireIntegration("crypto_send"), wrap(banking.withdraw));

  app.post("/api/me/transfers", requireAuth, requireApproved, guardDemoLedger, wrap((req, res) => {
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
    const suppliedCategory = typeof req.body?.category === "string" ? req.body.category.trim() : "";
    if (req.user!.accountType === "business" && !suppliedCategory) return void res.status(400).json({ error: "A category is required for business transfers." });
    if (suppliedCategory.length > 80) return void res.status(400).json({ error: "Category is too long." });
    const category = suppliedCategory || "Uncategorized";
    const method = String(req.body?.method ?? "ACH");
    const note = String(req.body?.note ?? `${method} payment`);
    const cardId = typeof req.body?.cardId === "string" ? req.body.cardId : null;
    const fee = quoteFee("transfer", cents);
    const debit = cents + fee.feeCents;
    const reward = Math.round(cents * rewardRate(category));
    // No funded savings provider is connected. Preferences cannot authorize
    // creating money; Scout analysis never changes the ledger.
    const scout = 0;
    try {
      const result = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents, rewards_cents, lifetime_rewards_cents, scout_saved_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as
          | { id: number; balance_cents: number; rewards_cents: number; lifetime_rewards_cents: number; scout_saved_cents: number }
          | undefined;
        if (!account) throw new Error("No account found.");
        if (account.balance_cents < debit) throw new Error("Insufficient funds for this transfer and its fee.");
        // Card spending honours the card's own controls. Freeze, limits and
        // locks are security controls the member sets in the UI — the server is
        // the system of record, so it enforces them instead of trusting that
        // nothing will spend on a frozen card. (contactless/atm/magstripe are
        // terminal-side controls with no meaning for a ledger transfer.)
        if (cardId) {
          const card = db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").get(cardId, req.user!.id) as Record<string, unknown> | undefined;
          if (!card) throw new RouteError(404, "Card not found.");
          if (typeof card.provider_card_id === "string" && card.provider_card_id) {
            throw new RouteError(409, "This is a live Stripe Issuing card. Card purchases settle through Stripe authorizations and cannot be simulated as a local transfer.");
          }
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
        const at = now();
        enforceTeamSpend(db, req.user!.id, personOf(req.user!), cents, at);
        const after = before - debit;
        if (after < 0) throw new Error("Insufficient funds for this transfer and its fee.");
        db.prepare("UPDATE accounts SET balance_cents = ?, rewards_cents = ?, lifetime_rewards_cents = ?, scout_saved_cents = ?, updated_at = ? WHERE id = ?")
          .run(after, account.rewards_cents + reward, account.lifetime_rewards_cents + reward, account.scout_saved_cents + scout, now(), account.id);
        const txn = { id: rid("txn"), reference: makeReference() };
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, fee_cents, reward_cents, scout_cents, card_id, status, reference, note, created_at, performed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cleared', ?, ?, ?, ?)`,
        ).run(txn.id, account.id, req.user!.id, counterparty, category, method, -cents, fee.feeCents, reward, scout, cardId, txn.reference, note, at, personOf(req.user!));
        if (cardId) db.prepare("UPDATE cards SET spent_cents = spent_cents + ? WHERE id = ? AND user_id = ?").run(cents, cardId, req.user!.id);
        notify(req.user!.id, "transfer", `Sent ${(cents / 100).toFixed(2)} to ${counterparty}`, `${method} · +${(reward / 100).toFixed(2)} rewards earned.`);
        return { id: txn.id, reference: txn.reference, before, after };
      });
      if (method.trim().toLowerCase() === "zelle") sendZelleNotification(db,req.user!.id,{event:"outgoing_recorded",amountCents:cents,reference:result.reference,occurredAt:now(),counterparty});
      res.status(201).json({
        result: { reference: result.reference, date: now(), amount: cents / 100, fee: fee.feeCents / 100, balanceBefore: result.before / 100, balanceAfter: result.after / 100, reward: reward / 100, scout: scout / 100 },
        transaction: { id: result.id, merchant: counterparty, amount: money(-cents), fee: money(fee.feeCents), reference: result.reference, status: "cleared" },
        balance: money(result.after),
      });
    } catch (err) {
      fail(res, err, "Transfer failed.");
    }
  }));

  // Veyra-to-Veyra: members pay each other by email or Veyra ID. Lookup shows the
  // recipient's name for review before any money moves; the transfer itself is
  // one database transaction that returns the original result on a retry.
  const veyraTransfers = createVeyraTransfers(db, {
    notify,
    enforceSpend: (ownerId, actorId, cents, at) => enforceTeamSpend(db, ownerId, actorId, cents, at),
    paymentsHalted: () => getSetting(db, "payment_rails") === "halted",
  });
  app.post("/api/me/veyra-transfers/lookup", requireAuth, requireApproved, wrap(veyraTransfers.lookup));
  app.post("/api/me/veyra-transfers", requireAuth, requireApproved, wrap(veyraTransfers.transfer));

  // --- Digital assets -------------------------------------------------------
  // Holdings live beside the deposit account, never inside it. See
  // server/src/assets.ts for why trading is gated, and server/src/money.ts for
  // why every quantity below is a bigint of base units rather than a number.

  const cryptoWorkspace = createCryptoWorkspace(db, audit, integrations);
  app.get("/api/me/crypto/capabilities", requireAuth, wrap(cryptoWorkspace.capabilities));
  app.get("/api/me/crypto/orders", requireAuth, wrap(cryptoWorkspace.history));
  app.get("/api/me/crypto/orders/:id", requireAuth, wrap(cryptoWorkspace.order));
  app.post("/api/me/crypto/quote", requireAuth, requireApproved, requireIntegration("crypto_trading"), wrap(cryptoWorkspace.quote));
  app.post("/api/me/crypto/confirm", requireAuth, requireIntegration("crypto_trading"), wrap(cryptoWorkspace.confirm));
  app.post("/api/me/crypto/wallet-balance", requireAuth, wrap(cryptoWorkspace.walletBalance));

  app.get("/api/me/holdings", requireAuth, wrap(async (req, res) => {
    const assets = listAssets(db);
    const quotes = await loadPrices();
    const rows = db.prepare("SELECT asset, units, updated_at FROM holdings WHERE user_id = ?")
      .all(req.user!.id) as unknown as { asset: string; units: string; updated_at: number }[];
    const held = new Map(rows.map((row) => [row.asset, row]));

    // A withdrawal debits on request, so holdings are simply what is left —
    // there is no pending reservation to add back.
    let totalCents = 0;
    let priced = true;
    const holdings = assets.map((asset) => {
      const row = held.get(asset.code);
      const units = BigInt(row?.units ?? "0");
      const quote = quotes.get(asset.code) ?? null;
      const totalUnits = units;
      // A missing quote yields null, never 0 — a zero would be silently summed
      // into the total and render as a confident, wrong valuation.
      const valueCents = quote ? valueInCents(totalUnits, asset.decimals, quote.cents) : null;
      if (valueCents === null) { if (totalUnits > 0n) priced = false; } else totalCents += valueCents;
      return {
        asset: asset.code,
        name: asset.name,
        kind: asset.kind,
        decimals: asset.decimals,
        units: units.toString(),
        totalQuantity: formatUnitsTrimmed(totalUnits, asset.decimals),
        withdrawalNetwork: ASSETS.find(a => a.code === asset.code)?.network ?? null,
        quantity: formatUnitsTrimmed(units, asset.decimals),
        priceUsd: quote ? centsToDecimal(Number(quote.cents)) : null,
        valueUsd: valueCents === null ? null : centsToDecimal(valueCents),
        quotedAt: quote ? quote.fetchedAt : null,
        updatedAt: row?.updated_at ?? null,
      };
    });

    res.json({
      holdings,
      previewData: previewCryptoEnabled(),
      // `partial` tells the client that at least one held asset could not be
      // priced, so the total understates reality and must be labelled.
      totalUsd: centsToDecimal(totalCents),
      quoteStatus: quotes.size === 0 ? "unavailable" : [...quotes.values()].every(q => quoteIsFresh(q.fetchedAt)) ? "current" : "stale",
      partial: !priced,
      tradingEnabled: tradingEnabled(),
      disclosure: "Digital assets are not FDIC insured and can lose value.",
    });
  }));

  app.post("/api/me/holdings/trade", requireAuth, requireApproved, requireIntegration("crypto_trading"), wrap(async (req, res) => {
    if (!tradingEnabled()) {
      return void res.status(503).json({ error: "Buying and selling is unavailable.", code: "crypto_disabled" });
    }
    const code = String(req.body?.asset ?? "").trim().toUpperCase();
    const side = req.body?.side;
    if (side !== "buy" && side !== "sell") {
      return void res.status(400).json({ error: "side must be 'buy' or 'sell'." });
    }
    const asset = assetByCode(db, code);
    if (!asset) return void res.status(404).json({ error: "Unknown asset.", code: "crypto_unknown_asset" });

    // Buys are denominated in dollars ("$50 of BTC"), sells in units of the
    // asset ("0.25 BTC"). That matches how people actually think about each
    // direction, and it means a sell can empty a position exactly rather than
    // leaving dust behind from a dollar-to-unit conversion.
    let units: bigint;
    let cents: number;
    const quote = await tradableQuote(asset.code);
    if (!quote) {
      return void res.status(503).json({ error: `No current price for ${asset.code}.`, code: "crypto_no_price" });
    }
    if (req.body?.expectedPriceUsd !== undefined && String(req.body.expectedPriceUsd) !== centsToDecimal(Number(quote.cents))) return void res.status(409).json({ error: "The quote changed. Refresh and review the current price before trading." });
    try {
      if (side === "buy") {
        cents = dollarsToCents(req.body?.amount ?? 0);
        if (cents <= 0) return void res.status(400).json({ error: "Amount must be greater than zero." });
        units = unitsForCents(cents, asset.decimals, quote.cents);
        if (units <= 0n) return void res.status(400).json({ error: "Amount is too small to buy any of this asset." });
      } else {
        units = parseUnits(req.body?.amount ?? 0, asset.decimals);
        if (units <= 0n) return void res.status(400).json({ error: "Amount must be greater than zero." });
        cents = valueInCents(units, asset.decimals, quote.cents);
        if (cents <= 0) return void res.status(400).json({ error: "Amount is too small to sell." });
      }
    } catch {
      return void res.status(400).json({ error: "Invalid amount." });
    }

    let event: { reference: string; at: number; feeCents: number };
    try {
      event = inTransaction(db, () => {
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?")
          .get(req.user!.id) as { id: number; balance_cents: number } | undefined;
        if (!account) throw new BadInputError("No account found.");
        const current = BigInt((db.prepare("SELECT units FROM holdings WHERE user_id = ? AND asset = ?")
          .get(req.user!.id, asset.code) as unknown as { units: string } | undefined)?.units ?? "0");

        const fee = quoteFee(side === "buy" ? "crypto_buy" : "crypto_sell", cents);
        const nextUnits = side === "buy" ? current + units : current - units;
        const nextCents = side === "buy" ? account.balance_cents - cents - fee.feeCents : account.balance_cents + applyFee(cents, fee.feeCents);
        if (side === "buy" && nextCents < 0) throw new BadInputError("Insufficient funds in checking for this order and its fee.");
        if (nextUnits < 0n) throw new BadInputError(`Insufficient ${asset.code}.`);
        const at = now();
        if (side === "buy") enforceTeamSpend(db, req.user!.id, personOf(req.user!), cents, at);

        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?")
          .run(nextCents, now(), account.id);
        db.prepare(
          `INSERT INTO holdings (user_id, asset, units, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, asset) DO UPDATE SET units = excluded.units, updated_at = excluded.updated_at`,
        ).run(req.user!.id, asset.code, nextUnits.toString(), now());

        const reference = makeReference();
        db.prepare(
          `INSERT INTO holding_transactions (id, user_id, asset, side, units, usd_cents, price_cents, reference, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(rid("hld"), req.user!.id, asset.code, side, units.toString(), cents, quote.cents.toString(), reference, now());

        // The deposit leg also lands in the member's statement. Money leaving a
        // checking balance with no matching line is how support tickets start.
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, fee_cents, status, reference, note, created_at, performed_by)
           VALUES (?, ?, ?, ?, 'Investing', 'Internal', ?, ?, 'cleared', ?, ?, ?, ?)`,
        ).run(
          rid("txn"), account.id, req.user!.id, `${side === "buy" ? "Bought" : "Sold"} ${asset.code}`,
          side === "buy" ? -cents : cents, fee.feeCents, reference,
          `${formatUnitsTrimmed(units, asset.decimals)} ${asset.code} at ${centsToDecimal(Number(quote.cents))}/${asset.code}${fee.feeCents ? `; fee ${centsToDecimal(fee.feeCents)}` : ""}`,
          at, personOf(req.user!),
        );
        return { reference, at, feeCents: fee.feeCents };
      });
    } catch (err) {
      return void fail(res, err, "Trade failed.");
    }

    sendCryptoNotification(db, req.user!.id, { activity: side, status: "completed", reference: event.reference, occurredAt: event.at,
      asset: side === "buy" ? "USD" : asset.code, quantity: side === "buy" ? centsToDecimal(cents) : formatUnitsTrimmed(units, asset.decimals),
      toAsset: side === "buy" ? asset.code : "USD", toQuantity: side === "buy" ? formatUnitsTrimmed(units, asset.decimals) : centsToDecimal(cents), settlement: "account" });
    res.status(201).json({
      ok: true,
      asset: asset.code,
      side,
      quantity: formatUnitsTrimmed(units, asset.decimals),
      amountUsd: centsToDecimal(cents),
      feeUsd: centsToDecimal(event.feeCents),
      priceUsd: centsToDecimal(Number(quote.cents)),
    });
  }));

  app.get("/api/me/markets", requireAuth, wrap(async (req, res) => {
    const { markets, fetchedAt } = await loadMarkets();
    const registry = new Map(listAssets(db).map(a => [a.code, a]));
    const held = new Map((db.prepare("SELECT asset, units FROM holdings WHERE user_id = ?")
      .all(req.user!.id) as unknown as { asset: string; units: string }[]).map(r => [r.asset, r.units]));

    // `tradeable` is driven by the local registry, never by the upstream list.
    // A coin appearing on CoinGecko is not consent to custody it: decimals,
    // and therefore every unit conversion, only exist for assets we seeded.
    const rows = markets.map(row => {
      const asset = ASSETS.find(a => a.code === row.code)?.id === row.id ? registry.get(row.code) : undefined;
      const units = asset ? held.get(row.code) ?? "0" : "0";
      return {
        code: row.code,
        name: row.name,
        image: row.image,
        rank: row.rank,
        priceUsd: centsToDecimal(row.priceCents),
        change1h: row.change1h,
        change24h: row.change24h,
        change7d: row.change7d,
        marketCapUsd: row.marketCapCents === null ? null : centsToDecimal(row.marketCapCents),
        volumeUsd: row.volumeCents === null ? null : centsToDecimal(row.volumeCents),
        sparkline: row.sparkline,
        tradeable: Boolean(asset),
        decimals: asset?.decimals ?? null,
        kind: asset?.kind ?? null,
        units,
        quantity: asset ? formatUnitsTrimmed(BigInt(units), asset.decimals) : null,
        valueUsd: asset && units !== "0"
          ? centsToDecimal(valueInCents(BigInt(units), asset.decimals, BigInt(row.priceCents)))
          : null,
      };
    });

    res.json({
      markets: rows,
      previewData: previewCryptoEnabled(),
      quoteStatus: !fetchedAt ? "unavailable" : quoteIsFresh(fetchedAt) ? "current" : "stale",
      quotedAt: fetchedAt || null,
      tradingEnabled: tradingEnabled(),
      disclosure: "Market data is indicative. Digital assets are not FDIC insured and can lose value.",
    });
  }));

  app.get("/api/me/holdings/:asset/candles", requireAuth, wrap(async (req, res) => {
    const code = String(req.params.asset ?? "").trim().toUpperCase();
    const asset = assetByCode(db, code);
    if (!asset) return void res.status(404).json({ error: "Unknown asset.", code: "crypto_unknown_asset" });

    const range = String(req.query.range ?? "7d");
    if (!isCandleRange(range)) {
      return void res.status(400).json({ error: `range must be one of ${CANDLE_RANGES.join(", ")}.` });
    }

    const candles = await loadCandles(asset.code, range);
    // 503 rather than an empty array: the client must be able to tell "no
    // history available" apart from "this asset was flat", and an empty
    // series renders as the latter.
    if (!candles) {
      return void res.status(503).json({ error: `No price history for ${asset.code}.`, code: "crypto_no_history" });
    }
    res.json({ asset: asset.code, range, candles, previewData: previewCryptoEnabled() });
  }));

  app.get("/api/me/notifications", requireAuth, wrap((req, res) => {
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40").all(req.user!.id);
    res.json({ notifications: rows, unread: rows.filter((r) => (r as { read: number }).read === 0).length });
  }));

  app.post("/api/me/notifications/read-all", requireAuth, requireApproved, wrap((req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(req.user!.id);
    res.json({ ok: true });
  }));

  app.get("/api/me/kyc", requireAuth, wrap((req, res) => {
    const row = db.prepare("SELECT status, completeness, document_type, country, requested_by, requested_at, request_reason, submission_json, updated_at FROM kyc_records WHERE user_id = ?").get(req.user!.id);
    res.json({ kyc: row ?? { status: "not_started", completeness: 0 } });
  }));

  /**
   * The member's own application, read back to them. Tax IDs are masked here
   * (their full value exists in exactly two places: the database and the staff
   * console) and the shape matches what they filled in at sign-up.
   */
  app.get("/api/me/profile", requireAuth, wrap((req, res) => {
    const row = db.prepare("SELECT * FROM identity_profiles WHERE user_id = ?").get(req.user!.id) as Record<string, unknown> | undefined;
    if (!row) return void res.json({ profile: null, submittedAt: null });
    res.json({
      profile: memberIdentity(req.user!.accountType, rowToApplication(row)),
      submittedAt: row.submitted_at ?? null,
    });
  }));

  app.post("/api/me/kyc/submit", requireAuth, wrap((req, res) => {
    const { legalName, dob, country, documentType, source, taxId, documents, note } = req.body ?? {};
    // A member answering a request for information often has the name fields
    // blank (they came from the application, not a wizard) — the documents are
    // what the reviewer asked for, so that is the requirement.
    if (!Array.isArray(documents) || documents.length === 0) {
      return void res.status(400).json({ error: "Add at least one item before sending." });
    }
    const row = reviewRow(req.user!.id);
    const before = String(row?.review_state ?? "approved");
    // Only a held application returns to the queue. Someone already approved who
    // sends us a document must not be dropped back into review and locked out.
    const state = before === "more_info" || before === "in_review" ? "in_review" : before;
    const submission = {
      legalName: String(legalName ?? ""), dob: String(dob ?? ""), country: String(country ?? ""),
      documentType: String(documentType ?? ""), source: String(source ?? ""), taxId: String(taxId ?? ""),
      documents,
      // The applicant's own words, shown to the reviewer next to the documents.
      note: String(note ?? "").trim(),
      submittedAt: now(),
    };
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO kyc_records (user_id, status, completeness, document_type, country, submission_json, updated_at, review_state)
         VALUES (?, 'in_review', 100, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'in_review', completeness = 100,
           document_type = excluded.document_type, country = excluded.country,
           submission_json = excluded.submission_json, review_state = excluded.review_state,
           updated_at = excluded.updated_at`,
      ).run(req.user!.id, submission.documentType, submission.country, JSON.stringify(submission), now(), state);
    });
    if (state === "in_review" && before === "more_info") {
      notify(req.user!.id, "security", "Information received", "Thanks — your application is back with our review team. We'll be in touch within 1–2 business days.");
    }
    res.status(201).json({ ok: true, status: "in_review", reviewState: state });
  }));

  app.post("/api/me/disputes", requireAuth, requireApproved, wrap((req, res) => {
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
    const currentTokenId = verifyToken(req.authToken ?? "")?.jti;
    const state = buildMemberState(db, req.user!.id, currentTokenId);
    if (!state) return void res.status(404).json({ error: "No account found." });
    res.json({ account: state });
  }));

  /* ---------- profile & preferences ---------- */

  app.patch("/api/me/profile", requireAuth, requireApproved, wrap((req, res) => {
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

  app.put("/api/me/preferences", requireAuth, requireApproved, wrap((req, res) => {
    const key = String(req.body?.key ?? "");
    const value = req.body?.value === true;
    // Two-factor must only be changed by the password- and code-verified
    // authenticator flow below. A preference toggle is not authentication.
    const map: Record<string, string> = { loginAlerts: "login_alerts", scoutAuto: "scout_auto", weeklyDigest: "weekly_digest" };
    const col = map[key];
    if (key === "twoFactor") return void res.status(400).json({ error: "Set up or turn off two-step sign-in through Security Center." });
    if (!col) return void res.status(400).json({ error: "Unknown preference." });
    const existing = db.prepare("SELECT user_id FROM preferences WHERE user_id = ?").get(req.user!.id);
    if (existing) {
      db.prepare(`UPDATE preferences SET ${col} = ? WHERE user_id = ?`).run(value ? 1 : 0, req.user!.id);
    } else {
      // The legacy table defaulted two_factor to true, which only reflected a
      // UI toggle and never represented an enrolled authenticator. Any first
      // preference edit must preserve the honest, unenrolled default.
      db.prepare(`INSERT INTO preferences (user_id, ${col}, two_factor) VALUES (?, ?, 0)`).run(req.user!.id, value ? 1 : 0);
    }
    res.json({ ok: true });
  }));

  app.post("/api/me/security/two-factor/setup", requireAuth, requireApproved, wrap((req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) return void res.status(400).json({ error: "Enter your password to set up an authenticator." });
    if (!rateLimit(`totp-setup:${personOf(req.user!)}`, 5, 10 * 60_000)) {
      return void res.status(429).json({ error: "Too many setup requests. Wait a few minutes, then try again." });
    }
    const row = db.prepare("SELECT password_hash, totp_secret_encrypted FROM users WHERE id = ?").get(personOf(req.user!)) as
      | { password_hash: string; totp_secret_encrypted: string | null }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    if (row.totp_secret_encrypted) return void res.status(409).json({ error: "Two-step sign-in is already enabled." });
    const secret = generateTotpSecret();
    const expiresAt = now() + 10 * 60_000;
    db.prepare("UPDATE users SET totp_pending_secret_encrypted = ?, totp_pending_expires_at = ? WHERE id = ?")
      .run(encryptTotpSecret(secret), expiresAt, personOf(req.user!));
    res.json({ secret, otpauthUrl: authenticatorUri(secret, req.user!.email), expiresAt });
  }));

  app.post("/api/me/security/two-factor/confirm", requireAuth, requireApproved, wrap((req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!password || !code) return void res.status(400).json({ error: "Enter your password and authenticator code." });
    if (!rateLimit(`totp-confirm:${personOf(req.user!)}`, 10, 60_000)) {
      return void res.status(429).json({ error: "Too many verification attempts. Wait a minute, then try again." });
    }
    const row = db.prepare("SELECT password_hash, totp_pending_secret_encrypted, totp_pending_expires_at FROM users WHERE id = ?").get(personOf(req.user!)) as
      | { password_hash: string; totp_pending_secret_encrypted: string | null; totp_pending_expires_at: number | null }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    if (!row.totp_pending_secret_encrypted || !row.totp_pending_expires_at || row.totp_pending_expires_at <= now()) {
      db.prepare("UPDATE users SET totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL WHERE id = ?").run(personOf(req.user!));
      return void res.status(400).json({ error: "Authenticator setup expired. Start again to receive a new key." });
    }
    let secret = "";
    try { secret = decryptTotpSecret(row.totp_pending_secret_encrypted); } catch { /* rejected below */ }
    if (!secret || !verifyTotp(secret, code)) return void res.status(400).json({ error: "That code didn't match. Check your authenticator and try again." });
    const recoveryCodes = generateRecoveryCodes();
    inTransaction(db, () => {
      db.prepare("UPDATE users SET totp_secret_encrypted = totp_pending_secret_encrypted, totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL WHERE id = ?")
        .run(personOf(req.user!));
      db.prepare(`INSERT INTO preferences (user_id, two_factor, login_alerts, scout_auto, weekly_digest)
        VALUES (?, 1, 1, 1, 0) ON CONFLICT(user_id) DO UPDATE SET two_factor = 1`).run(personOf(req.user!));
      storeRecoveryCodes(personOf(req.user!), recoveryCodes);
      notify(personOf(req.user!), "security", "Two-step sign-in enabled", "An authenticator code is now required when you sign in.");
    });
    res.json({ enabled: true, recoveryCodes });
  }));

  app.post("/api/me/security/two-factor/recovery-codes/regenerate", requireAuth, requireApproved, wrap((req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!password || !code) return void res.status(400).json({ error: "Enter your password and current authenticator code." });
    if (!rateLimit(`totp-recovery-regenerate:${personOf(req.user!)}`, 5, 10 * 60_000)) {
      return void res.status(429).json({ error: "Too many recovery-code requests. Wait a few minutes, then try again." });
    }
    const row = db.prepare("SELECT password_hash, totp_secret_encrypted FROM users WHERE id = ?").get(personOf(req.user!)) as
      | { password_hash: string; totp_secret_encrypted: string | null }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    let secret = "";
    try { if (row.totp_secret_encrypted) secret = decryptTotpSecret(row.totp_secret_encrypted); } catch { /* rejected below */ }
    if (!secret || !verifyTotp(secret, code)) return void res.status(400).json({ error: "That code didn't match your authenticator." });
    const recoveryCodes = generateRecoveryCodes();
    inTransaction(db, () => storeRecoveryCodes(personOf(req.user!), recoveryCodes));
    res.json({ recoveryCodes });
  }));

  app.post("/api/me/security/two-factor/disable", requireAuth, requireApproved, wrap((req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!password || !code) return void res.status(400).json({ error: "Enter your password and an authenticator or recovery code." });
    if (!rateLimit(`totp-disable:${personOf(req.user!)}`, 8, 60_000)) {
      return void res.status(429).json({ error: "Too many attempts. Wait a minute, then try again." });
    }
    const row = db.prepare("SELECT password_hash, totp_secret_encrypted FROM users WHERE id = ?").get(personOf(req.user!)) as
      | { password_hash: string; totp_secret_encrypted: string | null }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return void res.status(400).json({ error: "Your current password is incorrect." });
    let secret = "";
    try { if (row.totp_secret_encrypted) secret = decryptTotpSecret(row.totp_secret_encrypted); } catch { /* rejected below */ }
    const validTotp = Boolean(secret && verifyTotp(secret, code));
    const recoveryCodeHash = validTotp ? null : hashRecoveryCode(code);
    if (!validTotp && !recoveryCodeHash) return void res.status(400).json({ error: "That code didn't match your authenticator or recovery codes." });
    const disabled = inTransaction(db, () => {
      if (recoveryCodeHash) {
        const consumed = db.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ?")
          .run(personOf(req.user!), recoveryCodeHash);
        if (consumed.changes !== 1) return false;
      }
      db.prepare("UPDATE users SET totp_secret_encrypted = NULL, totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL WHERE id = ?")
        .run(personOf(req.user!));
      db.prepare("UPDATE preferences SET two_factor = 0 WHERE user_id = ?").run(personOf(req.user!));
      db.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(personOf(req.user!));
      db.prepare("DELETE FROM login_challenges WHERE user_id = ?").run(personOf(req.user!));
      notify(personOf(req.user!), "security", "Two-step sign-in turned off", "Authenticator verification is no longer required when you sign in.");
      return true;
    });
    if (!disabled) return void res.status(400).json({ error: "That code didn't match your authenticator or recovery codes." });
    res.json({ enabled: false });
  }));

  /* ---------- budgets & cash plans ---------- */

  app.post("/api/me/budgets", requireAuth, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const category = String(req.body?.category ?? "All spending").trim() || "All spending";
    const monthlyLimit = dollarsToCents(req.body?.monthlyLimit ?? 0);
    const alertPercent = Number(req.body?.alertPercent ?? 80);
    if (!name || name.length > 48) return void res.status(400).json({ error: "Use a budget name between 1 and 48 characters." });
    if (monthlyLimit <= 0 || monthlyLimit > MAX_TRANSFER_CENTS) return void res.status(400).json({ error: "Use a valid monthly budget limit." });
    if (!Number.isInteger(alertPercent) || alertPercent < 50 || alertPercent > 100) {
      return void res.status(400).json({ error: "Alert threshold must be between 50% and 100%." });
    }
    const id = rid("budget");
    db.prepare(
      "INSERT INTO budgets (id, user_id, name, category, monthly_limit_cents, alert_percent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, req.user!.id, name, category, monthlyLimit, alertPercent, now(), now());
    res.status(201).json({ budget: { id, name, category, monthlyLimit: monthlyLimit / 100, alertPercent, createdAt: now() } });
  }));

  app.delete("/api/me/budgets/:id", requireAuth, wrap((req, res) => {
    const result = db.prepare("DELETE FROM budgets WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    if (!result.changes) return void res.status(404).json({ error: "Budget not found." });
    res.json({ ok: true });
  }));

  /* ---------- cards ---------- */

  const cardRow = (id: string, userId: string) =>
    db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined;

  app.post("/api/me/cards", requireAuth, requireApproved, wrap(async (req, res) => {
    const label = String(req.body?.label ?? "").trim();
    const type = req.body?.type === "physical" ? "physical" : "virtual";
    const limit = dollarsToCents(req.body?.limit ?? 0);
    const cardholder = String(req.body?.cardholder ?? req.user!.name);
    if (!label) return void res.status(400).json({ error: "A label is required." });
    if (limit <= 0) return void res.status(400).json({ error: "A monthly limit is required." });

    const rail = stripeRails.status(req.user!.id);
    // Production never creates an invented card. Once Stripe rails are
    // configured, every new card is an Issuing card or the request fails with
    // a clear onboarding state — no local PAN/CVV stand-in can leak into live
    // operations. Development keeps the existing fixture path below.
    if (rail.configured) {
      const owner = stripeOwner(req, res); if (!owner) return;
      try {
        const issued = await stripeRails.issueCard(owner, { label, type });
        const id = rid("card");
        const controls = { online: true, contactless: true, atm: type === "physical", international: false, magstripe: type === "physical" };
        const shipping = type === "physical" ? { status: "processing", provider: "stripe", orderedAt: now() } : { status: "not_applicable" };
        const masked = `•••• •••• •••• ${issued.last4}`;
        db.prepare(
          `INSERT INTO cards (id,user_id,label,last4,full_number,expiry,cvv,type,cardholder,merchant_lock,category_lock,
             limit_cents,spent_cents,single_txn_limit_cents,daily_atm_limit_cents,pin,frozen,wallet_status,controls_json,shipping_json,created_at,provider_card_id,provider_cardholder_id,provider_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,0,'not_added',?,?,?,?,?,?)`,
        ).run(id, req.user!.id, label, issued.last4, masked, issued.expiry, "", type, cardholder,
          typeof req.body?.merchantLock === "string" && req.body.merchantLock.trim() ? req.body.merchantLock.trim() : null, null,
          limit, Math.min(limit, 500_000), type === "physical" ? 100_000 : 0, "", JSON.stringify(controls), JSON.stringify(shipping), now(),
          issued.providerCardId, issued.providerCardholderId, issued.status);
        notify(req.user!.id, "card", `${type === "virtual" ? "Virtual" : "Physical"} card issued`, `${label} •••• ${issued.last4} is managed through Stripe Issuing.`);
        return void res.status(201).json({ card: { id, last4: issued.last4, fullNumber: masked, exp: issued.expiry, cvv: "•••", providerStatus: issued.status } });
      } catch (error) {
        if (stripeFailure(res, error)) return;
        throw error;
      }
    }
    if (process.env.NODE_ENV === "production") {
      return void res.status(503).json({ error: "Card issuing is not configured. Complete Stripe Treasury and Issuing setup before issuing a live card.", code: "rails_unavailable" });
    }

    const id = rid("card");
    const nums = cardNumbers();
    const controls = { online: true, contactless: true, atm: type === "physical", international: false, magstripe: type === "physical" };
    const shipping = type === "physical"
      ? { status: "processing", carrier: "ParcelPost", tracking: `VP${Math.random().toString().slice(2, 14)}`, orderedAt: now(), estimatedDelivery: now() + 6 * 86_400_000, address: String(req.body?.shippingAddress ?? "").trim().slice(0, 200) || memberMailingAddress(req.user!.id) }
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

  app.patch("/api/me/cards/:id", requireAuth, requireApproved, wrap(async (req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    const patch = req.body ?? {};
    const providerCardId = typeof card.provider_card_id === "string" && card.provider_card_id ? card.provider_card_id : "";
    if (providerCardId) {
      const providerControlChange = patch.limit != null || patch.singleTransactionLimit != null || patch.dailyAtmLimit != null ||
        patch.pin != null || patch.walletStatus != null || "merchantLock" in patch || "categoryLock" in patch || patch.controls;
      if (providerControlChange) return void res.status(409).json({ error: "Live card spending controls must be changed in the Stripe card-management component until Veyra's provider-control sync is enabled.", code: "provider_controls_pending" });
      if (typeof patch.frozen === "boolean") {
        try {
          const provider = await stripeRails.setCardFrozen(req.user!.id, providerCardId, patch.frozen);
          db.prepare("UPDATE cards SET frozen=?, provider_status=? WHERE id=? AND user_id=?").run(patch.frozen ? 1 : 0, provider.status, id, req.user!.id);
          return void res.json({ ok: true, providerStatus: provider.status });
        } catch (error) {
          if (stripeFailure(res, error)) return;
          throw error;
        }
      }
      if (typeof patch.label === "string" && patch.label.trim()) {
        db.prepare("UPDATE cards SET label=? WHERE id=? AND user_id=?").run(patch.label.trim(), id, req.user!.id);
        return void res.json({ ok: true });
      }
      return void res.status(400).json({ error: "Nothing to update." });
    }
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

  app.delete("/api/me/cards/:id", requireAuth, requireApproved, wrap(async (req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    const providerCardId = typeof card.provider_card_id === "string" && card.provider_card_id ? card.provider_card_id : "";
    if (providerCardId) {
      try { await stripeRails.setCardFrozen(req.user!.id, providerCardId, true); }
      catch (error) { if (stripeFailure(res, error)) return; throw error; }
    }
    db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").run(id, req.user!.id);
    res.json({ ok: true });
  }));

  app.post("/api/me/cards/freeze-all", requireAuth, requireApproved, wrap(async (req, res) => {
    const providerCards = db.prepare("SELECT provider_card_id FROM cards WHERE user_id=? AND provider_card_id IS NOT NULL AND provider_card_id != '' AND frozen=0").all(req.user!.id) as Array<{ provider_card_id: string }>;
    try {
      // No local success until each remote card is actually inactive. A partial
      // provider outage leaves the remaining rows visible for a retry instead
      // of claiming every live card was frozen.
      for (const card of providerCards) await stripeRails.setCardFrozen(req.user!.id, card.provider_card_id, true);
    } catch (error) { if (stripeFailure(res, error)) return; throw error; }
    db.prepare("UPDATE cards SET frozen = 1, provider_status=CASE WHEN provider_card_id IS NOT NULL AND provider_card_id != '' THEN 'inactive' ELSE provider_status END WHERE user_id = ?").run(req.user!.id);
    notify(req.user!.id, "security", "All cards frozen", "New card purchases will be declined until you unfreeze a card.");
    res.json({ ok: true });
  }));

  app.post("/api/me/cards/:id/replace", requireAuth, requireApproved, wrap((req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    if (typeof card.provider_card_id === "string" && card.provider_card_id) {
      return void res.status(409).json({ error: "Request replacement through the Stripe card-management component so the live card is replaced and shipped by the provider.", code: "provider_replacement_pending" });
    }
    const reason = String(req.body?.reason ?? "Replacement requested");
    const newId = rid("card");
    const nums = cardNumbers();
    const shipping = card.type === "physical"
      ? { status: "processing", carrier: "ParcelPost", tracking: `VP${Math.random().toString().slice(2, 14)}`, orderedAt: now(), estimatedDelivery: now() + 6 * 86_400_000, address: previousShippingAddress(card) || memberMailingAddress(req.user!.id) }
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

  app.post("/api/me/cards/:id/shipping/advance", requireAuth, requireApproved, wrap((req, res) => {
    const id = String(req.params.id);
    const card = cardRow(id, req.user!.id);
    if (!card) return void res.status(404).json({ error: "Card not found." });
    if (typeof card.provider_card_id === "string" && card.provider_card_id) return void res.status(409).json({ error: "Live card shipping is updated by Stripe webhook events, not simulated from this screen.", code: "provider_shipping_pending" });
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

  app.post("/api/me/invoices", requireAuth, requireApproved, wrap((req, res) => {
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

  app.post("/api/me/invoices/:id/paid", requireAuth, requireApproved, wrap((req, res) => {
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

  app.post("/api/me/invoices/:id/remind", requireAuth, requireApproved, wrap((req, res) => {
    const id = String(req.params.id);
    const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND user_id = ?").get(id, req.user!.id) as Record<string, unknown> | undefined;
    if (!inv) return void res.status(404).json({ error: "Invoice not found." });
    notify(req.user!.id, "invoice", `Reminder sent to ${String(inv.client)}`, `We emailed ${String(inv.client_email)} about invoice #${id}.`);
    res.json({ ok: true });
  }));

  /* ---------- team ---------- */

  const INVITE_TTL_MS = 7 * 86_400_000;
  const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");

  app.post("/api/me/team", requireAuth, requireApproved, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = String(req.body?.role ?? "Member");
    const monthlyLimit = dollarsToCents(req.body?.monthlyLimit ?? 0);
    if (!name || !email) return void res.status(400).json({ error: "Name and email are required." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return void res.status(400).json({ error: "Enter a valid email address." });
    if (!["Admin", "Member", "Bookkeeper"].includes(role)) return void res.status(400).json({ error: "Invalid role." });
    if (monthlyLimit < 0 || monthlyLimit > MAX_TRANSFER_CENTS || (role === "Bookkeeper" && monthlyLimit !== 0)) {
      return void res.status(400).json({ error: "Monthly limits must be between $0 and $250,000; Bookkeepers must have a $0 limit." });
    }
    if (req.user!.accountType !== "business") return void res.status(400).json({ error: "Team access is available on business accounts." });
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      return void res.status(409).json({ error: "That email already has a Veyra login. Invite a different address." });
    }
    if (db.prepare("SELECT 1 FROM team_members WHERE user_id = ? AND email = ? COLLATE NOCASE AND status != 'removed'").get(req.user!.id, email)) {
      return void res.status(409).json({ error: "That person is already on your team or has a pending invite." });
    }
    if (!rateLimit(`invite:${req.user!.id}`, 30, 60 * 60_000)) return void res.status(429).json({ error: "Too many invites — try again in an hour." });
    const id = rid("tm");
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    db.prepare(
      `INSERT INTO team_members (id, user_id, name, email, role, card_count, monthly_limit_cents, status, invite_token_hash, invite_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
    ).run(id, req.user!.id, name, email, role, role === "Bookkeeper" ? 0 : 1, monthlyLimit, hashInvite(token), now() + INVITE_TTL_MS);
    const business = req.user!.business || req.user!.name;
    void sendMail(teamInviteMail(email, name, req.user!.name, business, role, token));
    notify(req.user!.id, "security", `Invite sent to ${name}`, `${role} · ${monthlyLimit ? `${centsToDecimal(monthlyLimit)} monthly limit (UTC)` : role === "Bookkeeper" ? "view-only access" : "no outgoing spending allowance"}.`);
    // Without a mail provider the link would only exist in an email that never
    // leaves the server, so development hands it back for the owner to share.
    const inviteUrl = process.env.NODE_ENV !== "production" && !mailDelivers() ? `/#/invite/accept?token=${token}` : undefined;
    res.status(201).json({
      member: { id, name, email, role, cardCount: role === "Bookkeeper" ? 0 : 1, monthlyLimit: monthlyLimit / 100, status: "invited" },
      ...(inviteUrl ? { inviteUrl } : {}),
    });
  }));

  app.delete("/api/me/team/:id", requireAuth, requireApproved, wrap((req, res) => {
    const id = String(req.params.id);
    const member = db.prepare("SELECT role, member_user_id FROM team_members WHERE id = ? AND user_id = ?").get(id, req.user!.id) as
      { role: string; member_user_id: string | null } | undefined;
    if (!member) return void res.status(404).json({ error: "Team member not found." });
    if (member.role === "Owner") return void res.status(400).json({ error: "The account owner cannot be removed." });
    if (member.member_user_id && member.member_user_id === req.user!.loginId) {
      return void res.status(400).json({ error: "You can't remove yourself — ask the account owner." });
    }
    inTransaction(db, () => {
      db.prepare("DELETE FROM team_members WHERE id = ? AND user_id = ?").run(id, req.user!.id);
      // Their login stops working immediately: requireAuth requires an active
      // team_members row, and every live session is revoked.
      if (member.member_user_id) db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?").run(member.member_user_id);
    });
    res.json({ ok: true });
  }));

  /** A pending, unexpired invite by its raw token. */
  function pendingInvite(token: string) {
    if (!/^[a-f0-9]{32,128}$/i.test(token)) return undefined;
    return db.prepare(
      `SELECT m.*, o.name AS owner_name, o.business AS owner_business, o.plan AS owner_plan
       FROM team_members m JOIN users o ON o.id = m.user_id
       WHERE m.invite_token_hash = ? AND m.status = 'invited' AND m.invite_expires_at > ?`,
    ).get(hashInvite(token), now()) as Record<string, unknown> | undefined;
  }

  app.get("/api/invites/:token", wrap((req, res) => {
    const invite = pendingInvite(String(req.params.token));
    if (!invite) return void res.status(404).json({ error: "This invitation is invalid, already used, or expired. Ask for a new one." });
    res.json({ invite: {
      name: String(invite.name), email: String(invite.email), role: String(invite.role),
      business: String(invite.owner_business || invite.owner_name), invitedBy: String(invite.owner_name),
      expiresAt: Number(invite.invite_expires_at),
    } });
  }));

  app.post("/api/invites/:token/accept", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`invite-accept:${ip}`, 20, 60 * 60_000)) return void res.status(429).json({ error: "Too many attempts — try again later." });
    const invite = pendingInvite(String(req.params.token));
    if (!invite) return void res.status(404).json({ error: "This invitation is invalid, already used, or expired. Ask for a new one." });
    const name = String(req.body?.name ?? "").trim() || String(invite.name);
    const password = String(req.body?.password ?? "");
    if (name.length < 2 || name.length > 80) return void res.status(400).json({ error: "Enter your name." });
    if (password.length < 8) return void res.status(400).json({ error: "Use at least 8 characters for your password." });
    const email = String(invite.email);
    if (db.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
      return void res.status(409).json({ error: "That email already has a Veyra login." });
    }
    const id = rid("u");
    const ownerId = String(invite.user_id);
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, name, email, phone, business, account_type, role, plan, password_hash, status, created_at, team_owner_id, team_role, veyra_id)
         VALUES (?, ?, ?, '', ?, 'business', 'user', ?, ?, 'active', ?, ?, ?, ?)`,
      ).run(id, name, email, String(invite.owner_business ?? ""), String(invite.owner_plan ?? "Pro"), hashPassword(password), now(), ownerId, String(invite.role), generateVeyraId(db));
      db.prepare("UPDATE team_members SET status = 'active', name = ?, member_user_id = ?, invite_token_hash = NULL, invite_expires_at = NULL WHERE id = ?")
        .run(name, id, String(invite.id));
    });
    const tokenId = randomUUID();
    db.prepare("INSERT INTO sessions (token_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenId, id, now(), now() + TOKEN_TTL_MS);
    notify(ownerId, "security", `${name} joined your team`, `${String(invite.role)} access is now active. You can remove it any time from Team.`);
    res.status(201).json({ token: signToken({ sub: id, jti: tokenId, role: "user" }), user: { ...fullUser(id), status: "active" } });
  }));

  /* ---------- savings pockets (money ops) ---------- */

  app.post("/api/me/pockets", requireAuth, requireApproved, wrap((req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const target = dollarsToCents(req.body?.target ?? 0);
    if (!name) return void res.status(400).json({ error: "A name is required." });
    const id = rid("pocket");
    db.prepare(
      `INSERT INTO savings_pockets (id, user_id, name, balance_cents, target_cents, color, icon, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    ).run(id, req.user!.id, name, target, String(req.body?.color ?? "#7558dc"), String(req.body?.icon ?? "general"), now());
    res.status(201).json({ pocket: { id, name, balance: 0, target: target / 100 } });
  }));

  app.post("/api/me/pockets/:id/move", requireAuth, requireApproved, wrap((req, res) => {
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

  app.delete("/api/me/pockets/:id", requireAuth, requireApproved, wrap((req, res) => {
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

  app.post("/api/me/payees", requireAuth, requireApproved, wrap((req, res) => {
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

  app.delete("/api/me/payees/:id", requireAuth, requireApproved, wrap((req, res) => {
    const info = db.prepare("DELETE FROM payees WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Payee not found." });
    res.json({ ok: true });
  }));

  app.post("/api/me/scheduled", requireAuth, requireApproved, wrap((req, res) => {
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

  app.patch("/api/me/scheduled/:id", requireAuth, requireApproved, wrap((req, res) => {
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

  app.delete("/api/me/scheduled/:id", requireAuth, requireApproved, wrap((req, res) => {
    const info = db.prepare("DELETE FROM scheduled_payments WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Payment not found." });
    res.json({ ok: true });
  }));

  app.post("/api/me/scheduled/:id/pay", requireAuth, requireApproved, wrap((req, res) => {
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
        const fee = quoteFee("bill", cents);
        const account = db.prepare("SELECT id, balance_cents FROM accounts WHERE user_id = ?").get(req.user!.id) as { id: number; balance_cents: number };
        if (account.balance_cents < cents + fee.feeCents) throw new Error("Insufficient funds for this payment and its fee.");
        const at = now();
        enforceTeamSpend(db, req.user!.id, personOf(req.user!), cents, at);
        const base = Number(payment.next_date);
        const nextDate = payment.frequency === "weekly"
          ? base + 7 * 86_400_000
          : payment.frequency === "monthly"
            ? new Date(base).setMonth(new Date(base).getMonth() + 1)
            : base;
        db.prepare("UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?").run(account.balance_cents - cents - fee.feeCents, now(), account.id);
        db.prepare("UPDATE scheduled_payments SET next_date = ?, status = ? WHERE id = ?")
          .run(nextDate, payment.frequency === "once" ? "completed" : String(payment.status), id);
        const txn = rid("txn");
        db.prepare(
          `INSERT INTO transactions (id, account_id, user_id, merchant, category, method, amount_cents, fee_cents, status, reference, note, created_at, performed_by)
           VALUES (?, ?, ?, ?, ?, 'ACH', ?, ?, 'cleared', ?, ?, ?, ?)`,
        ).run(txn, account.id, req.user!.id, String(payment.payee_name), String(payment.category), -cents, fee.feeCents,
          makeReference(), String(payment.memo ?? "Scheduled payment"), at, personOf(req.user!));
        notify(req.user!.id, "transfer", `${centsToDecimal(cents)} paid to ${String(payment.payee_name)}`,
          payment.frequency === "once" ? "One-time payment completed." : "Next payment scheduled.");
        return txn;
      });
      // The ledger row's id, so the client can act on the payment the server
      // just wrote (dispute it) before the refreshed snapshot lands.
      res.json({ ok: true, transaction: { id: txnId } });
    } catch (err) {
      fail(res, err, "Payment failed.");
    }
  }));

  /* ---------- rewards, Scout, perks, sessions, notifications ---------- */

  app.post("/api/me/rewards/redeem", requireAuth, requireApproved, wrap((req, res) => {
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

  app.post("/api/me/scout/apply", requireAuth, requireApproved, wrap((_req, res) => {
    res.status(410).json({
      error: "Scout estimates cannot be credited to your balance. No funded savings provider is connected.",
      code: "scout_credit_disabled",
    });
  }));

  app.post("/api/me/perks/:id/redeem", requireAuth, requireApproved, wrap((req, res) => {
    const info = db.prepare("UPDATE perks SET status = 'redeemed' WHERE id = ? AND user_id = ? AND status = 'available'")
      .run(String(req.params.id), req.user!.id);
    if (info.changes === 0) return void res.status(404).json({ error: "Perk not available." });
    res.json({ ok: true });
  }));

  app.post("/api/me/notifications/:id/read", requireAuth, requireApproved, wrap((req, res) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  }));

  app.post("/api/me/sessions/:id/revoke", requireAuth, requireApproved, wrap((req, res) => {
    const target = db.prepare(`
      SELECT ss.auth_token_id FROM security_sessions ss JOIN sessions s ON s.token_id = ss.auth_token_id AND s.user_id = ss.user_id
      WHERE ss.id = ? AND ss.user_id = ? AND s.revoked = 0 AND s.expires_at > ?
    `).get(String(req.params.id), personOf(req.user!), now()) as { auth_token_id: string } | undefined;
    if (!target) return void res.status(404).json({ error: "That active session was not found." });
    const current = req.authToken ? verifyToken(req.authToken)?.jti : undefined;
    if (target.auth_token_id === current) return void res.status(400).json({ error: "You can't sign out the session you're using here. Use Sign out instead." });
    const revoked = db.prepare("UPDATE sessions SET revoked = 1 WHERE token_id = ? AND user_id = ? AND revoked = 0")
      .run(target.auth_token_id, personOf(req.user!));
    if (revoked.changes === 0) return void res.status(404).json({ error: "That active session was not found." });
    notify(personOf(req.user!), "security", "A device was signed out", "An active sign-in session was revoked from Security Center.");
    res.json({ ok: true, revoked: true });
  }));

  app.post("/api/me/sessions/revoke-others", requireAuth, requireApproved, wrap((req, res) => {
    const current = req.authToken ? verifyToken(req.authToken)?.jti : undefined;
    if (!current) return void res.status(401).json({ error: "Your session could not be verified. Sign in again." });
    const result = db.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND token_id <> ? AND revoked = 0 AND expires_at > ?")
      .run(personOf(req.user!), current, now());
    if (result.changes > 0) notify(personOf(req.user!), "security", "Other devices were signed out", `${result.changes} other session${result.changes === 1 ? " was" : "s were"} revoked from Security Center.`);
    res.json({ ok: true, revokedCount: result.changes });
  }));

  app.patch("/api/me/sessions/:id", requireAuth, requireApproved, wrap((req, res) => {
    if (typeof req.body?.trusted !== "boolean") return void res.status(400).json({ error: "Nothing to update." });
    const live = db.prepare(`
      SELECT 1 FROM security_sessions ss JOIN sessions s ON s.token_id = ss.auth_token_id AND s.user_id = ss.user_id
      WHERE ss.id = ? AND ss.user_id = ? AND s.revoked = 0 AND s.expires_at > ?
    `).get(String(req.params.id), personOf(req.user!), now());
    if (!live) return void res.status(404).json({ error: "That active session was not found." });
    db.prepare("UPDATE security_sessions SET trusted = ? WHERE id = ? AND user_id = ?").run(req.body.trusted ? 1 : 0, String(req.params.id), personOf(req.user!));
    res.json({ ok: true, trusted: req.body.trusted });
  }));

  /* ---------- KYC wizard progress + member dispute tracking ---------- */

  app.patch("/api/me/kyc", requireAuth, requireApproved, wrap((req, res) => {
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
        customers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND team_owner_id IS NULL"),
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
              a.account_number, a.routing_number, a.balance_cents, a.pending_cents, k.status AS kyc_status,
              p.dob, p.ssn, p.city, p.state, p.id_type, p.submitted_at
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       LEFT JOIN kyc_records k ON k.user_id = u.id
       LEFT JOIN identity_profiles p ON p.user_id = u.id
       WHERE u.role = 'user' AND u.team_owner_id IS NULL
       ORDER BY u.created_at DESC`,
    ).all() as Array<Record<string, unknown>>;
    const filtered = q
      ? rows.filter(r => `${r.name} ${r.email} ${r.business} ${r.ssn ?? ""}`.toLowerCase().includes(q))
      : rows;
    res.json({
      members: filtered.map(r => ({
        id: r.id, name: r.name, email: r.email, phone: r.phone, business: r.business,
        accountType: r.account_type, plan: r.plan, status: r.status,
        accountNumber: r.account_number ?? null, routingNumber: r.routing_number ?? null,
        balance: money((r.balance_cents as number) ?? 0),
        pending: money((r.pending_cents as number) ?? 0),
        kycStatus: r.kyc_status ?? "not_started",
        // Enough for the directory table; the full application is one request
        // away at /api/admin/members/:id.
        dob: r.dob ?? null, ssn: r.ssn ?? null,
        city: r.city ?? null, state: r.state ?? null, idType: r.id_type ?? null,
        profileSubmittedAt: r.submitted_at ?? null,
      })),
    });
  }));

  // Static path, declared before /:id: Express would otherwise read
  // "status-reasons" as a member id and answer 404 instead of checking the
  // permission. The console's picker and the route that applies a restriction
  // must share one catalogue, which is why this is served and not hardcoded.
  app.get("/api/admin/members/status-reasons", requireAuth, requirePerm("accounts.set_status"), wrap((_req, res) => {
    res.json({ reasons: SUSPENSION_REASONS, otherCode: OTHER_REASON_CODE });
  }));

  app.get("/api/admin/members/:id", requireAuth, requirePerm("customers.view"), wrap((req, res) => {
    const user = memberRow(String(req.params.id));
    if (!user) return void res.status(404).json({ error: "Member not found." });
    const account = db.prepare("SELECT * FROM accounts WHERE user_id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    const txns = db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(String(req.params.id));
    const kyc = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(String(req.params.id));
    const identityRow = db.prepare("SELECT * FROM identity_profiles WHERE user_id = ?").get(String(req.params.id)) as Record<string, unknown> | undefined;
    const viewAccounts = can(db, req.user!.role, "accounts.view");
    res.json({
      member: {
        id: user.id, name: user.name, email: user.email, phone: user.phone, business: user.business,
        accountType: user.account_type, plan: user.plan, status: user.status, createdAt: user.created_at,
        balance: viewAccounts ? money((account?.balance_cents as number) ?? 0) : undefined,
        accountNumber: viewAccounts ? account?.account_number : undefined, routingNumber: viewAccounts ? account?.routing_number : undefined,
        bankName: viewAccounts ? account?.bank_name : undefined, bankAccountType: viewAccounts ? account?.bank_account_type : undefined,
        statusReason: user.status_reason ?? "", teamOwnerId: user.team_owner_id ?? null,
        pending: viewAccounts ? money((account?.pending_cents as number) ?? 0) : undefined,
      },
      // Full identity data on this endpoint is restricted to KYC reviewers;
      // ordinary customer-directory readers do not receive SSNs or EINs.
      identity: identityRow && can(db, req.user!.role, "kyc.review")
        ? { ...rowToApplication(identityRow), submittedAt: identityRow.submitted_at ?? null }
        : null,
      transactions: can(db, req.user!.role, "transactions.view") ? txns.map(txnOut) : [],
      kyc,
      permissions: rolePermissions(db, req.user!.role as StaffRole),
      emailDeliveryConfigured: mailDelivers(),
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

  /**
   * Correct a member's account number.
   *
   * The number is printed on statements and handed out for ACH and wire, so a
   * wrong one has to be fixable from the console rather than by a migration.
   * Twelve digits, unique across the platform, and rewritten only for a member
   * who exists — with the old value recorded in the audit log.
   */
  app.patch("/api/admin/members/:id/account-number", requireAuth, requirePerm("accounts.edit_number"), wrap((req, res) => {
    const target = memberRow(String(req.params.id));
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const digits = String(req.body?.accountNumber ?? "").replace(/[\s-]/g, "");
    if (!/^\d{12}$/.test(digits)) {
      return void res.status(400).json({ error: "An account number is exactly 12 digits." });
    }
    const clash = db.prepare("SELECT user_id FROM accounts WHERE account_number = ? AND user_id != ?")
      .get(digits, String(req.params.id)) as { user_id: string } | undefined;
    if (clash) return void res.status(409).json({ error: "That account number is already assigned to another account." });
    const account = db.prepare("SELECT account_number FROM accounts WHERE user_id = ?")
      .get(String(req.params.id)) as { account_number: string } | undefined;
    const before = account?.account_number ?? "";
    if (before === digits) return void res.json({ accountNumber: digits, changed: false });
    if (account) {
      db.prepare("UPDATE accounts SET account_number = ?, updated_at = ? WHERE user_id = ?")
        .run(digits, now(), String(req.params.id));
    } else {
      // A member without an account row still gets a real account, not just a
      // number floating in the console.
      db.prepare(
        `INSERT INTO accounts (user_id, account_number, routing_number, bank_name, balance_cents, pending_cents, rewards_cents, created_at, updated_at)
         VALUES (?, ?, '091408735', 'Northfield Bank', 0, 0, 0, ?, ?)`,
      ).run(String(req.params.id), digits, now(), now());
    }
    audit(req, "account.number", "Financial", `user:${String(req.params.id)} · ${target.name}`,
      `Account number set to ${digits}.`, before || "(none)", digits);
    notify(String(req.params.id), "security", "Your account number was updated",
      `Veyra Support changed the account number on your checking account to ${digits}. If you did not expect this, contact us right away.`);
    res.json({ accountNumber: digits, changed: true });
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
    // A restriction must carry a reason from the catalogue (or an explicit
    // custom one). `reason` is still accepted on its own for older clients.
    let reasonText = "";
    let reasonCode = "";
    if (status === "restricted") {
      const resolved = resolveSuspensionReason(req.body?.reasonCode, req.body?.reason);
      if (!resolved.ok) return void res.status(400).json({ error: resolved.error });
      reasonText = resolved.text;
      reasonCode = resolved.code;
    }
    const before = target.status as string;
    const now = Date.now();
    if (status === "restricted") {
      db.prepare("UPDATE users SET status = ?, status_reason = ?, status_changed_at = ?, status_changed_by = ? WHERE id = ?")
        .run(status, reasonText, now, req.user!.name, String(req.params.id));
    } else {
      // Lifting a hold clears the banner but keeps who did it and when, so the
      // audit trail and the member's history stay coherent.
      db.prepare("UPDATE users SET status = ?, status_reason = '', status_changed_at = ?, status_changed_by = ? WHERE id = ?")
        .run(status, now, req.user!.name, String(req.params.id));
    }
    audit(req, "account.status", "Financial", `user:${String(req.params.id)} · ${target.name}`,
      status === "restricted"
        ? `Restricted account — ${reasonCode === OTHER_REASON_CODE ? "custom reason" : reasonCode}: "${reasonText}"`
        : "Restored account to active.", before, status);
    notify(String(req.params.id), "security",
      status === "restricted" ? "Your account is restricted" : "Your account is fully active",
      status === "restricted"
        ? `${reasonText} Outgoing transfers are paused while we review.`
        : "Restrictions were lifted — all features are available again.");
    res.json({ status, reason: reasonText || undefined, reasonCode: reasonCode || undefined });
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
      `SELECT u.id, u.name, u.email, u.account_type, u.business, k.submission_json, k.updated_at,
              k.review_state, k.status, k.review_note, k.review_reqs_json
       FROM kyc_records k JOIN users u ON u.id = k.user_id
       WHERE k.status = 'in_review' AND k.review_state IN ('in_review', 'more_info')
       ORDER BY k.updated_at ASC`,
    ).all() as Array<Record<string, unknown>>;
    res.json({
      queue: rows.map(r => ({
        userId: r.id, name: r.name, email: r.email, business: r.business ?? "", accountType: r.account_type,
        submission: r.submission_json ? JSON.parse(r.submission_json as string) : null,
        submittedAt: r.updated_at,
        reviewState: r.review_state ?? "in_review",
        reviewNote: String(r.review_note ?? ""),
        reviewRequirements: JSON.parse(String(r.review_reqs_json ?? "[]")),
      })),
    });
  }));

  /**
   * The decision that opens, holds or closes an application.
   *
   * Three outcomes, each recorded with who decided and why:
   *   approved         — the account is usable, the dashboard unlocks
   *   needs_attention  — we need more from the applicant (the fraud-hold path)
   *   rejected         — we are not opening this account
   *
   * The reason is required for anything other than approval: an applicant who is
   * held or declined is told why, in their own words, rather than being left to
   * guess. An already-decided application can be re-decided (a hold becomes an
   * approval once the documents arrive) but a member who is already approved is
   * left alone — closing an open account is an account action, not a review one.
   */
  app.post("/api/admin/kyc/:userId/decision", requireAuth, requirePerm("kyc.review"), wrap((req, res) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(String(req.params.userId)) as Record<string, unknown> | undefined;
    if (!target) return void res.status(404).json({ error: "Member not found." });
    const raw = String(req.body?.decision ?? "");
    if (raw !== "approved" && raw !== "needs_attention" && raw !== "rejected") {
      return void res.status(400).json({ error: "decision must be 'approved', 'needs_attention' or 'rejected'." });
    }
    const decision = raw as "approved" | "needs_attention" | "rejected";
    const note = String(req.body?.note ?? "").trim();
    const requirements = Array.isArray(req.body?.requirements)
      ? req.body.requirements.map(String).filter((r: string) => REVIEW_REQUIREMENTS.includes(r))
      : [];
    if (decision !== "approved" && !note) {
      return void res.status(400).json({ error: "A reason is required — the applicant is shown it." });
    }
    if (decision === "needs_attention" && requirements.length === 0) {
      return void res.status(400).json({ error: "Choose at least one item to ask the applicant for." });
    }
    const record = db.prepare("SELECT * FROM kyc_records WHERE user_id = ?").get(String(req.params.userId)) as Record<string, unknown> | undefined;
    if (!record) return void res.status(409).json({ error: "This member has no application to review." });
    const before = String(record.review_state ?? "approved");
    if (before === "approved") {
      return void res.status(409).json({ error: "This member is already approved. Restrict the account instead of re-reviewing it." });
    }

    const reviewState = decision === "approved" ? "approved" : decision === "needs_attention" ? "more_info" : "rejected";
    inTransaction(db, () => {
      if (decision === "approved") {
        db.prepare(
          `UPDATE kyc_records SET status = 'approved', review_state = 'approved', completeness = 100,
             review_note = '', review_reqs_json = '[]', requested_by = NULL, requested_at = NULL,
             request_reason = NULL, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE user_id = ?`,
        ).run(req.user!.id, now(), now(), String(req.params.userId));
      } else {
        db.prepare(
          `UPDATE kyc_records SET status = ?, review_state = ?, review_note = ?, review_reqs_json = ?,
             reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE user_id = ?`,
        ).run(
          decision === "needs_attention" ? "needs_attention" : "in_review",
          reviewState, note, JSON.stringify(requirements), req.user!.id, now(), now(), String(req.params.userId),
        );
      }
    });

    audit(req, decision === "approved" ? "application.approve" : decision === "rejected" ? "application.reject" : "application.request_info",
      "KYC", `user:${String(req.params.userId)} · ${target.name}`,
      decision === "approved"
        ? "Approved the account application."
        : `${decision === "rejected" ? "Rejected" : "Requested more information for"} the account application — ${note}`,
      before, reviewState);
    notify(String(req.params.userId), "security",
      decision === "approved" ? "Your account is approved" : decision === "rejected" ? "About your Veyra application" : "We need a little more from you",
      decision === "approved"
        ? `Welcome to Veyra — your account is open. Sign in to move money, set up cards and meet Scout. Approved by ${req.user!.name}.`
        : decision === "rejected"
        ? `${note} If you think this is a mistake, reply to this message and our team will take another look.`
        : `${note} Open your application to send what we need${requirements.length ? `: ${requirements.map((r: string) => requirementLabel(r)).join(", ")}` : ""}. Reviewed by ${req.user!.name}.`);
    void sendMail(kycDecisionMail(String(target.email), String(target.name), decision, note));
    res.json({ status: reviewState, decision });
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
    const members = db.prepare("SELECT id, name, email, account_type FROM users WHERE role = 'user' AND team_owner_id IS NULL ORDER BY created_at DESC LIMIT 50").all();
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
    const targets = db.prepare("SELECT id, account_type FROM users WHERE role = 'user' AND team_owner_id IS NULL").all() as Array<{ id: string; account_type: string }>;
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
      // Every column the directory shows, including the identity the member
      // applied with: this is the register compliance works from.
      rows = [["ID", "Name", "Email", "Phone", "Business", "Type", "Plan", "Status", "Role",
        "Date of birth", "SSN", "Legal name (business)", "EIN", "Address", "City", "State", "ZIP", "Country",
        "ID document", "ID number", "ID expiry", "Applied at"],
        ...db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.business, u.account_type, u.plan, u.status, u.role,
                              p.dob, p.ssn, p.legal_name, p.ein, p.address_line1, p.city, p.state, p.postal_code,
                              p.country, p.id_type, p.id_number, p.id_expiry, p.submitted_at
                       FROM users u LEFT JOIN identity_profiles p ON p.user_id = u.id
                       ORDER BY u.created_at`).all()
          .map((r: any) => [r.id, r.name, r.email, r.phone, r.business, r.account_type, r.plan, r.status, r.role,
            r.dob ?? "", r.ssn ?? "", r.legal_name ?? "", r.ein ?? "", r.address_line1 ?? "", r.city ?? "",
            r.state ?? "", r.postal_code ?? "", r.country ?? "", r.id_type ?? "", r.id_number ?? "", r.id_expiry ?? "",
            r.submitted_at ? new Date(r.submitted_at).toISOString() : ""])];
    } else if (kind === "accounts") {
      // Columns mirror the Accounts console: the same counts (cards, frozen
      // cards, transactions incl. how many are pending), KYC standing, status
      // and last activity, computed from the same source of truth.
      // The accounts export carries the account application too — a compliance
      // officer pulling the register needs the identity behind each account in
      // the same file.
      rows = [["User ID", "Member", "Email", "Business", "Type", "Date of birth", "SSN", "Legal name (business)", "EIN",
        "Address", "City", "State", "ZIP", "Country", "ID document", "ID number", "ID expiry",
        "Account number", "Balance", "Pending", "Rewards", "Cards", "Frozen cards", "Transactions", "Pending transactions", "KYC", "Status", "Last activity"],
        ...db.prepare(`SELECT a.user_id, u.name, u.email, u.business, u.account_type, u.status, a.account_number,
                              a.balance_cents, a.pending_cents, a.rewards_cents,
                              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS card_count,
                              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.frozen = 1) AS frozen_count,
                              (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txn_count,
                              (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.status = 'pending') AS pending_count,
                              (SELECT status FROM kyc_records k WHERE k.user_id = u.id) AS kyc_status,
                              (SELECT MAX(created_at) FROM transactions t WHERE t.user_id = u.id) AS last_activity,
                              p.dob, p.ssn, p.legal_name, p.ein, p.address_line1, p.city, p.state, p.postal_code,
                              p.country, p.id_type, p.id_number, p.id_expiry
                       FROM accounts a JOIN users u ON u.id = a.user_id
                       LEFT JOIN identity_profiles p ON p.user_id = u.id
                       ORDER BY a.balance_cents DESC`).all()
          .map((r: any) => [r.user_id, r.name, r.email, r.business ?? "", r.account_type,
            r.dob ?? "", r.ssn ?? "", r.legal_name ?? "", r.ein ?? "",
            r.address_line1 ?? "", r.city ?? "", r.state ?? "", r.postal_code ?? "", r.country ?? "",
            r.id_type ?? "", r.id_number ?? "", r.id_expiry ?? "", r.account_number,
            centsToDecimal(r.balance_cents), centsToDecimal(r.pending_cents), centsToDecimal(r.rewards_cents),
            r.card_count, r.frozen_count, r.txn_count, r.pending_count, r.kyc_status ?? "not_started", r.status,
            r.last_activity ? new Date(r.last_activity).toISOString() : "Never"])];
    } else if (kind === "transactions") {
      rows = [["Date", "Member", "Merchant", "Category", "Method", "Amount", "Fee", "Status", "Reference"],
        ...db.prepare(`SELECT t.*, u.name AS member FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC`).all()
          .map((r: any) => [new Date(r.created_at).toISOString(), r.member, r.merchant, r.category, r.method, centsToDecimal(r.amount_cents), centsToDecimal(r.fee_cents ?? 0), r.status, r.reference])];
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

  /* ============================== admin: integration switches ============================== */

  app.get("/api/admin/integrations", requireAuth, requirePerm("settings.manage"), wrap((_req, res) => {
    res.json({ integrations: integrations.list() });
  }));

  app.put("/api/admin/integrations/:id", requireAuth, requirePerm("settings.manage"), wrap((req, res) => {
    const id = String(req.params.id);
    const def = integrationById(id);
    if (!def) return void res.status(404).json({ error: "Unknown integration." });
    if (typeof req.body?.enabled !== "boolean") return void res.status(400).json({ error: "enabled must be true or false." });
    const before = integrations.isOn(id) ? "on" : "off";
    const after = req.body.enabled ? "on" : "off";
    integrations.setOn(id, req.body.enabled, req.user!.id);
    audit(req, "integration.toggle", "System", "platform", `Switched ${def.label} ${after}.`, before, after);
    res.json({ integration: integrations.status(id), integrations: integrations.list() });
  }));

  /* ============================== admin: durable operations casework ============================== */

  const OPERATION_KINDS = ["kyc", "dispute", "account", "transaction", "support", "other"] as const;
  const OPERATION_PRIORITIES = ["critical", "high", "normal", "low"] as const;
  const OPERATION_STATUSES = ["open", "investigating", "waiting", "resolved"] as const;
  type OperationKind = typeof OPERATION_KINDS[number];
  type OperationPriority = typeof OPERATION_PRIORITIES[number];
  type OperationStatus = typeof OPERATION_STATUSES[number];
  const oneOf = <T extends readonly string[]>(value: unknown, values: T): value is T[number] =>
    typeof value === "string" && (values as readonly string[]).includes(value);

  const staffAssignee = (userId: string) => db.prepare(
    "SELECT id, name, role FROM users WHERE id = ? AND status = 'active' AND role IN ('support', 'compliance', 'admin', 'superadmin')",
  ).get(userId) as { id: string; name: string; role: string } | undefined;

  const addOperationEvent = (caseId: string, req: Request, action: string, detail = "") => {
    db.prepare(
      "INSERT INTO operation_case_events (case_id, at, actor_id, actor_name, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(caseId, now(), req.user!.id, req.user!.name, action, detail);
  };

  const loadOperationCases = () => {
    const rows = db.prepare(`
      SELECT c.*, member.name AS member_name, member.email AS member_email,
             assignee.name AS assignee_name, assignee.role AS assignee_role,
             creator.name AS creator_name
      FROM operation_cases c
      LEFT JOIN users member ON member.id = c.user_id
      LEFT JOIN users assignee ON assignee.id = c.assigned_to
      JOIN users creator ON creator.id = c.created_by
      ORDER BY CASE c.status WHEN 'resolved' THEN 1 ELSE 0 END, c.priority = 'critical' DESC,
               c.priority = 'high' DESC, c.due_at IS NULL, c.due_at ASC, c.updated_at DESC
      LIMIT 300
    `).all() as Array<Record<string, unknown>>;
    return rows.map(row => {
      const caseId = String(row.id);
      const events = (db.prepare(
        "SELECT id, at, actor_id, actor_name, action, detail FROM operation_case_events WHERE case_id = ? ORDER BY at DESC LIMIT 100",
      ).all(caseId) as Array<Record<string, unknown>>).map(event => ({
        id: Number(event.id), at: Number(event.at), actorId: String(event.actor_id), actorName: String(event.actor_name),
        action: String(event.action), detail: String(event.detail ?? ""),
      }));
      const notes = (db.prepare(
        "SELECT id, author_id, author_name, body, created_at FROM operation_case_notes WHERE case_id = ? ORDER BY created_at DESC LIMIT 100",
      ).all(caseId) as Array<Record<string, unknown>>).map(note => ({
        id: Number(note.id), authorId: String(note.author_id), authorName: String(note.author_name),
        body: String(note.body), createdAt: Number(note.created_at),
      }));
      return {
        id: caseId, title: String(row.title), kind: row.kind as OperationKind,
        priority: row.priority as OperationPriority, status: row.status as OperationStatus,
        summary: String(row.summary ?? ""), sourceType: row.source_type ? String(row.source_type) : undefined,
        sourceId: row.source_id ? String(row.source_id) : undefined,
        member: row.user_id ? { id: String(row.user_id), name: String(row.member_name ?? "Unknown member"), email: String(row.member_email ?? "") } : undefined,
        assignee: row.assigned_to ? { id: String(row.assigned_to), name: String(row.assignee_name ?? "Unknown staff"), role: String(row.assignee_role ?? "") } : undefined,
        createdBy: { id: String(row.created_by), name: String(row.creator_name) },
        dueAt: row.due_at == null ? undefined : Number(row.due_at), createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at), closedAt: row.closed_at == null ? undefined : Number(row.closed_at), events, notes,
        reference: supportReference(caseId), category: row.category ? String(row.category) : undefined,
        contact: row.contact_email ? { name: String(row.contact_name ?? ""), email: String(row.contact_email) } : undefined,
        messages: supportMessages(caseId),
      };
    });
  };

  app.get("/api/admin/operations/cases", requireAuth, requirePerm("dashboard.view"), wrap((_req, res) => {
    res.json({ cases: loadOperationCases() });
  }));

  app.post("/api/admin/operations/cases", requireAuth, requirePerm("dashboard.view"), wrap((req, res) => {
    const body = req.body ?? {};
    const title = String(body.title ?? "").trim();
    const summary = String(body.summary ?? "").trim();
    if (title.length < 3 || title.length > 120) return void res.status(400).json({ error: "Case title must be between 3 and 120 characters." });
    if (summary.length > 2_000) return void res.status(400).json({ error: "Case summary must be 2,000 characters or fewer." });
    if (!oneOf(body.kind, OPERATION_KINDS)) return void res.status(400).json({ error: "Choose a valid case type." });
    if (!oneOf(body.priority ?? "normal", OPERATION_PRIORITIES)) return void res.status(400).json({ error: "Choose a valid priority." });
    const memberId = typeof body.userId === "string" && body.userId ? body.userId : null;
    if (memberId) {
      const member = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'user'").get(memberId);
      if (!member) return void res.status(400).json({ error: "Choose a valid member." });
    }
    const assignedTo = typeof body.assignedTo === "string" && body.assignedTo ? body.assignedTo : null;
    if (assignedTo && !staffAssignee(assignedTo)) return void res.status(400).json({ error: "Choose an active staff assignee." });
    const dueAt = body.dueAt == null || body.dueAt === "" ? null : Number(body.dueAt);
    if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt < now() - 86_400_000 || dueAt > now() + 366 * 86_400_000)) {
      return void res.status(400).json({ error: "Choose a valid due date within the next year." });
    }
    const sourceType = typeof body.sourceType === "string" && body.sourceType.trim() ? body.sourceType.trim().slice(0, 40) : null;
    const sourceId = typeof body.sourceId === "string" && body.sourceId.trim() ? body.sourceId.trim().slice(0, 120) : null;
    if (Boolean(sourceType) !== Boolean(sourceId)) return void res.status(400).json({ error: "A case source needs both a type and ID." });
    if (sourceType && sourceId && db.prepare("SELECT 1 FROM operation_cases WHERE source_type = ? AND source_id = ?").get(sourceType, sourceId)) {
      return void res.status(409).json({ error: "A tracked case already exists for this source." });
    }
    const id = `ops_${randomUUID()}`;
    const stamp = now();
    inTransaction(db, () => {
      db.prepare(`INSERT INTO operation_cases
        (id, title, kind, priority, status, summary, user_id, source_type, source_id, assigned_to, due_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, body.kind, body.priority ?? "normal", summary, memberId, sourceType, sourceId, assignedTo, dueAt, req.user!.id, stamp, stamp);
      addOperationEvent(id, req, "case.created", "Case opened");
      if (assignedTo) addOperationEvent(id, req, "case.assigned", `Assigned to ${staffAssignee(assignedTo)!.name}`);
    });
    audit(req, "operations.case.create", "System", `case:${id}`, `Opened ${body.priority ?? "normal"} ${body.kind} case: ${title}.`);
    res.status(201).json({ case: loadOperationCases().find(item => item.id === id) });
  }));

  app.put("/api/admin/operations/cases/:id", requireAuth, requirePerm("dashboard.view"), wrap((req, res) => {
    const caseId = String(req.params.id);
    const current = db.prepare("SELECT * FROM operation_cases WHERE id = ?").get(caseId) as Record<string, unknown> | undefined;
    if (!current) return void res.status(404).json({ error: "Case not found." });
    const body = req.body ?? {};
    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    const changes: string[] = [];
    const events: Array<[string, string]> = [];
    if (body.priority !== undefined) {
      if (!oneOf(body.priority, OPERATION_PRIORITIES)) return void res.status(400).json({ error: "Choose a valid priority." });
      if (body.priority !== current.priority) { updates.push("priority = ?"); values.push(body.priority); changes.push(`priority ${current.priority} → ${body.priority}`); events.push(["case.priority", `Priority changed to ${body.priority}`]); }
    }
    if (body.status !== undefined) {
      if (!oneOf(body.status, OPERATION_STATUSES)) return void res.status(400).json({ error: "Choose a valid case status." });
      if (body.status !== current.status) {
        updates.push("status = ?"); values.push(body.status); updates.push("closed_at = ?"); values.push(body.status === "resolved" ? now() : null);
        changes.push(`status ${current.status} → ${body.status}`); events.push(["case.status", `Status changed to ${body.status}`]);
      }
    }
    if (body.assignedTo !== undefined) {
      const assignedTo = typeof body.assignedTo === "string" && body.assignedTo ? body.assignedTo : null;
      if (assignedTo && !staffAssignee(assignedTo)) return void res.status(400).json({ error: "Choose an active staff assignee." });
      if (assignedTo !== (current.assigned_to ?? null)) {
        updates.push("assigned_to = ?"); values.push(assignedTo);
        const assigneeName = assignedTo ? staffAssignee(assignedTo)!.name : "Unassigned";
        changes.push(`owner → ${assigneeName}`); events.push(["case.assigned", `Assigned to ${assigneeName}`]);
      }
    }
    if (body.dueAt !== undefined) {
      const dueAt = body.dueAt == null || body.dueAt === "" ? null : Number(body.dueAt);
      if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt < now() - 86_400_000 || dueAt > now() + 366 * 86_400_000)) {
        return void res.status(400).json({ error: "Choose a valid due date within the next year." });
      }
      if (dueAt !== (current.due_at ?? null)) {
        updates.push("due_at = ?"); values.push(dueAt); changes.push(dueAt ? `due ${new Date(dueAt).toISOString()}` : "due date cleared");
        events.push(["case.due", dueAt ? `Due ${new Date(dueAt).toISOString()}` : "Due date cleared"]);
      }
    }
    if (!updates.length) return void res.status(400).json({ error: "Nothing to update." });
    inTransaction(db, () => {
      updates.push("updated_at = ?"); values.push(now()); values.push(caseId);
      db.prepare(`UPDATE operation_cases SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      for (const [action, detail] of events) addOperationEvent(caseId, req, action, detail);
    });
    audit(req, "operations.case.update", "System", `case:${caseId}`, `Updated ${String(current.title)}: ${changes.join("; ")}.`);
    res.json({ case: loadOperationCases().find(item => item.id === caseId) });
  }));

  app.post("/api/admin/operations/cases/:id/notes", requireAuth, requirePerm("dashboard.view"), wrap((req, res) => {
    const caseId = String(req.params.id);
    const body = String(req.body?.body ?? "").trim();
    if (body.length < 2 || body.length > 2_000) return void res.status(400).json({ error: "Case notes must be between 2 and 2,000 characters." });
    const exists = db.prepare("SELECT title FROM operation_cases WHERE id = ?").get(caseId) as { title: string } | undefined;
    if (!exists) return void res.status(404).json({ error: "Case not found." });
    inTransaction(db, () => {
      db.prepare("INSERT INTO operation_case_notes (case_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(caseId, req.user!.id, req.user!.name, body, now());
      db.prepare("UPDATE operation_cases SET updated_at = ? WHERE id = ?").run(now(), caseId);
      addOperationEvent(caseId, req, "case.note", "Internal note added");
    });
    audit(req, "operations.case.note", "System", `case:${caseId}`, `Added an internal note to ${exists.title}.`);
    res.status(201).json({ case: loadOperationCases().find(item => item.id === caseId) });
  }));

  /**
   * Where a physical card goes when the member doesn't say: the mailing address
   * from their application (the business address for business accounts) —
   * never a placeholder.
   */
  function memberMailingAddress(userId: string): string {
    const row = db.prepare(`SELECT p.*, u.account_type FROM identity_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`).get(userId) as Record<string, unknown> | undefined;
    if (!row) return "Address on file";
    const biz = row.account_type === "business" && row.biz_address_line1;
    const pick = (personal: string, business: string) => String((biz ? row[business] : row[personal]) ?? "").trim();
    const parts = [pick("address_line1", "biz_address_line1"), pick("address_line2", "biz_address_line2"),
      [pick("city", "biz_city"), [pick("state", "biz_state"), pick("postal_code", "biz_postal_code")].filter(Boolean).join(" ")].filter(Boolean).join(", ")];
    return parts.filter(Boolean).join(" · ") || "Address on file";
  }
  function previousShippingAddress(card: Record<string, unknown>): string {
    try {
      const shipping = JSON.parse(String(card.shipping_json ?? "{}")) as { address?: unknown };
      return typeof shipping.address === "string" ? shipping.address : "";
    } catch { return ""; }
  }

  /* ============================== customer support ============================== */

  // A support ticket is an operations case (kind 'support') plus a
  // customer-visible thread in support_messages. Members open and reply from
  // the in-app Support Desk; visitors use the public Support / Contact forms;
  // staff reply from the Operations queue. Each side is notified (in-app and by
  // email when a provider is configured).
  const SUPPORT_CATEGORIES = ["Cards & ATMs", "Transfers & Zelle", "Dispute / Fraud", "Account KYC", "Rewards", "Account", "Payments", "Sales", "Something else"] as const;
  function supportReference(caseId: string) {
    return `VS-${caseId.replace(/^ops_/, "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  }
  function supportMessages(caseId: string) {
    return (db.prepare(
      "SELECT id, author_kind, author_name, body, created_at FROM support_messages WHERE case_id = ? ORDER BY created_at, id",
    ).all(caseId) as Array<Record<string, unknown>>).map(m => ({
      id: Number(m.id), author: m.author_kind as "customer" | "staff", authorName: String(m.author_name),
      body: String(m.body), createdAt: Number(m.created_at),
    }));
  }
  /** Member-facing shape: no internal notes, no staff identities beyond a first name. */
  function memberTicket(row: Record<string, unknown>) {
    const id = String(row.id);
    const status = String(row.status);
    return {
      id, reference: supportReference(id), subject: String(row.title), category: String(row.category ?? "Something else"),
      status: status === "resolved" ? "resolved" : status === "waiting" ? "awaiting_you" : status === "investigating" ? "in_progress" : "open",
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      messages: supportMessages(id).map(m => ({ ...m, authorName: m.author === "staff" ? `${m.authorName.split(/\s+/)[0]} · Veyra support` : m.authorName })),
    };
  }
  function supportText(value: unknown, min: number, max: number, label: string): string {
    const text = String(value ?? "").trim();
    if (text.length < min || text.length > max) throw new BadInputError(`${label} must be between ${min} and ${max} characters.`);
    return text;
  }
  /** Public tickets need a creator; they are attributed to the bootstrap Super Admin as the system actor. */
  function systemActorId(): string | undefined {
    const row = db.prepare("SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    return row?.id;
  }
  function alertSupportInbox(caseId: string, subject: string, from: string, body: string) {
    const inbox = String(process.env.SUPPORT_INBOX ?? "").trim();
    if (inbox) void sendMail(supportInboxMail(inbox, supportReference(caseId), subject, from, body));
  }

  app.get("/api/me/support", requireAuth, wrap((req, res) => {
    const rows = db.prepare(
      "SELECT * FROM operation_cases WHERE kind = 'support' AND user_id = ? ORDER BY updated_at DESC LIMIT 100",
    ).all(req.user!.id) as Array<Record<string, unknown>>;
    res.json({ tickets: rows.map(memberTicket) });
  }));

  app.post("/api/me/support", requireAuth, wrap((req, res) => {
    if (!rateLimit(`support:${req.user!.id}`, 10, 60 * 60_000)) {
      return void res.status(429).json({ error: "You've opened a lot of tickets recently — reply on an existing one, or try again in an hour." });
    }
    const subject = supportText(req.body?.subject, 3, 120, "Subject");
    const message = supportText(req.body?.message, 2, 4_000, "Message");
    const category = (SUPPORT_CATEGORIES as readonly string[]).includes(String(req.body?.category)) ? String(req.body.category) : "Something else";
    const id = `ops_${randomUUID()}`;
    const stamp = now();
    inTransaction(db, () => {
      db.prepare(`INSERT INTO operation_cases
        (id, title, kind, priority, status, summary, user_id, category, created_by, created_at, updated_at)
        VALUES (?, ?, 'support', ?, 'open', ?, ?, ?, ?, ?, ?)`)
        .run(id, subject, category === "Dispute / Fraud" ? "high" : "normal", message.slice(0, 2_000), req.user!.id, category, req.user!.id, stamp, stamp);
      db.prepare("INSERT INTO support_messages (case_id, author_kind, author_id, author_name, body, created_at) VALUES (?, 'customer', ?, ?, ?, ?)")
        .run(id, req.user!.id, req.user!.name, message, stamp);
      addOperationEvent(id, req, "case.created", `Support ticket opened by the member (${category})`);
    });
    void sendMail(supportReceivedMail(req.user!.email, req.user!.name, supportReference(id), subject, true));
    alertSupportInbox(id, subject, `${req.user!.name} <${req.user!.email}>`, message);
    const row = db.prepare("SELECT * FROM operation_cases WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json({ ticket: memberTicket(row) });
  }));

  app.post("/api/me/support/:id/messages", requireAuth, wrap((req, res) => {
    const caseId = String(req.params.id);
    const row = db.prepare("SELECT * FROM operation_cases WHERE id = ? AND kind = 'support' AND user_id = ?").get(caseId, req.user!.id) as Record<string, unknown> | undefined;
    if (!row) return void res.status(404).json({ error: "Ticket not found." });
    if (!rateLimit(`support-reply:${req.user!.id}`, 60, 60 * 60_000)) return void res.status(429).json({ error: "Too many messages — try again shortly." });
    const message = supportText(req.body?.message, 1, 4_000, "Message");
    inTransaction(db, () => {
      db.prepare("INSERT INTO support_messages (case_id, author_kind, author_id, author_name, body, created_at) VALUES (?, 'customer', ?, ?, ?, ?)")
        .run(caseId, req.user!.id, req.user!.name, message, now());
      // A customer reply puts the ball back in support's court (and reopens a resolved ticket).
      const reopen = row.status === "waiting" || row.status === "resolved";
      db.prepare(`UPDATE operation_cases SET updated_at = ?${reopen ? ", status = 'open', closed_at = NULL" : ""} WHERE id = ?`).run(now(), caseId);
      addOperationEvent(caseId, req, "support.customer_reply", reopen ? "Customer replied — reopened" : "Customer replied");
    });
    const updated = db.prepare("SELECT * FROM operation_cases WHERE id = ?").get(caseId) as Record<string, unknown>;
    res.status(201).json({ ticket: memberTicket(updated) });
  }));

  // Public Support / Contact forms. No session, so: per-IP rate limit, a
  // honeypot field bots fill in, and strict length limits.
  app.post("/api/support/contact", wrap((req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimit(`contact:${ip}`, 5, 60 * 60_000)) return void res.status(429).json({ error: "Too many messages from this connection — try again later." });
    const body = req.body ?? {};
    // Honeypot: pretend success so bots learn nothing.
    if (typeof body.website === "string" && body.website.trim()) return void res.status(202).json({ ok: true });
    const name = supportText(body.name, 2, 80, "Name");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 200) return void res.status(400).json({ error: "Enter a valid email address." });
    const message = supportText(body.message, 5, 4_000, "Message");
    const sales = body.kind === "sales";
    const company = String(body.company ?? "").trim().slice(0, 120);
    const teamSize = String(body.teamSize ?? "").trim().slice(0, 20);
    const topic = String(body.topic ?? "").trim().slice(0, 60);
    const category = sales ? "Sales" : (SUPPORT_CATEGORIES as readonly string[]).includes(topic) ? topic : "Something else";
    const subject = sales ? `Sales enquiry${company ? ` — ${company}` : ""}` : `${category} — website message`;
    const actor = systemActorId();
    if (!actor) return void res.status(503).json({ error: "Support is not available right now — please email us instead." });
    const member = db.prepare("SELECT COALESCE(team_owner_id, id) AS id FROM users WHERE email = ? COLLATE NOCASE AND role = 'user'").get(email) as { id: string } | undefined;
    const thread = sales ? `${message}\n\nCompany: ${company || "—"} · Team size: ${teamSize || "—"}` : message;
    const id = `ops_${randomUUID()}`;
    const stamp = now();
    inTransaction(db, () => {
      db.prepare(`INSERT INTO operation_cases
        (id, title, kind, priority, status, summary, user_id, category, contact_name, contact_email, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'normal', 'open', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, subject, sales ? "other" : "support", thread.slice(0, 2_000), member?.id ?? null, category, name, email, actor, stamp, stamp);
      db.prepare("INSERT INTO support_messages (case_id, author_kind, author_id, author_name, body, created_at) VALUES (?, 'customer', ?, ?, ?, ?)")
        .run(id, member?.id ?? null, name, thread, stamp);
      db.prepare("INSERT INTO operation_case_events (case_id, at, actor_id, actor_name, action, detail) VALUES (?, ?, ?, 'Website form', 'case.created', ?)")
        .run(id, stamp, actor, `${sales ? "Sales enquiry" : "Support request"} from ${name} <${email}>`);
    });
    void sendMail(supportReceivedMail(email, name, supportReference(id), subject, false));
    alertSupportInbox(id, subject, `${name} <${email}>`, thread);
    res.status(201).json({ ok: true, reference: supportReference(id) });
  }));

  app.post("/api/admin/operations/cases/:id/reply", requireAuth, requirePerm("dashboard.view"), wrap((req, res) => {
    const caseId = String(req.params.id);
    const row = db.prepare(`
      SELECT c.*, u.name AS member_name, u.email AS member_email FROM operation_cases c
      LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(caseId) as Record<string, unknown> | undefined;
    if (!row) return void res.status(404).json({ error: "Case not found." });
    const toEmail = String(row.contact_email ?? row.member_email ?? "");
    if (!toEmail) return void res.status(400).json({ error: "This case has no customer to reply to — use an internal note instead." });
    const message = supportText(req.body?.body, 2, 4_000, "Reply");
    const resolve = req.body?.resolve === true;
    inTransaction(db, () => {
      db.prepare("INSERT INTO support_messages (case_id, author_kind, author_id, author_name, body, created_at) VALUES (?, 'staff', ?, ?, ?, ?)")
        .run(caseId, req.user!.id, req.user!.name, message, now());
      db.prepare("UPDATE operation_cases SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?")
        .run(resolve ? "resolved" : "waiting", resolve ? now() : null, now(), caseId);
      addOperationEvent(caseId, req, "support.staff_reply", resolve ? "Replied to the customer and resolved" : "Replied to the customer — waiting on them");
    });
    const reference = supportReference(caseId);
    const isMember = Boolean(row.user_id);
    if (isMember) notify(String(row.user_id), "security", `Support replied · ${reference}`, message.slice(0, 240));
    void sendMail(supportReplyMail(toEmail, String(row.contact_name ?? row.member_name ?? ""), reference, String(row.title), message, isMember));
    audit(req, "operations.case.reply", "System", `case:${caseId}`, `Replied to the customer on ${String(row.title)}.`);
    res.status(201).json({ case: loadOperationCases().find(item => item.id === caseId) });
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
      SELECT u.id, u.name, u.email, u.business, u.account_type, u.status, u.status_reason, u.status_changed_at,
             a.account_number, a.routing_number, a.balance_cents, a.pending_cents, a.rewards_cents,
             (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS card_count,
             (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.frozen = 1) AS frozen_count,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS txn_count,
             (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.status = 'pending') AS pending_txn_count,
             (SELECT MAX(created_at) FROM transactions t WHERE t.user_id = u.id) AS last_activity,
             (SELECT status FROM kyc_records k WHERE k.user_id = u.id) AS kyc_status,
             p.dob, p.ssn, p.city, p.state, p.id_type, p.legal_name, p.owner_name, p.submitted_at
      FROM users u LEFT JOIN accounts a ON a.user_id = u.id
      LEFT JOIN identity_profiles p ON p.user_id = u.id
      WHERE (u.role = 'user' OR u.role IS NULL) AND u.team_owner_id IS NULL
      ORDER BY u.created_at
    `).all() as Array<Record<string, unknown>>).map(a => ({
      userId: String(a.id), name: String(a.name), email: String(a.email), business: String(a.business ?? ""),
      accountType: a.account_type as "personal" | "business",
      hasAccount: a.balance_cents != null,
      accountNumber: (a.account_number as string) ?? null,
      routingNumber: (a.routing_number as string) ?? null,
      balance: Math.round((a.balance_cents as number ?? 0)) / 100,
      pendingBalance: Math.round((a.pending_cents as number ?? 0)) / 100,
      rewards: Math.round((a.rewards_cents as number ?? 0)) / 100,
      cards: a.card_count as number,
      frozenCards: a.frozen_count as number,
      txnCount: a.txn_count as number,
      pendingTxns: a.pending_txn_count as number,
      kycStatus: (a.kyc_status as string) ?? "not_started",
      accountStatus: a.status === "restricted" ? "restricted" : "active",
      // Why the hold is in place, so a second operator can see the reason the
      // first one chose without opening the audit trail.
      statusReason: (a.status_reason as string) || null,
      statusChangedAt: (a.status_changed_at as number) ?? null,
      lastActivity: (a.last_activity as number) ?? 0,
      // The application, visible to staff in the console: date of birth, tax
      // ID, address and the ID document each member applied with.
      dob: (a.dob as string) ?? null,
      ssn: (a.ssn as string) ?? null,
      city: (a.city as string) ?? null,
      state: (a.state as string) ?? null,
      idType: (a.id_type as string) ?? null,
      legalName: (a.legal_name as string) ?? null,
      ownerName: (a.owner_name as string) ?? null,
      applicationAt: (a.submitted_at as number) ?? null,
    }));

    const transactions = (db.prepare(`
      SELECT t.*, u.name AS member_name FROM transactions t JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 400
    `).all() as Array<Record<string, unknown>>).map(t => ({
      id: String(t.id), merchant: String(t.merchant), category: String(t.category),
      amount: Math.round(t.amount_cents as number) / 100,
      fee: Math.round((t.fee_cents as number ?? 0)) / 100,
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
      WHERE k.review_state IN ('in_review', 'more_info') AND u.role = 'user'
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
          review: {
            state: String(r.review_state ?? "in_review"),
            note: String(r.review_note ?? ""),
            requirements: JSON.parse(String(r.review_reqs_json ?? "[]")),
            reviewedBy: r.reviewed_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(String(r.reviewed_by)) as { name: string } | undefined)?.name : undefined,
            reviewedAt: (r.reviewed_at as number) ?? null,
            submittedAt: (db.prepare("SELECT submitted_at FROM identity_profiles WHERE user_id = ?").get(String(r.id)) as { submitted_at: number } | undefined)?.submitted_at ?? null,
          },
        },
        reviewState: String(r.review_state ?? "in_review"),
        reviewNote: String(r.review_note ?? ""),
        reviewRequirements: JSON.parse(String(r.review_reqs_json ?? "[]")),
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
    const operationCases = loadOperationCases();

    res.json({ users, accounts, transactions, analytics: readLedgerAnalytics(db, undefined), disputes, kycQueue, operationCases, audit: auditEntries, roles, settings });
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
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
      // Root the SPA file explicitly: a hidden ancestor of cwd must not hide index.html.
      res.sendFile("index.html", { root: resolve("dist") });
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

function txnOut(t: any) {
  return {
    id: t.id, merchant: t.merchant, category: t.category, method: t.method,
    amount: money(t.amount_cents), fee: money(t.fee_cents ?? 0), status: t.status, reference: t.reference,
    note: t.note, date: t.created_at, memberName: t.member_name ?? undefined,
  };
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
