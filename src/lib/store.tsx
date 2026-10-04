import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, apiReachability, probeApi, getToken, ApiError, endSession } from "./api";
import { useToast } from "../components/Toast";
import { useAuth } from "./auth";

/* ============================================================
   Types
   ============================================================ */
export type Txn = {
  id: string;
  merchant: string;
  category: string;
  amount: number; // negative = money out, positive = money in
  reward: number;
  date: number;
  cardId?: string;
  scout?: number; // savings Scout recovered on this purchase
  note?: string;
  method?: string;
  reference?: string;
  status?: "cleared" | "pending";
};

export type Card = {
  id: string;
  label: string;
  last4: string;
  fullNumber: string;
  exp: string;
  cvv: string;
  limit: number;
  spent: number;
  frozen: boolean;
  type: "virtual" | "physical";
  merchantLock?: string;
  categoryLock?: string;
  cardholder: string;
  pin: string;
  singleTransactionLimit: number;
  dailyAtmLimit: number;
  controls: CardControls;
  shipping: CardShipping;
  walletStatus: "not_added" | "added";
  createdAt: number;
};

export type CardControls = {
  online: boolean;
  contactless: boolean;
  atm: boolean;
  international: boolean;
  magstripe: boolean;
};

export type ShippingStatus = "not_applicable" | "processing" | "printing" | "shipped" | "in_transit" | "delivered";
export type CardShipping = {
  status: ShippingStatus;
  carrier?: string;
  tracking?: string;
  orderedAt?: number;
  estimatedDelivery?: number;
  deliveredAt?: number;
  address?: string;
};

export type Invoice = {
  id: string;
  client: string;
  clientEmail: string;
  amount: number;
  status: "paid" | "open" | "overdue";
  due: number;
  createdAt: number;
  description?: string;
};

export type BankAccountDetails = { accountNumber: string; routingNumber: string; bankName: string; accountType: string; holder: string };
export type TeamMember = { id: string; name: string; email: string; role: "Owner" | "Admin" | "Member" | "Bookkeeper"; cardCount: number; monthlyLimit: number; status: "active" | "invited" };
export type Perk = { id: string; partner: string; category: string; value: string; description: string; code: string; status: "available" | "redeemed" };
export type NotificationItem = { id: string; title: string; detail: string; time: number; read: boolean; type: "scout" | "card" | "transfer" | "security" | "invoice" | "info" };
export type Preferences = { twoFactor: boolean; loginAlerts: boolean; scoutAuto: boolean; weeklyDigest: boolean };

export type SavingsPocket = {
  id: string;
  name: string;
  balance: number;
  target: number;
  color: string;
  icon: "shield" | "home" | "travel" | "tax" | "payroll" | "general";
  createdAt: number;
};

export type Payee = {
  id: string;
  name: string;
  nickname?: string;
  bankName: string;
  routingNumber: string;
  accountLast4: string;
  accountType: "Checking" | "Savings";
  verified: boolean;
  createdAt: number;
};

export type ScheduledPayment = {
  id: string;
  payeeId?: string;
  payeeName: string;
  amount: number;
  category: string;
  frequency: "once" | "weekly" | "monthly";
  nextDate: number;
  status: "active" | "paused" | "completed";
  autopay: boolean;
  memo?: string;
};

export type Dispute = {
  id: string;
  transactionId: string;
  merchant: string;
  amount: number;
  reason: string;
  detail?: string;
  status: "submitted" | "reviewing" | "resolved" | "denied";
  openedAt: number;
  updatedAt: number;
};

export type SecuritySession = {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: number;
  current: boolean;
  trusted: boolean;
};

export type KycStatus = "not_started" | "requested" | "in_review" | "approved" | "needs_attention";
/** Document categories a compliance review can ask a member for. */
export type KycRequirement = "identity" | "address" | "selfie" | "funds";
/** What the member actually submitted, kept for compliance review. */
export type KycSubmission = {
  legalName: string;
  dob: string;
  country: string;
  documentType: string;
  source: string;
  taxId: string;
  registration?: string;
  industry?: string;
  /** The full sign-up application, present when the member verified at sign-up. */
  application?: Record<string, unknown>;
  documents: Array<{ key: string; label: string; name: string }>;
  submittedAt: number;
};
export type KycRecord = {
  status: KycStatus;
  completeness: number;
  lastUpdated: number;
  nextStep: string;
  documentType: string;
  country: string;
  /** Set when an admin requests verification: who asked, when and why. */
  requestedAt?: number;
  requestedBy?: string;
  requestReason?: string;
  /** Which document categories the admin asked for. */
  requirements?: KycRequirement[];
  /** Set when the member submits the wizard for review. */
  submission?: KycSubmission;
};
/** Admin-initiated verification request payload. */
export type KycRequest = {
  requestedBy: string;
  reason: string;
  requirements: KycRequirement[];
  documentType?: string;
};

export type Account = {
  version: number;
  balance: number;
  pendingBalance: number;
  rewards: number;
  lifetimeRewards: number;
  scoutSaved: number;
  cards: Card[];
  transactions: Txn[];
  invoices: Invoice[];
  bankDetails: BankAccountDetails;
  team: TeamMember[];
  perks: Perk[];
  notifications: NotificationItem[];
  preferences: Preferences;
  savingsPockets: SavingsPocket[];
  payees: Payee[];
  scheduledPayments: ScheduledPayment[];
  disputes: Dispute[];
  sessions: SecuritySession[];
  scoutApplied: string[];
  kyc: KycRecord;
  /** Platform-level status set by admins ("restricted" blocks outgoing sends). */
  accountStatus?: "active" | "restricted";
};

export type Profile = { name: string; business: string; email: string; accountType: "personal" | "business" };
export type MoveResult = { reference: string; date: number; amount: number; balanceBefore: number; balanceAfter: number; reward: number; scout: number };

/* ============================================================
   Formatting & utilities
   ============================================================ */
export const SCHEMA_VERSION = 6;
const DAY = 86_400_000;

export const categories = ["Software", "Advertising", "Travel", "Operations", "Utilities", "Equipment", "Professional"];
const RATE: Record<string, number> = { Software: 0.04, Advertising: 0.045, Travel: 0.035, Operations: 0.025, Utilities: 0.025, Equipment: 0.03, Professional: 0.02 };
export const rewardRate = (category: string) => RATE[category] ?? 0.02;

export const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
export const shortDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const longDate = (ts: number) =>
  new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const r2 = (n: number) => Math.round(n * 100) / 100;
const rid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
export const makeReference = () =>
  `VYR-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

function cardNumbers(fixedLast4?: string) {
  const last4 = fixedLast4 && /^\d{4}$/.test(fixedLast4) ? fixedLast4 : digits(4);
  const year = (new Date().getFullYear() + 3 + Math.floor(Math.random() * 2)) % 100;
  const month = 1 + Math.floor(Math.random() * 12);
  return {
    last4,
    // The Arc network uses a reserved test range instead of a live card-network BIN.
    fullNumber: `9${digits(3)} ${digits(4)} ${digits(4)} ${last4}`,
    exp: `${String(month).padStart(2, "0")}/${String(year).padStart(2, "0")}`,
    cvv: digits(3),
  };
}

const defaultCardControls = (type: Card["type"]): CardControls => ({
  online: true,
  contactless: true,
  atm: type === "physical",
  international: false,
  magstripe: type === "physical",
});

const virtualShipping = (): CardShipping => ({ status: "not_applicable" });
const deliveredShipping = (now: number): CardShipping => ({
  status: "delivered",
  carrier: "ParcelPost",
  tracking: `VP${digits(12)}`,
  orderedAt: now - DAY * 38,
  estimatedDelivery: now - DAY * 30,
  deliveredAt: now - DAY * 31,
  address: "125 Market Street · San Francisco, CA 94105",
});
const newPhysicalShipping = (address = "125 Market Street · San Francisco, CA 94105"): CardShipping => ({
  status: "processing",
  carrier: "ParcelPost",
  tracking: `VP${digits(12)}`,
  orderedAt: Date.now(),
  estimatedDelivery: Date.now() + DAY * 6,
  address,
});

export function downloadFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function transactionsToCSV(txns: Txn[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["Date", "Merchant", "Category", "Method", "Amount", "Rewards", "Scout savings", "Reference", "Memo"];
  const rows = txns.map(t =>
    [
      new Date(t.date).toISOString().slice(0, 10),
      esc(t.merchant),
      esc(t.category),
      t.method ?? "",
      t.amount.toFixed(2),
      t.reward.toFixed(2),
      (t.scout ?? 0).toFixed(2),
      t.reference ?? "",
      esc(t.note ?? ""),
    ].join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

/* ============================================================
   Persistence + migration from earlier data shapes
   ============================================================ */
const RENAMED: Record<string, string> = { "AWS Cloud": "Stratus Compute", "WeWork All Access": "Commons Coworking" };
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const list = <T,>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);

/** Minimal safe default used only if a snapshot field is missing. */
const emptyAccount = (): Account => ({
  version: SCHEMA_VERSION,
  balance: 0, pendingBalance: 0, rewards: 0, lifetimeRewards: 0, scoutSaved: 0,
  cards: [], transactions: [], invoices: [],
  bankDetails: { accountNumber: "", routingNumber: "", bankName: "", accountType: "Business checking", holder: "" },
  team: [], perks: [], notifications: [],
  preferences: { twoFactor: true, loginAlerts: true, scoutAuto: true, weeklyDigest: false },
  savingsPockets: [], payees: [], scheduledPayments: [], disputes: [], sessions: [], scoutApplied: [],
  kyc: { status: "not_started", completeness: 0, lastUpdated: 0, nextStep: "", documentType: "", country: "" },
});

function normalize(raw: unknown, p: Profile): Account {
  const base = emptyAccount();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Account>;
  const current = r.version === SCHEMA_VERSION;

  const cards = (list<Partial<Card>>(r.cards) ?? base.cards).map((c): Card => {
    const fresh = cardNumbers(c.last4);
    const masked = typeof c.fullNumber !== "string" || c.fullNumber.includes("•");
    return {
      id: c.id ?? rid("card"),
      label: c.label ?? "Card",
      last4: fresh.last4,
      fullNumber: masked || !current ? fresh.fullNumber : (c.fullNumber as string),
      exp: c.exp ?? fresh.exp,
      cvv: c.cvv ?? fresh.cvv,
      limit: num(c.limit, 2500),
      spent: num(c.spent, 0),
      frozen: Boolean(c.frozen),
      type: c.type === "physical" ? "physical" : "virtual",
      merchantLock: c.merchantLock || undefined,
      categoryLock: c.categoryLock || undefined,
      cardholder: c.cardholder ?? p.name,
      pin: /^\d{4}$/.test(c.pin ?? "") ? (c.pin as string) : digits(4),
      singleTransactionLimit: num(c.singleTransactionLimit, Math.min(num(c.limit, 2500), 5000)),
      dailyAtmLimit: num(c.dailyAtmLimit, c.type === "physical" ? 1000 : 0),
      controls: { ...defaultCardControls(c.type === "physical" ? "physical" : "virtual"), ...(c.controls ?? {}) },
      shipping: c.type === "physical" ? { ...deliveredShipping(Date.now()), ...(c.shipping ?? {}) } : virtualShipping(),
      walletStatus: c.walletStatus === "added" ? "added" : "not_added",
      createdAt: num(c.createdAt, Date.now()),
    };
  });

  const transactions = (list<Partial<Txn>>(r.transactions) ?? base.transactions).map((t): Txn => {
    const amount = num(t.amount, 0);
    const merchantRaw = String(t.merchant ?? "Transaction").replace(/^Client payment — /, "");
    const rawCategory = String(t.category ?? "");
    const category = rawCategory === "Legal & Prof." ? "Professional" : categories.includes(rawCategory) ? rawCategory : "Operations";
    return {
      id: t.id ?? rid("txn"),
      merchant: RENAMED[merchantRaw] ?? merchantRaw,
      category,
      amount,
      reward: num(t.reward, 0),
      scout: num(t.scout, 0),
      date: num(t.date, Date.now()),
      cardId: t.cardId,
      note: t.note,
      method: t.method ?? (amount > 0 ? "ACH" : "Card"),
      reference: t.reference ?? makeReference(),
      status: t.status === "pending" ? "pending" : "cleared",
    };
  });

  const invoices = (list<Partial<Invoice>>(r.invoices) ?? base.invoices).map((i): Invoice => {
    const due = num(i.due, Date.now() + 14 * DAY);
    const status = i.status === "paid" ? "paid" : due < Date.now() ? "overdue" : "open";
    return {
      id: String(i.id ?? Math.floor(1000 + Math.random() * 9000)),
      client: i.client ?? "Client",
      clientEmail: i.clientEmail ?? "billing@client.example",
      amount: num(i.amount, 0),
      status,
      due,
      createdAt: num(i.createdAt, due - 14 * DAY),
      description: i.description,
    };
  });

  const prefs = r.preferences && typeof r.preferences === "object" ? r.preferences : {};

  const kyc = (r.kyc && typeof r.kyc === "object" ? r.kyc : base.kyc) as Partial<KycRecord>;

  return {
    ...base,
    version: SCHEMA_VERSION,
    balance: num(r.balance, base.balance),
    pendingBalance: num(r.pendingBalance, base.pendingBalance),
    rewards: num(r.rewards, base.rewards),
    lifetimeRewards: num(r.lifetimeRewards, num(r.rewards, 0) + 1420.5),
    scoutSaved: num(r.scoutSaved, base.scoutSaved),
    cards,
    transactions,
    invoices,
    team: current ? list<TeamMember>(r.team) ?? base.team : base.team,
    perks: current ? list<Perk>(r.perks) ?? base.perks : base.perks,
    notifications: list<NotificationItem>(r.notifications) ?? base.notifications,
    preferences: { ...base.preferences, ...prefs },
    savingsPockets: list<SavingsPocket>(r.savingsPockets) ?? base.savingsPockets,
    payees: list<Payee>(r.payees) ?? base.payees,
    scheduledPayments: list<ScheduledPayment>(r.scheduledPayments) ?? base.scheduledPayments,
    disputes: list<Dispute>(r.disputes) ?? base.disputes,
    sessions: list<SecuritySession>(r.sessions) ?? base.sessions,
    scoutApplied: list<string>(r.scoutApplied) ?? [],
    accountStatus: r.accountStatus === "restricted" ? "restricted" : "active",
    kyc: {
      status: kyc.status === "not_started" || kyc.status === "requested" || kyc.status === "in_review" || kyc.status === "approved" || kyc.status === "needs_attention" ? kyc.status : base.kyc.status,
      completeness: num(kyc.completeness, base.kyc.completeness),
      lastUpdated: num(kyc.lastUpdated, base.kyc.lastUpdated),
      nextStep: typeof kyc.nextStep === "string" ? kyc.nextStep : base.kyc.nextStep,
      documentType: typeof kyc.documentType === "string" ? kyc.documentType : base.kyc.documentType,
      country: typeof kyc.country === "string" ? kyc.country : base.kyc.country,
      requestedAt: typeof kyc.requestedAt === "number" ? kyc.requestedAt : undefined,
      requestedBy: typeof kyc.requestedBy === "string" ? kyc.requestedBy : undefined,
      requestReason: typeof kyc.requestReason === "string" ? kyc.requestReason : undefined,
      requirements: Array.isArray(kyc.requirements)
        ? kyc.requirements.filter((q): q is KycRequirement => q === "identity" || q === "address" || q === "selfie" || q === "funds")
        : undefined,
      submission: kyc.submission && typeof kyc.submission === "object" ? {
        legalName: typeof kyc.submission.legalName === "string" ? kyc.submission.legalName : "",
        dob: typeof kyc.submission.dob === "string" ? kyc.submission.dob : "",
        country: typeof kyc.submission.country === "string" ? kyc.submission.country : "",
        documentType: typeof kyc.submission.documentType === "string" ? kyc.submission.documentType : "",
        source: typeof kyc.submission.source === "string" ? kyc.submission.source : "",
        taxId: typeof kyc.submission.taxId === "string" ? kyc.submission.taxId : "",
        registration: typeof kyc.submission.registration === "string" ? kyc.submission.registration : undefined,
        industry: typeof kyc.submission.industry === "string" ? kyc.submission.industry : undefined,
        application: kyc.submission.application && typeof kyc.submission.application === "object"
          ? (kyc.submission.application as Record<string, unknown>) : undefined,
        documents: Array.isArray(kyc.submission.documents)
          ? kyc.submission.documents
              .filter(d => Boolean(d) && typeof d === "object" && typeof (d as { name?: unknown }).name === "string")
              .map(d => ({ key: String((d as { key: unknown }).key), label: String((d as { label: unknown }).label), name: String((d as { name: unknown }).name) }))
          : [],
        submittedAt: typeof kyc.submission.submittedAt === "number" ? kyc.submission.submittedAt : 0,
      } : undefined,
    },
  };
}

const pushNote = (a: Account, note: Omit<NotificationItem, "id" | "time" | "read">): NotificationItem[] =>
  [{ ...note, id: rid("n"), time: Date.now(), read: false }, ...a.notifications].slice(0, 40);

/* ============================================================
   Shared account state (one source of truth for every page)
   ============================================================ */
/** Member verification awaiting compliance review (served by /api/admin/state). */
export type KycQueueItem = {
  userId: string;
  name: string;
  email: string;
  business: string;
  accountType: "personal" | "business";
  kyc: KycRecord;
};

/** Summary of one member's account (served by /api/admin/state). */
export type PlatformAccount = {
  userId: string;
  name: string;
  email: string;
  business: string;
  accountType: "personal" | "business";
  hasAccount: boolean;
  balance: number;
  pendingBalance: number;
  rewards: number;
  cards: number;
  frozenCards: number;
  txnCount: number;
  pendingTxns: number;
  kycStatus: KycStatus;
  accountStatus: "active" | "restricted";
  lastActivity: number;
  /** From the member's account application — staff see these in the console. */
  dob?: string | null;
  ssn?: string | null;
  city?: string | null;
  state?: string | null;
  idType?: string | null;
  legalName?: string | null;
  ownerName?: string | null;
  applicationAt?: number | null;
};

type SendInput = { counterparty: string; amount: number; category: string; method: string; cardId?: string; note?: string };
type CardInput = { label: string; limit: number; type: Card["type"]; merchantLock?: string; cardholder: string; shippingAddress?: string };
type InvoiceInput = { client: string; clientEmail: string; amount: number; dueDays: number; description?: string };
type InviteInput = { name: string; email: string; role: TeamMember["role"]; monthlyLimit: number };
type PocketInput = { name: string; target: number; color: string; icon: SavingsPocket["icon"] };
type PayeeInput = { name: string; nickname?: string; bankName: string; routingNumber: string; accountLast4: string; accountType: Payee["accountType"] };
type ScheduledInput = { payeeId?: string; payeeName: string; amount: number; category: string; frequency: ScheduledPayment["frequency"]; nextDate: number; autopay: boolean; memo?: string };
type DisputeInput = { transactionId: string; reason: string; detail?: string };

function useAccountState() {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user?.id;
  const name = user?.name ?? "";
  const business = user?.business ?? "";
  const email = user?.email ?? "";
  const accountType = user?.accountType ?? "business";
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const ref = useRef<Account | null>(null);

  useEffect(() => {
    if (!userId) {
      ref.current = null;
      setAccount(null);
      setAccountError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // The backend is the system of record — load the server snapshot.
      try {
        const { account: raw } = await apiGet<{ account: unknown }>("/api/me/state");
        if (cancelled) return;
        ref.current = normalize(raw, { name, business, email, accountType });
        setAccount(ref.current);
        setAccountError(null);
      } catch (err) {
        if (cancelled) return;
        // A rejected session is not an account problem: end it so the login
        // form asks for credentials instead of parking the member on an error
        // card they cannot act on. (This also covers the case where the request
        // went out with no token at all — blocked storage, cleared profile.)
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          endSession();
          return;
        }
        setAccountError(err instanceof Error ? err.message : "Could not load your account.");
      }
    })();
    // Reload only when the signed-in user changes; profile edits sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const commit = useCallback(
    (fn: (a: Account) => Account) => {
      const current = ref.current;
      if (!current) return;
      const next = fn(current);
      ref.current = next;
      setAccount(next); // optimistic — the sync layer reconciles with the server
    },
    [],
  );

  /* ------------------------------------------------------------------
     Backend sync (API mode).
     Every action applies optimistically to the local state above (instant
     UI, works offline), then replays against the server. The server is
     authoritative: after each mutation the account snapshot is re-fetched,
     and if the server rejects an action (insufficient funds, restricted
     account, rails halted, …) the optimistic change is rolled back to the
     server's truth and the member sees the server's error.
     ------------------------------------------------------------------ */
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const refreshFromServer = useCallback(async () => {
    const { account: raw } = await apiGet<{ account: unknown }>("/api/me/state");
    const next = normalize(raw, { name, business, email, accountType });
    ref.current = next;
    setAccount(next);
  }, [name, business, email, accountType]);
  const enqueue = useCallback((run: () => Promise<unknown>, onResult?: (result: unknown) => void) => {
    syncQueue.current = syncQueue.current.then(async () => {
      try {
        const result = await run();
        onResult?.(result);
        await refreshFromServer();
      } catch (err) {
        toast({ tone: "error", title: "Action not saved", description: err instanceof Error ? err.message : "The backend rejected this action." });
        try { await refreshFromServer(); } catch { /* offline — keep the local optimistic state */ }
      }
    });
  }, [toast, refreshFromServer]);

  /**
   * Records created optimistically get a client-side id; the server assigns its
   * own. `adoptId` remembers the mapping (from the create response) and
   * `resolveId` applies it, so a follow-up action taken before the refreshed
   * snapshot lands — pay this invoice, move money out of this pocket, remove
   * this payee — still targets the row the server actually stored.
   */
  const idAliases = useRef(new Map<string, string>());
  const resolveId = useCallback((id: string) => idAliases.current.get(id) ?? id, []);
  const adoptId = useCallback((localId: string, serverId?: unknown) => {
    if (typeof serverId !== "string" || !serverId || serverId === localId) return;
    if (idAliases.current.size > 500) idAliases.current.clear();
    idAliases.current.set(localId, serverId);
  }, []);

  /**
   * Requests are queued, so anything a call site reads while *building* one
   * (an id that a queued create is about to re-map, an amount derived from a
   * row the server may still be writing) must be read when the request runs,
   * not when it is queued. Pass a thunk for path/body values of that kind.
   */
  type Deferred<T> = T | (() => T);
  const resolveDeferred = <T,>(value: Deferred<T>): T =>
    (typeof value === "function" ? (value as () => T)() : value);

  /**
   * The optimistic state is only honest if a mutation that never reached the
   * server is reported instead of looking saved. There is no offline replay
   * queue, so without a session token or with the API known to be down the
   * request is refused *and the member is told* — the action stays unsent and
   * would be lost on refresh. An unresolved probe ("unknown") is not a reason
   * to refuse: the request itself is the better probe, and its failure is
   * surfaced by the queue's error path.
   */
  const canSync = useCallback((): boolean => {
    if (!getToken()) {
      toast({ tone: "error", title: "Action not saved", description: "You're not signed in, so this change was not sent. Sign in and try again." });
      return false;
    }
    if (apiReachability() === "offline") {
      toast({ tone: "error", title: "Action not saved", description: "The Veyra server can't be reached, so this change was not sent and won't survive a refresh. Retrying…" });
      void probeApi(true); // re-probe so the next attempt can go through
      return false;
    }
    return true;
  }, [toast]);

  const syncPost = useCallback((path: Deferred<string>, body?: Deferred<unknown>, onResult?: (result: unknown) => void) => {
    if (!canSync()) return;
    enqueue(() => apiPost(resolveDeferred(path), resolveDeferred(body)), onResult);
  }, [canSync, enqueue]);
  const syncPatch = useCallback((path: Deferred<string>, body: Deferred<unknown>, onResult?: (result: unknown) => void) => {
    if (!canSync()) return;
    enqueue(() => apiPatch(resolveDeferred(path), resolveDeferred(body)), onResult);
  }, [canSync, enqueue]);
  const syncPut = useCallback((path: Deferred<string>, body: Deferred<unknown>) => {
    if (!canSync()) return;
    enqueue(() => apiPut(resolveDeferred(path), resolveDeferred(body)));
  }, [canSync, enqueue]);
  const syncDelete = useCallback((path: Deferred<string>) => {
    if (!canSync()) return;
    enqueue(() => apiDelete(resolveDeferred(path)));
  }, [canSync, enqueue]);

  // Keep account holder + owner row in sync with profile edits.
  useEffect(() => {
    if (!userId || !name) return;
    commit(a => {
      const holder = accountType === "personal" ? name : business || a.bankDetails.holder;
      const synced = a.bankDetails.holder === holder && a.team.some(m => m.role === "Owner" && m.name === name && m.email === email);
      if (synced) return a;
      return {
        ...a,
        bankDetails: { ...a.bankDetails, holder, accountType: accountType === "personal" ? "Personal checking" : "Business checking" },
        team: a.team.map(m => (m.role === "Owner" ? { ...m, name, email } : m)),
      };
    });
  }, [userId, name, business, email, accountType, commit]);

  const deposit = useCallback(
    (amount: number, source: string): MoveResult => {
      const before = ref.current?.balance ?? 0;
      const value = r2(amount);
      const result: MoveResult = { reference: makeReference(), date: Date.now(), amount: value, balanceBefore: before, balanceAfter: r2(before + value), reward: 0, scout: 0 };
      commit(a => ({
        ...a,
        balance: r2(a.balance + value),
        transactions: [
          { id: rid("txn"), merchant: source, category: "Operations", amount: value, reward: 0, scout: 0, date: result.date, note: "Incoming ACH deposit", method: "ACH", reference: result.reference, status: "cleared" },
          ...a.transactions,
        ],
        notifications: pushNote(a, { title: "Deposit received", detail: `+${money(value)} from ${source} is available now.`, type: "transfer" }),
      }));
      syncPost("/api/me/deposits", { amount: value, source });
      return result;
    },
    [commit, syncPost],
  );

  const depositCheck = useCallback(
    (checkNumber: string, issuer: string, amount: number, memo?: string): MoveResult => {
      const before = ref.current?.balance ?? 0;
      const value = r2(amount);
      const result: MoveResult = { reference: makeReference(), date: Date.now(), amount: value, balanceBefore: before, balanceAfter: r2(before + value), reward: 0, scout: 0 };
      commit(a => ({
        ...a,
        balance: r2(a.balance + value),
        transactions: [
          {
            id: rid("txn"),
            merchant: `Check #${checkNumber} · ${issuer}`,
            category: "Operations",
            amount: value,
            reward: 0,
            scout: 0,
            date: result.date,
            note: memo || `Mobile check deposit from ${issuer}`,
            method: "Mobile Check",
            reference: result.reference,
            status: "cleared",
          },
          ...a.transactions,
        ],
        notifications: pushNote(a, {
          title: `Check #${checkNumber} Cleared`,
          detail: `+${money(value)} from ${issuer} deposited and available.`,
          type: "transfer",
        }),
      }));
      syncPost("/api/me/deposits", { amount: value, checkNumber, issuer, memo });
      return result;
    },
    [commit, syncPost],
  );

  const sendPayment = useCallback(
    (input: SendInput): MoveResult => {
      const current = ref.current;
      if (current?.accountStatus === "restricted") {
        throw new Error("Your account is restricted. Outgoing transfers are paused — contact support.");
      }
      const before = current?.balance ?? 0;
      const value = r2(input.amount);
      const reward = r2(value * rewardRate(input.category));
      const scoutOn = current?.preferences.scoutAuto ?? true;
      const scout = scoutOn && Math.random() < 0.65 ? r2(value * (0.03 + Math.random() * 0.07)) : 0;
      const result: MoveResult = { reference: makeReference(), date: Date.now(), amount: value, balanceBefore: before, balanceAfter: r2(before - value + scout), reward, scout };
      // The ledger row's id is the server's; remember it so an immediate
      // follow-up (dispute this payment) targets the stored row either way.
      const txnId = rid("txn");
      commit(a => ({
        ...a,
        balance: r2(a.balance - value + scout),
        rewards: r2(a.rewards + reward),
        lifetimeRewards: r2(a.lifetimeRewards + reward),
        scoutSaved: r2(a.scoutSaved + scout),
        cards: input.cardId ? a.cards.map(c => (c.id === input.cardId ? { ...c, spent: r2(c.spent + value) } : c)) : a.cards,
        transactions: [
          { id: txnId, merchant: input.counterparty, category: input.category, amount: -value, reward, scout, date: result.date, cardId: input.cardId, note: input.note || `${input.method} payment`, method: input.method, reference: result.reference, status: "cleared" },
          ...a.transactions,
        ],
        notifications: [
          ...(scout > 0
            ? [{ id: rid("n"), title: `Scout saved ${money(scout)}`, detail: `Found a better rate on your ${input.counterparty} payment.`, time: Date.now(), read: false, type: "scout" as const }]
            : []),
          { id: rid("n"), title: `Sent ${money(value)} to ${input.counterparty}`, detail: `${input.method} · +${money(reward)} rewards earned.`, time: Date.now(), read: false, type: "transfer" as const },
          ...a.notifications,
        ].slice(0, 40),
      }));
      syncPost(
        "/api/me/transfers",
        { counterparty: input.counterparty, amount: value, category: input.category, method: input.method, cardId: input.cardId, note: input.note },
        (result) => adoptId(txnId, (result as { transaction?: { id?: string } } | null)?.transaction?.id),
      );
      return result;
    },
    [adoptId, commit, syncPost],
  );

  const redeemRewards = useCallback(() => {
    const amount = r2(ref.current?.rewards ?? 0);
    if (amount < 0.01) return 0;
    commit(a => ({
      ...a,
      balance: r2(a.balance + amount),
      rewards: 0,
      transactions: [
        { id: rid("txn"), merchant: "Rewards redemption", category: "Operations", amount, reward: 0, scout: 0, date: Date.now(), note: "Cash back redeemed 1:1", method: "Internal", reference: makeReference(), status: "cleared" },
        ...a.transactions,
      ],
      notifications: pushNote(a, { title: `Redeemed ${money(amount)}`, detail: "Cash back moved to your available balance.", type: "transfer" }),
    }));
    syncPost("/api/me/rewards/redeem");
    return amount;
  }, [commit, syncPost]);

  /** Records a Scout rebate as a credited adjustment and prevents applying it twice. */
  const applyScoutSavings = useCallback(
    (opportunityId: string, merchant: string, amount: number, note: string): boolean => {
      const current = ref.current;
      const value = r2(amount);
      if (!current || !opportunityId || value <= 0 || current.scoutApplied.includes(opportunityId)) return false;
      commit(a => ({
        ...a,
        balance: r2(a.balance + value),
        scoutSaved: r2(a.scoutSaved + value),
        scoutApplied: [...a.scoutApplied, opportunityId],
        transactions: [{
          id: rid("txn"),
          merchant: `Scout savings · ${merchant}`,
          category: "Operations",
          amount: value,
          reward: 0,
          scout: value,
          date: Date.now(),
          note,
          method: "Scout credit",
          reference: makeReference(),
          status: "cleared",
        }, ...a.transactions],
        notifications: pushNote(a, {
          title: `Scout credited ${money(value)}`,
          detail: `Savings from ${merchant} were credited to checking.`,
          type: "scout",
        }),
      }));
      syncPost("/api/me/scout/apply", { opportunityId, merchant, amount: value, note });
      return true;
    },
    [commit, syncPost],
  );

  const createCard = useCallback(
    (input: CardInput): Card => {
      const card: Card = {
        id: rid("card"),
        ...cardNumbers(),
        label: input.label,
        limit: input.limit,
        spent: 0,
        frozen: false,
        type: input.type,
        merchantLock: input.merchantLock || undefined,
        cardholder: input.cardholder,
        pin: digits(4),
        singleTransactionLimit: Math.min(input.limit, 5000),
        dailyAtmLimit: input.type === "physical" ? 1000 : 0,
        controls: defaultCardControls(input.type),
        shipping: input.type === "physical" ? newPhysicalShipping(input.shippingAddress) : virtualShipping(),
        walletStatus: "not_added",
        createdAt: Date.now(),
      };
      commit(a => ({
        ...a,
        cards: [card, ...a.cards],
        notifications: pushNote(a, { title: `${input.type === "virtual" ? "Virtual" : "Physical"} card issued`, detail: `${card.label} •••• ${card.last4} · ${money(card.limit, false)} monthly limit.`, type: "card" }),
      }));
      syncPost("/api/me/cards", { label: input.label, limit: input.limit, type: input.type, merchantLock: input.merchantLock, cardholder: input.cardholder, shippingAddress: input.shippingAddress });
      return card;
    },
    [commit, syncPost],
  );

  const toggleFreeze = useCallback(
    (id: string) => {
      const card = ref.current?.cards.find(c => c.id === id);
      if (!card) return false;
      const frozen = !card.frozen;
      commit(a => ({
        ...a,
        cards: a.cards.map(c => (c.id === id ? { ...c, frozen } : c)),
        notifications: pushNote(a, {
          title: frozen ? `${card.label} card frozen` : `${card.label} card unfrozen`,
          detail: frozen ? "New purchases will be declined until you unfreeze it." : "The card is active and ready to use.",
          type: "card",
        }),
      }));
      syncPatch(`/api/me/cards/${id}`, { frozen });
      return frozen;
    },
    [commit, syncPatch],
  );

  const removeCard = useCallback((id: string) => {
    commit(a => ({ ...a, cards: a.cards.filter(c => c.id !== id) }));
    syncDelete(`/api/me/cards/${id}`);
  }, [commit, syncDelete]);

  const setLimit = useCallback(
    (id: string, limit: number) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, limit } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { limit });
    },
    [commit, syncPatch],
  );

  const setCardControl = useCallback(
    (id: string, key: keyof CardControls, enabled: boolean) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, controls: { ...c.controls, [key]: enabled } } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { controls: { [key]: enabled } });
    },
    [commit, syncPatch],
  );

  const setMerchantLock = useCallback(
    (id: string, merchantLock?: string) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, merchantLock: merchantLock?.trim() || undefined } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { merchantLock: merchantLock?.trim() || "" });
    },
    [commit, syncPatch],
  );

  const setCategoryLock = useCallback(
    (id: string, categoryLock?: string) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, categoryLock: categoryLock || undefined } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { categoryLock: categoryLock || "" });
    },
    [commit, syncPatch],
  );

  const setTransactionLimit = useCallback(
    (id: string, singleTransactionLimit: number) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, singleTransactionLimit } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { singleTransactionLimit });
    },
    [commit, syncPatch],
  );

  const setAtmLimit = useCallback(
    (id: string, dailyAtmLimit: number) => {
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, dailyAtmLimit } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { dailyAtmLimit });
    },
    [commit, syncPatch],
  );

  const changeCardPin = useCallback(
    (id: string, pin: string) => {
      if (!/^\d{4}$/.test(pin)) return false;
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, pin } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { pin });
      return true;
    },
    [commit, syncPatch],
  );

  const toggleCardWallet = useCallback(
    (id: string) => {
      const card = ref.current?.cards.find(c => c.id === id);
      if (!card) return "not_added" as const;
      const walletStatus = card.walletStatus === "added" ? "not_added" : "added";
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, walletStatus } : c)) }));
      syncPatch(`/api/me/cards/${id}`, { walletStatus });
      return walletStatus;
    },
    [commit, syncPatch],
  );

  const advanceCardShipping = useCallback(
    (id: string) => {
      const order: ShippingStatus[] = ["processing", "printing", "shipped", "in_transit", "delivered"];
      const card = ref.current?.cards.find(c => c.id === id);
      if (!card || card.type !== "physical") return card?.shipping.status ?? "not_applicable";
      const index = Math.max(0, order.indexOf(card.shipping.status));
      const status = order[Math.min(index + 1, order.length - 1)];
      commit(a => ({
        ...a,
        cards: a.cards.map(c => c.id === id ? { ...c, shipping: { ...c.shipping, status, deliveredAt: status === "delivered" ? Date.now() : c.shipping.deliveredAt } } : c),
        notifications: pushNote(a, { title: `${card.label} shipment updated`, detail: status === "delivered" ? "Your card was delivered." : `Card status: ${status.replace("_", " ")}.`, type: "card" }),
      }));
      syncPost(`/api/me/cards/${id}/shipping/advance`);
      return status;
    },
    [commit, syncPost],
  );

  const replaceCard = useCallback(
    (id: string, reason: string): Card | null => {
      const old = ref.current?.cards.find(c => c.id === id);
      if (!old) return null;
      const replacement: Card = {
        ...old,
        id: rid("card"),
        ...cardNumbers(),
        label: `${old.label} replacement`,
        spent: 0,
        frozen: false,
        pin: digits(4),
        shipping: old.type === "physical" ? newPhysicalShipping() : virtualShipping(),
        walletStatus: "not_added",
        createdAt: Date.now(),
      };
      commit(a => ({
        ...a,
        cards: [replacement, ...a.cards.map(c => c.id === id ? { ...c, frozen: true } : c)],
        notifications: pushNote(a, { title: `${old.label} replacement issued`, detail: `${reason}. The old card is frozen and •••• ${replacement.last4} is ready.`, type: "card" }),
      }));
      syncPost(`/api/me/cards/${id}/replace`, { reason });
      return replacement;
    },
    [commit, syncPost],
  );

  const markInvoicePaid = useCallback(
    (id: string): Invoice | null => {
      const inv = ref.current?.invoices.find(i => i.id === id);
      if (!inv || inv.status === "paid") return null;
      commit(a => ({
        ...a,
        balance: r2(a.balance + inv.amount),
        invoices: a.invoices.map(i => (i.id === id ? { ...i, status: "paid" } : i)),
        transactions: [
          { id: rid("txn"), merchant: inv.client, category: "Operations", amount: inv.amount, reward: 0, scout: 0, date: Date.now(), note: `Invoice #${inv.id} payment`, method: "ACH", reference: makeReference(), status: "cleared" },
          ...a.transactions,
        ],
        notifications: pushNote(a, { title: `${inv.client} paid ${money(inv.amount)}`, detail: `Invoice #${inv.id} is settled and the funds are available.`, type: "invoice" }),
      }));
      // Settling an invoice credits the account server-side (atomic) and writes
      // the matching ledger row; the snapshot below replaces the optimistic one.
      syncPost(() => `/api/me/invoices/${resolveId(id)}/paid`);
      return inv;
    },
    [commit, resolveId, syncPost],
  );

  const createInvoice = useCallback(
    (input: InvoiceInput): Invoice => {
      const ids = (ref.current?.invoices ?? []).map(i => Number.parseInt(i.id, 10)).filter(n => Number.isFinite(n));
      const invoice: Invoice = {
        id: String((ids.length ? Math.max(...ids) : 1047) + 1),
        client: input.client,
        clientEmail: input.clientEmail,
        amount: r2(input.amount),
        status: "open",
        due: Date.now() + input.dueDays * DAY,
        createdAt: Date.now(),
        description: input.description,
      };
      commit(a => ({
        ...a,
        invoices: [invoice, ...a.invoices],
        notifications: pushNote(a, { title: `Invoice #${invoice.id} sent`, detail: `${money(invoice.amount)} to ${invoice.client} · due in ${input.dueDays} days.`, type: "invoice" }),
      }));
      syncPost(
        "/api/me/invoices",
        { client: input.client, clientEmail: input.clientEmail, amount: invoice.amount, dueDays: input.dueDays, description: input.description },
        (result) => adoptId(invoice.id, (result as { invoice?: { id?: string } } | null)?.invoice?.id),
      );
      return invoice;
    },
    [adoptId, commit, syncPost],
  );

  const sendReminder = useCallback(
    (id: string) => {
      const inv = ref.current?.invoices.find(i => i.id === id);
      if (!inv) return null;
      commit(a => ({ ...a, notifications: pushNote(a, { title: `Reminder sent to ${inv.client}`, detail: `We emailed ${inv.clientEmail} about invoice #${inv.id}.`, type: "invoice" }) }));
      syncPost(() => `/api/me/invoices/${resolveId(id)}/remind`);
      return inv;
    },
    [commit, resolveId, syncPost],
  );

  const redeemPerk = useCallback(
    (perkId: string) => {
      commit(a => ({ ...a, perks: a.perks.map(p => (p.id === perkId ? { ...p, status: "redeemed" } : p)) }));
      syncPost(`/api/me/perks/${perkId}/redeem`);
    },
    [commit, syncPost],
  );

  const inviteTeamMember = useCallback(
    (input: InviteInput): TeamMember => {
      const member: TeamMember = { id: rid("tm"), name: input.name, email: input.email, role: input.role, cardCount: input.role === "Bookkeeper" ? 0 : 1, monthlyLimit: input.monthlyLimit, status: "invited" };
      commit(a => ({
        ...a,
        team: [...a.team, member],
        notifications: pushNote(a, { title: `Invite sent to ${input.name}`, detail: `${input.role} · ${input.monthlyLimit ? `${money(input.monthlyLimit, false)} monthly limit` : "view-only access"}.`, type: "security" }),
      }));
      syncPost(
        "/api/me/team",
        { name: member.name, email: member.email, role: member.role, monthlyLimit: member.monthlyLimit },
        (result) => adoptId(member.id, (result as { member?: { id?: string } } | null)?.member?.id),
      );
      return member;
    },
    [adoptId, commit, syncPost],
  );

  const removeTeamMember = useCallback((id: string) => {
    commit(a => ({ ...a, team: a.team.filter(m => m.id !== id || m.role === "Owner") }));
    // The server also refuses to remove the Owner (400) — the guard above keeps
    // the optimistic state honest without a round trip.
    syncDelete(() => `/api/me/team/${resolveId(id)}`);
  }, [commit, resolveId, syncDelete]);

  const createSavingsPocket = useCallback(
    (input: PocketInput): SavingsPocket => {
      const pocket: SavingsPocket = { id: rid("pocket"), name: input.name.trim(), balance: 0, target: r2(input.target), color: input.color, icon: input.icon, createdAt: Date.now() };
      commit(a => ({ ...a, savingsPockets: [...a.savingsPockets, pocket] }));
      syncPost(
        "/api/me/pockets",
        { name: pocket.name, target: pocket.target, color: pocket.color, icon: pocket.icon },
        (result) => adoptId(pocket.id, (result as { pocket?: { id?: string } } | null)?.pocket?.id),
      );
      return pocket;
    },
    [adoptId, commit, syncPost],
  );

  const transferSavings = useCallback(
    (pocketId: string, amount: number, direction: "to_pocket" | "to_checking") => {
      const pocket = ref.current?.savingsPockets.find(p => p.id === pocketId);
      const current = ref.current;
      const value = r2(amount);
      if (!pocket || !current || value <= 0) return false;
      if (direction === "to_pocket" && value > current.balance) return false;
      if (direction === "to_checking" && value > pocket.balance) return false;
      const intoPocket = direction === "to_pocket";
      commit(a => ({
        ...a,
        balance: r2(a.balance + (intoPocket ? -value : value)),
        savingsPockets: a.savingsPockets.map(p => p.id === pocketId ? { ...p, balance: r2(p.balance + (intoPocket ? value : -value)) } : p),
        transactions: [{ id: rid("txn"), merchant: pocket.name, category: "Operations", amount: intoPocket ? -value : value, reward: 0, scout: 0, date: Date.now(), note: intoPocket ? "Moved to savings pocket" : "Moved from savings pocket", method: "Internal", reference: makeReference(), status: "cleared" }, ...a.transactions],
      }));
      // Money moves server-side in one transaction (with the overdraft check);
      // a rejection rolls the optimistic balances back to the server's truth.
      syncPost(() => `/api/me/pockets/${resolveId(pocketId)}/move`, { amount: value, direction });
      return true;
    },
    [commit, resolveId, syncPost],
  );

  const deleteSavingsPocket = useCallback(
    (id: string) => {
      const pocket = ref.current?.savingsPockets.find(p => p.id === id);
      if (!pocket) return 0;
      commit(a => ({ ...a, balance: r2(a.balance + pocket.balance), savingsPockets: a.savingsPockets.filter(p => p.id !== id) }));
      // Closing a pocket refunds any remaining balance to checking server-side.
      syncDelete(() => `/api/me/pockets/${resolveId(id)}`);
      return pocket.balance;
    },
    [commit, resolveId, syncDelete],
  );

  const addPayee = useCallback(
    (input: PayeeInput): Payee => {
      const payee: Payee = { id: rid("payee"), name: input.name.trim(), nickname: input.nickname?.trim() || undefined, bankName: input.bankName.trim(), routingNumber: input.routingNumber, accountLast4: input.accountLast4, accountType: input.accountType, verified: true, createdAt: Date.now() };
      commit(a => ({ ...a, payees: [...a.payees, payee] }));
      syncPost(
        "/api/me/payees",
        { name: payee.name, nickname: payee.nickname ?? "", bankName: payee.bankName, routingNumber: payee.routingNumber, accountLast4: payee.accountLast4, accountType: payee.accountType },
        (result) => adoptId(payee.id, (result as { payee?: { id?: string } } | null)?.payee?.id),
      );
      return payee;
    },
    [adoptId, commit, syncPost],
  );

  const removePayee = useCallback((id: string) => {
    commit(a => ({ ...a, payees: a.payees.filter(p => p.id !== id) }));
    syncDelete(() => `/api/me/payees/${resolveId(id)}`);
  }, [commit, resolveId, syncDelete]);

  const addScheduledPayment = useCallback(
    (input: ScheduledInput): ScheduledPayment => {
      const payment: ScheduledPayment = { id: rid("bill"), ...input, payeeName: input.payeeName.trim(), amount: r2(input.amount), status: "active" };
      commit(a => ({ ...a, scheduledPayments: [...a.scheduledPayments, payment] }));
      syncPost(
        "/api/me/scheduled",
        {
          payeeId: payment.payeeId, payeeName: payment.payeeName, amount: payment.amount,
          category: payment.category, frequency: payment.frequency, nextDate: payment.nextDate,
          autopay: payment.autopay, memo: payment.memo,
        },
        (result) => adoptId(payment.id, (result as { payment?: { id?: string } } | null)?.payment?.id),
      );
      return payment;
    },
    [adoptId, commit, syncPost],
  );

  const toggleScheduledPayment = useCallback(
    (id: string) => {
      const payment = ref.current?.scheduledPayments.find(p => p.id === id);
      if (!payment || payment.status === "completed") return;
      const status = payment.status === "paused" ? "active" : "paused";
      commit(a => ({ ...a, scheduledPayments: a.scheduledPayments.map(p => p.id === id && p.status !== "completed" ? { ...p, status } : p) }));
      syncPatch(() => `/api/me/scheduled/${resolveId(id)}`, { status });
    },
    [commit, resolveId, syncPatch],
  );

  const removeScheduledPayment = useCallback((id: string) => {
    commit(a => ({ ...a, scheduledPayments: a.scheduledPayments.filter(p => p.id !== id) }));
    syncDelete(() => `/api/me/scheduled/${resolveId(id)}`);
  }, [commit, resolveId, syncDelete]);

  const payScheduledNow = useCallback(
    (id: string) => {
      const payment = ref.current?.scheduledPayments.find(p => p.id === id);
      const current = ref.current;
      if (!payment || !current || payment.amount > current.balance || payment.status === "completed") return false;
      const nextDate = payment.frequency === "weekly" ? payment.nextDate + 7 * DAY : payment.frequency === "monthly" ? new Date(payment.nextDate).setMonth(new Date(payment.nextDate).getMonth() + 1) : payment.nextDate;
      const txnId = rid("txn");
      commit(a => ({
        ...a,
        balance: r2(a.balance - payment.amount),
        scheduledPayments: a.scheduledPayments.map(p => p.id === id ? { ...p, nextDate, status: p.frequency === "once" ? "completed" : p.status } : p),
        transactions: [{ id: txnId, merchant: payment.payeeName, category: payment.category, amount: -payment.amount, reward: 0, scout: 0, date: Date.now(), note: payment.memo || "Scheduled payment", method: "ACH", reference: makeReference(), status: "cleared" }, ...a.transactions],
        notifications: pushNote(a, { title: `${money(payment.amount)} paid to ${payment.payeeName}`, detail: payment.frequency === "once" ? "One-time payment completed." : `Next payment ${shortDate(nextDate)}.`, type: "transfer" }),
      }));
      // The server debits the account, advances next_date and writes the ledger row.
      syncPost(
        () => `/api/me/scheduled/${resolveId(id)}/pay`,
        undefined,
        (result) => adoptId(txnId, (result as { transaction?: { id?: string } } | null)?.transaction?.id),
      );
      return true;
    },
    [adoptId, commit, resolveId, syncPost],
  );

  const createDispute = useCallback(
    (input: DisputeInput): Dispute | null => {
      const txn = ref.current?.transactions.find(t => t.id === input.transactionId);
      if (!txn || txn.amount >= 0 || ref.current?.disputes.some(d => d.transactionId === txn.id && d.status !== "denied")) return null;
      const dispute: Dispute = { id: rid("dispute"), transactionId: txn.id, merchant: txn.merchant, amount: Math.abs(txn.amount), reason: input.reason, detail: input.detail?.trim() || undefined, status: "submitted", openedAt: Date.now(), updatedAt: Date.now() };
      commit(a => ({ ...a, disputes: [dispute, ...a.disputes], notifications: pushNote(a, { title: `Dispute opened for ${txn.merchant}`, detail: `${money(Math.abs(txn.amount))} is under review.`, type: "security" }) }));
      // Files the case in the admin Risk & Fraud queue, where staff arbitrate it.
      // The id is resolved at send time: a payment created moments ago carries
      // a client id until the queued create answers with the server's row.
      syncPost(
        "/api/me/disputes",
        () => ({ transactionId: resolveId(txn.id), reason: dispute.reason, detail: dispute.detail ?? "" }),
        (result) => adoptId(dispute.id, (result as { dispute?: { id?: string } } | null)?.dispute?.id),
      );
      return dispute;
    },
    [adoptId, commit, resolveId, syncPost],
  );

  const revokeSession = useCallback((id: string) => {
    commit(a => ({ ...a, sessions: a.sessions.filter(s => s.id !== id || s.current) }));
    syncPost(`/api/me/sessions/${id}/revoke`);
  }, [commit, syncPost]);
  const toggleTrustedSession = useCallback((id: string) => {
    const trusted = !(ref.current?.sessions.find(s => s.id === id)?.trusted ?? false);
    commit(a => ({ ...a, sessions: a.sessions.map(s => s.id === id ? { ...s, trusted: !s.trusted } : s) }));
    syncPatch(`/api/me/sessions/${id}`, { trusted });
  }, [commit, syncPatch]);
  const freezeAllCards = useCallback(() => {
    commit(a => ({ ...a, cards: a.cards.map(c => ({ ...c, frozen: true })), notifications: pushNote(a, { title: "All cards frozen", detail: "New card purchases will be declined until you unfreeze a card.", type: "security" }) }));
    syncPost("/api/me/cards/freeze-all");
  }, [commit, syncPost]);

  const markNotificationRead = useCallback(
    (id: string) => {
      commit(a => ({ ...a, notifications: a.notifications.map(n => (n.id === id ? { ...n, read: true } : n)) }));
      syncPost(`/api/me/notifications/${id}/read`);
    },
    [commit, syncPost],
  );

  const updateKyc = useCallback(
    (update: Partial<KycRecord> | ((prev: KycRecord) => KycRecord)) => {
      const current = ref.current;
      const next = !current
        ? undefined
        : typeof update === "function" ? update(current.kyc) : { ...current.kyc, ...update, lastUpdated: Date.now() };
      if (!next) return;
      commit(a => ({ ...a, kyc: next }));
      // A submission goes to the review queue; progress saves patch the record.
      if (next.submission) {
        syncPost("/api/me/kyc/submit", next.submission);
      } else {
        syncPatch("/api/me/kyc", {
          nextStep: next.nextStep, documentType: next.documentType,
          country: next.country, completeness: next.completeness,
        });
      }
    },
    [commit, syncPost, syncPatch],
  );

  const markAllNotificationsRead = useCallback(() => {
    commit(a => ({ ...a, notifications: a.notifications.map(n => ({ ...n, read: true })) }));
    syncPost("/api/me/notifications/read-all");
  }, [commit, syncPost]);

  const setPreference = useCallback(
    (key: keyof Preferences, value: boolean) => {
      commit(a => ({ ...a, preferences: { ...a.preferences, [key]: value } }));
      syncPut("/api/me/preferences", { key, value });
    },
    [commit, syncPut],
  );

  const exportCSV = useCallback((txns?: Txn[], filename?: string) => {
    const data = txns ?? ref.current?.transactions ?? [];
    downloadFile(filename ?? `veyra-transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactionsToCSV(data), "text/csv");
    return data.length;
  }, []);

  return useMemo(
    () => ({
      account,
      accountError,
      user,
      deposit,
      depositCheck,
      sendPayment,
      redeemRewards,
      applyScoutSavings,
      createCard,
      toggleFreeze,
      removeCard,
      setLimit,
      setCardControl,
      setMerchantLock,
      setCategoryLock,
      setTransactionLimit,
      setAtmLimit,
      changeCardPin,
      toggleCardWallet,
      advanceCardShipping,
      replaceCard,
      markInvoicePaid,
      createInvoice,
      sendReminder,
      redeemPerk,
      inviteTeamMember,
      removeTeamMember,
      createSavingsPocket,
      transferSavings,
      deleteSavingsPocket,
      addPayee,
      removePayee,
      addScheduledPayment,
      toggleScheduledPayment,
      removeScheduledPayment,
      payScheduledNow,
      createDispute,
      revokeSession,
      toggleTrustedSession,
      freezeAllCards,
      markNotificationRead,
      updateKyc,
      markAllNotificationsRead,
      setPreference,
      exportCSV,
    }),
    [account, accountError, user, deposit, depositCheck, sendPayment, redeemRewards, applyScoutSavings, createCard, toggleFreeze, removeCard, setLimit, setCardControl, setMerchantLock, setCategoryLock, setTransactionLimit, setAtmLimit, changeCardPin, toggleCardWallet, advanceCardShipping, replaceCard, markInvoicePaid, createInvoice, sendReminder, redeemPerk, inviteTeamMember, removeTeamMember, createSavingsPocket, transferSavings, deleteSavingsPocket, addPayee, removePayee, addScheduledPayment, toggleScheduledPayment, removeScheduledPayment, payScheduledNow, createDispute, revokeSession, toggleTrustedSession, freezeAllCards, markNotificationRead, updateKyc, markAllNotificationsRead, setPreference, exportCSV],
  );
}

type AccountValue = ReturnType<typeof useAccountState>;
const AccountCtx = createContext<AccountValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const value = useAccountState();
  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAcct() {
  const ctx = useContext(AccountCtx);
  if (!ctx) throw new Error("useAcct must be used inside AccountProvider");
  return ctx;
}
