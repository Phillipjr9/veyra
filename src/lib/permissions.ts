/**
 * Role-based access control for the Veyra admin console.
 *
 * Roles live on the User record and are verified server-side on every admin
 * route. The console loads the live role matrix from GET /api/admin/state and
 * installs it via setServerRoleMatrix(), so can()/assertCan() here mirror
 * exactly what the server enforces. ROLE_DEFAULTS is only the pre-load
 * fallback; edits go through PUT /api/admin/roles (superadmin-only).
 */

export type StaffRole = "support" | "compliance" | "admin" | "superadmin";
export type Role = "user" | StaffRole;

export const STAFF_ROLES: StaffRole[] = ["support", "compliance", "admin", "superadmin"];

export const ROLE_LABELS: Record<Role, string> = {
  user: "Member",
  support: "Support agent",
  compliance: "Compliance officer",
  admin: "Administrator",
  superadmin: "Super Admin",
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  support: "Member-facing: views accounts and transactions, sends broadcasts.",
  compliance: "KYC review, risk & fraud queues, audit visibility.",
  admin: "Full operational control except staff and role management.",
  superadmin: "Highest permission level — everything, including staff & roles.",
};

/** Every permission used by the admin console. */
export const PERMISSIONS = [
  "dashboard.view",
  "customers.view",
  "customers.adjust_balance",
  "accounts.view",
  "accounts.set_status",
  "accounts.edit_number",
  "transactions.view",
  "transactions.export",
  "kyc.request",
  "kyc.review",
  "risk.view",
  "risk.resolve",
  "staff.manage",
  "roles.manage",
  "reports.view",
  "notifications.broadcast",
  "audit.view",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_DEFAULTS: Record<StaffRole, Permission[]> = {
  superadmin: ALL,
  admin: ALL.filter(p => p !== "staff.manage" && p !== "roles.manage"),
  compliance: [
    "dashboard.view", "customers.view", "accounts.view", "transactions.view",
    "transactions.export", "kyc.request", "kyc.review", "risk.view", "risk.resolve",
    "reports.view", "audit.view",
  ],
  support: [
    "dashboard.view", "customers.view", "accounts.view", "transactions.view",
    "notifications.broadcast",
  ],
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard.view": "View dashboard",
  "customers.view": "View customers",
  "customers.adjust_balance": "Credit / debit balances",
  "accounts.view": "View accounts",
  "accounts.set_status": "Restrict / restore accounts",
  "accounts.edit_number": "Edit bank details and funding methods",
  "transactions.view": "View transactions",
  "transactions.export": "Export transactions",
  "kyc.request": "Request verification",
  "kyc.review": "Approve / reject verification",
  "risk.view": "View risk & fraud",
  "risk.resolve": "Resolve disputes",
  "staff.manage": "Manage staff & roles assignment",
  "roles.manage": "Edit permission matrix",
  "reports.view": "Reports & exports",
  "notifications.broadcast": "Broadcast notifications",
  "audit.view": "View audit logs",
  "settings.manage": "Banking settings",
};

/**
 * Server-authoritative matrix (API mode). When the backend is reachable the
 * Super Admin console loads the live role matrix from /api/admin/state and
 * installs it here; can()/assertCan() then enforce exactly what the server
 * enforces on every admin route.
 */
let serverMatrix: Partial<Record<StaffRole, Permission[]>> | null = null;

export function setServerRoleMatrix(matrix: Partial<Record<StaffRole, Permission[]>> | null): void {
  serverMatrix = matrix
    ? Object.fromEntries(Object.entries(matrix).map(([role, list]) => [
        role,
        Array.isArray(list) ? (list as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)) : [],
      ]))
    : null;
  if (serverMatrix) serverMatrix.superadmin = [...PERMISSIONS];
}

/** Effective permission list for a staff role (server matrix, defaults before it loads). */
export function rolePermissions(role: StaffRole): Permission[] {
  return serverMatrix?.[role] ?? ROLE_DEFAULTS[role];
}

/** True when the role has the permission. Super Admin always passes. */
export function can(role: Role | undefined, permission: Permission): boolean {
  if (role === "superadmin") return true;
  if (!role || role === "user") return false;
  return rolePermissions(role).includes(permission);
}

/**
 * Enforcement point for sensitive operations — the "server-side check" analog.
 * Throws instead of returning false so a missing guard fails loudly.
 */
export function assertCan(role: Role | undefined, permission: Permission, action = "perform this action"): void {
  if (!can(role, permission)) {
    throw new Error(`Access denied — your role does not permit you to ${action}.`);
  }
}

export function isStaff(role: Role | undefined): boolean {
  return role !== undefined && role !== "user";
}

