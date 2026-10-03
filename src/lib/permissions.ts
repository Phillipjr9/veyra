/**
 * Role-based access control for the Veyra admin console.
 *
 * Roles are stored on the existing User record (src/lib/auth.tsx) — no second
 * auth system. Permission grants per role live in localStorage ("veyra.rbac")
 * as overrides on top of ROLE_DEFAULTS, editable only by superadmins in the
 * Roles & Permissions module.
 *
 * NOTE: this demo has no backend, so enforcement happens in the store/action
 * layer via assertCan() — the closest analog to server-side checks. In
 * production these same checks must run on the server.
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

const RBAC_KEY = "veyra.rbac";

function readOverrides(): Partial<Record<StaffRole, Permission[]>> {
  try {
    const raw = localStorage.getItem(RBAC_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<StaffRole, Permission[]>>;
    const clean: Partial<Record<StaffRole, Permission[]>> = {};
    for (const role of STAFF_ROLES) {
      const list = parsed[role];
      if (Array.isArray(list)) clean[role] = list.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    }
    // Super Admin can never be locked out.
    clean.superadmin = ALL;
    return clean;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Partial<Record<StaffRole, Permission[]>>) {
  try {
    localStorage.setItem(RBAC_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable */
  }
}

/** Effective permission list for a staff role (defaults + stored overrides). */
export function rolePermissions(role: StaffRole): Permission[] {
  const overrides = readOverrides();
  return overrides[role] ?? ROLE_DEFAULTS[role];
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

/** Persists a permission override for a role. Superadmin-only operation. */
export function setRolePermissions(role: StaffRole, permissions: Permission[]): Permission[] {
  const overrides = readOverrides();
  const next = role === "superadmin" ? ALL : permissions.filter(p => (PERMISSIONS as readonly string[]).includes(p));
  overrides[role] = next;
  writeOverrides(overrides);
  return next;
}

/** Resets a role back to its default grants. */
export function resetRolePermissions(role: StaffRole): Permission[] {
  const overrides = readOverrides();
  delete overrides[role];
  writeOverrides(overrides);
  return rolePermissions(role);
}
