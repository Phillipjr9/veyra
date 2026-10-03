/**
 * Headless tests for the RBAC layer (src/lib/permissions.ts).
 *
 * The server is the enforcement authority on every admin route; these checks
 * verify the client mirror: role defaults, the server-matrix override system
 * and the guards used across the admin console.
 * Run: npx tsx scripts/test-permissions.ts
 */
const { can, assertCan, isStaff, rolePermissions, setServerRoleMatrix, STAFF_ROLES, ROLE_DEFAULTS, PERMISSIONS } = await import("../src/lib/permissions.ts");

let failures = 0;
const expect = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}`);
  if (!cond) failures++;
};

/* ---------- role defaults ---------- */
expect("superadmin defaults to every permission", rolePermissions("superadmin").length === PERMISSIONS.length);
expect("admin defaults exclude staff + role management",
  !rolePermissions("admin").includes("staff.manage") && !rolePermissions("admin").includes("roles.manage") &&
  rolePermissions("admin").includes("customers.adjust_balance"));
expect("compliance defaults cover KYC + risk + audit",
  rolePermissions("compliance").includes("kyc.review") && rolePermissions("compliance").includes("risk.resolve") &&
  rolePermissions("compliance").includes("audit.view") && !rolePermissions("compliance").includes("staff.manage"));
expect("support defaults are read-only + broadcasts",
  rolePermissions("support").includes("customers.view") && rolePermissions("support").includes("notifications.broadcast") &&
  !rolePermissions("support").includes("customers.adjust_balance") && !rolePermissions("support").includes("kyc.review"));

/* ---------- can() / assertCan() ---------- */
expect("superadmin can do anything", can("superadmin", "settings.manage") && can("superadmin", "staff.manage"));
expect("members have no admin permissions", !can("user", "dashboard.view") && !can(undefined, "customers.view"));
let threw = false;
try { assertCan("support", "customers.adjust_balance", "adjust balances"); } catch { threw = true; }
expect("assertCan throws for a missing grant", threw);
threw = false;
try { assertCan("compliance", "kyc.review", "review verification"); } catch { threw = true; }
expect("assertCan passes for a granted permission", !threw);

/* ---------- staff detection ---------- */
expect("isStaff recognises every staff role and rejects members",
  STAFF_ROLES.every(r => isStaff(r)) && !isStaff("user") && !isStaff(undefined));

/* ---------- server matrix (mirrors GET /api/admin/state) ---------- */
setServerRoleMatrix({
  support: ["dashboard.view", "customers.view"],
  compliance: ["kyc.review", "kyc.request"],
  admin: PERMISSIONS.filter(p => p !== "staff.manage"),
  superadmin: ["dashboard.view"], // even a hostile/odd payload cannot lock the superadmin out
});
expect("server matrix overrides defaults immediately", can("support", "dashboard.view") && !can("support", "accounts.view"));
expect("revoked grants disappear from can()", !can("compliance", "risk.resolve") && can("compliance", "kyc.review"));
expect("superadmin can never be locked out of the matrix", can("superadmin", "staff.manage"));
setServerRoleMatrix(null);
expect("clearing the matrix falls back to defaults", can("support", "accounts.view") && can("compliance", "risk.resolve"));

/* ---------- matrix self-heal (role changes load a fresh matrix) ---------- */
setServerRoleMatrix({ support: ["dashboard.view"] });
setServerRoleMatrix({ support: ROLE_DEFAULTS.support });
expect("re-installing the matrix replaces the previous grants", can("support", "notifications.broadcast"));
setServerRoleMatrix(null);

console.log(failures === 0 ? "\nALL PERMISSION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
if (failures > 0) process.exit(1);
