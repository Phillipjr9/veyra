import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth, getUsers } from "./auth";

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
export type NotificationItem = { id: string; title: string; detail: string; time: number; read: boolean; type: "scout" | "card" | "transfer" | "security" | "invoice" };
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
};

export type Profile = { name: string; business: string; email: string; accountType: "personal" | "business" };
export type MoveResult = { reference: string; date: number; amount: number; balanceBefore: number; balanceAfter: number; reward: number; scout: number };

/* ============================================================
   Formatting & utilities
   ============================================================ */
export const SCHEMA_VERSION = 6;
const DAY = 86_400_000;
const HOUR = 3_600_000;

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
    // The fictional Arc network uses a reserved demo range instead of a live card-network BIN.
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
   Seed data (all merchants, partners and banks are fictional)
   ============================================================ */
function seed(p: Profile): Account {
  const now = Date.now();
  const personal = p.accountType === "personal";
  const domain = p.email.includes("@") ? p.email.split("@")[1] : "company.example";
  const businessCards: Card[] = [
    { id: rid("card"), label: "Subscriptions", ...cardNumbers("2903"), limit: 4000, spent: 1182.4, frozen: false, type: "virtual", categoryLock: "Software", cardholder: p.name, pin: "2846", singleTransactionLimit: 1200, dailyAtmLimit: 0, controls: defaultCardControls("virtual"), shipping: virtualShipping(), walletStatus: "added", createdAt: now - DAY * 90 },
    { id: rid("card"), label: "Advertising", ...cardNumbers("7741"), limit: 12000, spent: 5620.5, frozen: false, type: "virtual", merchantLock: "Northstar Ads", categoryLock: "Advertising", cardholder: p.name, pin: "6031", singleTransactionLimit: 5000, dailyAtmLimit: 0, controls: defaultCardControls("virtual"), shipping: virtualShipping(), walletStatus: "not_added", createdAt: now - DAY * 60 },
    { id: rid("card"), label: "Metal debit", ...cardNumbers("5118"), limit: 15000, spent: 410, frozen: false, type: "physical", cardholder: p.name, pin: "4917", singleTransactionLimit: 7500, dailyAtmLimit: 1000, controls: defaultCardControls("physical"), shipping: deliveredShipping(now), walletStatus: "added", createdAt: now - DAY * 38 },
  ];
  const personalCards: Card[] = [
    { id: rid("card"), label: "Everyday debit", ...cardNumbers("1842"), limit: 5000, spent: 682.71, frozen: false, type: "physical", cardholder: p.name, pin: "3174", singleTransactionLimit: 2500, dailyAtmLimit: 600, controls: defaultCardControls("physical"), shipping: deliveredShipping(now), walletStatus: "added", createdAt: now - DAY * 70 },
    { id: rid("card"), label: "Online spending", ...cardNumbers("6219"), limit: 1500, spent: 128.55, frozen: false, type: "virtual", categoryLock: "Software", cardholder: p.name, pin: "5402", singleTransactionLimit: 500, dailyAtmLimit: 0, controls: defaultCardControls("virtual"), shipping: virtualShipping(), walletStatus: "added", createdAt: now - DAY * 42 },
    { id: rid("card"), label: "Travel", ...cardNumbers("9086"), limit: 3000, spent: 0, frozen: true, type: "virtual", categoryLock: "Travel", cardholder: p.name, pin: "8251", singleTransactionLimit: 1200, dailyAtmLimit: 0, controls: { ...defaultCardControls("virtual"), international: true }, shipping: virtualShipping(), walletStatus: "not_added", createdAt: now - DAY * 20 },
  ];
  const cards = personal ? personalCards : businessCards;
  const cardFor = (category: string) => personal
    ? category === "Software" ? cards[1].id : category === "Travel" ? cards[2].id : cards[0].id
    : category === "Advertising" ? cards[1].id : category === "Software" || category === "Utilities" ? cards[0].id : cards[2].id;

  // merchant, category, amount, days ago, memo, method, scout rate
  const businessRows: Array<[string, string, number, number, string, string, number]> = [
    ["Fable Cloud", "Software", -218, 1, "Team workspace · monthly", "Card", 0.08],
    ["Northstar Ads", "Advertising", -1240.5, 3, "Spring retargeting campaign", "Card", 0.12],
    ["Orbit Mobile", "Utilities", -92, 5, "Team phone lines", "Card", 0],
    ["Pixelforge", "Software", -256, 8, "Design plugins · annual", "Card", 0.1],
    ["Harbor Studio", "Operations", -1480, 11, "Brand workshop", "ACH", 0],
    ["Canvas Studio", "Software", -150.4, 14, "Editor seats", "Card", 0],
    ["Skyline Rail", "Travel", -318.75, 18, "Client visit", "Card", 0.06],
    ["Mono Labs", "Operations", 6800, 21, "Invoice #1048 · milestone 2", "ACH", 0],
    ["Searchlight Ads", "Advertising", -860.2, 25, "Search campaign", "Card", 0.07],
    ["Deskwork Supply", "Equipment", -412.6, 29, "Monitors for new hires", "Card", 0],
    ["Stratus Compute", "Software", -642.1, 34, "Cloud hosting", "Card", 0.09],
    ["Commons Coworking", "Operations", -599, 42, "Desk memberships", "ACH", 0],
    ["Card processor payout", "Operations", 12450, 45, "Weekly sales settlement", "ACH", 0],
    ["Ledgerly Advisors", "Professional", -1200, 52, "Quarterly bookkeeping", "Wire", 0],
  ];
  const personalRows: Array<[string, string, number, number, string, string, number]> = [
    ["Green Basket Market", "Operations", -86.42, 1, "Weekly groceries", "Card", .04],
    ["Daily Grind Coffee", "Operations", -6.85, 2, "Morning coffee", "Card", 0],
    ["Northfield Payroll", "Operations", 3250, 3, "Direct deposit", "ACH", 0],
    ["Metro Transit", "Travel", -42, 5, "Monthly transit pass", "Card", .06],
    ["Streambox", "Software", -16.99, 8, "Monthly subscription", "Card", .08],
    ["Oak Street Rent", "Operations", -1450, 11, "Monthly rent", "ACH", 0],
    ["City Electric", "Utilities", -93.18, 14, "Electric bill", "ACH", .04],
    ["Harbor Pharmacy", "Operations", -34.6, 18, "Prescription", "Card", 0],
    ["Northstar Air", "Travel", -328.4, 23, "Weekend flight", "Card", .07],
    ["Corner Books", "Operations", -28.95, 27, "Books", "Card", 0],
    ["Orbit Mobile", "Utilities", -74, 33, "Mobile plan", "Card", .05],
    ["Northfield Payroll", "Operations", 3250, 34, "Direct deposit", "ACH", 0],
    ["Home Savings", "Operations", -500, 38, "Savings transfer", "ACH", 0],
    ["Fitness House", "Operations", -49, 47, "Monthly membership", "Card", .05],
  ];
  const rows = personal ? personalRows : businessRows;
  const transactions = rows.map(([merchant, category, amount, daysAgo, note, method, scoutRate]): Txn => ({
    id: rid("txn"),
    merchant,
    category,
    amount,
    reward: amount < 0 ? r2(Math.abs(amount) * rewardRate(category)) : 0,
    scout: amount < 0 ? r2(Math.abs(amount) * scoutRate) : 0,
    date: now - DAY * daysAgo - Math.floor(Math.random() * 8) * HOUR,
    cardId: method === "Card" ? cardFor(category) : undefined,
    note,
    method,
    reference: makeReference(),
    status: "cleared",
  }));

  const invoices: Invoice[] = personal ? [] : [
    { id: "1051", client: "Quill & Co", clientEmail: "accounts@quill.example", amount: 3250, status: "open", due: now + DAY * 18, createdAt: now - DAY * 2, description: "Website retainer" },
    { id: "1050", client: "Lumen Retail", clientEmail: "finance@lumen.example", amount: 1150, status: "overdue", due: now - DAY * 4, createdAt: now - DAY * 24, description: "Product photography" },
    { id: "1049", client: "Harbor Studio", clientEmail: "ap@harbor.example", amount: 2400, status: "open", due: now + DAY * 6, createdAt: now - DAY * 8, description: "Workshop facilitation" },
    { id: "1048", client: "Mono Labs", clientEmail: "billing@monolabs.example", amount: 6800, status: "paid", due: now - DAY * 21, createdAt: now - DAY * 35, description: "Milestone 2 delivery" },
  ];

  const team: TeamMember[] = personal ? [
    { id: rid("tm"), name: p.name, email: p.email, role: "Owner", cardCount: 3, monthlyLimit: 9500, status: "active" },
  ] : [
    { id: rid("tm"), name: p.name, email: p.email, role: "Owner", cardCount: 2, monthlyLimit: 25000, status: "active" },
    { id: rid("tm"), name: "Marcus Vance", email: `marcus@${domain}`, role: "Admin", cardCount: 1, monthlyLimit: 8000, status: "active" },
    { id: rid("tm"), name: "Chloe Chen", email: `chloe@${domain}`, role: "Bookkeeper", cardCount: 0, monthlyLimit: 0, status: "active" },
  ];

  const perks: Perk[] = personal ? [
    { id: "pp1", partner: "Green Basket", category: "Everyday", value: "$15 grocery credit", description: "Spend $100 on groceries and get $15 back.", code: "VEYRA-GROCERY15", status: "available" },
    { id: "pp2", partner: "Northstar Air", category: "Travel", value: "Free checked bag", description: "One checked bag on an eligible round trip.", code: "VEYRA-FLYFREE", status: "available" },
    { id: "pp3", partner: "Streambox", category: "Entertainment", value: "3 months free", description: "New and returning members get three months on us.", code: "VEYRA-STREAM3", status: "redeemed" },
    { id: "pp4", partner: "Daily Grind", category: "Dining", value: "20% back", description: "Cash back on one coffee order each week.", code: "VEYRA-COFFEE20", status: "available" },
  ] : [
    { id: "p1", partner: "Stratus Compute", category: "Infrastructure", value: "$5,000 credits", description: "Cloud hosting credits for new business accounts.", code: "VEYRA-STRATUS-5K", status: "available" },
    { id: "p2", partner: "Notebook Pro", category: "Productivity", value: "6 months free", description: "Docs, wikis and AI writing for your whole team.", code: "VEYRA-NOTEBOOK-6M", status: "available" },
    { id: "p3", partner: "Paywell Checkout", category: "Payments", value: "$20k fee-free", description: "No processing fees on your first $20,000 in card sales.", code: "VEYRA-PAYWELL-20K", status: "redeemed" },
    { id: "p4", partner: "Trackline", category: "Software", value: "$1,000 credit", description: "Issue tracking and roadmaps for product teams.", code: "VEYRA-TRACK-1K", status: "available" },
    { id: "p5", partner: "Wayfare Travel", category: "Travel", value: "20% off hotels", description: "Corporate rates at boutique hotels worldwide.", code: "VEYRA-WAYFARE20", status: "available" },
    { id: "p6", partner: "Ledgerly Advisors", category: "Finance", value: "First month free", description: "A dedicated bookkeeper and a clean monthly close.", code: "VEYRA-LEDGER-1M", status: "available" },
  ];

  const notifications: NotificationItem[] = personal ? [
    { id: rid("n"), title: "Scout saved $26.27", detail: "A lower fare was applied to your Northstar Air purchase.", time: now - 2 * HOUR, read: false, type: "scout" },
    { id: rid("n"), title: "Paycheck deposited", detail: "+$3,250.00 is available in checking.", time: now - DAY * 3, read: false, type: "transfer" },
    { id: rid("n"), title: "Travel card is frozen", detail: "No new purchases can be made until you unfreeze it.", time: now - DAY * 5, read: true, type: "card" },
    { id: rid("n"), title: "New sign-in", detail: "Chrome on macOS · verified with two-factor.", time: now - DAY * 8, read: true, type: "security" },
  ] : [
    { id: rid("n"), title: "Scout saved $148.86", detail: "Negotiated an annual rate on your Northstar Ads plan.", time: now - 2 * HOUR, read: false, type: "scout" },
    { id: rid("n"), title: "Invoice #1050 is overdue", detail: "Lumen Retail hasn't paid $1,150.00 yet.", time: now - 9 * HOUR, read: false, type: "invoice" },
    { id: rid("n"), title: "Deposit received", detail: "+$6,800.00 from Mono Labs cleared via ACH.", time: now - DAY * 2, read: true, type: "transfer" },
    { id: rid("n"), title: "New sign-in", detail: "Chrome on macOS · verified with two-factor.", time: now - DAY * 4, read: true, type: "security" },
  ];

  const savingsPockets: SavingsPocket[] = personal ? [
    { id: rid("pocket"), name: "Emergency fund", balance: 1850, target: 5000, color: "#7558dc", icon: "shield", createdAt: now - DAY * 120 },
    { id: rid("pocket"), name: "Summer trip", balance: 740, target: 2200, color: "#3f9a68", icon: "travel", createdAt: now - DAY * 70 },
  ] : [
    { id: rid("pocket"), name: "Tax reserve", balance: 12400, target: 20000, color: "#7558dc", icon: "tax", createdAt: now - DAY * 140 },
    { id: rid("pocket"), name: "Payroll buffer", balance: 6800, target: 15000, color: "#3f9a68", icon: "payroll", createdAt: now - DAY * 95 },
  ];

  const payees: Payee[] = personal ? [
    { id: rid("payee"), name: "Oak Street Properties", nickname: "Rent", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "3018", accountType: "Checking", verified: true, createdAt: now - DAY * 100 },
    { id: rid("payee"), name: "Jordan Ellis", nickname: "Jordan", bankName: "Union Savings", routingNumber: "122105155", accountLast4: "8842", accountType: "Checking", verified: true, createdAt: now - DAY * 48 },
    { id: rid("payee"), name: "City Electric", bankName: "Metro Bank", routingNumber: "026009593", accountLast4: "4420", accountType: "Checking", verified: true, createdAt: now - DAY * 80 },
  ] : [
    { id: rid("payee"), name: "Harbor Studio", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "1180", accountType: "Checking", verified: true, createdAt: now - DAY * 120 },
    { id: rid("payee"), name: "Ledgerly Advisors", bankName: "Union Savings", routingNumber: "122105155", accountLast4: "7204", accountType: "Checking", verified: true, createdAt: now - DAY * 84 },
    { id: rid("payee"), name: "Commons Coworking", bankName: "Metro Bank", routingNumber: "026009593", accountLast4: "6107", accountType: "Checking", verified: true, createdAt: now - DAY * 64 },
  ];

  const scheduledPayments: ScheduledPayment[] = personal ? [
    { id: rid("bill"), payeeId: payees[0].id, payeeName: payees[0].name, amount: 1450, category: "Operations", frequency: "monthly", nextDate: now + DAY * 7, status: "active", autopay: true, memo: "Monthly rent" },
    { id: rid("bill"), payeeId: payees[2].id, payeeName: payees[2].name, amount: 96, category: "Utilities", frequency: "monthly", nextDate: now + DAY * 12, status: "active", autopay: true, memo: "Electric bill" },
    { id: rid("bill"), payeeName: "Orbit Mobile", amount: 74, category: "Utilities", frequency: "monthly", nextDate: now + DAY * 19, status: "active", autopay: true, memo: "Mobile plan" },
  ] : [
    { id: rid("bill"), payeeId: payees[2].id, payeeName: payees[2].name, amount: 599, category: "Operations", frequency: "monthly", nextDate: now + DAY * 5, status: "active", autopay: true, memo: "Workspace membership" },
    { id: rid("bill"), payeeId: payees[1].id, payeeName: payees[1].name, amount: 1200, category: "Professional", frequency: "monthly", nextDate: now + DAY * 14, status: "active", autopay: false, memo: "Bookkeeping retainer" },
  ];

  const sessions: SecuritySession[] = [
    { id: rid("session"), device: "MacBook Pro", browser: "Chrome", location: "San Francisco, CA", lastActive: now, current: true, trusted: true },
    { id: rid("session"), device: "iPhone", browser: "Veyra mobile", location: "San Francisco, CA", lastActive: now - HOUR * 6, current: false, trusted: true },
    { id: rid("session"), device: "Windows laptop", browser: "Edge", location: "Oakland, CA", lastActive: now - DAY * 18, current: false, trusted: false },
  ];

  const kyc: KycRecord = {
    status: personal ? "in_review" : "approved",
    completeness: personal ? 72 : 92,
    lastUpdated: now - DAY * 2,
    nextStep: personal ? "Awaiting address verification review." : "Ready for final account review.",
    documentType: personal ? "Passport" : "Business registration",
    country: personal ? "United States" : "United States",
  };

  const rewards = r2(transactions.reduce((s, t) => s + t.reward, 0));
  return {
    version: SCHEMA_VERSION,
    balance: personal ? 6824.65 : 84290.42,
    pendingBalance: personal ? 325 : 2174.5,
    rewards,
    lifetimeRewards: r2(rewards + (personal ? 286.4 : 1420.5)),
    scoutSaved: r2(transactions.reduce((s, t) => s + (t.scout ?? 0), 0)),
    cards,
    transactions,
    invoices,
    bankDetails: { accountNumber: personal ? "509381726142" : "409281729014", routingNumber: "091408735", bankName: "Northfield Bank", accountType: personal ? "Personal checking" : "Business checking", holder: personal ? p.name : p.business || "Your business" },
    team,
    perks,
    notifications,
    preferences: { twoFactor: true, loginAlerts: true, scoutAuto: true, weeklyDigest: false },
    savingsPockets,
    payees,
    scheduledPayments,
    disputes: [],
    sessions,
    scoutApplied: [],
    kyc,
  };
}

/* ============================================================
   Persistence + migration from earlier data shapes
   ============================================================ */
const RENAMED: Record<string, string> = { "AWS Cloud": "Stratus Compute", "WeWork All Access": "Commons Coworking" };
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const list = <T,>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);

function normalize(raw: unknown, p: Profile): Account {
  const base = seed(p);
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

const storageKey = (userId: string) => `veyra.account.${userId}`;

function isUsableAccount(account: Partial<Account> | null | undefined): boolean {
  if (!account || typeof account !== "object") return false;
  const hasSeedData = [
    Array.isArray(account.transactions) && account.transactions.length > 0,
    Array.isArray(account.cards) && account.cards.length > 0,
    Array.isArray(account.notifications) && account.notifications.length > 0,
    Array.isArray(account.savingsPockets) && account.savingsPockets.length > 0,
    typeof account.balance === "number" && Number.isFinite(account.balance) && account.balance !== 0,
    typeof account.rewards === "number" && Number.isFinite(account.rewards) && account.rewards !== 0,
    typeof account.scoutSaved === "number" && Number.isFinite(account.scoutSaved) && account.scoutSaved !== 0,
  ].some(Boolean);

  return hasSeedData || typeof account.version === "number";
}

function save(userId: string, account: Account) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(account));
  } catch {
    /* storage full or unavailable */
  }
}

function load(userId: string, p: Profile): Account {
  let parsed: unknown = null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const seeded = seed(p);
  const account = parsed ? normalize(parsed, p) : seeded;
  const hydrated = isUsableAccount(account) ? account : seeded;
  save(userId, hydrated);
  return hydrated;
}

const pushNote = (a: Account, note: Omit<NotificationItem, "id" | "time" | "read">): NotificationItem[] =>
  [{ ...note, id: rid("n"), time: Date.now(), read: false }, ...a.notifications].slice(0, 40);

/* ============================================================
   Admin-initiated KYC requests (cross-account)
   ============================================================ */

/**
 * Places a verification request on a member's account (used by the Super Admin
 * console). The member sees a pop-up alert at the top of their dashboard until
 * they complete verification. Seeds the member's store if they have never
 * signed in on this device so the request is never lost.
 */
export function requestKycForUser(userId: string, profile: Profile, req: KycRequest): void {
  const account = load(userId, profile);
  const requirements = req.requirements.length > 0 ? req.requirements : (["identity", "address"] as KycRequirement[]);
  const next: Account = {
    ...account,
    kyc: {
      ...account.kyc,
      status: account.kyc.status === "approved" ? account.kyc.status : "requested",
      requestedAt: Date.now(),
      requestedBy: req.requestedBy,
      requestReason: req.reason,
      requirements,
      documentType: req.documentType ?? account.kyc.documentType,
      lastUpdated: Date.now(),
      nextStep: `Compliance requested ${requirements.length} document${requirements.length === 1 ? "" : "s"} — upload them to lift your account limits.`,
    },
    notifications: pushNote(account, {
      title: "Identity verification requested",
      detail: `${req.requestedBy} asked you to verify your identity. ${req.reason}`,
      type: "security",
    }),
  };
  save(userId, next);
}

/** Reads a member's KYC status without seeding or mutating their store. */
export function peekKycForUser(userId: string): Pick<KycRecord, "status" | "completeness" | "requestedAt"> {
  const kyc = readStoredAccount(userId)?.kyc;
  if (!kyc || typeof kyc !== "object") return { status: "not_started", completeness: 0 };
  const allowed: KycStatus[] = ["not_started", "requested", "in_review", "approved", "needs_attention"];
  return {
    status: allowed.includes(kyc.status as KycStatus) ? (kyc.status as KycStatus) : "not_started",
    completeness: typeof kyc.completeness === "number" ? kyc.completeness : 0,
    requestedAt: typeof kyc.requestedAt === "number" ? kyc.requestedAt : undefined,
  };
}

/** Parses a member's stored account without side effects (null if absent). */
function readStoredAccount(userId: string): Partial<Account> | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Partial<Account>) : null;
  } catch {
    return null;
  }
}

/** One pending review in the admin KYC queue. */
export type KycQueueItem = {
  userId: string;
  name: string;
  email: string;
  business: string;
  accountType: "personal" | "business";
  kyc: KycRecord;
};

/** All member verifications awaiting compliance review (oldest first). */
export function listKycQueue(): KycQueueItem[] {
  const users = getUsers().filter(u => u.role !== "superadmin");
  const items: KycQueueItem[] = [];
  for (const u of users) {
    const kyc = readStoredAccount(u.id)?.kyc;
    if (!kyc || kyc.status !== "in_review") continue;
    items.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      business: u.business || "",
      accountType: u.accountType === "personal" ? "personal" : "business",
      kyc: kyc as KycRecord,
    });
  }
  return items.sort((a, b) => (a.kyc.submission?.submittedAt ?? a.kyc.lastUpdated) - (b.kyc.submission?.submittedAt ?? b.kyc.lastUpdated));
}

/** Admin decision on a member's verification: approve or request changes. */
export function resolveKycForUser(
  userId: string,
  profile: Profile,
  decision: "approved" | "needs_attention",
  note: string,
  adminName: string,
): void {
  const account = load(userId, profile);
  const approved = decision === "approved";
  const attribution = `Reviewed by ${adminName}.`;
  const next: Account = {
    ...account,
    kyc: {
      ...account.kyc,
      status: decision,
      completeness: approved ? 100 : account.kyc.completeness,
      lastUpdated: Date.now(),
      nextStep: approved
        ? "Identity verified — all account limits are unlocked."
        : note || "One or more documents need attention before approval can continue.",
      ...(approved ? { requestedAt: undefined, requestedBy: undefined, requestReason: undefined, requirements: undefined } : {}),
    },
    notifications: pushNote(account, approved
      ? { title: "Identity verification approved", detail: `${note || "Your identity is verified and all account limits are now unlocked."} ${attribution}`, type: "security" }
      : { title: "Verification changes requested", detail: `${note || "Our compliance team needs another look at one or more documents."} ${attribution}`, type: "security" }),
  };
  save(userId, next);
}

/* ============================================================
   Shared account state (one source of truth for every page)
   ============================================================ */
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
  const userId = user?.id;
  const name = user?.name ?? "";
  const business = user?.business ?? "";
  const email = user?.email ?? "";
  const accountType = user?.accountType ?? "business";
  const [account, setAccount] = useState<Account | null>(null);
  const ref = useRef<Account | null>(null);

  useEffect(() => {
    if (!userId) {
      ref.current = null;
      setAccount(null);
      return;
    }
    const loaded = load(userId, { name, business, email, accountType });
    ref.current = loaded;
    setAccount(loaded);
    // Reload only when the signed-in user changes; profile edits sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const commit = useCallback(
    (fn: (a: Account) => Account) => {
      const current = ref.current;
      if (!current || !userId) return;
      const next = fn(current);
      ref.current = next;
      save(userId, next);
      setAccount(next);
    },
    [userId],
  );

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
      return result;
    },
    [commit],
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
      return result;
    },
    [commit],
  );

  const adminAdjustBalance = useCallback(
    (amount: number, memo: string, type: "credit" | "debit" = "credit"): MoveResult => {
      const before = ref.current?.balance ?? 0;
      const delta = type === "credit" ? r2(amount) : -r2(amount);
      const after = r2(before + delta);
      const result: MoveResult = { reference: makeReference(), date: Date.now(), amount: delta, balanceBefore: before, balanceAfter: after, reward: 0, scout: 0 };
      commit(a => ({
        ...a,
        balance: after,
        transactions: [
          {
            id: rid("txn"),
            merchant: `Treasury Adjustment (${type === "credit" ? "Credit" : "Debit"})`,
            category: "Operations",
            amount: delta,
            reward: 0,
            scout: 0,
            date: result.date,
            note: memo || "Manual Super Admin Ledger Adjustment",
            method: "Adjustment",
            reference: result.reference,
            status: "cleared",
          },
          ...a.transactions,
        ],
        notifications: pushNote(a, {
          title: `Administrative Balance Adjustment`,
          detail: `${type === "credit" ? "+" : "−"}${money(amount)} · ${memo || "System adjustment"}`,
          type: "security",
        }),
      }));
      return result;
    },
    [commit],
  );

  const sendPayment = useCallback(
    (input: SendInput): MoveResult => {
      const current = ref.current;
      const before = current?.balance ?? 0;
      const value = r2(input.amount);
      const reward = r2(value * rewardRate(input.category));
      const scoutOn = current?.preferences.scoutAuto ?? true;
      const scout = scoutOn && Math.random() < 0.65 ? r2(value * (0.03 + Math.random() * 0.07)) : 0;
      const result: MoveResult = { reference: makeReference(), date: Date.now(), amount: value, balanceBefore: before, balanceAfter: r2(before - value + scout), reward, scout };
      commit(a => ({
        ...a,
        balance: r2(a.balance - value + scout),
        rewards: r2(a.rewards + reward),
        lifetimeRewards: r2(a.lifetimeRewards + reward),
        scoutSaved: r2(a.scoutSaved + scout),
        cards: input.cardId ? a.cards.map(c => (c.id === input.cardId ? { ...c, spent: r2(c.spent + value) } : c)) : a.cards,
        transactions: [
          { id: rid("txn"), merchant: input.counterparty, category: input.category, amount: -value, reward, scout, date: result.date, cardId: input.cardId, note: input.note || `${input.method} payment`, method: input.method, reference: result.reference, status: "cleared" },
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
      return result;
    },
    [commit],
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
    return amount;
  }, [commit]);

  /** Records a demo-mode Scout rebate as a credited adjustment and prevents applying it twice. */
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
      return true;
    },
    [commit],
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
      return card;
    },
    [commit],
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
      return frozen;
    },
    [commit],
  );

  const removeCard = useCallback((id: string) => commit(a => ({ ...a, cards: a.cards.filter(c => c.id !== id) })), [commit]);

  const setLimit = useCallback(
    (id: string, limit: number) => commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, limit } : c)) })),
    [commit],
  );

  const setCardControl = useCallback(
    (id: string, key: keyof CardControls, enabled: boolean) =>
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, controls: { ...c.controls, [key]: enabled } } : c)) })),
    [commit],
  );

  const setMerchantLock = useCallback(
    (id: string, merchantLock?: string) =>
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, merchantLock: merchantLock?.trim() || undefined } : c)) })),
    [commit],
  );

  const setCategoryLock = useCallback(
    (id: string, categoryLock?: string) =>
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, categoryLock: categoryLock || undefined } : c)) })),
    [commit],
  );

  const setTransactionLimit = useCallback(
    (id: string, singleTransactionLimit: number) =>
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, singleTransactionLimit } : c)) })),
    [commit],
  );

  const setAtmLimit = useCallback(
    (id: string, dailyAtmLimit: number) =>
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, dailyAtmLimit } : c)) })),
    [commit],
  );

  const changeCardPin = useCallback(
    (id: string, pin: string) => {
      if (!/^\d{4}$/.test(pin)) return false;
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, pin } : c)) }));
      return true;
    },
    [commit],
  );

  const toggleCardWallet = useCallback(
    (id: string) => {
      const card = ref.current?.cards.find(c => c.id === id);
      if (!card) return "not_added" as const;
      const walletStatus = card.walletStatus === "added" ? "not_added" : "added";
      commit(a => ({ ...a, cards: a.cards.map(c => (c.id === id ? { ...c, walletStatus } : c)) }));
      return walletStatus;
    },
    [commit],
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
      return status;
    },
    [commit],
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
      return replacement;
    },
    [commit],
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
      return inv;
    },
    [commit],
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
      return invoice;
    },
    [commit],
  );

  const sendReminder = useCallback(
    (id: string) => {
      const inv = ref.current?.invoices.find(i => i.id === id);
      if (!inv) return null;
      commit(a => ({ ...a, notifications: pushNote(a, { title: `Reminder sent to ${inv.client}`, detail: `We emailed ${inv.clientEmail} about invoice #${inv.id}.`, type: "invoice" }) }));
      return inv;
    },
    [commit],
  );

  const redeemPerk = useCallback(
    (perkId: string) => commit(a => ({ ...a, perks: a.perks.map(p => (p.id === perkId ? { ...p, status: "redeemed" } : p)) })),
    [commit],
  );

  const inviteTeamMember = useCallback(
    (input: InviteInput): TeamMember => {
      const member: TeamMember = { id: rid("tm"), name: input.name, email: input.email, role: input.role, cardCount: input.role === "Bookkeeper" ? 0 : 1, monthlyLimit: input.monthlyLimit, status: "invited" };
      commit(a => ({
        ...a,
        team: [...a.team, member],
        notifications: pushNote(a, { title: `Invite sent to ${input.name}`, detail: `${input.role} · ${input.monthlyLimit ? `${money(input.monthlyLimit, false)} monthly limit` : "view-only access"}.`, type: "security" }),
      }));
      return member;
    },
    [commit],
  );

  const removeTeamMember = useCallback((id: string) => commit(a => ({ ...a, team: a.team.filter(m => m.id !== id || m.role === "Owner") })), [commit]);

  const createSavingsPocket = useCallback(
    (input: PocketInput): SavingsPocket => {
      const pocket: SavingsPocket = { id: rid("pocket"), name: input.name.trim(), balance: 0, target: r2(input.target), color: input.color, icon: input.icon, createdAt: Date.now() };
      commit(a => ({ ...a, savingsPockets: [...a.savingsPockets, pocket] }));
      return pocket;
    },
    [commit],
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
      return true;
    },
    [commit],
  );

  const deleteSavingsPocket = useCallback(
    (id: string) => {
      const pocket = ref.current?.savingsPockets.find(p => p.id === id);
      if (!pocket) return 0;
      commit(a => ({ ...a, balance: r2(a.balance + pocket.balance), savingsPockets: a.savingsPockets.filter(p => p.id !== id) }));
      return pocket.balance;
    },
    [commit],
  );

  const addPayee = useCallback(
    (input: PayeeInput): Payee => {
      const payee: Payee = { id: rid("payee"), name: input.name.trim(), nickname: input.nickname?.trim() || undefined, bankName: input.bankName.trim(), routingNumber: input.routingNumber, accountLast4: input.accountLast4, accountType: input.accountType, verified: true, createdAt: Date.now() };
      commit(a => ({ ...a, payees: [...a.payees, payee] }));
      return payee;
    },
    [commit],
  );

  const removePayee = useCallback((id: string) => commit(a => ({ ...a, payees: a.payees.filter(p => p.id !== id) })), [commit]);

  const addScheduledPayment = useCallback(
    (input: ScheduledInput): ScheduledPayment => {
      const payment: ScheduledPayment = { id: rid("bill"), ...input, payeeName: input.payeeName.trim(), amount: r2(input.amount), status: "active" };
      commit(a => ({ ...a, scheduledPayments: [...a.scheduledPayments, payment] }));
      return payment;
    },
    [commit],
  );

  const toggleScheduledPayment = useCallback(
    (id: string) => commit(a => ({ ...a, scheduledPayments: a.scheduledPayments.map(p => p.id === id && p.status !== "completed" ? { ...p, status: p.status === "paused" ? "active" : "paused" } : p) })),
    [commit],
  );

  const removeScheduledPayment = useCallback((id: string) => commit(a => ({ ...a, scheduledPayments: a.scheduledPayments.filter(p => p.id !== id) })), [commit]);

  const payScheduledNow = useCallback(
    (id: string) => {
      const payment = ref.current?.scheduledPayments.find(p => p.id === id);
      const current = ref.current;
      if (!payment || !current || payment.amount > current.balance || payment.status === "completed") return false;
      const nextDate = payment.frequency === "weekly" ? payment.nextDate + 7 * DAY : payment.frequency === "monthly" ? new Date(payment.nextDate).setMonth(new Date(payment.nextDate).getMonth() + 1) : payment.nextDate;
      commit(a => ({
        ...a,
        balance: r2(a.balance - payment.amount),
        scheduledPayments: a.scheduledPayments.map(p => p.id === id ? { ...p, nextDate, status: p.frequency === "once" ? "completed" : p.status } : p),
        transactions: [{ id: rid("txn"), merchant: payment.payeeName, category: payment.category, amount: -payment.amount, reward: 0, scout: 0, date: Date.now(), note: payment.memo || "Scheduled payment", method: "ACH", reference: makeReference(), status: "cleared" }, ...a.transactions],
        notifications: pushNote(a, { title: `${money(payment.amount)} paid to ${payment.payeeName}`, detail: payment.frequency === "once" ? "One-time payment completed." : `Next payment ${shortDate(nextDate)}.`, type: "transfer" }),
      }));
      return true;
    },
    [commit],
  );

  const createDispute = useCallback(
    (input: DisputeInput): Dispute | null => {
      const txn = ref.current?.transactions.find(t => t.id === input.transactionId);
      if (!txn || txn.amount >= 0 || ref.current?.disputes.some(d => d.transactionId === txn.id && d.status !== "denied")) return null;
      const dispute: Dispute = { id: rid("dispute"), transactionId: txn.id, merchant: txn.merchant, amount: Math.abs(txn.amount), reason: input.reason, detail: input.detail?.trim() || undefined, status: "submitted", openedAt: Date.now(), updatedAt: Date.now() };
      commit(a => ({ ...a, disputes: [dispute, ...a.disputes], notifications: pushNote(a, { title: `Dispute opened for ${txn.merchant}`, detail: `${money(Math.abs(txn.amount))} is under review.`, type: "security" }) }));
      return dispute;
    },
    [commit],
  );

  const advanceDispute = useCallback(
    (id: string) => {
      const dispute = ref.current?.disputes.find(d => d.id === id);
      if (!dispute || dispute.status === "resolved" || dispute.status === "denied") return dispute?.status;
      const status: Dispute["status"] = dispute.status === "submitted" ? "reviewing" : "resolved";
      commit(a => ({
        ...a,
        balance: status === "resolved" ? r2(a.balance + dispute.amount) : a.balance,
        disputes: a.disputes.map(d => d.id === id ? { ...d, status, updatedAt: Date.now() } : d),
        transactions: status === "resolved" ? [{ id: rid("txn"), merchant: `Dispute credit · ${dispute.merchant}`, category: "Operations", amount: dispute.amount, reward: 0, scout: 0, date: Date.now(), note: `Resolved dispute ${dispute.id}`, method: "Adjustment", reference: makeReference(), status: "cleared" }, ...a.transactions] : a.transactions,
        notifications: pushNote(a, { title: status === "resolved" ? "Dispute resolved" : "Dispute under review", detail: status === "resolved" ? `${money(dispute.amount)} was returned to checking.` : `We're reviewing your ${dispute.merchant} claim.`, type: "security" }),
      }));
      return status;
    },
    [commit],
  );

  const revokeSession = useCallback((id: string) => commit(a => ({ ...a, sessions: a.sessions.filter(s => s.id !== id || s.current) })), [commit]);
  const toggleTrustedSession = useCallback((id: string) => commit(a => ({ ...a, sessions: a.sessions.map(s => s.id === id ? { ...s, trusted: !s.trusted } : s) })), [commit]);
  const freezeAllCards = useCallback(() => commit(a => ({ ...a, cards: a.cards.map(c => ({ ...c, frozen: true })), notifications: pushNote(a, { title: "All cards frozen", detail: "New card purchases will be declined until you unfreeze a card.", type: "security" }) })), [commit]);

  const markNotificationRead = useCallback(
    (id: string) => commit(a => ({ ...a, notifications: a.notifications.map(n => (n.id === id ? { ...n, read: true } : n)) })),
    [commit],
  );

  const updateKyc = useCallback(
    (update: Partial<KycRecord> | ((prev: KycRecord) => KycRecord)) => {
      commit(a => ({
        ...a,
        kyc: typeof update === "function" ? update(a.kyc) : { ...a.kyc, ...update, lastUpdated: Date.now() },
      }));
    },
    [commit],
  );

  const markAllNotificationsRead = useCallback(() => commit(a => ({ ...a, notifications: a.notifications.map(n => ({ ...n, read: true })) })), [commit]);

  const setPreference = useCallback(
    (key: keyof Preferences, value: boolean) => commit(a => ({ ...a, preferences: { ...a.preferences, [key]: value } })),
    [commit],
  );

  const exportCSV = useCallback((txns?: Txn[], filename?: string) => {
    const data = txns ?? ref.current?.transactions ?? [];
    downloadFile(filename ?? `veyra-transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactionsToCSV(data), "text/csv");
    return data.length;
  }, []);

  const reset = useCallback(() => {
    if (!userId) return;
    const fresh = seed({ name, business, email, accountType });
    ref.current = fresh;
    save(userId, fresh);
    setAccount(fresh);
  }, [userId, name, business, email, accountType]);

  return useMemo(
    () => ({
      account,
      user,
      deposit,
      depositCheck,
      adminAdjustBalance,
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
      advanceDispute,
      revokeSession,
      toggleTrustedSession,
      freezeAllCards,
      markNotificationRead,
      updateKyc,
      markAllNotificationsRead,
      setPreference,
      exportCSV,
      reset,
    }),
    [account, user, deposit, depositCheck, adminAdjustBalance, sendPayment, redeemRewards, applyScoutSavings, createCard, toggleFreeze, removeCard, setLimit, setCardControl, setMerchantLock, setCategoryLock, setTransactionLimit, setAtmLimit, changeCardPin, toggleCardWallet, advanceCardShipping, replaceCard, markInvoicePaid, createInvoice, sendReminder, redeemPerk, inviteTeamMember, removeTeamMember, createSavingsPocket, transferSavings, deleteSavingsPocket, addPayee, removePayee, addScheduledPayment, toggleScheduledPayment, removeScheduledPayment, payScheduledNow, createDispute, advanceDispute, revokeSession, toggleTrustedSession, freezeAllCards, markNotificationRead, updateKyc, markAllNotificationsRead, setPreference, exportCSV, reset],
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
