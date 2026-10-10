/**
 * Validates every exported email template in emails/:
 *  - balanced tags and complete documents
 *  - hosted PNG logo present (no inline SVG, which Gmail/Outlook strip)
 *  - footer legal content present
 *  - every app link points at a route that actually exists (dead-link guard)
 * Run: npm test   (or: node scripts/check-emails.mjs)
 */
import { readFileSync, readdirSync } from "node:fs";

const APP = "https://app.veyra.com";
/** Routes that exist in src/App.tsx (hash router paths, without leading #). */
const KNOWN_ROUTES = new Set([
  "accounts", "bills", "cards", "disputes", "external-accounts", "invoices", "kyc", "payments", "perks",
  "rewards", "scout", "security", "settings", "statements", "superadmin",
  "support-desk", "team", "transactions", "transfers",
  "application", "forgot-password", "invite/accept",
]);

const dir = new URL("../emails/", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".html"));
let failures = 0;
const fail = (msg) => { console.log(`✗ ${msg}`); failures++; };

for (const f of files) {
  const html = readFileSync(new URL(f, dir), "utf8");

  if (!html.startsWith("<!doctype html>") || !html.trim().endsWith("</html>")) fail(`${f}: incomplete document`);
  if (!html.includes('src="https://veyra.com/images/email/logo-mark.png"')) fail(`${f}: hosted logo missing`);
  if (/<svg/.test(html)) fail(`${f}: inline SVG present (stripped by Gmail/Outlook)`);
  for (const must of ["Manrope", "DM Sans", "available 24/7", "125 Market Street", "not a bank"])
    if (!html.includes(must)) fail(`${f}: missing "${must}"`);

  for (const tag of ["table", "tr", "td", "div", "span", "p", "a", "h1"]) {
    const open = (html.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "g")) || []).length;
    if (open !== close) fail(`${f}: unbalanced <${tag}> (${open}/${close})`);
  }

  // Dead-link guard: every APP href must map to a real route
  for (const m of html.matchAll(new RegExp(`href="${APP}/([a-z-]+(?:/[a-z-]+)*)[^"]*"`, "g"))) {
    if (!KNOWN_ROUTES.has(m[1])) fail(`${f}: email links to unknown route "/${m[1]}"`);
  }
}

console.log(failures === 0
  ? `ALL ${files.length} EMAIL TEMPLATES VALID (structure, logo, footer, links)`
  : `${failures} PROBLEM(S) FOUND`);
process.exit(failures === 0 ? 0 : 1);
