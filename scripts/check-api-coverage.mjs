/**
 * Route coverage guard.
 *
 * Every route the Express backend exposes should be reachable from the app —
 * a server route with no caller is dead surface, and a client call with no
 * route is a broken promise (the UI would 404 at runtime). This script diffs
 * the two and fails the build on drift.
 *
 * Read-only endpoints whose data already ships inside the aggregate snapshots
 * (`GET /api/me/state`, `GET /api/admin/state`) are intentional exceptions and
 * are listed below with the snapshot that supersedes them.
 *
 * Run: npm run check:routes   (also part of: npm test)
 */
import { readFileSync } from "node:fs";

const SERVER_FILE = "server/src/app.ts";
const CLIENT_FILES = [
  "src/lib/api.ts",
  "src/lib/auth.tsx",
  "src/lib/recaptcha.ts",
  "src/lib/authConfig.ts",
  "src/lib/federated.ts",
  "src/lib/passkey.ts",
  "src/lib/holdings.ts",
  "src/lib/store.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/SuperAdmin.tsx",
  "src/pages/Auth.tsx",
  "src/pages/SupportCenter.tsx",
  "src/pages/Marketing.tsx",
  "src/components/Chrome.tsx",
  "src/components/BankingControls.tsx",
  "src/components/CryptoSend.tsx",
  "src/components/AddressField.tsx",
  "src/components/CommandPalette.tsx",
  "src/components/MoneyFlow.tsx",
  "src/components/SecurityCenterContent.tsx",
  "src/pages/dashboards/parts.tsx",
  "src/pages/dashboards/PersonalDashboard.tsx",
  "src/pages/dashboards/BusinessDashboard.tsx",
  "src/pages/dashboards/AdminShell.tsx",
];

/** Routes whose payload is already delivered by an aggregate snapshot. */
const SUPERSEDED_BY_SNAPSHOT = new Map([
  ["GET /api/me/account", "GET /api/me/state"],
  ["GET /api/me/transactions", "GET /api/me/state"],
  ["GET /api/me/notifications", "GET /api/me/state"],
  ["GET /api/me/kyc", "GET /api/me/state"],
  ["GET /api/admin/overview", "GET /api/admin/state"],
  ["GET /api/admin/members", "GET /api/admin/state"],
  ["GET /api/admin/members/:id", "GET /api/admin/state"],
  ["GET /api/admin/kyc/queue", "GET /api/admin/state"],
  ["GET /api/admin/risk/disputes", "GET /api/admin/state"],
  ["GET /api/admin/staff", "GET /api/admin/state"],
  ["GET /api/admin/roles", "GET /api/admin/state"],
  ["GET /api/admin/audit", "GET /api/admin/state"],
  ["GET /api/admin/settings", "GET /api/admin/state"],
]);

// Deliberate compatibility tombstones: stale clients get an explicit error,
// but the current UI must never call these endpoints.
const RETIRED_ROUTES = new Map([
  ["PATCH /api/admin/members/:id/account-number", "Legacy number-only compatibility endpoint; UI uses account-details"],
  ["POST /api/me/scout/apply", "410 scout_credit_disabled — no funded savings provider"],
]);

const server = readFileSync(SERVER_FILE, "utf8");

/** `app.get("/api/x/:id", …)` → "GET /api/x/:id" */
const serverRoutes = [...server.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)]
  .map(([, method, path]) => `${method.toUpperCase()} ${path}`);

/** Comments mention routes too — a commented-out call must not count as wired. */
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const client = CLIENT_FILES.map(file => {
  try { return stripComments(readFileSync(file, "utf8")); } catch { return ""; }
}).join("\n");

/**
 * Client call shapes:
 *   apiPost("/api/x", …) · apiGet<{…}>("/api/x") · syncPatch(`/api/x/${id}`, …)
 *   api("DELETE", "/api/x") · fetch("/api/x")
 */
const VERB = { Get: "GET", GetText: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE" };

const clientCalls = new Set();
const addCall = (method, path) => {
  const clean = path.split("?")[0];
  if (!clean.startsWith("/api/")) return;
  clientCalls.add(`${method} ${clean}`);
};
// A call is matched with its method so method drift can't hide behind a path
// reference. `syncPost(() => \`/api/x/${id}\`)` (a path resolved at send time)
// counts too, and a bare `fetch(url)` is a GET.
for (const [, verb, path] of client.matchAll(/(?:api|sync)(GetText|Get|Post|Put|Patch|Delete)\s*(?:<[^>]*>)?\s*\(\s*(?:\(\s*\)\s*=>\s*)?[`"]([^`"]+)[`"]/g))
  addCall(VERB[verb], path);
for (const [, method, path] of client.matchAll(/\bapi\s*\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*[`"]([^`"]+)[`"]/g))
  addCall(method, path);
for (const [, path] of client.matchAll(/fetch\(\s*[`"](\/api\/[^`"]+)[`"]/g)) addCall("GET", path);

/**
 * Paths that live in a lookup table (e.g. the Super Admin EXPORTS map) are
 * referenced, not called inline — count those as wired too, so a route behind
 * a table isn't reported as dead surface. Direct calls stay method-checked.
 */
const referenced = new Set();

/** `/api/x/${id}` and `/api/x/:id` both normalise to `/api/x/*`. */
const normalise = path => path.replace(/:[A-Za-z_]\w*/g, "*").replace(/\$\{[^}]*\}/g, "*");
const key = entry => {
  const [method, path] = entry.split(" ");
  return `${method} ${normalise(path)}`;
};

for (const [, path] of client.matchAll(/[`"](\/api\/[a-z0-9/:._${}-]+)[`"]/gi)) referenced.add(normalise(path.split("?")[0]));

/** Server patterns use `*` for params: `/api/reports/*.csv` accepts `/api/reports/kyc.csv`. */
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = p => new RegExp(`^${escape(p).replace(/\\\*/g, "[^/]*")}$`);

const clientKeys = [...clientCalls].map(key);
const serverKeys = new Map(serverRoutes.map(route => [key(route), route]));

// A route is wired when the app calls it with the same method. Lookup tables
// (the Super Admin EXPORTS map) hold paths rather than calls — they are read
// endpoints, so they only satisfy a GET route.
const unwired = [...serverKeys]
  .filter(([k]) => {
    const [method, routePath] = k.split(" ");
    const accepts = pattern(routePath);
    const called = clientKeys.some(entry => entry.startsWith(`${method} `) && accepts.test(entry.slice(entry.indexOf(" ") + 1)));
    if (called) return false;
    return !(method === "GET" && [...referenced].some(path => accepts.test(path)));
  })
  .map(([, route]) => route)
  .filter(route => !SUPERSEDED_BY_SNAPSHOT.has(route) && !RETIRED_ROUTES.has(route));

// Client calls that don't correspond to any route (typos, removed endpoints,
// or a method the route doesn't accept).
const serverPatterns = [...serverKeys.keys()].map(k => ({ method: k.split(" ")[0], accepts: pattern(k.split(" ")[1]) }));
const dead = [...new Set(clientKeys)]
  .filter(k => !serverPatterns.some(sp => sp.method === k.split(" ")[0] && sp.accepts.test(k.split(" ")[1])))
  .filter(k => ![...SUPERSEDED_BY_SNAPSHOT.keys()].map(key).includes(k));

let failed = false;
const retiredCalls = [...clientCalls].filter(call => RETIRED_ROUTES.has(call));
if (retiredCalls.length) {
  failed = true;
  console.log(`Retired endpoints must not have UI callers: ${retiredCalls.join(", ")}`);
}

if (unwired.length) {
  failed = true;
  console.log(`\n✗ ${unwired.length} server route(s) have no caller in the app:\n`);
  for (const route of unwired) console.log(`    ${route}`);
  console.log("\n  Wire the route up, or add it to SUPERSEDED_BY_SNAPSHOT if an aggregate snapshot already carries it.");
}

if (dead.length) {
  failed = true;
  console.log(`\n✗ ${dead.length} client call(s) have no matching server route:\n`);
  for (const call of dead) console.log(`    ${call}`);
}

if (failed) {
  console.log(`\nROUTE COVERAGE FAILED — ${serverRoutes.length} server routes, ${clientCalls.size} client calls.\n`);
  process.exit(1);
}

console.log(`✓ route coverage: all ${serverRoutes.length} server routes accounted for (${SUPERSEDED_BY_SNAPSHOT.size} aggregate-only reads, ${RETIRED_ROUTES.size} retired endpoints)`);
