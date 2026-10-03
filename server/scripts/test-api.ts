/**
 * API integration tests — boots the real server on an ephemeral port with a
 * fresh database and exercises the full surface over HTTP:
 *
 * auth (login/logout), unauthorized access, role restrictions, staff
 * provisioning, customer/account management, deposits & withdrawals,
 * transfers, KYC workflow, risk/fraud workflow, staff & role management,
 * audit logging & immutability, broadcasts, reports/exports, settings,
 * emergency halt, concurrent financial operations, privilege escalation,
 * data integrity, password reset.
 *
 * Nothing is seeded: the only pre-existing account is the Super Admin
 * bootstrapped from ADMIN_* env vars below. Every member and staff account,
 * and every dollar of balance, is created through the public API — exactly
 * like production traffic.
 *
 * Run: npm run test:api   (or: npx tsx server/scripts/test-api.ts)
 */
import { createApp } from "../src/app.js";
import { resetRateLimits } from "../src/security.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
const expect = (label: string, cond: boolean, extra?: string) => {
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}${extra && !cond ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), "veyra-api-test-"));
// Clean production instance — env-bootstrapped admin, no other identities.
process.env.ADMIN_EMAIL = "ops@veyra.test";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.ADMIN_NAME = "Ops Admin";
const { app, db } = createApp(join(tmp, "test.db"));
const server = await new Promise<{ port: number }>(resolve => {
  const s = app.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as { port: number }).port }));
});
const base = `http://127.0.0.1:${server.port}`;

const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, json, text, headers: res.headers };
};

const register = async (name: string, email: string, password: string, extra: Record<string, unknown> = {}) =>
  api("POST", "/api/auth/register", undefined, { name, email, password, ...extra });

try {
  /* ---------- health & auth ---------- */
  const health = await api("GET", "/api/health");
  expect("health check", health.status === 200 && health.json.ok === true);

  const bootCount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  expect("clean database contains only the bootstrap admin", bootCount === 1);

  const ghostLogin = await api("POST", "/api/auth/login", undefined, { email: "demo@veyra.com", password: "veyra123" });
  expect("no pre-seeded identities exist (login 401)", ghostLogin.status === 401);

  const badLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "wrong" });
  expect("login rejects wrong password (401)", badLogin.status === 401);

  const noToken = await api("GET", "/api/admin/overview");
  expect("unauthenticated admin access rejected (401)", noToken.status === 401);

  const badToken = await api("GET", "/api/admin/overview", "forged.token.here");
  expect("forged token rejected (401)", badToken.status === 401);

  const adminLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "admin-pass-123" });
  expect("env-bootstrapped superadmin login", adminLogin.status === 200 && adminLogin.json.token && adminLogin.json.user.role === "superadmin");
  const admin = adminLogin.json.token;
  const adminId = adminLogin.json.user.id;

  const hashRow = db.prepare("SELECT password_hash FROM users WHERE email = 'ops@veyra.test'").get() as { password_hash: string };
  expect("passwords stored as scrypt digests, never plaintext", hashRow.password_hash.startsWith("s2$") && !hashRow.password_hash.includes("admin-pass-123"));

  /* ---------- every account is created through the API ---------- */
  const raeReg = await register("Rae Kim", "rae@member.test", "member-pass-1", { accountType: "business", business: "Rae & Co Studio" });
  const alexReg = await register("Alex Stone", "alex@member.test", "member-pass-2", { accountType: "personal" });
  const adaReg = await register("Ada Mensah", "ada@staff.test", "staff-pass-1", { accountType: "business", business: "Veyra Financial HQ" });
  const leoReg = await register("Leo Frost", "leo@staff.test", "staff-pass-2", { accountType: "business", business: "Veyra Financial HQ" });
  expect("members register through the API", [raeReg, alexReg, adaReg, leoReg].every(r => r.status === 201));
  const raeId = raeReg.json.user.id, alexId = alexReg.json.user.id;

  const promoteCompliance = await api("POST", `/api/admin/staff/${adaReg.json.user.id}/role`, admin, { role: "compliance" });
  const promoteSupport = await api("POST", `/api/admin/staff/${leoReg.json.user.id}/role`, admin, { role: "support" });
  expect("admin provisions compliance + support staff", promoteCompliance.status === 200 && promoteSupport.status === 200);

  const raeLogin = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const alexLogin = await api("POST", "/api/auth/login", undefined, { email: "alex@member.test", password: "member-pass-2" });
  const complianceLogin = await api("POST", "/api/auth/login", undefined, { email: "ada@staff.test", password: "staff-pass-1" });
  const supportLogin = await api("POST", "/api/auth/login", undefined, { email: "leo@staff.test", password: "staff-pass-2" });
  const rae = raeLogin.json.token, alex = alexLogin.json.token;
  const compliance = complianceLogin.json.token, support = supportLogin.json.token;
  expect("staff + member logins", rae && alex && compliance && support);

  /* ---------- unauthorized & role restrictions ---------- */
  const memberOnAdmin = await api("GET", "/api/admin/overview", rae);
  expect("member blocked from admin routes (403)", memberOnAdmin.status === 403);

  const supportAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, support, { direction: "credit", amount: 100, memo: "nope" });
  expect("support cannot adjust balances (403)", supportAdjust.status === 403);

  const supportStaff = await api("GET", "/api/admin/staff", support);
  expect("support cannot manage staff (403)", supportStaff.status === 403);

  const complianceAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, compliance, { direction: "credit", amount: 100, memo: "nope" });
  expect("compliance cannot adjust balances (403)", complianceAdjust.status === 403);

  const complianceKyc = await api("GET", "/api/admin/kyc/queue", compliance);
  expect("compliance CAN view KYC queue (RBAC grant)", complianceKyc.status === 200 && Array.isArray(complianceKyc.json.queue));

  /* ---------- dashboard overview ---------- */
  const overview = await api("GET", "/api/admin/overview", admin);
  expect("overview KPIs present", overview.status === 200 &&
    typeof overview.json.totals.customers === "number" &&
    typeof overview.json.totals.totalBalanceCents === "number" &&
    Array.isArray(overview.json.recentAudit));

  /* ---------- customers & accounts ---------- */
  const members = await api("GET", "/api/admin/members?q=rae", admin);
  expect("member search finds the API-registered member", members.status === 200 && members.json.members.length === 1 && members.json.members[0].name === "Rae Kim");

  await api("PUT", "/api/me/preferences", rae, { key: "scoutAuto", value: false }); // deterministic balances
  await api("POST", "/api/me/deposits", rae, { amount: 5000, source: "Opening deposit" });

  const memberDetail = await api("GET", `/api/admin/members/${raeId}`, admin);
  expect("member detail with account + transactions", memberDetail.status === 200 && memberDetail.json.member.balance.cents > 0 && memberDetail.json.transactions.length > 0);

  /* ---------- deposits & withdrawals (admin treasury) ---------- */
  const before = memberDetail.json.member.balance.cents as number;
  const credit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 500, memo: "Wire deposit confirmation" });
  expect("admin credit adjusts member balance (+$500)", credit.status === 200 && credit.json.after.cents === before + 50000);

  const noMemo = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 100 });
  expect("adjustment without audit reason rejected (400)", noMemo.status === 400);

  const debit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 200, memo: "Fee reversal" });
  expect("admin withdrawal adjusts balance (−$200)", debit.status === 200 && debit.json.after.cents === before + 30000);

  const overdraft = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 99_999_999, memo: "should fail" });
  expect("overdraft withdrawal rejected, balance unchanged", overdraft.status === 400 &&
    (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents === before + 30000);

  /* ---------- concurrent financial operations stay consistent ---------- */
  const concurrentStart = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  await Promise.all(
    Array.from({ length: 5 }, () => api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 10, memo: "concurrent" })),
  );
  const concurrentEnd = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  expect("5 concurrent credits apply exactly once each (atomicity)", concurrentEnd === concurrentStart + 5 * 1000);

  /* ---------- member transfers & restrictions ---------- */
  const transfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Harbor Studio", amount: 100, category: "Operations", method: "ACH" });
  expect("member transfer succeeds and debits balance (+rewards)", transfer.status === 201 && transfer.json.balance.amount === ((concurrentEnd - 10000) / 100).toFixed(2) && transfer.json.result.reward === 2.5);

  const overdraftTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "X", amount: 99_999_999 });
  expect("transfer beyond balance rejected", overdraftTransfer.status === 400);

  const restrict = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reason: "Suspicious transaction pattern" });
  expect("account restriction applied", restrict.status === 200 && restrict.json.status === "restricted");
  const blockedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Y", amount: 5 });
  expect("restricted member's transfers blocked server-side (403)", blockedTransfer.status === 403);
  const depositStillWorks = await api("POST", "/api/me/deposits", rae, { amount: 25, source: "Incoming ACH" });
  expect("deposits still land while restricted", depositStillWorks.status === 201);
  const restore = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "active" });
  expect("account restored", restore.status === 200 && restore.json.status === "active");

  const restrictNoReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted" });
  expect("restriction without a reason rejected", restrictNoReason.status === 400);

  /* ---------- KYC workflow (request → submit → approve) ---------- */
  const kycRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId, requirements: ["identity", "address"], reason: "Annual compliance review" });
  expect("admin KYC request sets 'requested'", kycRequest.status === 200 && kycRequest.json.status === "requested");

  const alexNotifs = await api("GET", "/api/me/notifications", alex);
  expect("member notified of verification request", alexNotifs.json.notifications.some((n: any) => n.title === "Identity verification requested"));

  const kycSubmit = await api("POST", "/api/me/kyc/submit", alex, {
    legalName: "Alex Stone", dob: "1992-09-21", country: "United States", documentType: "Drivers License",
    source: "Salary income", taxId: "7710", documents: [{ key: "idFront", label: "License", name: "license.jpg" }],
  });
  expect("member submission enters review", kycSubmit.status === 201 && kycSubmit.json.status === "in_review");

  const queue = await api("GET", "/api/admin/kyc/queue", admin);
  expect("submission appears in admin queue with payload", queue.json.queue.some((q: any) => q.userId === alexId && q.submission.legalName === "Alex Stone"));

  const decisionNoNote = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "needs_attention" });
  expect("changes-rejected without a note (400)", decisionNoNote.status === 400);

  const approve = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "approved" });
  expect("approval verified member", approve.status === 200 && approve.json.status === "approved");
  const afterApprove = await api("GET", "/api/me/kyc", alex);
  expect("member sees approved status (100%)", afterApprove.json.kyc.status === "approved" && afterApprove.json.kyc.completeness === 100);

  const reRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId });
  expect("re-requesting an approved member rejected (409)", reRequest.status === 409);

  /* ---------- risk & fraud workflow ---------- */
  const memberDispute = await api("POST", "/api/me/disputes", alex, { reason: "Duplicate charge", merchant: "City Electric", amount: 96.12 });
  expect("member can open a dispute", memberDispute.status === 201);
  const disputeId = memberDispute.json.dispute.id;

  // The app files disputes against a specific ledger row; the server enforces
  // one open case per transaction (retries and second tabs included).
  const raeOutflow = (await api("GET", "/api/me/state", rae)).json.account.transactions.find((t: any) => t.amount < 0);
  const linkedDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "Card was in my possession." });
  expect("member can dispute a specific transaction", linkedDispute.status === 201);
  const duplicateDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "" });
  expect("second filing for the same transaction rejected (409)", duplicateDispute.status === 409);

  const disputes = await api("GET", "/api/admin/risk/disputes", admin);
  expect("risk queue lists the filed dispute", disputes.status === 200 && disputes.json.disputes.length >= 1 &&
    disputes.json.disputes.some((d: any) => d.id === disputeId && d.status === "submitted"));

  const advance1 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute advances to reviewing", advance1.status === 200 && advance1.json.status === "reviewing");
  const alexBalanceBefore = (await api("GET", "/api/me/account", alex)).json.balance.cents as number;
  const advance2 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute resolution credits the member", advance2.status === 200 && advance2.json.status === "resolved" &&
    (await api("GET", "/api/me/account", alex)).json.balance.cents === alexBalanceBefore + 9612);

  /* ---------- staff management & privilege escalation ---------- */
  const promote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "compliance" });
  expect("member promoted to compliance", promote.status === 200 && promote.json.role === "compliance");
  const demote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "user" });
  expect("staff access revoked", demote.status === 200);

  const selfChange = await api("POST", `/api/admin/staff/${adminId}/role`, admin, { role: "user" });
  expect("self role change rejected (escalation guard)", selfChange.status === 400);

  /* ---------- role matrix (server-enforced) ---------- */
  const rolesBefore = await api("GET", "/api/admin/roles", admin);
  expect("roles endpoint lists matrix", rolesBefore.status === 200 && rolesBefore.json.roles.length === 4);

  await api("PUT", "/api/admin/roles", admin, { role: "support", permissions: ["dashboard.view"] });
  const supportAfterChange = await api("GET", "/api/admin/members", support);
  expect("revoking a permission takes effect immediately (403)", supportAfterChange.status === 403);

  await api("POST", "/api/admin/roles/reset", admin, { role: "support" });
  const supportAfterReset = await api("GET", "/api/admin/members", support);
  expect("role reset restores grants", supportAfterReset.status === 200);

  const complianceRolesEdit = await api("PUT", "/api/admin/roles", compliance, { role: "admin", permissions: [] });
  expect("compliance cannot edit the role matrix (403)", complianceRolesEdit.status === 403);

  /* ---------- broadcasts & notifications ---------- */
  const broadcast = await api("POST", "/api/admin/broadcasts", admin, { title: "Maintenance window", detail: "Sunday 02:00–04:00 UTC.", audience: "all" });
  expect("broadcast delivered to members", broadcast.status === 200 && broadcast.json.delivered >= 2);
  const raeNotifsAfter = await api("GET", "/api/me/notifications", rae);
  expect("broadcast visible in member notifications", raeNotifsAfter.json.notifications.some((n: any) => n.title === "Maintenance window"));

  /* ---------- settings & emergency halt ---------- */
  const settingsSave = await api("PUT", "/api/admin/settings", admin, { coreApy: 4.5 });
  expect("settings saved", settingsSave.status === 200 && settingsSave.json.settings.core_apy === "4.50");

  const halt = await api("PUT", "/api/admin/settings", admin, { paymentRails: "halted" });
  expect("emergency halt engaged", halt.status === 200);
  const haltedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Z", amount: 10 });
  expect("transfers blocked while rails halted (503)", haltedTransfer.status === 503);
  const resume = await api("PUT", "/api/admin/settings", admin, { paymentRails: "operational" });
  expect("rails resumed", resume.status === 200);

  /* ---------- reports & exports ---------- */
  for (const kind of ["customers", "accounts", "transactions", "kyc"]) {
    const report = await api("GET", `/api/admin/reports/${kind}.csv`, admin);
    expect(`report export: ${kind}`, report.status === 200 && report.text.includes(",") && (report.headers.get("content-type") ?? "").includes("text/csv"));
  }
  const accountsCsv = await api("GET", "/api/admin/reports/accounts.csv", admin);
  expect("accounts export carries the console columns", accountsCsv.text.split("\n")[0].includes("Frozen cards") &&
    accountsCsv.text.split("\n")[0].includes("KYC") && accountsCsv.text.split("\n")[0].includes("Last activity"));
  const kycCsv = await api("GET", "/api/admin/reports/kyc.csv", admin);
  expect("kyc export carries requested/updated timestamps", kycCsv.text.split("\n")[0].includes("Requested at") &&
    kycCsv.text.split("\n")[0].includes("Updated"));
  const auditCsv = await api("GET", "/api/admin/audit/export.csv", admin);
  expect("report export: audit (CSV)", auditCsv.status === 200 && auditCsv.text.includes(",") && (auditCsv.headers.get("content-type") ?? "").includes("text/csv"));
  const exportNoPerm = await api("GET", "/api/admin/reports/customers.csv", support);
  expect("support cannot export reports (403)", exportNoPerm.status === 403);

  /* ---------- audit trail ---------- */
  const auditList = await api("GET", "/api/admin/audit?category=Financial", admin);
  expect("audit trail lists financial actions", auditList.status === 200 && auditList.json.entries.length >= 3);

  const auditSearch = await api("GET", "/api/admin/audit?q=overdraw", admin);
  expect("audit search works", auditSearch.status === 200);

  const supportAudit = await api("GET", "/api/admin/audit", support);
  expect("support cannot read audit logs (403)", supportAudit.status === 403);

  let triggerFired = false;
  try { db.exec("UPDATE audit_log SET summary = 'tampered'"); } catch { triggerFired = true; }
  expect("audit_log UPDATE blocked by DB trigger", triggerFired);
  triggerFired = false;
  try { db.exec("DELETE FROM audit_log"); } catch { triggerFired = true; }
  expect("audit_log DELETE blocked by DB trigger", triggerFired);

  /* ---------- data integrity ---------- */
  const txnsAfter = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  // Exactly the 11 applied operations so far (rae: 2 deposits + 1 credit + 1
  // debit + 5 concurrent credits + 1 transfer; alex: 1 dispute credit) —
  // every applied op wrote a row and every rejected op wrote none.
  expect("every financial op wrote a ledger row (and rejected ops wrote none)", txnsAfter.n === 11);
  const orphanTxns = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  const orphanAccounts = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  expect("no orphaned ledger rows or accounts (FK integrity)", orphanTxns.n === 0 && orphanAccounts.n === 0);

  /* ---------- logout revokes the session ---------- */
  const logout = await api("POST", "/api/auth/logout", support);
  expect("logout succeeds", logout.status === 200);
  const afterLogout = await api("GET", "/api/auth/me", support);
  expect("revoked token no longer authenticates (401)", afterLogout.status === 401);

  /* ---------- registration ---------- */
  const juneReg = await register("June Okafor", "june@okafor.design", "supersafe123", { accountType: "business", business: "Okafor Design" });
  expect("registration creates a member + account + token", juneReg.status === 201 && juneReg.json.token);
  const dupe = await register("X", "june@okafor.design", "supersafe123");
  expect("duplicate email rejected (409)", dupe.status === 409);

  /* ---------- member lifecycle: empty start → real activity ---------- */
  const juneToken = juneReg.json.token;
  const juneState = await api("GET", "/api/me/state", juneToken);
  const js = juneState.json.account;
  expect("new member starts EMPTY (production behavior)", juneState.status === 200 &&
    js.balance === 0 && js.pendingBalance === 0 && js.cards.length === 0 && js.transactions.length === 0 &&
    js.invoices.length === 0 && js.team.length === 1 && js.team[0].role === "Owner" &&
    js.savingsPockets.length === 0 && js.payees.length === 0 && js.scheduledPayments.length === 0 &&
    js.perks.length === 0 && js.disputes.length === 0 && js.notifications.length === 0 &&
    js.bankDetails.accountNumber.length === 12 && js.kyc.status === "not_started" && js.accountStatus === "active");
  await api("PUT", "/api/me/preferences", juneToken, { key: "scoutAuto", value: false }); // deterministic balances
  await api("POST", "/api/me/deposits", juneToken, { amount: 1200, source: "Payroll" });
  const juneCard = await api("POST", "/api/me/cards", juneToken, { label: "Everyday", type: "virtual", limit: 500, cardholder: "June Okafor" });
  await api("POST", "/api/me/transfers", juneToken, { counterparty: "Acme Supplies", amount: 180, category: "Operations", method: "Card", cardId: juneCard.json.card.id });
  const juneAfter = (await api("GET", "/api/me/state", juneToken)).json.account;
  expect("member builds real history through the API", juneAfter.balance === 1200 - 180 &&
    juneAfter.transactions.length === 2 && juneAfter.cards.length === 1 &&
    juneAfter.cards[0].spent === 180 && juneAfter.team[0].name === "June Okafor");

  // Cards: issue → patch → controls → freeze-all → replace → shipping → delete
  const newCard = await api("POST", "/api/me/cards", rae, { label: "Test card", type: "virtual", limit: 800, cardholder: "Rae Kim" });
  expect("card issued with generated numbers", newCard.status === 201 && newCard.json.card.last4.length === 4 && newCard.json.card.fullNumber.startsWith("9"));
  const cardId = newCard.json.card.id;
  const cardPatch = await api("PATCH", `/api/me/cards/${cardId}`, rae, { frozen: true, limit: 1500, pin: "9876", controls: { international: true } });
  expect("card patch updates fields", cardPatch.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === cardId && c.frozen === true && c.limit === 1500 && c.pin === "9876" && c.controls.international === true));
  const badPin = await api("PATCH", `/api/me/cards/${cardId}`, rae, { pin: "12" });
  expect("invalid PIN rejected (400)", badPin.status === 400);
  const foreignCard = await api("PATCH", `/api/me/cards/${cardId}`, alex, { frozen: false });
  expect("cannot patch another member's card (404)", foreignCard.status === 404);
  const freezeAll = await api("POST", "/api/me/cards/freeze-all", rae);
  expect("freeze-all freezes every card", freezeAll.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.every((c: any) => c.frozen === true));
  const replaced = await api("POST", `/api/me/cards/${cardId}/replace`, rae, { reason: "Compromised" });
  expect("card replacement issues a new card + freezes old", replaced.status === 201 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === replaced.json.card.id && c.label === "Test card replacement"));
  const physical = await api("POST", "/api/me/cards", rae, { label: "Ship me", type: "physical", limit: 2000 });
  const ship = await api("POST", `/api/me/cards/${physical.json.card.id}/shipping/advance`, rae);
  expect("shipping advances processing → printing", ship.status === 200 && ship.json.status === "printing");
  const deleted = await api("DELETE", `/api/me/cards/${physical.json.card.id}`, rae);
  expect("card deleted", deleted.status === 200);

  // Invoices: create → remind → mark paid credits balance
  const inv = await api("POST", "/api/me/invoices", rae, { client: "Test Client", clientEmail: "t@c.example", amount: 500, dueDays: 14, description: "Integration test" });
  expect("invoice created with next sequential id", inv.status === 201 && Number(inv.json.invoice.id) > 1047);
  const remind = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/remind`, rae);
  expect("invoice reminder recorded", remind.status === 200);
  const balanceBeforeInv = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const markPaid = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("invoice payment credits balance", markPaid.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balanceBeforeInv + 500);
  const paidAgain = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("double payment rejected (409)", paidAgain.status === 409);

  // Savings pockets: create → fund → withdraw → delete refunds
  const pocket = await api("POST", "/api/me/pockets", rae, { name: "Integration fund", target: 1000, color: "#7558dc", icon: "general" });
  const pocketId = pocket.json.pocket.id;
  const balPrePocket = (await api("GET", "/api/me/state", rae)).json.account.balance;
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 300, direction: "to_pocket" });
  let state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket funding moves money out of checking", state.balance === balPrePocket - 300 &&
    state.savingsPockets.find((p: any) => p.id === pocketId).balance === 300);
  const overPocket = await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 99999, direction: "to_pocket" });
  expect("pocket funding beyond balance rejected", overPocket.status === 400);
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 100, direction: "to_checking" });
  await api("DELETE", `/api/me/pockets/${pocketId}`, rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket withdrawal + delete refunds remainder", state.balance === balPrePocket && !state.savingsPockets.some((p: any) => p.id === pocketId));

  // Payees & scheduled payments: add → schedule → pay debits
  const payee = await api("POST", "/api/me/payees", rae, { name: "Integration Vendor", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "9090", accountType: "Checking" });
  expect("payee added", payee.status === 201);
  const badPayee = await api("POST", "/api/me/payees", rae, { name: "Bad", bankName: "X", routingNumber: "123", accountLast4: "12" });
  expect("payee validation enforced (400)", badPayee.status === 400);
  const sched = await api("POST", "/api/me/scheduled", rae, { payeeId: payee.json.payee.id, payeeName: "Integration Vendor", amount: 250, category: "Operations", frequency: "monthly", nextDate: Date.now() + 86_400_000, autopay: true, memo: "Integration" });
  expect("scheduled payment created", sched.status === 201);
  const balPreSched = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const payNow = await api("POST", `/api/me/scheduled/${sched.json.payment.id}/pay`, rae);
  expect("pay-now debits and advances next date", payNow.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balPreSched - 250);
  const paused = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae);
  expect("scheduled payment pause/resume toggle", paused.status === 200 && paused.json.status === "paused");
  const resumed = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "active" });
  expect("explicit status wins over the toggle (app contract)", resumed.status === 200 && resumed.json.status === "active");
  const badStatus = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "cancelled" });
  expect("unknown scheduled status rejected (400)", badStatus.status === 400);
  const foreignSched = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, alex, { status: "paused" });
  expect("cannot pause another member's payment (404)", foreignSched.status === 404);

  // Rewards redemption
  const rewardsPre = (await api("GET", "/api/me/state", rae)).json.account;
  const redeem = await api("POST", "/api/me/rewards/redeem", rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("rewards redeem 1:1 into checking", redeem.status === 200 && Math.abs(state.balance - (rewardsPre.balance + rewardsPre.rewards)) < 0.001 && state.rewards === 0);

  // Scout idempotency
  const scout1 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  const scout2 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  expect("scout savings apply exactly once", scout1.json.applied === true && scout2.json.applied === false);

  // Preferences + profile + KYC patch
  const pref = await api("PUT", "/api/me/preferences", rae, { key: "weeklyDigest", value: true });
  expect("preference updated", pref.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.weeklyDigest === true);
  const profile = await api("PATCH", "/api/me/profile", rae, { name: "Rae Kim", phone: "+1 (555) 000-0001" });
  expect("profile patch persists", profile.status === 200 && profile.json.user.phone === "+1 (555) 000-0001");
  const kycPatch = await api("PATCH", "/api/me/kyc", rae, { nextStep: "Final review", completeness: 95 });
  expect("kyc wizard progress saved", kycPatch.status === 200);

  // Team invite + owner protection
  const invite = await api("POST", "/api/me/team", rae, { name: "Ada Lovelace", email: "ada@raeandco.com", role: "Admin", monthlyLimit: 3000 });
  expect("team invite recorded as invited", invite.status === 201 && invite.json.member.status === "invited");
  const ownerRow = (await api("GET", "/api/me/state", rae)).json.account.team.find((m: any) => m.role === "Owner");
  const ownerRemove = await api("DELETE", `/api/me/team/${ownerRow.id}`, rae);
  expect("account owner cannot be removed (400)", ownerRemove.status === 400);

  // Members can open disputes but never resolve their own (compliance resolves)
  const memberAdvance = await api("POST", `/api/me/disputes/${disputeId}/advance`, alex);
  expect("member self-resolution blocked (404 — no such route)", memberAdvance.status === 404);

  // Change password + production token-based password reset
  resetRateLimits(); // this suite performs many logins — reset the limiter
  const changePw = await api("POST", "/api/auth/change-password", juneToken, { current: "supersafe123", next: "even safer 99" });
  expect("change password works", changePw.status === 200 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "even safer 99" })).status === 200);
  const forgotUnknown = await api("POST", "/api/auth/forgot-password", undefined, { email: "nobody@nowhere.example" });
  expect("forgot-password never reveals account existence", forgotUnknown.status === 200 && forgotUnknown.json.ok === true &&
    !forgotUnknown.json.token && !forgotUnknown.json.tempPassword);
  await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
  const badReset = await api("POST", "/api/auth/reset-password", undefined, { token: "forged-token", password: "new password 123" });
  expect("forged reset token rejected (400)", badReset.status === 400);
  // Mint a token through the same code path (sha256-hashed, 30-min expiry) for
  // June's real user id, then complete the reset like the emailed link would.
  const crypto = await import("node:crypto");
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(crypto.createHash("sha256").update(rawToken).digest("hex"), juneReg.json.user.id, Date.now() + 30 * 60_000, Date.now());
  const weakReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "short" });
  expect("reset enforces the 8-char minimum (400)", weakReset.status === 400);
  const goodReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "totally new pass 77" });
  expect("valid token resets the password", goodReset.status === 200 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "totally new pass 77" })).status === 200);
  const replayReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "another pass 88" });
  expect("reset token is single-use (replay rejected)", replayReset.status === 400);

  /* ---------- admin aggregate state ---------- */
  const adminState = await api("GET", "/api/admin/state", admin);
  const as = adminState.json;
  expect("admin state aggregates the console", adminState.status === 200 &&
    as.users.length >= 6 && as.accounts.length >= 3 && as.transactions.length >= 15 &&
    Array.isArray(as.disputes) && Array.isArray(as.kycQueue) && as.audit.length > 0 &&
    as.roles.support.length > 0 && as.settings.payment_rails === "operational");
  const raeMirror = (await api("GET", "/api/me/state", rae)).json.account;
  expect("admin state mirrors member shapes", as.accounts.some((a: any) =>
    a.userId === raeId && a.balance === raeMirror.balance && a.cards === raeMirror.cards.length));
  const memberState = await api("GET", "/api/admin/state", rae);
  expect("admin state blocked for members (403)", memberState.status === 403);

  console.log(failures === 0 ? "\nALL API INTEGRATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
} finally {
  server && await new Promise<void>(r => (server as any).close ? (server as any).close(() => r()) : r());
  // allow the event loop to drain
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 100);
}
