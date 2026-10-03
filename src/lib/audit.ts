/**
 * Append-only audit trail for every admin action.
 *
 * Stored under "veyra.audit" in localStorage. There is deliberately NO update
 * or delete API — logs can be read and exported, never edited. In production
 * this would be an immutable, server-side table (with hash chaining); the
 * shape here matches what that table needs.
 */
import { downloadFile } from "./store";

export type AuditAction =
  | "balance.adjust"
  | "account.status"
  | "kyc.request"
  | "kyc.approve"
  | "kyc.request_changes"
  | "card.freeze_override"
  | "dispute.resolve"
  | "staff.promote"
  | "staff.demote"
  | "roles.update"
  | "roles.reset"
  | "notification.broadcast"
  | "settings.save"
  | "system.halt"
  | "system.resume"
  | "report.export";

export type AuditEntry = {
  id: string;
  at: number;
  adminId: string;
  adminName: string;
  action: AuditAction;
  category: "Financial" | "KYC" | "Risk" | "Access" | "System" | "Comms";
  target: string; // "user:ID · Name" / "role:admin" / "platform"
  summary: string;
  before?: string;
  after?: string;
};

const AUDIT_KEY = "veyra.audit";
const MAX_ENTRIES = 500;

function read(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(e => e && typeof e.id === "string" && typeof e.at === "number") : [];
  } catch {
    return [];
  }
}

function persist(entries: AuditEntry[]) {
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage unavailable */
  }
}

const rid = () => `aud_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Appends an entry to the trail. Returns the stored entry. */
export function logAdminAction(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
  const record: AuditEntry = { ...entry, id: rid(), at: Date.now() };
  persist([record, ...read()]);
  return record;
}

/** Newest-first read of the audit trail. */
export function getAuditLogs(): AuditEntry[] {
  return read().sort((a, b) => b.at - a.at);
}

/** Seeds a small history so the trail demonstrates context (demo only). */
export function ensureAuditSeed(): void {
  if (read().length > 0) return;
  const now = Date.now();
  const H = 3600_000;
  const seed: Array<Omit<AuditEntry, "id">> = [
    {
      at: now - 26 * H, adminId: "superadmin-master", adminName: "Chief System Admin", action: "settings.save", category: "System",
      target: "platform", summary: "Updated core high-yield APY to 4.25%.", before: "4.10%", after: "4.25%",
    },
    {
      at: now - 49 * H, adminId: "superadmin-master", adminName: "Chief System Admin", action: "staff.promote", category: "Access",
      target: "user:compliance · Compliance Officer", summary: "Granted compliance officer access to Mira Osei.", before: "Member", after: "Compliance officer",
    },
    {
      at: now - 72 * H, adminId: "compliance", adminName: "Mira Osei", action: "kyc.approve", category: "KYC",
      target: "user:personal-demo · Alex Morgan", summary: "Approved identity verification.", before: "In review", after: "Approved",
    },
  ];
  persist(seed.map(e => ({ ...e, id: rid() })));
}

/** CSV export of the trail (newest first). */
export function exportAuditLogs(filename?: string): void {
  const rows = [["Timestamp", "Admin", "Action", "Category", "Target", "Summary", "Before", "After"] as const,
    ...getAuditLogs().map(e => [
      new Date(e.at).toISOString(), e.adminName, e.action, e.category, e.target, e.summary, e.before ?? "", e.after ?? "",
    ])];
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(filename ?? `veyra-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
}
