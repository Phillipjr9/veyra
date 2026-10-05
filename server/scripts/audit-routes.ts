/**
 * Route security audit.
 *
 * Every route declared in server/src/app.ts is probed over HTTP with six
 * identities — no token, a member, and each staff role — and the response is
 * checked against the gates the route declares in its own source line:
 *
 *   - a route with requireAuth must answer 401 without a token
 *   - a route with requirePerm(P) must answer 403 for every role whose live
 *     grant list (GET /api/admin/roles) does not include P
 *   - a route with requirePerm(P) must NOT answer 403 for a role that has P
 *   - a route with requireAuth and no requirePerm must not answer 403 for a
 *     member (it is member surface)
 *
 * That catches the failure modes unit tests usually miss: a route missing its
 * requireAuth, a permission typo, a gate applied to the wrong role, or member
 * surface accidentally locked to staff.
 *
 * Resource-scoped routes are probed with a real id owned by another member
 * where one exists (isolation pass), otherwise with a synthetic id — the audit
 * asserts on the *gate* status (401/403), not on 404/happy-path behaviour.
 *
 * Run: npm run audit:routes
 */
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { resetRateLimits } from "../src/security.js";

process.env.ADMIN_EMAIL = "audit-admin@veyra.test";
process.env.ADMIN_PASSWORD = "audit-admin-pass";
process.env.ADMIN_NAME = "Audit Admin";

/* ---------- parse the declared policy out of the route declarations ---------- */

const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
const ROUTE_RE = /app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
const rawRoutes = [...source.matchAll(ROUTE_RE)];

/**
 * The independent security contract, written by hand from the product's rules
 * rather than derived from the code under audit. Deriving expectations from the
 * same source would hide the worst failure mode — a gate that was deleted,
 * since both the route and its expectation would change together.
 *
 * Every route must match exactly one entry; an unmatched route fails the audit
 * so new surface has to be classified deliberately.
 */
type Policy = { method: string; path: string; auth: boolean; /** One permission, or any of several. */ perm: string | string[] | null };
const BASELINE: Policy[] = [
  // Public surface: reachable without a session.
  { method: "GET", path: "/api/health", auth: false, perm: null },
  // Advertises the demo credentials the login page offers with one click. Public
  // by design (a signed-out visitor is who it's for) and empty in production —
  // see demoLoginsEnabled() in server/src/demo.ts.
  { method: "GET", path: "/api/demo/accounts", auth: false, perm: null },
  // Tells a signed-out browser whether reCAPTCHA is enforced and which public
  // site key to mint tokens with. Public by necessity — it is read before
  // anyone can sign in — and carries no secret: the site key is designed to
  // ship inside the page, while the secret/API key never leaves the server.
  { method: "GET", path: "/api/auth/config", auth: false, perm: null },
  { method: "POST", path: "/api/auth/login", auth: false, perm: null },
  // Exchanges a verified Firebase ID token for a Veyra session. Public because
  // it IS a sign-in route; the token is the credential. It can only attach to
  // an account that already exists (never auto-provisions) and refuses staff
  // accounts unless FEDERATED_ALLOW_STAFF=1 — see server/src/federated.ts.
  { method: "POST", path: "/api/auth/federated", auth: false, perm: null },
  // Passkey sign-in. Public of necessity — both halves run before a session
  // exists. The challenge route hands out nothing but random bytes, and the
  // login route is gated by a signature over a server-issued, single-use
  // challenge, which is a far stronger check than any permission.
  // Deliberately no allowCredentials and no email parameter, so neither route
  // can answer "does this account exist?" — see server/src/webauthn.ts.
  { method: "POST", path: "/api/auth/passkey/challenge", auth: false, perm: null },
  { method: "POST", path: "/api/auth/passkey/login", auth: false, perm: null },
  { method: "POST", path: "/api/auth/register", auth: false, perm: null },
  { method: "POST", path: "/api/auth/forgot-password", auth: false, perm: null },
  { method: "POST", path: "/api/auth/reset-password", auth: false, perm: null },

  // Session + member surface: any authenticated caller, no admin permission.
  { method: "POST", path: "/api/auth/logout", auth: true, perm: null },
  { method: "GET", path: "/api/auth/me", auth: true, perm: null },
  { method: "POST", path: "/api/auth/change-password", auth: true, perm: null },
  { method: "GET", path: "/api/me/account", auth: true, perm: null },
  { method: "GET", path: "/api/me/transactions", auth: true, perm: null },
  { method: "POST", path: "/api/me/deposits", auth: true, perm: null },
  { method: "POST", path: "/api/me/transfers", auth: true, perm: null },
  { method: "GET", path: "/api/me/notifications", auth: true, perm: null },
  // Managing your own passkeys. Authenticated and scoped to the caller: a
  // passkey is added to an account that already exists, never used to open
  // one, and DELETE matches on (id, user_id) so another member's credential
  // reads as 404 rather than as someone else's row.
  { method: "POST", path: "/api/me/passkeys/challenge", auth: true, perm: null },
  { method: "POST", path: "/api/me/passkeys", auth: true, perm: null },
  { method: "GET", path: "/api/me/passkeys", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/passkeys/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/notifications/read-all", auth: true, perm: null },
  { method: "POST", path: "/api/me/notifications/:id/read", auth: true, perm: null },
  { method: "GET", path: "/api/me/kyc", auth: true, perm: null },
  { method: "GET", path: "/api/me/profile", auth: true, perm: null },
  { method: "PATCH", path: "/api/me/kyc", auth: true, perm: null },
  { method: "POST", path: "/api/me/kyc/submit", auth: true, perm: null },
  { method: "POST", path: "/api/me/disputes", auth: true, perm: null },
  { method: "GET", path: "/api/me/state", auth: true, perm: null },
  { method: "PATCH", path: "/api/me/profile", auth: true, perm: null },
  { method: "PUT", path: "/api/me/preferences", auth: true, perm: null },
  { method: "POST", path: "/api/me/cards", auth: true, perm: null },
  { method: "PATCH", path: "/api/me/cards/:id", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/cards/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/cards/freeze-all", auth: true, perm: null },
  { method: "POST", path: "/api/me/cards/:id/replace", auth: true, perm: null },
  { method: "POST", path: "/api/me/cards/:id/shipping/advance", auth: true, perm: null },
  { method: "POST", path: "/api/me/invoices", auth: true, perm: null },
  { method: "POST", path: "/api/me/invoices/:id/paid", auth: true, perm: null },
  { method: "POST", path: "/api/me/invoices/:id/remind", auth: true, perm: null },
  { method: "POST", path: "/api/me/team", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/team/:id", auth: true, perm: null },
  { method: "GET", path: "/api/me/holdings", auth: true, perm: null },
  { method: "POST", path: "/api/me/holdings/trade", auth: true, perm: null },
  { method: "GET", path: "/api/me/holdings/:asset/candles", auth: true, perm: null },
  { method: "GET", path: "/api/me/markets", auth: true, perm: null },
  { method: "POST", path: "/api/me/pockets", auth: true, perm: null },
  { method: "POST", path: "/api/me/budgets", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/budgets/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/pockets/:id/move", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/pockets/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/payees", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/payees/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/scheduled", auth: true, perm: null },
  { method: "PATCH", path: "/api/me/scheduled/:id", auth: true, perm: null },
  { method: "DELETE", path: "/api/me/scheduled/:id", auth: true, perm: null },
  { method: "POST", path: "/api/me/scheduled/:id/pay", auth: true, perm: null },
  { method: "POST", path: "/api/me/rewards/redeem", auth: true, perm: null },
  { method: "POST", path: "/api/me/scout/apply", auth: true, perm: null },
  { method: "POST", path: "/api/me/perks/:id/redeem", auth: true, perm: null },
  { method: "POST", path: "/api/me/sessions/:id/revoke", auth: true, perm: null },
  { method: "PATCH", path: "/api/me/sessions/:id", auth: true, perm: null },

  // Admin console: each operation requires its own explicit permission.
  { method: "GET", path: "/api/admin/overview", auth: true, perm: "dashboard.view" },
  { method: "GET", path: "/api/admin/state", auth: true, perm: "dashboard.view" },
  { method: "GET", path: "/api/admin/members", auth: true, perm: "customers.view" },
  { method: "GET", path: "/api/admin/members/:id", auth: true, perm: "customers.view" },
  { method: "POST", path: "/api/admin/members/:id/adjust", auth: true, perm: "customers.adjust_balance" },
  { method: "POST", path: "/api/admin/members/:id/status", auth: true, perm: "accounts.set_status" },
  { method: "PATCH", path: "/api/admin/members/:id/account-number", auth: true, perm: "accounts.edit_number" },
  { method: "POST", path: "/api/admin/kyc/request", auth: true, perm: "kyc.request" },
  { method: "GET", path: "/api/admin/kyc/queue", auth: true, perm: "kyc.review" },
  { method: "POST", path: "/api/admin/kyc/:userId/decision", auth: true, perm: "kyc.review" },
  // Operations casework rides on the console's own dashboard.view grant: the case
  // list is part of the command overview, not a separate permission.
  { method: "GET", path: "/api/admin/operations/cases", auth: true, perm: "dashboard.view" },
  { method: "POST", path: "/api/admin/operations/cases", auth: true, perm: "dashboard.view" },
  { method: "PUT", path: "/api/admin/operations/cases/:id", auth: true, perm: "dashboard.view" },
  { method: "POST", path: "/api/admin/operations/cases/:id/notes", auth: true, perm: "dashboard.view" },
  { method: "GET", path: "/api/admin/risk/disputes", auth: true, perm: "risk.view" },
  { method: "POST", path: "/api/admin/risk/disputes/:id/advance", auth: true, perm: "risk.resolve" },
  { method: "GET", path: "/api/admin/staff", auth: true, perm: "staff.manage" },
  { method: "POST", path: "/api/admin/staff/:id/role", auth: true, perm: "staff.manage" },
  { method: "GET", path: "/api/admin/roles", auth: true, perm: "roles.manage" },
  { method: "PUT", path: "/api/admin/roles", auth: true, perm: "roles.manage" },
  { method: "POST", path: "/api/admin/roles/reset", auth: true, perm: "roles.manage" },
  { method: "GET", path: "/api/admin/audit", auth: true, perm: "audit.view" },
  { method: "GET", path: "/api/admin/audit/export.csv", auth: true, perm: "audit.view" },
  { method: "POST", path: "/api/admin/broadcasts", auth: true, perm: "notifications.broadcast" },
  // The ledger file opens with either permission; every other report kind
  // additionally requires reports.view inside the handler.
  { method: "GET", path: "/api/admin/reports/:kind.csv", auth: true, perm: ["reports.view", "transactions.export"] },
  { method: "GET", path: "/api/admin/settings", auth: true, perm: "settings.manage" },
  { method: "PUT", path: "/api/admin/settings", auth: true, perm: "settings.manage" },
];

const samePath = (a: string, b: string) => a === b || (a.includes(":") && new RegExp(`^${a.replace(/:[A-Za-z_]\w*/g, "[^/]+")}$`).test(b));
const baselineFor = (method: string, path: string) =>
  BASELINE.find(p => p.method === method && samePath(p.path, path) && String(p.path).includes(":") === path.includes(":") );

type Declared = { method: string; path: string; auth: boolean; perm: string | null; public: boolean; expects: string[]; contractProblems: string[] };
const declared: Declared[] = rawRoutes.map((match, index) => {
  const method = match[1];
  const path = match[2];
  // Only the route's own declaration matters — scan from the declaration to the
  // handler body, not into the next route's gates.
  const end = index + 1 < rawRoutes.length ? rawRoutes[index + 1].index! : source.length;
  const segment = source.slice(match.index, end);
  const bodyStart = segment.search(/\bwrap\(|\(\s*_?req\b/);
  const header = bodyStart === -1 ? segment.slice(0, 400) : segment.slice(0, bodyStart);
  const anyPerm = /requireAnyPerm\(([^)]*)\)/.exec(header);
  const declaredPerms = anyPerm
    ? [...anyPerm[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
    : (() => {
        const one = /requirePerm\("([^"]+)"\)/.exec(header);
        return one ? [one[1]] : [];
      })();
  const declaredAuth = /requireAuth/.test(header);

  // Compare the implementation against the independent contract. A mismatch is
  // the finding itself: a dropped gate, a typo'd permission, or an extra one.
  const policy = baselineFor(method.toUpperCase(), path);
  const contractProblems: string[] = [];
  if (!policy) {
    contractProblems.push("no entry in the security baseline — classify this route deliberately");
  } else {
    if (policy.auth !== declaredAuth) {
      contractProblems.push(policy.auth ? "baseline requires auth but the route declares none" : "baseline is public but the route declares requireAuth");
    }
    const wanted = (Array.isArray(policy.perm) ? policy.perm : [policy.perm]).filter(Boolean).sort().join(" | ");
    const declaredList = [...declaredPerms].sort().join(" | ");
    if (wanted !== declaredList) {
      contractProblems.push(`baseline requires ${wanted || "no permission"} but the route declares ${declaredList || "none"}`);
    }
  }
  return {
    method: method.toUpperCase(),
    path,
    auth: declaredAuth,
    perm: declaredPerms.join(" | ") || null,
    // Expectations follow the contract, not the implementation.
    public: policy ? !policy.auth : !declaredAuth,
    expects: policy ? (Array.isArray(policy.perm) ? policy.perm : [policy.perm]).filter((p): p is string => Boolean(p)) : [],
    contractProblems,
  };
});

/* ---------- boot ---------- */

const tmp = mkdtempSync(join(tmpdir(), "veyra-audit-"));
const { app, db } = createApp(join(tmp, "audit.db"));
const httpServer = await new Promise<import("node:http").Server>(resolve => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`;

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  // GET/HEAD must not carry a body (undici throws); the audit only needs the gate.
  const sendBody = body !== undefined && method !== "GET" && method !== "HEAD";
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: sendBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, json, text };
};

const register = async (name: string, email: string) =>
  (await call("POST", "/api/auth/register", undefined, {
    name, email, password: "audit-pass-1", accountType: "business", business: "Audit Co",
    profile: applicationFor("business", name, "Audit Co"),
  })).json;

/**
 * Registration parks every new account in the review queue, and money routes
 * refuse to move until a human clears it — so the audit approves its own
 * fixtures the same way staff do, through the decision endpoint.
 */
const approve = async (userId: string) =>
  call("POST", `/api/admin/kyc/${userId}/decision`, superadmin, { decision: "approved", note: "" });

// Identities
const adminLogin = await call("POST", "/api/auth/login", undefined, { email: "audit-admin@veyra.test", password: "audit-admin-pass" });
const superadmin = adminLogin.json.token;

const owner = await register("Route Owner", "owner@audit.test");
const otherUser = await register("Route Other", "other@audit.test");
const supportUser = await register("Sup Porter", "support@audit.test");
const complianceUser = await register("Com Plian", "compliance@audit.test");
const adminUser = await register("Ad Min", "admin@audit.test");

// Staff accounts act through the console, so only the two members need clearing.
for (const u of [owner, otherUser]) await approve(u.user.id);

await call("POST", `/api/admin/staff/${supportUser.user.id}/role`, superadmin, { role: "support" });
await call("POST", `/api/admin/staff/${complianceUser.user.id}/role`, superadmin, { role: "compliance" });
await call("POST", `/api/admin/staff/${adminUser.user.id}/role`, superadmin, { role: "admin" });

const login = async (email: string) => (await call("POST", "/api/auth/login", undefined, { email, password: "audit-pass-1" })).json.token;
const ownerToken = await login("owner@audit.test");
const otherToken = await login("other@audit.test");
const support = await login("support@audit.test");
const compliance = await login("compliance@audit.test");
const admin = await login("admin@audit.test");
resetRateLimits();

const identities: Array<[string, string | undefined]> = [
  ["anonymous", undefined],
  ["member", ownerToken],
  ["support", support],
  ["compliance", compliance],
  ["admin", admin],
  ["superadmin", superadmin],
];

/** Live grants per role, straight from the server (never a hardcoded copy). */
const rolesResponse = await call("GET", "/api/admin/roles", superadmin);
const grants: Record<string, string[]> = Object.fromEntries(rolesResponse.json.roles.map((r: any) => [r.role, r.permissions]));

/* ---------- resources owned by `owner`, for isolation probing ---------- */

await call("POST", "/api/me/deposits", ownerToken, { amount: 5000, source: "Audit funding" });
const ownerCard = (await call("POST", "/api/me/cards", ownerToken, { label: "Audit card", limit: 1000, type: "virtual", cardholder: "Route Owner" })).json.card;
const ownerInvoice = (await call("POST", "/api/me/invoices", ownerToken, { client: "Audit Client", clientEmail: "c@audit.test", amount: 10, dueDays: 1 })).json.invoice;
const ownerPocket = (await call("POST", "/api/me/pockets", ownerToken, { name: "Audit pocket", target: 100, color: "#7558dc", icon: "general" })).json.pocket;
const ownerPayee = (await call("POST", "/api/me/payees", ownerToken, { name: "Audit Payee", bankName: "Audit Bank", routingNumber: "021000021", accountLast4: "1234", accountType: "Checking" })).json.payee;
const ownerScheduled = (await call("POST", "/api/me/scheduled", ownerToken, { payeeName: "Audit Payee", amount: 5, category: "Operations", frequency: "monthly", nextDate: Date.now() + 86_400_000 })).json.payment;
const ownerTransfer = (await call("POST", "/api/me/transfers", ownerToken, { counterparty: "Audit Vendor", amount: 20, category: "Operations", method: "ACH" })).json;
const ownerDispute = (await call("POST", "/api/me/disputes", ownerToken, { transactionId: ownerTransfer.transaction.id, reason: "audit", detail: "audit" })).json.dispute;
const ownerKycId = owner.user.id;

/** Maps a path parameter to a resource owned by ANOTHER member, so isolation can be probed. */
const foreignIdFor = (path: string): string => {
  if (path.includes("/cards/")) return ownerCard.id;
  if (path.includes("/invoices/")) return ownerInvoice.id;
  if (path.includes("/pockets/")) return ownerPocket.id;
  if (path.includes("/payees/")) return ownerPayee.id;
  if (path.includes("/scheduled/")) return ownerScheduled.id;
  if (path.includes("/disputes/")) return ownerDispute.id;
  if (path.includes("/sessions/")) return (db.prepare("SELECT id FROM security_sessions WHERE user_id = ? LIMIT 1").get(owner.user.id) as { id: string } | undefined)?.id ?? "none";
  if (path.includes("/notifications/")) return (db.prepare("SELECT id FROM notifications WHERE user_id = ? LIMIT 1").get(owner.user.id) as { id: string } | undefined)?.id ?? "none";
  if (path.includes("/perks/")) return (db.prepare("SELECT id FROM perks WHERE user_id = ? LIMIT 1").get(owner.user.id) as { id: string } | undefined)?.id ?? "none";
  if (path.includes("/team/")) return (db.prepare("SELECT id FROM team_members WHERE user_id = ? LIMIT 1").get(owner.user.id) as { id: string } | undefined)?.id ?? "none";
  if (path.includes("/risk/disputes/")) return String((db.prepare("SELECT id FROM disputes LIMIT 1").get() as { id: string } | undefined)?.id ?? "none");
  if (path.includes("/admin/members/") || path.includes("/admin/kyc/") || path.includes("/admin/staff/")) return ownerKycId;
  return "synthetic-id";
};

const fillPath = (path: string) => path.replace(/:kind/g, "transactions").replace(/:[A-Za-z_]\w*/g, () => foreignIdFor(path));

/** Bodies differ per route; only the gate matters here. */
const bodyFor = (route: Declared): unknown => {
  if (route.path.endsWith("/paid") || route.path.endsWith("/remind") || route.path.endsWith("/pay")) return undefined;
  if (route.path.endsWith("/kyc/submit")) return { legalName: "Audit", documents: [{ key: "id", label: "ID", name: "id.png" }] };
  if (route.path.endsWith("/preferences")) return { key: "twoFactor", value: true };
  if (route.path.endsWith("/roles")) return { role: "support", permissions: [] };
  if (route.path.endsWith("/roles/reset")) return { role: "support" };
  if (route.path.endsWith("/decision")) return { decision: "approved" };
  if (route.path.endsWith("/advance")) return undefined;
  if (route.path.endsWith("/broadcasts")) return { title: "Audit", detail: "Audit", audience: "all" };
  if (route.path.endsWith("/settings")) return { coreApy: 4.5 };
  if (route.path.endsWith("/adjust")) return { direction: "credit", amount: 1, memo: "audit" };
  if (route.path.endsWith("/status")) return { status: "restricted", reason: "audit" };
  if (route.path.endsWith("/role")) return { role: "member-not-a-role" };
  if (route.path.endsWith("/kyc/request")) return { userId: ownerKycId, requirements: ["identity"], reason: "audit" };
  if (route.path.endsWith("/pockets") || route.path.includes("/pockets/")) return { name: "audit", target: 1, amount: 1, direction: "to_pocket" };
  if (route.path.endsWith("/payees")) return { name: "Audit", bankName: "Audit Bank", routingNumber: "021000021", accountLast4: "1234" };
  if (route.path.endsWith("/scheduled")) return { payeeName: "Audit", amount: 1, nextDate: Date.now() + 86_400_000 };
  if (route.path.endsWith("/cards")) return { label: "audit", limit: 1, type: "virtual" };
  if (route.path.endsWith("/profile")) return { name: "Audit Probe" };
  if (route.path.endsWith("/kyc")) return { nextStep: "details", completeness: 10 };
  if (route.path.endsWith("/invoices")) return { client: "Audit", clientEmail: "a@b.co", amount: 1, dueDays: 1 };
  if (route.path.endsWith("/team")) return { name: "Audit", email: "audit@team.test", role: "Member", monthlyLimit: 0 };
  if (route.path.endsWith("/disputes")) return { reason: "audit", amount: 1, merchant: "Audit" };
  if (route.path.endsWith("/transfers")) return { counterparty: "Audit", amount: 1, category: "Operations", method: "ACH" };
  if (route.path.endsWith("/deposits")) return { amount: 1, source: "Audit" };
  if (route.path.endsWith("/scout/apply")) return { opportunityId: "audit-opp", merchant: "Audit", amount: 1, note: "audit" };
  if (route.path.endsWith("/sessions/:id")) return { trusted: true };
  if (route.path.endsWith("/login")) return { email: "nobody@audit.test", password: "wrong-password" };
  if (route.path.endsWith("/register")) return {};
  if (route.path.endsWith("/forgot-password")) return { email: "owner@audit.test" };
  if (route.path.endsWith("/reset-password")) return { token: "not-a-real-token", password: "audit-pass-2" };
  if (route.path.endsWith("/change-password")) return { current: "wrong", next: "audit-pass-3" };
  return {};
};

/* ---------- the audit ---------- */

type Problem = { route: string; role: string; status: number; note: string };
const problems: Problem[] = [];
const matrix: Record<string, Record<string, number>> = {};

for (const route of declared) {
  const path = fillPath(route.path);
  const key = `${route.method} ${route.path}`;
  for (const note of route.contractProblems) {
    problems.push({ route: key, role: "contract", status: 0, note });
  }
  matrix[key] = {};
  for (const [label, token] of identities) {
    // Probing logout would revoke the very token the rest of the audit uses;
    // it gets its own dedicated pass at the end.
    if (route.path === "/api/auth/logout" && label !== "anonymous") { matrix[key][label] = -1; continue; }
    const res = await call(route.method, path, token, bodyFor(route));
    matrix[key][label] = res.status;

    if (route.public) {
      // Public surface must stay reachable without a token (health, register,
      // password recovery) and must not be gated by accident. Login is the one
      // endpoint that answers 401 by design: the probe sends bad credentials.
      const rejectsCredentials = key === "POST /api/auth/login";
      if (label === "anonymous" && res.status === 401 && !rejectsCredentials) {
        problems.push({ route: key, role: label, status: res.status, note: "public route required authentication" });
      }
      continue;
    }

    if (label === "anonymous") {
      if (res.status !== 401) problems.push({ route: key, role: label, status: res.status, note: "no token did not get 401" });
      continue;
    }
    if (label === "superadmin") {
      if (res.status === 401 || res.status === 403) problems.push({ route: key, role: label, status: res.status, note: "superadmin blocked" });
      continue;
    }
    const required = route.expects;
    const roleKey = label === "member" ? null : label;
    const hasGrant = roleKey ? required.some(p => grants[roleKey]?.includes(p)) : false;
    const wanted = required.join(" or ");

    if (required.length) {
      if (!hasGrant && res.status !== 403) problems.push({ route: key, role: label, status: res.status, note: `role lacks ${wanted} but got ${res.status}, expected 403` });
      if (hasGrant && res.status === 403) problems.push({ route: key, role: label, status: res.status, note: `role has ${wanted} but got 403` });
    } else if (label === "member" && res.status === 403) {
      problems.push({ route: key, role: label, status: res.status, note: "member surface returned 403 to a member" });
    }
  }
}

/* ---------- public routes ---------- */

for (const path of ["/api/health"]) {
  const res = await call("GET", path);
  if (res.status !== 200) problems.push({ route: `GET ${path}`, role: "anonymous", status: res.status, note: "public route not reachable" });
}

/* ---------- session lifecycle (logout is probed last: it revokes tokens) ---------- */

{
  const anon = await call("POST", "/api/auth/logout");
  if (anon.status !== 401) problems.push({ route: "POST /api/auth/logout", role: "anonymous", status: anon.status, note: "logout without a token did not get 401" });

  const disposable = await register("Logout Probe", "logout-probe@audit.test");
await approve(disposable.user.id);
  const out = await call("POST", "/api/auth/logout", disposable.token);
  const after = await call("GET", "/api/auth/me", disposable.token);
  matrix["POST /api/auth/logout"] = { anonymous: 401, member: out.status, support: -1, compliance: -1, admin: -1, superadmin: -1 };
  if (out.status !== 200 || after.status !== 401) {
    problems.push({ route: "POST /api/auth/logout", role: "member", status: out.status, note: `revoked session still authenticates (${after.status})` });
  }
}

/* ---------- cross-member isolation ---------- */

/**
 * Routes taking a resource id: another member's id must never reach the row
 * (404/403), not merely fail later with a 400.
 */
const isolationTargets: Array<[string, string, unknown]> = [
  ["PATCH", `/api/me/cards/${ownerCard.id}`, { frozen: true }],
  ["DELETE", `/api/me/cards/${ownerCard.id}`, undefined],
  ["POST", `/api/me/cards/${ownerCard.id}/replace`, { reason: "x" }],
  ["POST", `/api/me/cards/${ownerCard.id}/shipping/advance`, undefined],
  ["POST", `/api/me/invoices/${ownerInvoice.id}/paid`, undefined],
  ["POST", `/api/me/invoices/${ownerInvoice.id}/remind`, undefined],
  ["POST", `/api/me/pockets/${ownerPocket.id}/move`, { amount: 1, direction: "to_checking" }],
  ["DELETE", `/api/me/pockets/${ownerPocket.id}`, undefined],
  ["DELETE", `/api/me/payees/${ownerPayee.id}`, undefined],
  ["PATCH", `/api/me/scheduled/${ownerScheduled.id}`, { status: "paused" }],
  ["DELETE", `/api/me/scheduled/${ownerScheduled.id}`, undefined],
  ["POST", `/api/me/scheduled/${ownerScheduled.id}/pay`, undefined],
];

/**
 * Self-scoped bulk routes: any authenticated caller may invoke them, but they
 * must only ever touch the caller's own rows — asserted against the owner's
 * snapshot before/after.
 */
const selfScopedTargets: Array<[string, string, unknown]> = [
  ["POST", "/api/me/cards/freeze-all", undefined],
  ["POST", "/api/me/notifications/read-all", undefined],
  ["POST", "/api/me/rewards/redeem", undefined],
];

// Owner's resources must be untouched after the other member's attempts.
const beforeState = (await call("GET", "/api/me/state", ownerToken)).json.account;
for (const [method, path, body] of [...isolationTargets, ...selfScopedTargets]) {
  const res = await call(method, path, otherToken, body);
  const isSelfScoped = selfScopedTargets.some(([, p]) => p === path);
  const ok = isSelfScoped ? res.status < 400 : res.status === 404 || res.status === 403;
  if (!ok) {
    problems.push({
      route: `${method} ${path}`, role: "other member", status: res.status,
      note: isSelfScoped
        ? "self-scoped bulk route rejected its own caller"
        : "cross-member attempt was not refused (expected 404/403)",
    });
  }
}
const afterState = (await call("GET", "/api/me/state", ownerToken)).json.account;
if (beforeState.balance !== afterState.balance ||
    beforeState.cards[0]?.frozen !== afterState.cards[0]?.frozen ||
    beforeState.invoices[0]?.status !== afterState.invoices[0]?.status ||
    beforeState.savingsPockets[0]?.balance !== afterState.savingsPockets[0]?.balance) {
  problems.push({ route: "isolation", role: "other member", status: 200, note: "another member's resources changed" });
}
// A dispute must be filed only against the caller's own transactions.
const foreignDispute = await call("POST", "/api/me/disputes", otherToken, { transactionId: ownerTransfer.transaction.id, reason: "audit", detail: "" });
if (foreignDispute.status === 201) {
  problems.push({ route: "POST /api/me/disputes", role: "other member", status: 201, note: "dispute filed against another member's transaction id" });
}

/* ---------- staff accounts are not member surface ---------- */

const staffTargeting: Array<[string, string, unknown]> = [
  ["POST", `/api/admin/members/${supportUser.user.id}/adjust`, { direction: "credit", amount: 50, memo: "audit" }],
  ["POST", `/api/admin/members/${supportUser.user.id}/status`, { status: "restricted", reason: "audit" }],
  ["POST", `/api/admin/members/${superadmin === undefined ? "x" : adminLogin.json.user.id}/status`, { status: "restricted", reason: "audit" }],
];
for (const [method, path, body] of staffTargeting) {
  const res = await call(method, path, admin, body);
  if (res.status < 400) {
    problems.push({ route: `${method} ${path}`, role: "admin", status: res.status, note: "admin acted on a staff account through member-management routes" });
  }
}

/* ---------- registration validation ---------- */

const emptyBusiness = await call("POST", "/api/auth/register", undefined, { name: "Empty Biz", email: "empty-biz@audit.test", password: "audit-pass-1", accountType: "business", business: "" });
if (emptyBusiness.status === 201) problems.push({ route: "POST /api/auth/register", role: "anonymous", status: 201, note: "business account accepted an empty business name" });

// An account cannot be opened without a complete application — no profile at
// all, an invalid SSN, an under-age applicant and a bad EIN must all fail.
const noApplication = await call("POST", "/api/auth/register", undefined, { name: "No Profile", email: "no-profile@audit.test", password: "audit-pass-1", accountType: "personal" });
if (noApplication.status !== 422) problems.push({ route: "POST /api/auth/register", role: "anonymous", status: noApplication.status, note: "account opened without an application (expected 422)" });
const badSsn = await call("POST", "/api/auth/register", undefined, { name: "Bad Ssn", email: "bad-ssn@audit.test", password: "audit-pass-1", accountType: "personal", profile: { ...applicationFor("personal", "Bad Ssn"), ssn: "000-00-0000" } });
if (badSsn.status !== 422) problems.push({ route: "POST /api/auth/register", role: "anonymous", status: badSsn.status, note: "invalid SSN accepted (expected 422)" });
const underAge = await call("POST", "/api/auth/register", undefined, { name: "Under Age", email: "under-age@audit.test", password: "audit-pass-1", accountType: "personal", profile: { ...applicationFor("personal", "Under Age"), dob: "2015-01-01" } });
if (underAge.status !== 422) problems.push({ route: "POST /api/auth/register", role: "anonymous", status: underAge.status, note: "under-18 applicant accepted (expected 422)" });
const badEin = await call("POST", "/api/auth/register", undefined, { name: "Bad Ein", email: "bad-ein@audit.test", password: "audit-pass-1", accountType: "business", business: "Bad Ein Co", profile: { ...applicationFor("business", "Bad Ein", "Bad Ein Co"), ein: "00-0000000" } });
if (badEin.status !== 422) problems.push({ route: "POST /api/auth/register", role: "anonymous", status: badEin.status, note: "invalid EIN accepted (expected 422)" });

/* ---------- report ---------- */

const routeCount = declared.length;
const gateFailures = problems.filter(p => !p.note.startsWith("cross-member") && !p.note.includes("another member") && !p.note.includes("staff account"));
const isolationFailures = problems.filter(p => p.note.startsWith("cross-member") || p.note.includes("another member"));
const scopeFailures = problems.filter(p => p.note.includes("staff account"));

console.log(`\nAudited ${routeCount} routes × ${identities.length} identities = ${routeCount * identities.length} probes, plus ${isolationTargets.length + selfScopedTargets.length + staffTargeting.length + 3} isolation/validation probes.\n`);

const header = ["route", ...identities.map(([l]) => l)];
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
console.log(header.map((h, i) => pad(h, i === 0 ? 46 : 11)).join(""));
console.log("-".repeat(46 + identities.length * 11));
for (const [route, row] of Object.entries(matrix)) {
  console.log(pad(route, 46) + identities.map(([l]) => pad(String(row[l]), 11)).join(""));
}

const report = (title: string, list: Problem[]) => {
  if (!list.length) return;
  console.log(`\n✗ ${title} (${list.length}):`);
  for (const p of list) console.log(`    ${p.route} [${p.role}] → ${p.status}: ${p.note}`);
};
report("GATE FAILURES", gateFailures);
report("ISOLATION FAILURES", isolationFailures);
report("SCOPE FAILURES", scopeFailures);

const total = problems.length;
console.log(total === 0
  ? `\n✓ all ${routeCount} routes enforce their declared gates, isolate member data, and scope staff routes to members`
  : `\n${total} finding(s) — see above\n`);

httpServer.close();
process.exit(total === 0 ? 0 : 1);
