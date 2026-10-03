/**
 * Headless tests for the Super Admin control center: RBAC, staff management,
 * cross-account financial operations, audit trail, broadcasts and data
 * integrity. Run: npm test  (or: npx tsx scripts/test-admin.ts)
 */
const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => backing.set(k, v),
  removeItem: (k: string) => backing.delete(k),
};

const auth = await import("../src/lib/auth.tsx");
const store = await import("../src/lib/store.tsx");
const perms = await import("../src/lib/permissions.ts");
const audit = await import("../src/lib/audit.ts");

let failures = 0;
const expect = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}`);
  if (!cond) failures++;
};

/* ---------- 1. Role restrictions & RBAC ---------- */
expect("superadmin passes every permission", perms.PERMISSIONS.every(p => perms.can("superadmin", p)));
expect("compliance can review KYC", perms.can("compliance", "kyc.review"));
expect("compliance cannot manage staff", !perms.can("compliance", "staff.manage"));
expect("support cannot adjust balances", !perms.can("support", "customers.adjust_balance"));
expect("members have no admin permissions", !perms.can("user", "dashboard.view") && !perms.can(undefined, "reports.view"));

let threw = false;
try { perms.assertCan("support", "customers.adjust_balance", "adjust balances"); } catch { threw = true; }
expect("assertCan throws on missing permission (error states)", threw);
threw = false;
try { perms.assertCan("admin", "customers.adjust_balance", "adjust balances"); } catch { threw = true; }
expect("assertCan passes for permitted role", !threw);

/* ---------- 2. Role matrix editing (with superadmin lockout protection) ---------- */
perms.setRolePermissions("support", ["dashboard.view", "kyc.request"]);
expect("permission override takes effect", perms.can("support", "kyc.request"));
expect("override removed unrelated grants", !perms.can("support", "customers.view"));
perms.setRolePermissions("superadmin", []);
expect("superadmin can never be locked out", perms.can("superadmin", "staff.manage"));
perms.resetRolePermissions("support");
expect("role reset restores defaults", !perms.can("support", "kyc.request") && perms.can("support", "customers.view"));

/* ---------- 3. Staff management & privilege escalation ---------- */
await auth.ensureDemoUser();
const users = auth.getUsers();
const admin = users.find(u => u.email === "admin@veyra.com")!;
const demo = users.find(u => u.email === "demo@veyra.com")!;
expect("demo staff seeded (compliance + support)", users.some(u => u.email === "compliance@veyra.com") && users.some(u => u.email === "support@veyra.com"));

auth.setUserRole(demo.id, "compliance", admin.id);
expect("admin can promote a member to compliance", auth.getUsers().find(u => u.id === demo.id)?.role === "compliance");
auth.setUserRole(demo.id, "user", admin.id);
expect("admin can revoke staff access", auth.getUsers().find(u => u.id === demo.id)?.role === "user");

threw = false;
try { auth.setUserRole(admin.id, "admin", admin.id); } catch { threw = true; }
expect("self role change rejected (privilege escalation guard)", threw);
threw = false;
try { auth.setUserRole(admin.id, "user", demo.id); } catch { threw = true; }
expect("superadmin demotion rejected", threw);

/* ---------- 4. Audit trail (append-only, before/after) ---------- */
audit.ensureAuditSeed();
const seeded = audit.getAuditLogs();
expect("audit seed present", seeded.length >= 3);
audit.logAdminAction({
  adminId: "x", adminName: "Test Admin", action: "balance.adjust", category: "Financial",
  target: "user:t · Test", summary: "Credited $100.00.", before: "$50.00", after: "$150.00",
});
const after = audit.getAuditLogs();
expect("audit entry appended newest-first", after[0].summary.includes("Credited"));
expect("audit keeps before/after values", after[0].before === "$50.00" && after[0].after === "$150.00");
expect("audit module exposes no mutation API",
  !Object.keys(audit).some(k => /update|delete|edit|clear/i.test(k)));

/* ---------- 5. Cross-account financial operations (integrity preserved) ---------- */
const profile = { name: demo.name, business: demo.business, email: demo.email, accountType: "business" as const };
store.requestKycForUser(demo.id, profile, { requestedBy: "Chief System Admin", reason: "Test", requirements: ["identity"] });
const stored = () => JSON.parse(backing.get(`veyra.account.${demo.id}`)!);
const cardsBefore = stored().cards.length;
const balanceBefore = stored().balance;
const kycBefore = stored().kyc.status;

const adj = store.adminAdjustUserBalance(demo.id, profile, 500, "credit", "Wire deposit");
expect("credit adjusts the member's balance", Math.abs(stored().balance - (balanceBefore + 500)) < 0.01);
expect("adjustment returns before/after for the audit trail", Math.abs(adj.after - (adj.before + 500)) < 0.01);
expect("adjustment writes a ledger transaction", stored().transactions.some((t: any) => t.note === "Wire deposit"));
expect("member is notified of the credit", stored().notifications.some((n: any) => /credited/i.test(n.title)));

store.adminAdjustUserBalance(demo.id, profile, 200, "debit", "Fee reversal");
expect("debit reduces the balance (concurrent ops stay consistent)", Math.abs(stored().balance - (balanceBefore + 300)) < 0.01);
expect("account data integrity preserved (cards, KYC untouched)",
  stored().cards.length === cardsBefore && stored().kyc.status === kycBefore);

/* ---------- 6. Account status (restriction flag read by the send guard) ---------- */
store.setAccountStatus(demo.id, profile, "restricted", "Suspicious pattern");
expect("restriction stored on the member account", stored().accountStatus === "restricted");
expect("member notified of restriction", stored().notifications.some((n: any) => /restricted/i.test(n.title)));
store.setAccountStatus(demo.id, profile, "active", "");
expect("restoration clears restriction", stored().accountStatus === "active");

/* ---------- 7. Platform aggregation ---------- */
const accounts = store.listAllAccounts();
expect("member appears in platform accounts", accounts.some(a => a.userId === demo.id && a.hasAccount));
expect("staff excluded from member lists", accounts.every(a => a.email !== "admin@veyra.com"));
const txns = store.listAllTransactions();
expect("platform ledger aggregates member transactions", txns.some(t => t.userId === demo.id && t.note === "Wire deposit"));

/* ---------- 8. Risk workflow (dispute arbitration) ---------- */
const withDispute = stored();
withDispute.disputes = [{ id: "dsp1", transactionId: "t1", merchant: "Fable Cloud", amount: 218, reason: "Duplicate charge", status: "submitted", openedAt: Date.now(), updatedAt: Date.now() }];
backing.set(`veyra.account.${demo.id}`, JSON.stringify(withDispute));
const balPre = stored().balance;
let res = store.advanceDisputeForUser(demo.id, profile, "dsp1");
expect("dispute advances to reviewing", res?.status === "reviewing");
res = store.advanceDisputeForUser(demo.id, profile, "dsp1");
expect("dispute resolution credits the member", res?.status === "resolved" && Math.abs(stored().balance - (balPre + 218)) < 0.01);
expect("resolved dispute appears in platform list", store.listAllDisputes().some(d => d.id === "dsp1" && d.status === "resolved"));

/* ---------- 9. Broadcasts ---------- */
const { delivered } = store.broadcastNotification({ title: "Maintenance window", detail: "Sunday 02:00–04:00 UTC.", audience: "all" });
expect("broadcast delivered to at least one member", delivered >= 1);
expect("broadcast lands in member notifications", stored().notifications.some((n: any) => n.title === "Maintenance window"));

/* ---------- 10. Unauthorized access to admin console ---------- */
expect("member role blocked from admin console", !perms.isStaff("user"));
expect("all staff roles pass the console guard", perms.isStaff("support") && perms.isStaff("compliance") && perms.isStaff("admin") && perms.isStaff("superadmin"));

console.log(failures === 0 ? "\nALL ADMIN CONTROL CENTER TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
