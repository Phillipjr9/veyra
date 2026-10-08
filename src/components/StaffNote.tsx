import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";

/** Staff roles are everything except the plain member role. */
export const isStaffUser = (user?: { role?: string } | null) => Boolean(user?.role && user.role !== "user");

/**
 * Operational status for administrators only ("not connected", "not configured",
 * "activation needed"). Members see nothing here: the control it describes is
 * simply absent or disabled, so there is no status to explain to them.
 */
export function StaffNote({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return isStaffUser(user) ? <>{children}</> : null;
}
