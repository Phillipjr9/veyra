import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  Activity, AlertCircle, AlertTriangle, BadgeCheck, Bell, Check, Download, FileText, Hash,
  Landmark, Lock, LogOut, Mail, Megaphone, RefreshCw, ScrollText, Search, ShieldAlert, ShieldCheck,
  TrendingUp, UserCheck, UserRound, Users, Wallet, X, XCircle,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAuth, type User, type UserRole } from "../lib/auth";
import { apiGet, apiGetText, apiPatch, apiPost, apiPut } from "../lib/api";
import {
  money, longDate, downloadFile,
  type KycQueueItem, type KycRequirement, type PlatformAccount, type Txn, type Dispute, type ReviewRequirement,
} from "../lib/store";
import {
  can, assertCan, isStaff, STAFF_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS,
  rolePermissions, setServerRoleMatrix,
  PERMISSIONS, PERMISSION_LABELS, type Permission, type Role, type StaffRole,
} from "../lib/permissions";
import { useToast } from "../components/Toast";
import { AdminShell } from "./dashboards/AdminShell";

type AdminUser = User & { role?: UserRole };

/**
 * One member's account application, exactly as they submitted it at sign-up.
 * Staff with customers.view see every field, including the full SSN/EIN —
 * that is the point: compliance has to review the identity behind an account.
 */
type MemberIdentity = {
  firstName: string; middleName: string; lastName: string;
  dob: string; ssn: string; citizenship: string; phone: string; email: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; country: string;
  idType: string; idNumber: string; idIssuer: string; idExpiry: string;
  occupation: string; employer: string; incomeRange: string; sourceOfFunds: string;
  legalName?: string; dba?: string; ein?: string; businessType?: string; formationState?: string;
  formationDate?: string; industry?: string; website?: string; monthlyVolume?: string;
  bizAddressLine1?: string; bizAddressLine2?: string; bizCity?: string; bizState?: string;
  bizPostalCode?: string; bizCountry?: string;
  ownerName?: string; ownerTitle?: string; ownerDob?: string; ownerSsn?: string; ownerOwnership?: number;
  submittedAt?: number | null;
};
type TabId =
  | "dashboard" | "customers" | "accounts" | "transactions" | "kyc" | "risk"
  | "staff" | "roles" | "reports" | "notifications" | "audit" | "settings" | "profile";

const MODULES: Array<{ id: TabId; label: string; icon: React.ReactNode; perm?: Permission }> = [
  { id: "dashboard", label: "Dashboard", icon: <Activity size={15} />, perm: "dashboard.view" },
  { id: "customers", label: "Customers", icon: <Users size={15} />, perm: "customers.view" },
  { id: "accounts", label: "Accounts", icon: <Landmark size={15} />, perm: "accounts.view" },
  { id: "transactions", label: "Transactions", icon: <FileText size={15} />, perm: "transactions.view" },
  { id: "kyc", label: "KYC", icon: <UserCheck size={15} />, perm: "kyc.review" },
  { id: "risk", label: "Risk & Fraud", icon: <ShieldAlert size={15} />, perm: "risk.view" },
  { id: "staff", label: "Staff", icon: <UserRound size={15} />, perm: "staff.manage" },
  { id: "roles", label: "Roles & Permissions", icon: <Lock size={15} />, perm: "roles.manage" },
  { id: "reports", label: "Reports", icon: <Download size={15} />, perm: "reports.view" },
  { id: "notifications", label: "Notifications", icon: <Megaphone size={15} />, perm: "notifications.broadcast" },
  { id: "audit", label: "Audit Logs", icon: <ScrollText size={15} />, perm: "audit.view" },
  { id: "settings", label: "Banking Settings", icon: <ShieldCheck size={15} />, perm: "settings.manage" },
  { id: "profile", label: "Admin Profile", icon: <UserRound size={15} /> },
];

const ago = (ts: number) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/** Audit entry as served by GET /api/admin/state (append-only, server-side). */
type AuditEntry = {
  id: string;
  at: number;
  adminId: string;
  adminName: string;
  action: string;
  category: string;
  target: string;
  summary: string;
  before?: string;
  after?: string;
};

/** Aggregate admin state served by GET /api/admin/state. */
type AdminServerState = {
  users: Array<{ id: string; name: string; email: string; phone: string; business: string; accountType: "personal" | "business"; avatarUrl: string; role: string; plan: "Starter" | "Pro"; createdAt: number }>;
  accounts: PlatformAccount[];
  transactions: Array<Txn & { userId: string; memberName: string }>;
  disputes: Array<Dispute & { userId: string; memberName: string }>;
  kycQueue: KycQueueItem[];
  audit: AuditEntry[];
  roles: Record<string, Permission[]>;
  settings: Record<string, string>;
};

export function SuperAdminPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // Route protection — staff roles only (the member dashboard redirects others).
  if (!isStaff(user?.role)) return <Navigate to="/app" replace />;

  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  // Backend API health (real Express + SQLite server — see server/)
  const [apiHealth, setApiHealth] = useState<"checking" | "online" | "offline">("checking");
  const [apiUptime, setApiUptime] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch("/api/health", { signal: ctrl.signal });
        clearTimeout(timer);
        const body = await res.json();
        if (!cancelled) {
          setApiHealth(res.ok && body?.ok ? "online" : "offline");
          setApiUptime(typeof body?.uptimeSec === "number" ? body.uptimeSec : null);
        }
      } catch {
        if (!cancelled) { setApiHealth("offline"); setApiUptime(null); }
      }
    };
    ping();
    const iv = setInterval(ping, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Customers
  const [searchTerm, setSearchTerm] = useState("");
  // Transactions
  const [txnFilter, setTxnFilter] = useState<"all" | "in" | "out" | "pending">("all");
  // Balance adjustment
  const [adjustModal, setAdjustModal] = useState(false);
  const [targetUser, setTargetUser] = useState<AdminUser | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<"credit" | "debit">("credit");
  const [adjustKind, setAdjustKind] = useState("direct_deposit");
  const [adjustMemo, setAdjustMemo] = useState("");
  // Account number (the 12-digit number the member's money is addressed to)
  const [acctModal, setAcctModal] = useState(false);
  const [acctNumber, setAcctNumber] = useState("");
  const [acctSaving, setAcctSaving] = useState(false);
  // KYC
  const [kycModal, setKycModal] = useState(false);
  const [kycReqs, setKycReqs] = useState<KycRequirement[]>(["identity", "address"]);
  const [kycReason, setKycReason] = useState("");
  const [kycReview, setKycReview] = useState<KycQueueItem | null>(null);
  // The member whose full account application is open (loaded on demand from
  // /api/admin/members/:id so the console never loads every application at once).
  const [identityUser, setIdentityUser] = useState<AdminUser | null>(null);
  const [identityData, setIdentityData] = useState<MemberIdentity | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [kycDecisionNote, setKycDecisionNote] = useState("");
  // What we are asking the applicant for. Only used by "request information".
  // Starts empty on purpose: a pre-ticked list is easy to send by accident, and
  // whatever is ticked is exactly what the applicant is asked to produce.
  const [kycReqsFor, setKycReqsFor] = useState<ReviewRequirement[]>([]);
  const REQUEST_ITEMS: Array<{ key: ReviewRequirement; label: string; detail: string }> = [
    { key: "identity", label: "Photo ID", detail: "Passport, licence or state ID" },
    { key: "address", label: "Proof of address", detail: "Bill or statement, last 3 months" },
    { key: "selfie", label: "Selfie with ID", detail: "Face and document in one photo" },
    { key: "funds", label: "Proof of funds", detail: "Where the money comes from" },
  ];
  // Account status
  const [statusConfirm, setStatusConfirm] = useState<{ target: PlatformAccount; status: "active" | "restricted" } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  // Staff
  const [staffConfirm, setStaffConfirm] = useState<{ userId: string; name: string; role: Role } | null>(null);
  // Roles matrix
  const [matrixDraft, setMatrixDraft] = useState<Record<string, Permission[]> | null>(null);
  // Broadcast
  const [broadcast, setBroadcast] = useState({ title: "", detail: "", audience: "all" as "all" | "business" | "personal" | "unverified" });
  const [broadcastConfirm, setBroadcastConfirm] = useState(false);
  // Audit
  const [auditSearch, setAuditSearch] = useState("");
  const [auditCategory, setAuditCategory] = useState<"all" | "Financial" | "KYC" | "Risk" | "Access" | "System" | "Comms">("all");
  // Settings
  const [interestRate, setInterestRate] = useState("4.25");
  const [systemFrozen, setSystemFrozen] = useState(false);
  const [haltConfirm, setHaltConfirm] = useState(false);

  // The backend is the system of record — load the aggregate admin state and
  // install the server's role matrix so can() matches server enforcement.
  const [adminData, setAdminData] = useState<AdminServerState | null>(null);
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<AdminServerState>("/api/admin/state")
      .then(data => {
        if (cancelled) return;
        setAdminData(data);
        setAdminLoadError(null);
        setServerRoleMatrix(data.roles as Partial<Record<StaffRole, Permission[]>>);
        setInterestRate(data.settings.core_apy ?? "4.25");
        setSystemFrozen(data.settings.payment_rails === "halted");
      })
      .catch(err => {
        if (!cancelled) setAdminLoadError(err instanceof Error ? err.message : "Could not load platform data.");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const role = (user?.role ?? "user") as Role;
  const allow = (perm: Permission) => can(role, perm);
  const guard = (perm: Permission, action: string): boolean => {
    try { assertCan(role, perm, action); return true; }
    catch (err) {
      toast({ tone: "error", title: "Permission denied", description: err instanceof Error ? err.message : "Access denied." });
      return false;
    }
  };
  // Every admin route writes the append-only audit trail server-side — there is
  // deliberately no client-side audit writer.

  /* ---------------- platform data (server snapshot) ---------------- */
  const users: AdminUser[] = adminData ? (adminData.users as AdminUser[]) : [];
  const members = useMemo(() => users.filter(u => (u.role ?? "user") === "user"), [users]);
  const staff = useMemo(() => users.filter(u => u.role && u.role !== "user"), [users]);
  const accounts: PlatformAccount[] = adminData ? adminData.accounts : [];
  const allTxns: Array<Txn & { userId: string; memberName: string }> = adminData ? adminData.transactions : [];
  const disputes: Array<Dispute & { userId: string; memberName: string }> = adminData ? adminData.disputes : [];
  const kycQueue: KycQueueItem[] = adminData ? adminData.kycQueue : [];
  const auditLogs: AuditEntry[] = adminData ? adminData.audit : [];

  const accountBy = (userId: string) => accounts.find(a => a.userId === userId);
  const openDisputes = disputes.filter(d => d.status !== "resolved" && d.status !== "denied");
  const totals = useMemo(() => ({
    customers: members.length,
    openAccounts: accounts.filter(a => a.hasAccount).length,
    balances: accounts.reduce((s, a) => s + a.balance, 0),
    pending: accounts.reduce((s, a) => s + a.pendingBalance, 0),
    txns: allTxns.length,
    pendingTxns: allTxns.filter(t => t.status === "pending").length,
    kycPending: kycQueue.length + accounts.filter(a => a.kycStatus === "requested").length,
    riskAlerts: openDisputes.length + accounts.filter(a => a.accountStatus === "restricted").length,
    restricted: accounts.filter(a => a.accountStatus === "restricted").length,
  }), [members, accounts, allTxns, kycQueue, openDisputes]);

  const visibleModules = MODULES.filter(m => !m.perm || allow(m.perm));
  const moduleCount = (id: TabId) =>
    id === "customers" ? members.length
    : id === "kyc" ? kycQueue.length
    : id === "risk" ? openDisputes.length
    : id === "audit" ? auditLogs.length
    : undefined;

  /* ---------------- handlers (every mutation: permission check → action → audit → notify) ---------------- */

  const adjustmentOptions = [
    { id: "direct_deposit", label: "Direct deposit", credit: true, debit: false },
    { id: "payroll", label: "Payroll", credit: true, debit: false },
    { id: "ach_transfer", label: "ACH transfer", credit: true, debit: false },
    { id: "wire_transfer", label: "Wire transfer", credit: true, debit: true },
    { id: "refund", label: "Refund", credit: true, debit: false },
    { id: "bonus_payout", label: "Bonus payout", credit: true, debit: false },
    { id: "vendor_settlement", label: "Vendor settlement", credit: true, debit: false },
    { id: "fee_reversal", label: "Fee reversal", credit: true, debit: false },
    { id: "manual_adjustment", label: "Manual adjustment", credit: true, debit: true },
    { id: "ach_withdrawal", label: "ACH withdrawal", credit: false, debit: true },
    { id: "clawback", label: "Clawback", credit: false, debit: true },
    { id: "treasury_top_up", label: "Treasury top up", credit: true, debit: false },
  ] as const;

  const validAdjustmentOptions = adjustmentOptions.filter(option =>
    adjustType === "credit" ? option.credit : option.debit,
  );

  const fallbackAdjustment = adjustType === "credit"
    ? "Direct deposit"
    : "ACH withdrawal";

  const activeAdjustment = validAdjustmentOptions.find(option => option.id === adjustKind) ?? {
    id: adjustType === "credit" ? "direct_deposit" : "ach_withdrawal",
    label: fallbackAdjustment,
    credit: adjustType === "credit",
    debit: adjustType === "debit",
  };

  const handleCommitAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(adjustAmount);
    if (!val || val <= 0 || !targetUser) return;
    if (!guard("customers.adjust_balance", "adjust balances")) return;
    const description = activeAdjustment.label || fallbackAdjustment;
    const memo = adjustMemo.trim();
          apiPost<{ before: { amount: string }; after: { amount: string } }>(`/api/admin/members/${targetUser.id}/adjust`, {
            direction: adjustType,
            amount: val,
            description,
            memo: memo || description,
          })
        .then(r => {
          toast({ tone: "success", title: "Ledger adjustment committed", description: `${targetUser.name}: $${r.before.amount} → $${r.after.amount} · ${description} recorded on their statement.` });
          setAdjustModal(false); setAdjustAmount(""); setAdjustKind("direct_deposit"); setAdjustMemo(""); refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Adjustment failed", description: err.message }));
  };

  const openAccountNumber = (u: AdminUser) => {
    setTargetUser(u);
    setAcctNumber(accountBy(u.id)?.accountNumber ?? "");
    setAcctModal(true);
  };

  const handleSaveAccountNumber = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;
    if (!guard("accounts.edit_number", "edit account numbers")) return;
    const digits = acctNumber.replace(/[\s-]/g, "");
    if (!/^\d{12}$/.test(digits)) {
      toast({ tone: "error", title: "Account number not saved", description: "An account number is exactly 12 digits." });
      return;
    }
    setAcctSaving(true);
    apiPatch<{ accountNumber: string; changed: boolean }>(`/api/admin/members/${targetUser.id}/account-number`, { accountNumber: digits })
      .then(r => {
        toast({
          tone: "success",
          title: r.changed ? "Account number updated" : "Account number unchanged",
          description: r.changed
            ? `${targetUser.name} is now addressed as ${r.accountNumber}. The change is on the audit trail.`
            : `${targetUser.name} already had ${r.accountNumber}.`,
        });
        setAcctModal(false); setAcctNumber(""); refresh();
      })
      .catch((err: Error) => toast({ tone: "error", title: "Account number not saved", description: err.message }))
      .finally(() => setAcctSaving(false));
  };

  const handleRequestKyc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUser) return;
    if (!guard("kyc.request", "request verification")) return;
          apiPost(`/api/admin/kyc/request`, { userId: targetUser.id, requirements: kycReqs, reason: kycReason.trim() || "Identity verification is required to lift your account limits." })
        .then(() => {
          setKycModal(false); setKycReason("");
          toast({ tone: "success", title: "Verification request sent", description: `${targetUser.name} will see the alert on their dashboard.` });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Request failed", description: err.message }));
  };

  /**
   * Three outcomes, all recorded against the application and shown to the member:
   * approve (they get their dashboard), request information (a hold, usually
   * because something needs checking) or reject.
   */
  const handleKycDecision = (decision: "approved" | "needs_attention" | "rejected") => {
    if (!kycReview) return;
    if (!guard("kyc.review", "review applications")) return;
    const note = kycDecisionNote.trim();
    if (decision !== "approved" && !note) {
      toast({ tone: "error", title: "Add a reason first", description: "The applicant is shown exactly what you write here." });
      return;
    }
    if (decision === "needs_attention" && kycReqsFor.length === 0) {
      toast({ tone: "error", title: "Pick at least one item", description: "Choose what you need from the applicant." });
      return;
    }
    apiPost(`/api/admin/kyc/${kycReview.userId}/decision`, {
      decision, note, requirements: decision === "needs_attention" ? kycReqsFor : [],
    })
      .then(() => {
        toast({
          tone: decision === "approved" ? "success" : decision === "rejected" ? "error" : "info",
          title: decision === "approved" ? "Account approved" : decision === "rejected" ? "Application rejected" : "Information requested",
          description: decision === "approved"
            ? `${kycReview.name} now has full access to their dashboard.`
            : `${kycReview.name} has been notified.`,
        });
        setKycReview(null); setKycDecisionNote(""); refresh();
      })
      .catch((err: Error) => toast({ tone: "error", title: "Decision failed", description: err.message }));
  };

  const openIdentity = (u: AdminUser) => {
    setIdentityUser(u);
    setIdentityData(null);
    setIdentityError(null);
    apiGet<{ identity: MemberIdentity | null }>(`/api/admin/members/${u.id}`)
      .then(r => setIdentityData(r.identity))
      .catch((err: Error) => setIdentityError(err.message));
  };

  const handleStatusConfirm = () => {
    if (!statusConfirm) return;
    if (!guard("accounts.set_status", "change account status")) return;
    const { target, status } = statusConfirm;
          apiPost(`/api/admin/members/${target.userId}/status`, { status, reason: statusReason || "Reviewed by compliance." })
        .then(() => {
          toast({ tone: status === "restricted" ? "info" : "success", title: status === "restricted" ? "Account restricted" : "Account restored", description: `${target.name} has been notified.` });
          setStatusConfirm(null); setStatusReason(""); refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Status change failed", description: err.message }));
  };

  const handleResolveDispute = (name: string, disputeId: string, merchant: string) => {
    if (!guard("risk.resolve", "resolve disputes")) return;
          apiPost<{ status: string }>(`/api/admin/risk/disputes/${disputeId}/advance`)
        .then(r => {
          const resolved = r.status === "resolved";
          toast({ tone: resolved ? "success" : "info", title: resolved ? "Dispute resolved" : "Dispute under review", description: `${merchant} · ${name}` });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Action failed", description: err.message }));
  };

  const handleStaffConfirm = () => {
    if (!staffConfirm) return;
    if (!guard("staff.manage", "manage staff")) return;
          apiPost(`/api/admin/staff/${staffConfirm.userId}/role`, { role: staffConfirm.role })
        .then(() => {
          toast({ tone: "success", title: "Role updated", description: `${staffConfirm.name} is now ${ROLE_LABELS[staffConfirm.role]}.` });
          setStaffConfirm(null); refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Role change failed", description: err.message }));
  };

  const handleSaveMatrix = () => {
    if (!guard("roles.manage", "edit the permission matrix")) return;
    if (!matrixDraft) return;
          Promise.all(STAFF_ROLES.filter(r => r !== "superadmin")
        .filter(r => (matrixDraft[r] ?? rolePermissions(r)).join() !== rolePermissions(r).join())
        .map(r => apiPut("/api/admin/roles", { role: r, permissions: matrixDraft[r] ?? rolePermissions(r) })))
        .then(() => {
          setMatrixDraft(null);
          toast({ tone: "success", title: "Permission matrix saved", description: "Role grants updated — the server enforces them immediately." });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Save failed", description: err.message }));
  };

  const handleResetRole = (r: StaffRole) => {
    if (!guard("roles.manage", "edit the permission matrix")) return;
          apiPost("/api/admin/roles/reset", { role: r })
        .then(() => {
          setMatrixDraft(null);
          toast({ tone: "info", title: `${ROLE_LABELS[r]} reset`, description: "Default permissions restored." });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Reset failed", description: err.message }));
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcast.title.trim() || !broadcast.detail.trim()) return;
    setBroadcastConfirm(true);
  };
  const commitBroadcast = () => {
    if (!guard("notifications.broadcast", "send broadcasts")) return;
          apiPost<{ delivered: number }>("/api/admin/broadcasts", { title: broadcast.title.trim(), detail: broadcast.detail.trim(), audience: broadcast.audience })
        .then(r => {
          toast({ tone: "success", title: "Broadcast sent", description: `Delivered to ${r.delivered} member${r.delivered === 1 ? "" : "s"} in-app.` });
          setBroadcast({ title: "", detail: "", audience: "all" }); setBroadcastConfirm(false); refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Broadcast failed", description: err.message }));
  };

  /**
   * Every export is generated server-side from the database in full (the
   * console snapshot only carries a window of the ledger). Each download needs
   * the permission its route enforces, so the guard below mirrors the API.
   */
  const EXPORTS = {
    customers: { permissions: ["reports.view"], path: "/api/admin/reports/customers.csv", file: "veyra-customers" },
    accounts: { permissions: ["reports.view"], path: "/api/admin/reports/accounts.csv", file: "veyra-accounts" },
    // The ledger export serves the Reports tab and the Transactions console,
    // and the route accepts either permission (transactions.export opens only
    // this file — the directory, balances and KYC exports stay reports.view).
    transactions: { permissions: ["reports.view", "transactions.export"], path: "/api/admin/reports/transactions.csv", file: "veyra-ledger" },
    kyc: { permissions: ["reports.view"], path: "/api/admin/reports/kyc.csv", file: "veyra-kyc" },
    audit: { permissions: ["audit.view"], path: "/api/admin/audit/export.csv", file: "veyra-audit" },
  } as const satisfies Record<string, { permissions: readonly Permission[]; path: string; file: string }>;

  const handleExport = async (kind: keyof typeof EXPORTS) => {
    const spec = EXPORTS[kind];
    if (!spec.permissions.some(allow)) {
      toast({ tone: "error", title: "Permission denied", description: `Exporting this data requires the ${spec.permissions.join(" or ")} permission.` });
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    try {
      const csvText = await apiGetText(spec.path);
      downloadFile(`${spec.file}-${date}.csv`, csvText, "text/csv");
    } catch (err) {
      toast({ tone: "error", title: "Export failed", description: err instanceof Error ? err.message : "The export couldn't be downloaded." });
      return;
    }
    toast({ tone: "success", title: "Export ready", description: `${kind[0].toUpperCase() + kind.slice(1)} CSV downloaded.` });
  };

  const handleSaveSettings = () => {
    if (!guard("settings.manage", "change banking settings")) return;
          apiPut("/api/admin/settings", { coreApy: interestRate })
        .then(() => {
          toast({ tone: "success", title: "System parameters saved", description: `Core treasury yield updated to ${interestRate}%.` });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Save failed", description: err.message }));
  };

  const handleHaltToggle = () => {
    if (!guard("settings.manage", "change banking settings")) return;
    const next = !systemFrozen;
          apiPut("/api/admin/settings", { paymentRails: next ? "halted" : "operational" })
        .then(() => {
          setSystemFrozen(next);
          setHaltConfirm(false);
          toast({ tone: next ? "error" : "success", title: next ? "EMERGENCY: Payment rails halted" : "Core payment gateway resumed", description: next ? "All outgoing wire and card authorizations paused." : "All transaction flows operational." });
          refresh();
        })
        .catch((err: Error) => toast({ tone: "error", title: "Action failed", description: err.message }));
  };

  const filteredMembers = members.filter(u => {
    const q = searchTerm.toLowerCase();
    const app = accountBy(u.id);
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
      u.business.toLowerCase().includes(q) || (app?.dob ?? "").includes(q) || (app?.ssn ?? "").includes(q);
  });
  const filteredTxns = allTxns.filter(t =>
    txnFilter === "all" ? true
    : txnFilter === "in" ? t.amount > 0
    : txnFilter === "out" ? t.amount < 0
    : t.status === "pending"
  );
  const filteredAudit = auditLogs.filter(l =>
    (auditCategory === "all" || l.category === auditCategory) &&
    (auditSearch.trim() === "" || `${l.adminName} ${l.action} ${l.target} ${l.summary}`.toLowerCase().includes(auditSearch.toLowerCase()))
  );
  const broadcastHistory = auditLogs.filter(l => l.action === "notification.broadcast").slice(0, 6);

  const kycChip = (status: string) =>
    <span className={`status-pill ${status === "approved" ? "paid" : status === "in_review" ? "active" : status === "requested" || status === "needs_attention" ? "overdue" : "open"}`}>
      <span className="dot" />{status === "not_started" ? "unverified" : status.replace("_", " ")}
    </span>;

  const activeMatrix = matrixDraft ?? Object.fromEntries(STAFF_ROLES.map(r => [r, rolePermissions(r)])) as Record<StaffRole, Permission[]>;

  const adminNetFlow = [
    { month: "Jan", inflow: 82000, outflow: 46000 },
    { month: "Feb", inflow: 90000, outflow: 50000 },
    { month: "Mar", inflow: 98000, outflow: 53000 },
    { month: "Apr", inflow: 101000, outflow: 56000 },
    { month: "May", inflow: 112000, outflow: 61000 },
    { month: "Jun", inflow: 125000, outflow: 67000 },
  ];

  const channelMix = [
    { name: "Card", value: 44, color: "#7558dc" },
    { name: "ACH", value: 27, color: "#8fd3a4" },
    { name: "Wire", value: 18, color: "#f0bf6a" },
    { name: "Other", value: 11, color: "#c6d0ff" },
  ];

  return (
    <AdminShell
      user={{ name: user?.name ?? "", email: user?.email ?? "", avatarUrl: user?.avatarUrl }}
      roleLabel={ROLE_LABELS[role]}
      modules={visibleModules.map(({ id, label, icon }) => ({ id, label, icon, count: moduleCount(id) }))}
      activeTab={activeTab}
      onSelect={id => { setActiveTab(id as TabId); setMatrixDraft(null); }}
      onSignOut={() => { logout(); navigate("/"); }}
      health={apiHealth}
      uptimeSec={apiUptime}
    >
      <div className="superadmin-page">

      {/* Backend down / unauthorized — the console is API-only */}
      {adminLoadError && (
        <div className="panel admin-panel" role="alert" style={{ borderColor: "rgba(180,60,60,.4)" }}>
          <div className="panel-head">
            <div>
              <h2>Can't load platform data</h2>
              <span className="panel-sub">{adminLoadError}</span>
            </div>
            <button type="button" className="ghost-btn sm" onClick={refresh}><RefreshCw size={14} /> Retry</button>
          </div>
        </div>
      )}

      {/* ============================ DASHBOARD ============================ */}
      {activeTab === "dashboard" && !adminLoadError && (
        <div className="admin-tab-pane">
          <div className="admin-kpi-grid">
            {([
              ["Total customers", totals.customers, <Users size={12} />, "Personal & business members"],
              ["Open accounts", totals.openAccounts, <Landmark size={12} />, `${totals.restricted} restricted`],
              ["Total balances", money(totals.balances, false), <Wallet size={12} />, `+ ${money(totals.pending, false)} pending`],
              ["Transactions", totals.txns, <FileText size={12} />, `${totals.pendingTxns} pending`],
              ["KYC pending", totals.kycPending, <UserCheck size={12} />, "Requests + queue"],
              ["Risk alerts", totals.riskAlerts, <ShieldAlert size={12} />, `${openDisputes.length} disputes · ${totals.restricted} restricted`],
            ] as Array<[string, string | number, React.ReactNode, string]>).map(([label, value, icon, sub]) => (
              <div
                className={`admin-kpi-card ${label === "Total balances" ? "featured" : ""}`}
                key={label}
              >
                <span className="kpi-label">{label}</span>
                <strong className={`kpi-val ${label === "Risk alerts" && Number(totals.riskAlerts) > 0 ? "warn-red" : ""}`}>{value}</strong>
                <small className="kpi-sub">{icon} {sub}</small>
              </div>
            ))}
          </div>

          <div className="admin-chart-grid">
            <div className="admin-chart-panel admin-chart-main">
              <div className="chart-panel-head">
                <div>
                  <span className="chart-panel-kicker">Cash flow</span>
                  <h3>Net inflow vs operating outflow</h3>
                </div>
                <span className="chart-panel-badge positive">+18.4% QoQ</span>
              </div>
              <div className="chart-panel-body">
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={adminNetFlow} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="netflow-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#7558dc" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#7558dc" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(24, 23, 29, 0.08)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#716e78" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#716e78" }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                    <Tooltip
                      formatter={(value, name) => [money(Number(value), false), name === "inflow" ? "Inflow" : "Outflow"]}
                      contentStyle={{ borderRadius: 12, border: "1px solid rgba(24,23,29,.12)", background: "rgba(255,255,255,.96)", boxShadow: "0 18px 38px rgba(24,23,29,.12)" }}
                    />
                    <Area type="monotone" dataKey="outflow" stackId="1" stroke="#c2b4ff" strokeWidth={2.2} fill="rgba(117,88,220,0.14)" />
                    <Area type="monotone" dataKey="inflow" stackId="2" stroke="#7558dc" strokeWidth={2.5} fill="url(#netflow-fill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="admin-chart-panel">
              <div className="chart-panel-head">
                <div>
                  <span className="chart-panel-kicker">Funding mix</span>
                  <h3>Volume by channel</h3>
                </div>
              </div>
              <div className="chart-panel-body chart-panel-compact">
                <div className="admin-pie-wrap">
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={channelMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={58} paddingAngle={3}>
                        {channelMix.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [`${Number(value)}%`, "Share"]}
                        contentStyle={{ borderRadius: 12, border: "1px solid rgba(24,23,29,.12)", background: "rgba(255,255,255,.96)" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="admin-mix-legend">
                  {channelMix.map((item) => (
                    <div key={item.name} className="admin-mix-item">
                      <span className="admin-mix-dot" style={{ background: item.color }} />
                      <span>{item.name}</span>
                      <strong>{item.value}%</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={`admin-api-strip ${apiHealth === "offline" ? "offline" : ""}`} role="status">
            <span className={`status-pill ${apiHealth === "online" ? "active" : apiHealth === "offline" ? "overdue" : ""}`}>
              <span className="dot" />
              {apiHealth === "online" ? "API online" : apiHealth === "offline" ? "API offline" : "Checking…"}
            </span>
            <div className="admin-api-copy">
              <strong>Veyra API · Express + SQLite</strong>
              <small>
                {apiHealth === "online"
                  ? `Real backend connected${apiUptime != null ? ` · up ${apiUptime >= 3600 ? `${Math.floor(apiUptime / 3600)}h ` : apiUptime >= 60 ? `${Math.floor(apiUptime / 60)}m ` : ""}${apiUptime % 60 < 60 ? `${apiUptime % 60}s` : ""} · server-side auth, RBAC & audit` : ""}`
                  : apiHealth === "offline"
                    ? "Backend unreachable — reconnecting. All admin actions require the live API."
                    : "Reaching the backend…"}
              </small>
            </div>
            {apiHealth === "online" && <Landmark size={16} style={{ color: "var(--green)", marginLeft: "auto", flexShrink: 0 }} />}
          </div>

          <div className="admin-grid-split">
            <section className="panel admin-panel">
              <div className="panel-head">
                <div>
                  <h2>Recent admin activity</h2>
                  <span className="panel-sub">Every action is written to the immutable audit trail</span>
                </div>
                {allow("audit.view") && <button type="button" className="ghost-btn sm" onClick={() => setActiveTab("audit")}>View all</button>}
              </div>
              {auditLogs.length > 0 ? (
                <div className="admin-activity-list">
                  {auditLogs.slice(0, 6).map(l => (
                    <div className="admin-activity-row" key={l.id}>
                      <span className="admin-activity-cat">{l.category}</span>
                      <div>
                        <strong>{l.summary}</strong>
                        <small>{l.adminName} · {ago(l.at)} {l.before || l.after ? `· ${l.before ?? "—"} → ${l.after ?? "—"}` : ""}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state"><ScrollText size={24} /><strong>No admin activity yet</strong><p>Actions you take will appear here and in the audit trail.</p></div>}
            </section>

            <section className="panel admin-panel">
              <div className="panel-head">
                <div>
                  <h2>Recent platform transactions</h2>
                  <span className="panel-sub">Live from every member ledger</span>
                </div>
                {allow("transactions.view") && <button type="button" className="ghost-btn sm" onClick={() => setActiveTab("transactions")}>View all</button>}
              </div>
              {allTxns.length > 0 ? (
                <div className="admin-activity-list">
                  {allTxns.slice(0, 6).map(t => (
                    <div className="admin-activity-row" key={t.id}>
                      <span className={`admin-activity-cat ${t.amount < 0 ? "t-out" : "t-in"}`}>{t.amount < 0 ? "OUT" : "IN"}</span>
                      <div>
                        <strong>{t.merchant} · {money(Math.abs(t.amount))}</strong>
                        <small>{t.memberName} · {ago(t.date)} · {t.method ?? "Card"}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state"><TrendingUp size={24} /><strong>No member activity yet</strong><p>Member transactions will appear here in real time.</p></div>}
            </section>
          </div>
        </div>
      )}

      {/* ============================ CUSTOMERS ============================ */}
      {activeTab === "customers" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Customer directory</h2>
                <span className="panel-sub">{members.length} members · balances, KYC and treasury actions</span>
              </div>
              {allow("reports.view") && <button type="button" className="ghost-btn sm" onClick={() => handleExport("customers")}><Download size={13} /> Export CSV</button>}
            </div>
            <div className="admin-search-wrap" style={{ maxWidth: 340 }}>
              <Search size={14} />
              <input placeholder="Filter by name, email or business…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th><th>Type</th><th>Contact</th><th>Business</th>
                    <th>Date of birth</th><th>SSN</th><th>Address</th><th>ID document</th>
                    <th>Balance</th><th>KYC</th><th className="ta-r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(u => {
                    const acct = accountBy(u.id);
                    return (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.name}</strong><br />
                          <small><code>{u.id}</code></small><br />
                          <small className="acct-number-line">
                            Acct <code>{acct?.accountNumber ?? "—"}</code>
                          </small>
                        </td>
                        <td><span className={`chip ${u.accountType === "personal" ? "chip-green" : "chip-violet"}`}>{u.accountType.toUpperCase()}</span></td>
                        <td><small>{u.email}<br />{u.phone || "—"}</small></td>
                        <td><small>{u.business || "Personal account"}</small></td>
                        <td className="id-cell"><small>{acct?.dob ?? "—"}</small></td>
                        <td className="id-cell"><small><code>{acct?.ssn ?? "—"}</code></small></td>
                        <td className="id-cell"><small>{acct?.city ? `${acct.city}, ${acct.state ?? ""}` : "—"}</small></td>
                        <td className="id-cell"><small>{acct?.idType ?? "—"}</small></td>
                        <td><strong>{acct ? money(acct.balance) : "—"}</strong></td>
                        <td>{kycChip(acct?.kycStatus ?? "not_started")}</td>
                        <td className="ta-r">
                          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                            <button type="button" className="ghost-btn sm" onClick={() => openIdentity(u)}><FileText size={13} /> Application</button>
                            {allow("customers.adjust_balance") && (
                              <button type="button" className="solid-btn sm" onClick={() => { setTargetUser(u); setAdjustType("credit"); setAdjustModal(true); }}>Deposit / Withdraw</button>
                            )}
                            {allow("accounts.edit_number") && (
                              <button type="button" className="ghost-btn sm" onClick={() => openAccountNumber(u)}><Hash size={13} /> Account no.</button>
                            )}
                            {allow("kyc.request") && (
                              <button type="button" className="ghost-btn sm" onClick={() => { setTargetUser(u); setKycReqs(["identity", "address"]); setKycModal(true); }}><UserCheck size={13} /> Request KYC</button>
                            )}
                            {allow("accounts.set_status") && acct && (
                              <button type="button" className="ghost-btn sm" onClick={() => setStatusConfirm({ target: acct, status: acct.accountStatus === "restricted" ? "active" : "restricted" })}>
                                {acct.accountStatus === "restricted" ? "Restore" : "Restrict"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ============================ ACCOUNTS ============================ */}
      {activeTab === "accounts" && (
        <div className="admin-tab-pane">
          <div className="admin-kpi-grid">
            <div className="admin-kpi-card"><span className="kpi-label">Open accounts</span><strong className="kpi-val">{totals.openAccounts}</strong><small className="kpi-sub"><Landmark size={12} /> Across all members</small></div>
            <div className="admin-kpi-card"><span className="kpi-label">Total balances</span><strong className="kpi-val">{money(totals.balances, false)}</strong><small className="kpi-sub"><Wallet size={12} /> Settled funds</small></div>
            <div className="admin-kpi-card"><span className="kpi-label">Pending settlement</span><strong className="kpi-val">{money(totals.pending, false)}</strong><small className="kpi-sub"><RefreshCw size={12} /> In transit</small></div>
            <div className="admin-kpi-card"><span className="kpi-label">Restricted</span><strong className={`kpi-val ${totals.restricted > 0 ? "warn-red" : ""}`}>{totals.restricted}</strong><small className="kpi-sub"><Lock size={12} /> Sends blocked</small></div>
          </div>
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Member accounts</h2>
                <span className="panel-sub">Balances, cards and status — straight from each member ledger</span>
              </div>
              {allow("reports.view") && <button type="button" className="ghost-btn sm" onClick={() => handleExport("accounts")}><Download size={13} /> Export CSV</button>}
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th><th>Type</th><th>Balance</th><th>Pending</th><th>Cards</th>
                    <th>Transactions</th><th>KYC</th><th>Status</th><th>Last activity</th><th className="ta-r">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.userId}>
                      <td><strong>{a.name}</strong><br /><small>{a.email}</small></td>
                      <td><span className={`chip ${a.accountType === "personal" ? "chip-green" : "chip-violet"}`}>{a.accountType.toUpperCase()}</span></td>
                      <td><strong>{money(a.balance)}</strong></td>
                      <td><small>{money(a.pendingBalance)}</small></td>
                      <td><small>{a.cards}{a.frozenCards > 0 ? ` (${a.frozenCards} frozen)` : ""}</small></td>
                      <td><small>{a.txnCount}{a.pendingTxns > 0 ? ` · ${a.pendingTxns} pending` : ""}</small></td>
                      <td>{kycChip(a.kycStatus)}</td>
                      <td><span className={`status-pill ${a.accountStatus === "restricted" ? "overdue" : "active"}`}><span className="dot" />{a.accountStatus}</span></td>
                      <td><small>{a.lastActivity ? ago(a.lastActivity) : "Never"}</small></td>
                      <td className="ta-r">
                        {allow("accounts.set_status") && (
                          <button type="button" className="ghost-btn sm" onClick={() => setStatusConfirm({ target: a, status: a.accountStatus === "restricted" ? "active" : "restricted" })}>
                            {a.accountStatus === "restricted" ? "Restore" : "Restrict"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ============================ TRANSACTIONS ============================ */}
      {activeTab === "transactions" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Platform ledger</h2>
                <span className="panel-sub">{allTxns.length} transactions across every member account</span>
              </div>
              {allow("transactions.export") && <button type="button" className="ghost-btn sm" onClick={() => handleExport("transactions")}><Download size={13} /> Export CSV</button>}
            </div>
            <div className="segmented" role="tablist" style={{ marginBottom: 14 }}>
              {([["all", "All"], ["in", "Deposits"], ["out", "Withdrawals & transfers"], ["pending", "Pending"]] as Array<["all" | "in" | "out" | "pending", string]>).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={txnFilter === id} className={txnFilter === id ? "on" : ""} onClick={() => setTxnFilter(id)}>{label}</button>
              ))}
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Date</th><th>Member</th><th>Merchant / counterparty</th><th>Category</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th></tr>
                </thead>
                <tbody>
                  {filteredTxns.slice(0, 120).map(t => (
                    <tr key={t.userId + t.id}>
                      <td><small>{longDate(t.date)}</small></td>
                      <td><strong>{t.memberName}</strong></td>
                      <td>{t.merchant}</td>
                      <td><small>{t.category}</small></td>
                      <td><small>{t.method ?? "Card"}</small></td>
                      <td><strong style={{ color: t.amount < 0 ? "#9d4040" : "#2f7a4c" }}>{t.amount < 0 ? "−" : "+"}{money(Math.abs(t.amount))}</strong></td>
                      <td><span className={`status-pill ${t.status === "pending" ? "open" : "active"}`}><span className="dot" />{t.status ?? "cleared"}</span></td>
                      <td><code>{t.reference ?? "—"}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ============================ KYC ============================ */}
      {activeTab === "kyc" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>KYC verification queue</h2>
                <span className="panel-sub">{kycQueue.length} submitted for review · {accounts.filter(a => a.kycStatus === "requested").length} awaiting member action</span>
              </div>
              {allow("reports.view") && <button type="button" className="ghost-btn sm" onClick={() => handleExport("kyc")}><Download size={13} /> Export CSV</button>}
            </div>
            {kycQueue.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Member</th><th>Account</th><th>Submitted</th><th>Legal name</th><th>Date of birth</th><th>SSN</th><th>Document</th><th>Files</th><th>Source of funds</th><th className="ta-r">Decision</th></tr>
                  </thead>
                  <tbody>
                    {kycQueue.map(q => (
                      <tr key={q.userId}>
                        <td><strong>{q.name}</strong><br /><small>{q.email}</small></td>
                        <td><span className={`chip ${q.accountType === "personal" ? "chip-green" : "chip-violet"}`}>{q.accountType.toUpperCase()}</span></td>
                        <td><small>{q.kyc.submission ? longDate(q.kyc.submission.submittedAt) : "—"}</small></td>
                        <td>{q.kyc.submission?.legalName ?? "—"}</td>
                        <td><small>{q.kyc.submission?.dob ?? "—"}</small></td>
                        <td><small><code>{q.kyc.submission?.taxId ?? "—"}</code></small></td>
                        <td><small>{q.kyc.submission?.documentType ?? q.kyc.documentType}</small></td>
                        <td><small>{(q.kyc.submission?.documents ?? []).filter(d => d.name).length} uploaded</small></td>
                        <td><small>{q.kyc.submission?.source ?? "—"}</small></td>
                        <td className="ta-r">
                          {allow("kyc.review")
                            ? <button type="button" className="solid-btn sm" onClick={() => { setKycReview(q); setKycDecisionNote(""); setKycReqsFor([]); }}><Search size={13} /> Review</button>
                            : <small>View only</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <UserCheck size={28} />
                <strong>Verification queue is empty</strong>
                <p>No members have submitted identity documents. Send requests from the Customers module.</p>
              </div>
            )}
          </section>

          <section className="panel admin-panel">
            <div className="panel-head"><div><h2>Outstanding requests</h2><span className="panel-sub">Members who haven't completed their verification</span></div></div>
            {accounts.filter(a => a.kycStatus === "requested" || a.kycStatus === "needs_attention").length > 0 ? (
              <div className="admin-activity-list">
                {accounts.filter(a => a.kycStatus === "requested" || a.kycStatus === "needs_attention").map(a => (
                  <div className="admin-activity-row" key={a.userId}>
                    <span className="admin-activity-cat t-out">{a.kycStatus === "requested" ? "PENDING" : "CHANGES"}</span>
                    <div><strong>{a.name}</strong><small>{a.email} · {a.kycStatus === "requested" ? "hasn't started" : "needs to update documents"}</small></div>
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><BadgeCheck size={24} /><strong>All caught up</strong><p>No outstanding verification requests.</p></div>}
          </section>
        </div>
      )}

      {/* ============================ RISK & FRAUD ============================ */}
      {activeTab === "risk" && (
        <div className="admin-tab-pane">
          <div className="admin-grid-split">
            <section className="panel admin-panel">
              <div className="panel-head">
                <div>
                  <h2>Disputes & chargebacks</h2>
                  <span className="panel-sub">{openDisputes.length} open across the platform</span>
                </div>
              </div>
              {openDisputes.length > 0 ? (
                <div className="admin-activity-list">
                  {openDisputes.map(d => (
                    <div className="admin-activity-row" key={d.userId + d.id}>
                      <span className="admin-activity-cat t-out">DISPUTE</span>
                      <div style={{ flex: 1 }}>
                        <strong>{d.merchant} · {money(d.amount)}</strong>
                        <small>{d.memberName} · {d.reason} · {ago(d.updatedAt)}</small>
                      </div>
                      {allow("risk.resolve") && (
                        <button type="button" className="ghost-btn sm" onClick={() => handleResolveDispute(d.memberName, d.id, d.merchant)}>
                          {d.status === "submitted" ? "Start review" : "Resolve & refund"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state"><ShieldCheck size={24} /><strong>No open disputes</strong><p>Member chargeback claims will appear here.</p></div>}
            </section>

            <section className="panel admin-panel">
              <div className="panel-head"><div><h2>Risk signals</h2><span className="panel-sub">Derived live from member ledgers</span></div></div>
              <div className="admin-activity-list">
                {[
                  ...accounts.filter(a => a.accountStatus === "restricted").map(a => ({ tone: "t-out", label: "RESTRICTED", text: `${a.name} — account restricted`, sub: `Balance ${money(a.balance)} · outgoing sends blocked` })),
                  ...accounts.filter(a => a.kycStatus !== "approved" && a.balance >= 25000).map(a => ({ tone: "t-out", label: "UNVERIFIED", text: `${a.name} — ${money(a.balance, false)} unverified balance`, sub: "KYC above $25k threshold" })),
                  ...accounts.filter(a => a.frozenCards > 0).map(a => ({ tone: "", label: "FROZEN CARD", text: `${a.name} — ${a.frozenCards} frozen card${a.frozenCards === 1 ? "" : "s"}`, sub: "Check for card-control anomalies" })),
                  ...allTxns.filter(t => Math.abs(t.amount) >= 10000).slice(0, 4).map(t => ({ tone: "t-out", label: "LARGE TXN", text: `${t.memberName} — ${money(Math.abs(t.amount))} ${t.amount > 0 ? "in" : "out"}`, sub: `${t.merchant} · ${ago(t.date)}` })),
                ].length > 0 ? (
                  [
                    ...accounts.filter(a => a.accountStatus === "restricted").map(a => ({ tone: "t-out", label: "RESTRICTED", text: `${a.name} — account restricted`, sub: `Balance ${money(a.balance)} · outgoing sends blocked` })),
                    ...accounts.filter(a => a.kycStatus !== "approved" && a.balance >= 25000).map(a => ({ tone: "t-out", label: "UNVERIFIED", text: `${a.name} — ${money(a.balance, false)} unverified balance`, sub: "KYC above $25k threshold" })),
                    ...accounts.filter(a => a.frozenCards > 0).map(a => ({ tone: "", label: "FROZEN CARD", text: `${a.name} — ${a.frozenCards} frozen card${a.frozenCards === 1 ? "" : "s"}`, sub: "Check for card-control anomalies" })),
                    ...allTxns.filter(t => Math.abs(t.amount) >= 10000).slice(0, 4).map(t => ({ tone: "t-out", label: "LARGE TXN", text: `${t.memberName} — ${money(Math.abs(t.amount))} ${t.amount > 0 ? "in" : "out"}`, sub: `${t.merchant} · ${ago(t.date)}` })),
                  ].map((s, i) => (
                    <div className="admin-activity-row" key={s.label + i}>
                      <span className={`admin-activity-cat ${s.tone}`}>{s.label}</span>
                      <div><strong>{s.text}</strong><small>{s.sub}</small></div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state"><ShieldCheck size={24} /><strong>No risk signals</strong><p>Nothing unusual detected across member accounts.</p></div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ============================ STAFF ============================ */}
      {activeTab === "staff" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Staff & admins</h2>
                <span className="panel-sub">{staff.length} elevated accounts · role changes take effect at next sign-in</span>
              </div>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Staff member</th><th>Role</th><th>Access level</th><th className="ta-r">Change role</th></tr></thead>
                <tbody>
                  {staff.map(s => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong>{s.id === user?.id && <small> (you)</small>}<br /><small>{s.email}</small></td>
                      <td><span className={`chip ${s.role === "superadmin" ? "chip-violet" : "chip-green"}`}>{ROLE_LABELS[s.role as Role]}</span></td>
                      <td><small>{s.role !== "superadmin" ? `${rolePermissions(s.role as StaffRole).length} permissions` : "All permissions"}</small></td>
                      <td className="ta-r">
                        {s.role !== "superadmin" && s.id !== user?.id ? (
                          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                            {(["admin", "compliance", "support"] as StaffRole[]).filter(r => r !== s.role).map(r => (
                              <button key={r} type="button" className="ghost-btn sm" onClick={() => setStaffConfirm({ userId: s.id, name: s.name, role: r })}>
                                Make {ROLE_LABELS[r]}
                              </button>
                            ))}
                            <button type="button" className="ghost-btn sm" onClick={() => setStaffConfirm({ userId: s.id, name: s.name, role: "user" })}>Revoke access</button>
                          </div>
                        ) : <small>Protected</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel admin-panel">
            <div className="panel-head"><div><h2>Grant staff access</h2><span className="panel-sub">Elevate an existing member — no separate account needed</span></div></div>
            <div className="admin-activity-list">
              {members.slice(0, 8).map(u => (
                <div className="admin-activity-row" key={u.id}>
                  <span className="admin-activity-cat">{u.accountType === "personal" ? "PERSONAL" : "BUSINESS"}</span>
                  <div style={{ flex: 1 }}><strong>{u.name}</strong><small>{u.email}</small></div>
                  {(["support", "compliance", "admin"] as StaffRole[]).map(r => (
                    <button key={r} type="button" className="ghost-btn sm" onClick={() => setStaffConfirm({ userId: u.id, name: u.name, role: r })}>
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ============================ ROLES & PERMISSIONS ============================ */}
      {activeTab === "roles" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Permission matrix</h2>
                <span className="panel-sub">Effective grants per role — enforced on every admin action</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {matrixDraft && <button type="button" className="ghost-btn sm" onClick={() => setMatrixDraft(null)}>Discard changes</button>}
                <button type="button" className="solid-btn sm" onClick={handleSaveMatrix} disabled={!matrixDraft}><Check size={13} /> Save matrix</button>
              </div>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table perm-matrix">
                <thead>
                  <tr>
                    <th>Permission</th>
                    {STAFF_ROLES.map(r => <th key={r} className="ta-c">{ROLE_LABELS[r]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map(p => (
                    <tr key={p}>
                      <td><strong>{PERMISSION_LABELS[p]}</strong><br /><small><code>{p}</code></small></td>
                      {STAFF_ROLES.map(r => (
                        <td key={r} className="ta-c">
                          {r === "superadmin" ? (
                            <Check size={15} strokeWidth={3} style={{ color: "#2f7a4c", margin: "0 auto" }} />
                          ) : (
                            <label className="perm-toggle">
                              <input
                                type="checkbox"
                                checked={activeMatrix[r].includes(p)}
                                onChange={e => setMatrixDraft(draft => {
                                  const base = draft ?? (Object.fromEntries(STAFF_ROLES.map(x => [x, rolePermissions(x)])) as Record<StaffRole, Permission[]>);
                                  return { ...base, [r]: e.target.checked ? [...base[r], p] : base[r].filter(x => x !== p) };
                                })}
                              />
                            </label>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="role-desc-list">
              {STAFF_ROLES.map(r => (
                <div key={r}>
                  <strong>{ROLE_LABELS[r]} <button type="button" className="text-btn" onClick={() => handleResetRole(r)} disabled={r === "superadmin"}>Reset to default</button></strong>
                  <span>{ROLE_DESCRIPTIONS[r]}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ============================ REPORTS ============================ */}
      {activeTab === "reports" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head"><div><h2>Reports & exports</h2><span className="panel-sub">CSV exports of live platform data — every export is audit-logged</span></div></div>
            <div className="admin-export-grid">
              {([
                ["customers", "Customer directory", "All registered members with contact details and roles", <Users size={18} />],
                ["accounts", "Account balances", "Every member account: balances, cards, KYC and status", <Landmark size={18} />],
                ["transactions", "Transaction ledger", "The full platform ledger across all members", <FileText size={18} />],
                ["kyc", "KYC status", "Verification standing for every member", <UserCheck size={18} />],
                ["audit", "Audit trail", "The complete admin action history", <ScrollText size={18} />],
              ] as Array<["customers" | "accounts" | "transactions" | "kyc" | "audit", string, string, React.ReactNode]>).map(([kind, title, sub, icon]) => (
                <button type="button" key={kind} className="admin-export-card" onClick={() => handleExport(kind)}>
                  <span className="admin-export-icon">{icon}</span>
                  <strong>{title}</strong>
                  <small>{sub}</small>
                  <span className="admin-export-cta"><Download size={13} /> Download CSV</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ============================ NOTIFICATIONS ============================ */}
      {activeTab === "notifications" && (
        <div className="admin-tab-pane">
          <div className="admin-grid-split">
            <section className="panel admin-panel">
              <div className="panel-head"><div><h2>Broadcast a notification</h2><span className="panel-sub">Delivered in-app to every member in the audience instantly</span></div></div>
              <form className="dash-form" onSubmit={handleBroadcast}>
                <label htmlFor="bc-title">Title</label>
                <input id="bc-title" required maxLength={60} placeholder="e.g. Scheduled maintenance this Sunday" value={broadcast.title} onChange={e => setBroadcast(b => ({ ...b, title: e.target.value }))} />
                <label htmlFor="bc-detail">Message</label>
                <textarea id="bc-detail" required rows={3} maxLength={220} placeholder="What should members know?" value={broadcast.detail} onChange={e => setBroadcast(b => ({ ...b, detail: e.target.value }))} />
                <label htmlFor="bc-audience">Audience</label>
                <select id="bc-audience" value={broadcast.audience} onChange={e => setBroadcast(b => ({ ...b, audience: e.target.value as typeof b.audience }))}>
                  <option value="all">All members ({members.length})</option>
                  <option value="business">Business accounts only</option>
                  <option value="personal">Personal accounts only</option>
                  <option value="unverified">Unverified members only</option>
                </select>
                <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                  <button type="submit" className="solid-btn"><Megaphone size={14} /> Review & send</button>
                </div>
              </form>
            </section>
            <section className="panel admin-panel">
              <div className="panel-head"><div><h2>Recent broadcasts</h2><span className="panel-sub">From the audit trail</span></div></div>
              {broadcastHistory.length > 0 ? (
                <div className="admin-activity-list">
                  {broadcastHistory.map(l => (
                    <div className="admin-activity-row" key={l.id}>
                      <span className="admin-activity-cat">COMMS</span>
                      <div><strong>{l.summary}</strong><small>{l.adminName} · {ago(l.at)}</small></div>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-state"><Megaphone size={24} /><strong>No broadcasts yet</strong><p>Sent announcements will be listed here.</p></div>}
            </section>
          </div>
        </div>
      )}

      {/* ============================ AUDIT LOGS ============================ */}
      {activeTab === "audit" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Audit trail</h2>
                <span className="panel-sub">{auditLogs.length} entries · append-only — no admin, including Super Admin, can edit or delete entries</span>
              </div>
              <button type="button" className="ghost-btn sm" onClick={() => handleExport("audit")}><Download size={13} /> Export CSV</button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div className="admin-search-wrap" style={{ maxWidth: 300 }}>
                <Search size={14} />
                <input placeholder="Search admin, action or target…" value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
              </div>
              <div className="segmented">
                {(["all", "Financial", "KYC", "Risk", "Access", "System", "Comms"] as const).map(c => (
                  <button key={c} type="button" className={auditCategory === c ? "on" : ""} onClick={() => setAuditCategory(c as typeof auditCategory)}>{c === "all" ? "All" : c}</button>
                ))}
              </div>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Category</th><th>Target</th><th>Summary</th><th>Before → After</th></tr></thead>
                <tbody>
                  {filteredAudit.slice(0, 100).map(l => (
                    <tr key={l.id}>
                      <td><small>{longDate(l.at)}<br />{ago(l.at)}</small></td>
                      <td><strong>{l.adminName}</strong></td>
                      <td><code>{l.action}</code></td>
                      <td><span className="chip chip-violet">{l.category}</span></td>
                      <td><small>{l.target}</small></td>
                      <td><small>{l.summary}</small></td>
                      <td><small>{l.before || l.after ? `${l.before ?? "—"} → ${l.after ?? "—"}` : "—"}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ============================ BANKING SETTINGS ============================ */}
      {activeTab === "settings" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head"><div><h2>Global bank parameters</h2><span className="panel-sub">Changes are audit-logged with before/after values</span></div></div>
            <div className="admin-params-form">
              <div className="field-row">
                <div>
                  <label htmlFor="adm-apy">Core high-yield APY rate (%)</label>
                  <input id="adm-apy" type="number" step="0.05" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
                </div>
                <div>
                  <label>Zelle® instant transaction ceiling</label>
                  <input disabled value="$2,500 / transaction" />
                </div>
              </div>
              <button type="button" className="solid-btn" onClick={handleSaveSettings}>Save global config</button>
            </div>
          </section>

          <section className="panel admin-panel">
            <div className="panel-head"><div><h2>Emergency controls</h2><span className="panel-sub">Requires confirmation · fully audit-logged</span></div></div>
            <button type="button" className={`emergency-action ${systemFrozen ? "t-danger" : ""}`} onClick={() => setHaltConfirm(true)}>
              <AlertTriangle size={18} />
              <span>
                <b>{systemFrozen ? "Resume payment rails" : "Halt all payment rails"}</b>
                <small>{systemFrozen ? "Re-enable outgoing wires and card authorizations." : "Pause all outgoing wires and card authorizations platform-wide."}</small>
              </span>
              <span className={`status-pill ${systemFrozen ? "overdue" : "active"}`}><span className="dot" />{systemFrozen ? "Halted" : "Operational"}</span>
            </button>
          </section>

          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Customer notification emails</h2>
                <span className="panel-sub">Transactional templates built on the product design system</span>
              </div>
              <Mail size={18} style={{ color: "var(--violet)" }} />
            </div>
            <p style={{ margin: "0 0 16px", fontSize: "13.5px", lineHeight: 1.65, color: "var(--muted)" }}>
              Every notification email — security alerts, deposits and transfers, cards, invoicing, Scout insights and
              account lifecycle — uses the same fonts (Manrope &amp; DM Sans) and palette as the app.
            </p>
            <a className="solid-btn" href="#/email-templates" style={{ display: "inline-flex", textDecoration: "none" }}>
              <Mail size={14} /> Open email template studio
            </a>
          </section>
        </div>
      )}

      {/* ============================ ADMIN PROFILE ============================ */}
      {activeTab === "profile" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel admin-profile">
            <span className="app-avatar avatar-with-image" style={{ width: 56, height: 56 }}>
              <img src={user?.avatarUrl || "/images/avatar-3d-default.svg"} alt={user?.name} />
            </span>
            <div className="admin-profile-main">
              <h2>{user?.name}</h2>
              <p>{user?.email} · {user?.phone || "no phone on file"}</p>
              <div className="admin-role-line">
                <span className="admin-role-chip">{ROLE_LABELS[role]}</span>
                <small>{ROLE_DESCRIPTIONS[role as StaffRole] ?? ""}</small>
              </div>
              <div className="admin-perm-chips">
                {role === "superadmin"
                  ? <span className="admin-perm-chip all">All permissions — highest access level</span>
                  : rolePermissions(role as StaffRole).map(p => <span key={p} className="admin-perm-chip">{PERMISSION_LABELS[p]}</span>)}
              </div>
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                <Link to="/app" className="ghost-btn sm"><Activity size={14} /> Member dashboard</Link>
                <button type="button" className="ghost-btn sm" onClick={() => { logout(); navigate("/"); }}><LogOut size={14} /> Sign out</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ============================ MODALS ============================ */}

      {/* Deposit / Withdraw (cross-account treasury adjustment) */}
      {acctModal && targetUser && (
        <div className="modal-scrim" onClick={() => setAcctModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Account number: {targetUser.name}</h3></div>
            <form onSubmit={handleSaveAccountNumber} className="dash-form">
              <p className="admin-before-after">
                Current number: <strong><code>{accountBy(targetUser.id)?.accountNumber ?? "none on file"}</code></strong>
                <br />
                <small>Twelve digits. Members share this for ACH and wires, so a correction is recorded on the audit trail and the member is notified.</small>
              </p>
              <label htmlFor="adm-acct-no">New account number</label>
              <input id="adm-acct-no" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="12 digits"
                value={acctNumber} onChange={e => setAcctNumber(e.target.value.replace(/[^\d\s-]/g, ""))} />
              {acctNumber !== "" && !/^\d{12}$/.test(acctNumber.replace(/[\s-]/g, "")) && (
                <p className="flow-field-error" role="alert"><AlertCircle size={14} /><span>An account number is exactly 12 digits.</span></p>
              )}
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setAcctModal(false)}>Cancel</button>
                <button type="submit" className="solid-btn" disabled={acctSaving || !/^\d{12}$/.test(acctNumber.replace(/[\s-]/g, ""))}>
                  {acctSaving ? "Saving…" : "Save account number"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adjustModal && targetUser && (
        <div className="modal-scrim" onClick={() => setAdjustModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Transfer funds: {targetUser.name}</h3></div>
            <form onSubmit={handleCommitAdjustment} className="dash-form">
              <label>Direction</label>
              <div className="card-type-toggle">
                <button type="button" className={adjustType === "credit" ? "on" : ""} onClick={() => { setAdjustType("credit"); if (!validAdjustmentOptions.some(opt => opt.id === adjustKind)) setAdjustKind("direct_deposit"); }}>Deposit funds (+)</button>
                <button type="button" className={adjustType === "debit" ? "on" : ""} onClick={() => { setAdjustType("debit"); if (!validAdjustmentOptions.some(opt => opt.id === adjustKind)) setAdjustKind("ach_withdrawal"); }}>Withdraw / clawback (−)</button>
              </div>
              <label>Transaction type</label>
              <div className="card-type-toggle">
                {validAdjustmentOptions.map(option => (
                  <button key={option.id} type="button" className={adjustKind === option.id ? "on" : ""} onClick={() => setAdjustKind(option.id)}>{option.label}</button>
                ))}
              </div>
              <label htmlFor="adm-adj-amt">Amount ($ USD)</label>
              <div className="amount-input">
                <span>$</span>
                <input id="adm-adj-amt" type="number" min="1" step="0.01" required placeholder="0.00" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} />
              </div>
              <label htmlFor="adm-adj-memo">Reference note (optional detail on the member transaction)</label>
              <input id="adm-adj-memo" placeholder="e.g. June payroll, SaaS refund, wire confirmation" value={adjustMemo} onChange={e => setAdjustMemo(e.target.value)} />
              <p className="admin-before-after">
                Current balance: <strong>{money(accountBy(targetUser.id)?.balance ?? 0)}</strong>
                {adjustAmount && !isNaN(parseFloat(adjustAmount))
                  ? <> → <strong>{money((accountBy(targetUser.id)?.balance ?? 0) + (adjustType === "credit" ? 1 : -1) * parseFloat(adjustAmount))}</strong> after</>
                  : null}
              </p>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setAdjustModal(false)}>Cancel</button>
                <button type="submit" className="solid-btn">Commit transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KYC request */}
      {kycModal && targetUser && (
        <div className="modal-scrim" onClick={() => setKycModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Request identity verification: {targetUser.name}</h3></div>
            <form onSubmit={handleRequestKyc} className="dash-form">
              <label>Documents to request</label>
              <div className="kyc-req-grid">
                {([
                  ["identity", "Photo ID", "Government-issued identity document"],
                  ["address", "Proof of address", "Utility bill, lease or bank statement"],
                  ["selfie", "Selfie / liveness", "Selfie matched against the ID"],
                  ["funds", "Source of funds", "Payslip, invoice or income statement"],
                ] as Array<[KycRequirement, string, string]>).map(([id, label, note]) => (
                  <label key={id} className={`kyc-req-chip ${kycReqs.includes(id) ? "on" : ""}`}>
                    <input type="checkbox" checked={kycReqs.includes(id)} onChange={e => setKycReqs(reqs => e.target.checked ? [...reqs, id] : reqs.filter(r => r !== id))} />
                    <strong>{label}</strong>
                    <small>{note}</small>
                  </label>
                ))}
              </div>
              <label htmlFor="adm-kyc-reason">Reason shown to the member</label>
              <textarea id="adm-kyc-reason" rows={3} placeholder="e.g. Annual compliance review — verification is required to lift your account limits." value={kycReason} onChange={e => setKycReason(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setKycModal(false)}>Cancel</button>
                <button type="submit" className="solid-btn" disabled={kycReqs.length === 0}><UserCheck size={14} /> Send verification request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KYC review & decision */}
      {identityUser && (
        <div className="modal-scrim" onClick={() => setIdentityUser(null)}>
          <div className="modal is-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{identityUser.name} · account application</h3>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setIdentityUser(null)}><X size={16} /></button>
            </div>
            {identityError && <p className="form-error">Could not load the application: {identityError}</p>}
            {!identityData && !identityError && <p className="panel-sub">Loading application…</p>}
            {identityData && (() => {
              const d = identityData;
              const full = (parts: Array<string | undefined>) => parts.filter(Boolean).join(" ") || "—";
              const rows: Array<[string, string]> = [
                ["Legal name", full([d.firstName, d.middleName, d.lastName])],
                ["Date of birth", d.dob || "—"],
                ["SSN", d.ssn || "—"],
                ["Citizenship", d.citizenship || "—"],
                ["Phone", d.phone || "—"],
                ["Email", d.email || "—"],
                ["Home address", [d.addressLine1, d.addressLine2].filter(Boolean).join(", ") || "—"],
                ["City / state / ZIP", [d.city, d.state, d.postalCode].filter(Boolean).join(", ") || "—"],
                ["Country", d.country || "—"],
                ["ID document", d.idType || "—"],
                ["ID number", d.idNumber || "—"],
                ["ID issued by", d.idIssuer || "—"],
                ["ID expires", d.idExpiry || "—"],
                ["Occupation", d.occupation || "—"],
                ["Employer", d.employer || "—"],
                ["Annual income", d.incomeRange || "—"],
                ["Source of funds", d.sourceOfFunds || "—"],
              ];
              const bizRows: Array<[string, string]> = [
                ["Registered legal name", d.legalName || "—"],
                ["Trading name (DBA)", d.dba || "—"],
                ["EIN", d.ein || "—"],
                ["Business structure", d.businessType || "—"],
                ["State of formation", d.formationState || "—"],
                ["Date formed", d.formationDate || "—"],
                ["Industry", d.industry || "—"],
                ["Website", d.website || "—"],
                ["Expected monthly deposits", d.monthlyVolume || "—"],
                ["Business address", [d.bizAddressLine1, d.bizAddressLine2].filter(Boolean).join(", ") || "—"],
                ["Business city / state / ZIP", [d.bizCity, d.bizState, d.bizPostalCode].filter(Boolean).join(", ") || "—"],
                ["Business country", d.bizCountry || "—"],
                ["Beneficial owner", d.ownerName || "—"],
                ["Owner's title", d.ownerTitle || "—"],
                ["Owner's date of birth", d.ownerDob || "—"],
                ["Owner's SSN", d.ownerSsn || "—"],
                ["Owner's ownership", d.ownerOwnership ? `${d.ownerOwnership}%` : "—"],
              ];
              const section = (title: string, list: Array<[string, string]>) => (
                <>
                  <div className="app-section"><span>{title}</span></div>
                  <div className="kyc-review-rows">
                    {list.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                  </div>
                </>
              );
              return (
                <div className="dash-form">
                  <p className="panel-sub">
                    Submitted {d.submittedAt ? longDate(d.submittedAt) : "—"} · these are the details {identityUser.name} provided when the account was opened.
                  </p>
                  {section("Applicant", rows)}
                  {d.legalName ? section("Business", bizRows) : null}
                  {d.ein && !d.legalName ? section("Business", bizRows) : null}
                </div>
              );
            })()}
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setIdentityUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {kycReview && (
        <div className="modal-scrim" onClick={() => setKycReview(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Application review: {kycReview.name}</h3>
              <span className="panel-sub">
                {kycReview.reviewState === "more_info" ? "Back with us after a request for information" : "Waiting for a decision"}
              </span>
            </div>
            <div className="dash-form">
              {(() => {
                const s = kycReview.kyc.submission;
                const app = (s?.application ?? {}) as Record<string, string | number | undefined>;
                const val = (k: string) => { const v = app[k]; return v === undefined || v === "" ? "—" : String(v); };
                const rows: Array<[string, string]> = s ? [
                  ["Legal name", s.legalName],
                  ["Date of birth", s.dob || "—"],
                  ["SSN", s.taxId || "—"],
                  ["Citizenship", val("citizenship")],
                  ["Phone", val("phone")],
                  ["Email", val("email")],
                  ["Home address", [val("addressLine1"), val("addressLine2")].filter(v => v !== "—").join(", ") || "—"],
                  ["City / state / ZIP", [val("city"), val("state"), val("postalCode")].filter(v => v !== "—").join(", ") || "—"],
                  ["Country", s.country],
                  ["ID document", `${s.documentType}${app.idNumber ? ` · ${app.idNumber}` : ""}`],
                  ["ID issued by", val("idIssuer")],
                  ["ID expires", val("idExpiry")],
                  ["Occupation", val("occupation")],
                  ["Employer", val("employer")],
                  ["Annual income", val("incomeRange")],
                  ["Source of funds", s.source],
                  ...(s.registration ? [["Registration", s.registration] as [string, string]] : []),
                  ...(s.industry ? [["Industry", s.industry] as [string, string]] : []),
                  ...(app.legalName ? [
                    ["Registered legal name", val("legalName")] as [string, string],
                    ["EIN", val("ein")] as [string, string],
                    ["Business structure", val("businessType")] as [string, string],
                    ["State of formation", val("formationState")] as [string, string],
                    ["Date formed", val("formationDate")] as [string, string],
                    ["Expected monthly deposits", val("monthlyVolume")] as [string, string],
                    ["Business address", [val("bizAddressLine1"), val("bizCity"), val("bizState"), val("bizPostalCode")].filter(v => v !== "—").join(", ") || "—"] as [string, string],
                    ["Beneficial owner", `${val("ownerName")} · ${val("ownerTitle")}`] as [string, string],
                    ["Owner's SSN", val("ownerSsn")] as [string, string],
                    ["Owner's ownership", app.ownerOwnership ? `${app.ownerOwnership}%` : "—"] as [string, string],
                  ] : []),
                  ["Submitted", longDate(s.submittedAt)],
                ] : [["Status", "No submission details on file."]];
                return (
                  <>
                    <div className="kyc-review-rows">
                      {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                    </div>
                    {s && (s.documents ?? []).length > 0 && (
                      <div className="kyc-doc-review-list">
                        <label>Submitted documents</label>
                        {(s.documents ?? []).map(d => (
                          <div key={d.key} className="kyc-doc-review-item">
                            <FileText size={14} />
                            <span>{d.label}</span>
                            <small>{d.name || "—"}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
              <span className="app-section"><span>Request more information</span></span>
              <p className="admin-before-after">
                A hold the applicant can clear. Pick what you need — they see this list on their application page
                and can send it back without losing anything they already gave you.
              </p>
              <div className="admin-req-grid">
                {REQUEST_ITEMS.map(item => {
                  const on = kycReqsFor.includes(item.key);
                  return (
                    <button key={item.key} type="button" className={`admin-req ${on ? "on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setKycReqsFor(list => on ? list.filter(k => k !== item.key) : [...list, item.key])}>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </button>
                  );
                })}
              </div>
              <label htmlFor="adm-kyc-note">Reason shown to the applicant (required to hold or reject)</label>
              <textarea id="adm-kyc-note" rows={3} placeholder="e.g. The address document is older than 3 months — please upload a recent utility bill." value={kycDecisionNote} onChange={e => setKycDecisionNote(e.target.value)} />
              <div className="modal-actions admin-decision-actions">
                <button type="button" className="ghost-btn danger" onClick={() => handleKycDecision("rejected")}><XCircle size={14} /> Reject application</button>
                <button type="button" className="ghost-btn" disabled={kycDecisionNote.trim().length === 0 || kycReqsFor.length === 0} onClick={() => handleKycDecision("needs_attention")}><RefreshCw size={14} /> Request information</button>
                <button type="button" className="solid-btn" onClick={() => handleKycDecision("approved")}><Check size={14} /> Approve account</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account status confirm */}
      {statusConfirm && (
        <div className="modal-scrim" onClick={() => setStatusConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{statusConfirm.status === "restricted" ? "Restrict" : "Restore"} account: {statusConfirm.target.name}</h3>
            </div>
            <div className="dash-form">
              <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)" }}>
                {statusConfirm.status === "restricted"
                  ? "Restricting blocks all outgoing transfers and sends for this member. Deposits still arrive. The member is notified immediately."
                  : "The member regains full access to outgoing transfers immediately and is notified."}
              </p>
              {statusConfirm.status === "restricted" && (
                <>
                  <label htmlFor="adm-status-reason">Reason (required, shown to the member and in the audit trail)</label>
                  <input id="adm-status-reason" value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="e.g. Suspicious transaction pattern under review" />
                </>
              )}
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setStatusConfirm(null)}>Cancel</button>
                <button
                  type="button"
                  className={statusConfirm.status === "restricted" ? "danger-btn" : "solid-btn"}
                  disabled={statusConfirm.status === "restricted" && statusReason.trim().length === 0}
                  onClick={handleStatusConfirm}
                >
                  {statusConfirm.status === "restricted" ? "Restrict account" : "Restore account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Staff role confirm */}
      {staffConfirm && (
        <div className="modal-scrim" onClick={() => setStaffConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Change access: {staffConfirm.name}</h3></div>
            <div className="dash-form">
              <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)" }}>
                {staffConfirm.role === "user"
                  ? "This revokes all admin access. They keep their member account and data."
                  : `This grants ${ROLE_LABELS[staffConfirm.role]} access (${rolePermissions(staffConfirm.role as StaffRole).length} permissions). The change takes effect at their next sign-in and is recorded in the audit trail.`}
              </p>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setStaffConfirm(null)}>Cancel</button>
                <button type="button" className="solid-btn" onClick={handleStaffConfirm}>
                  {staffConfirm.role === "user" ? "Revoke access" : `Grant ${ROLE_LABELS[staffConfirm.role]}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast confirm */}
      {broadcastConfirm && (
        <div className="modal-scrim" onClick={() => setBroadcastConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Send broadcast</h3></div>
            <div className="dash-form">
              <div className="invite-summary">
                <Megaphone size={16} />
                <div>
                  <strong>{broadcast.title}</strong>
                  <small>{broadcast.detail}</small>
                </div>
              </div>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>
                Audience: <strong>{broadcast.audience === "all" ? `all ${members.length} members` : broadcast.audience + " members"}</strong>. Delivered instantly in-app and recorded in the audit trail.
              </p>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setBroadcastConfirm(false)}>Cancel</button>
                <button type="button" className="solid-btn" onClick={commitBroadcast}><Bell size={14} /> Send now</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System halt confirm */}
      {haltConfirm && (
        <div className="modal-scrim" onClick={() => setHaltConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>{systemFrozen ? "Resume payment rails?" : "Halt all payment rails?"}</h3></div>
            <div className="dash-form">
              <div className="freeze-confirm" style={{ textAlign: "center" }}>
                <AlertTriangle size={30} style={{ color: "#9d4040" }} />
                <p>
                  {systemFrozen
                    ? "Outgoing wires and card authorizations will be re-enabled for every member."
                    : "Every outgoing wire and card authorization will be paused platform-wide until resumed. This affects all members immediately."}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setHaltConfirm(false)}>Cancel</button>
                <button type="button" className={systemFrozen ? "solid-btn" : "danger-btn"} onClick={handleHaltToggle}>
                  {systemFrozen ? "Resume rails" : "Halt rails now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </AdminShell>
  );
}
