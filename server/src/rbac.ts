/**
 * Server-side RBAC — the authoritative permission source.
 *
 * Mirrors src/lib/permissions.ts (frontend mirror) but reads role overrides
 * from the role_permissions table. The client-side module is for UI gating
 * only; THIS file is what actually decides.
 */
import type { DatabaseSync } from "node:sqlite";

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
export type StaffRole = "support" | "compliance" | "admin" | "superadmin";
export type Role = "user" | StaffRole;

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

export const ROLE_LABELS: Record<Role, string> = {
  user: "Member",
  support: "Support agent",
  compliance: "Compliance officer",
  admin: "Administrator",
  superadmin: "Super Admin",
};

export function isStaffRole(role: string): role is StaffRole {
  return role === "support" || role === "compliance" || role === "admin" || role === "superadmin";
}

/** Effective permissions for a role: DB override if present, else defaults. Superadmin always everything. */
export function rolePermissions(db: DatabaseSync, role: StaffRole): Permission[] {
  if (role === "superadmin") return ALL;
  const row = db.prepare("SELECT permissions_json FROM role_permissions WHERE role = ?").get(role) as
    | { permissions_json: string }
    | undefined;
  if (row) {
    try {
      const list = JSON.parse(row.permissions_json) as string[];
      return list.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
    } catch {
      /* fall through to defaults */
    }
  }
  return ROLE_DEFAULTS[role];
}

export function can(db: DatabaseSync, role: string, permission: Permission): boolean {
  if (!isStaffRole(role)) return false;
  return rolePermissions(db, role).includes(permission);
}

/** Persists a permission override for a role (superadmin-only route). */
export function setRolePermissions(db: DatabaseSync, role: StaffRole, permissions: Permission[]): Permission[] {
  const clean = role === "superadmin" ? ALL : permissions.filter(p => (PERMISSIONS as readonly string[]).includes(p));
  db.prepare(
    "INSERT INTO role_permissions (role, permissions_json) VALUES (?, ?) " +
    "ON CONFLICT(role) DO UPDATE SET permissions_json = excluded.permissions_json",
  ).run(role, JSON.stringify(clean));
  return clean;
}

export function resetRolePermissions(db: DatabaseSync, role: StaffRole): Permission[] {
  db.prepare("DELETE FROM role_permissions WHERE role = ?").run(role);
  return rolePermissions(db, role);
}
