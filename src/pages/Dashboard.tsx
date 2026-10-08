import { buildCashFlow } from "../lib/dashboardAnalytics";
import { useDemoPayments } from "../lib/demoPayments";
import { DemoModeNotice } from "../components/DemoPayments";
import { downloadTransactionReceipt } from "../lib/receipts";
import { PLANS, PLAN_NOTICE } from "../../shared/catalog";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useMailingAddress } from "../lib/mailingAddress";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useNavigate, useOutlet, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CashFlowExplorer } from "../components/DashboardIntelligence";
import { SavingsActivityPanel } from "../components/SavingsActivityPanel";
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Award, BadgeCheck, BarChart3, Building2, CalendarClock, CandlestickChart, Check, Clock, Copy, CreditCard,
  Download, Eye, EyeOff, FileText, Gift, Globe2, KeyRound, Landmark, LayoutDashboard, Lock, LogOut, Mail, MapPin, MessageSquare, PackageCheck, Pause, PiggyBank, Play, Plus, Coins,
  Radio, ReceiptText, RefreshCw, Search, Send, Settings as SettingsIcon, TrendingUp, ShieldAlert, ShieldCheck, ShoppingBag, Smartphone, Snowflake, Sparkles, Trash2, Truck, Upload, UserPlus, UserRound, Users, WalletCards, X, Link2,
} from "lucide-react";
import { AnimatedMoney, AnimatedNumber, VirtualCard, ease } from "../components/common";
import { Footer } from "../components/Chrome";
import { useToast } from "../components/Toast";
import { ScoutQuickDrawer } from "../components/ScoutAIAssistant";
import { SecurityCenterContent } from "../components/SecurityCenterContent";
import { CommandPalette } from "../components/CommandPalette";
import { MobileCheckDepositModal } from "../components/MobileCheckDeposit";
import { CategoryPicker } from "../components/CategoryPicker";
import { VeyraIdCard, transferCategoryOptions } from "../components/SendMoneyShared";
import { Confetti, ETA, useMoneyFlow, ZelleLogo, type SendMethod } from "../components/MoneyFlow";
import { InvoiceDetailModal } from "../components/InvoiceDetailModal";
import { NotificationsMenu, NOTE_ROUTES, SuspensionBanner } from "./dashboards/parts";
import { PersonalChrome, PersonalOverview } from "./dashboards/PersonalDashboard";
import { BusinessChrome } from "./dashboards/BusinessDashboard";
import { Camera } from "lucide-react";
import { Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { lockScroll } from "../lib/scrollLock";
import {
  categories, copyText, longDate, money, rewardRate, shortDate, useAcct,
  type Card, type CardControls, type Dispute, type Invoice, type KycRequirement, type Perk, type SavingsPocket, type ShippingStatus, type TeamMember, type Txn,
} from "../lib/store";
import { quoteFee } from "../../shared/fees";

/* ============================================================
   Helpers
   ============================================================ */
const DAY = 86_400_000;
const isFresh = (t: Txn) => Date.now() - t.date < 12_000;
const rise = (i = 0) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.06, duration: 0.5, ease } });
const rangeStyle = (value: number, min: number, max: number) => ({ "--range": `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;
function recentPayees(txns: Txn[], limit = 6) {
  const seen = new Map<string, string>();
  for (const t of txns) {
    if (t.amount < 0 && !seen.has(t.merchant)) seen.set(t.merchant, t.category);
    if (seen.size >= limit) break;
  }
  return [...seen.entries()].map(([name, category]) => ({ name, category }));
}



/** Returns a keyed flash direction whenever the value changes, used for highlight pulses. */
/* ============================================================
   Route guard
   ============================================================ */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="route-loading"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role && user.role !== "user" && !location.pathname.startsWith("/app/superadmin")) {
    return <Navigate to="/app/superadmin" replace />;
  }
  if (user.role === "user" && location.pathname.startsWith("/app/superadmin")) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

/* ============================================================
   Shared dashboard UI
   ============================================================ */
type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: string };
const BUSINESS_NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Banking",
    items: [
      { to: "/app", label: "Overview", icon: <LayoutDashboard size={18} />, end: true },
      { to: "/app/accounts", label: "Accounts", icon: <PiggyBank size={18} /> },
      { to: "/app/cards", label: "Cards", icon: <CreditCard size={18} /> },
      { to: "/app/assets", label: "Crypto", icon: <Coins size={18} /> },
      { to: "/app/markets", label: "Markets", icon: <CandlestickChart size={18} /> },
      { to: "/app/transactions", label: "Transactions", icon: <BarChart3 size={18} /> },
      { to: "/app/transfers", label: "Transfers", icon: <Send size={18} /> },
      { to: "/app/invoices", label: "Invoicing", icon: <ReceiptText size={18} /> },
      { to: "/app/bills", label: "Bills & scheduled", icon: <CalendarClock size={18} /> },
      { to: "/app/plan", label: "Cash plan", icon: <TrendingUp size={18} />, badge: "NEW" },
    ],
  },
  {
    title: "Earn",
    items: [
      { to: "/app/scout", label: "Scout AI", icon: <Sparkles size={18} />, badge: "AI" },
      { to: "/app/rewards", label: "Rewards", icon: <Award size={18} /> },
      { to: "/app/perks", label: "Perks", icon: <Gift size={18} />, badge: "NEW" },
    ],
  },
  {
    title: "Manage",
    items: [
      { to: "/app/team", label: "Team", icon: <Users size={18} /> },
      { to: "/app/statements", label: "Statements", icon: <FileText size={18} /> },
      { to: "/app/disputes", label: "Disputes", icon: <ShieldAlert size={18} /> },
      { to: "/app/support-desk", label: "Support & Chat", icon: <MessageSquare size={18} />, badge: "LIVE" },
      { to: "/app/security", label: "Security", icon: <ShieldCheck size={18} /> },
      { to: "/app/settings", label: "Settings", icon: <SettingsIcon size={18} /> },
    ],
  },
];

const PERSONAL_NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Money",
    items: [
      { to: "/app", label: "Overview", icon: <LayoutDashboard size={18} />, end: true },
      { to: "/app/accounts", label: "Savings goals", icon: <PiggyBank size={18} /> },
      { to: "/app/cards", label: "Cards", icon: <CreditCard size={18} /> },
      { to: "/app/markets", label: "Markets", icon: <CandlestickChart size={18} /> },
      { to: "/app/transactions", label: "Transactions", icon: <BarChart3 size={18} /> },
      { to: "/app/transfers", label: "Send & receive", icon: <Send size={18} /> },
      { to: "/app/zelle", label: "Zelle®", icon: <ZelleLogo size={18} /> },
      { to: "/app/bills", label: "Bills & autopay", icon: <CalendarClock size={18} /> },
      { to: "/app/plan", label: "Money plan", icon: <TrendingUp size={18} />, badge: "NEW" },
    ],
  },
  {
    title: "Benefits",
    items: [
      { to: "/app/scout", label: "Scout savings", icon: <Sparkles size={18} />, badge: "AI" },
      { to: "/app/rewards", label: "Cash back", icon: <Award size={18} /> },
      { to: "/app/perks", label: "Everyday offers", icon: <Gift size={18} /> },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/app/statements", label: "Statements", icon: <FileText size={18} /> },
      { to: "/app/disputes", label: "Disputes", icon: <ShieldAlert size={18} /> },
      { to: "/app/support-desk", label: "Support & Chat", icon: <MessageSquare size={18} />, badge: "LIVE" },
      { to: "/app/security", label: "Security", icon: <ShieldCheck size={18} /> },
      { to: "/app/settings", label: "Settings", icon: <SettingsIcon size={18} /> },
    ],
  },
];

function PageHeader({ eyebrow, title, children }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="app-head">
      <div className="app-head-text">
        <span className="app-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children && <div className="app-head-actions">{children}</div>}
    </header>
  );
}

function Segmented<T extends string>({ id, value, onChange, options }: { id: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }> }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => onChange(o.value)}>
            {on && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  // `onClose` is a fresh arrow function on every render of the page that owns
  // the modal, so it must not be an effect dependency: re-running the effect
  // released and re-took the scroll lock (and issued a real scroll) on every
  // keystroke and toast — dozens of pin/unpin cycles per submit.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    // Locks the page without moving it: releasing a plain overflow lock after a
    // submit (which can resize the page) used to jump the member's view.
    const unlock = lockScroll();
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); unlock(); };
  }, [open]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div className="modal" role="dialog" aria-modal="true" aria-label={title}
            initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}>
            <div className="modal-head">
              <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle-row" onClick={() => onChange(!checked)}>
      <span className="toggle-text"><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <span className={`switch ${checked ? "on" : ""}`}><motion.i layout transition={{ type: "spring", stiffness: 600, damping: 35 }} /></span>
    </button>
  );
}

const TINTS: Array<[string, string]> = [["#ece7fb", "#6a4fd6"], ["#e4effb", "#3a6ea5"], ["#fdeee2", "#b36a2e"], ["#e5f5ec", "#3f8358"], ["#fbe9f0", "#a64a72"], ["#f3efd9", "#7d6a1e"]];
function MerchantIcon({ name, incoming = false, big = false }: { name: string; incoming?: boolean; big?: boolean }) {
  if (incoming) return <span className={`m-icon m-in ${big ? "big" : ""}`}><ArrowDownLeft size={big ? 22 : 15} /></span>;
  const [bg, fg] = TINTS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % TINTS.length];
  return <span className={`m-icon ${big ? "big" : ""}`} style={{ background: bg, color: fg }}>{(name.trim().charAt(0) || "?").toUpperCase()}</span>;
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <motion.div className="empty-state" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <span>{icon}</span><strong>{title}</strong><p>{text}</p>
    </motion.div>
  );
}

const GOLD = ["#f2c96b", "#ffe3a3", "#c4b4ff", "#ffffff"];
function Burst({ fire }: { fire: number }) {
  const reduce = useReducedMotion();
  if (!fire || reduce) return null;
  return (
    <span className="burst" key={fire} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        const dist = 38 + (i % 3) * 16;
        return (
          <motion.i key={i} style={{ background: GOLD[i % GOLD.length] }}
            initial={{ x: 0, y: 0, scale: 0.3, opacity: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: [0.3, 1, 0.5], opacity: [1, 1, 0] }}
            transition={{ duration: 0.85, ease: "easeOut" }} />
        );
      })}
    </span>
  );
}

function UsageBar({ spent, limit }: { spent: number; limit: number }) {
  const pct = Math.min(100, (spent / Math.max(limit, 1)) * 100);
  const tone = pct > 85 ? "high" : pct > 60 ? "mid" : "low";
  return (
    <div className="usage">
      <div className="usage-top"><span>{money(spent)} spent</span><b>{Math.round(pct)}%</b></div>
      <div className={`usage-bar ${tone}`}><motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease }} /></div>
    </div>
  );
}

function CategoryBars({ items, format = (n: number) => money(n, false) }: { items: Array<{ name: string; total: number }>; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map(i => i.total));
  return (
    <div className="cat-list">
      {items.map((c, i) => (
        <div className="cat-row" key={c.name}>
          <div className="cat-label"><span>{c.name}</span><b>{format(c.total)}</b></div>
          <div className="cat-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(c.total / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease }} /></div>
        </div>
      ))}
    </div>
  );
}

function TxnList({ txns, onSelect }: { txns: Txn[]; onSelect: (t: Txn) => void }) {
  return (
    <div className="txn-list">
      <AnimatePresence initial={false}>
        {txns.map(t => (
          <motion.button type="button" layout key={t.id} className={`txn-row ${isFresh(t) ? "is-new" : ""}`} onClick={() => onSelect(t)}
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease }}>
            <MerchantIcon name={t.merchant} incoming={t.amount > 0} />
            <span className="txn-main">
              <strong>{t.merchant}</strong>
              <small>{t.category} · {shortDate(t.date)}</small>
              {t.scout ? <span className="scout-chip"><Sparkles size={11} /> Scout saved {money(t.scout)}</span> : null}
            </span>
            <span className="txn-val">
              <strong className={t.amount > 0 ? "in" : ""}>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</strong>
              {t.reward > 0 && <small>+{money(t.reward)} back</small>}
              {(t.fee ?? 0) > 0 && <small>Fee {money(t.fee ?? 0)}</small>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TxnDrawer({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  const { account } = useAcct();
  const toast = useToast();
  useEffect(() => {
    if (!txn) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [txn, onClose]);

  const card = txn?.cardId ? account?.cards.find(c => c.id === txn.cardId) : undefined;
  const incoming = (txn?.amount ?? 0) > 0;
  const rows: Array<[string, string]> = txn
    ? [
        ["Date", longDate(txn.date)],
        ["Category", txn.category],
        ["Method", txn.method ?? (incoming ? "ACH" : "Card")],
        ...(card ? [["Card", `${card.label} •••• ${card.last4}`] as [string, string]] : []),
        ["Reference", txn.reference ?? "—"],
        ...(txn.note ? [["Memo", txn.note] as [string, string]] : []),
        ...((txn.fee ?? 0) > 0 ? [["Fee", money(txn.fee ?? 0)] as [string, string]] : []),
        ...(txn.reward > 0 ? [["Rewards earned", `+${money(txn.reward)}`] as [string, string]] : []),
        ...(txn.scout ? [["Scout savings", `+${money(txn.scout)}`] as [string, string]] : []),
      ]
    : [];
  const steps = incoming ? ["Initiated by sender", "Received", "Funds available"] : ["Authorized", "Processing", "Cleared"];

  const download = async () => {
    if (!txn) return;
    try { await downloadTransactionReceipt(txn, account?.bankDetails); toast({ tone: "success", title: "PDF receipt prepared" }); }
    catch (error) { toast({ tone: "error", title: "Receipt could not be generated", description: error instanceof Error ? error.message : "Please try again." }); }
  };
  const copyRef = async () => {
    if (!txn?.reference) return;
    const ok = await copyText(txn.reference);
    toast(ok ? { tone: "success", title: "Reference copied", description: txn.reference } : { tone: "error", title: "Couldn't copy the reference" });
  };

  return createPortal(
    <AnimatePresence>
      {txn && <motion.div key="txn-scrim" className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />}
      {txn && (
        <motion.aside key="txn-drawer" className="drawer" role="dialog" aria-modal="true" aria-label="Transaction details"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 38 }}>
          <div className="drawer-head">
            <span>Transaction details</span>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details"><X size={16} /></button>
          </div>
          <div className="drawer-hero">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 380, damping: 20 }}>
              <MerchantIcon name={txn.merchant} incoming={incoming} big />
            </motion.div>
            <strong className={`drawer-amount ${incoming ? "in" : ""}`}>{incoming ? "+" : "−"}{money(Math.abs(txn.amount))}</strong>
            <span className="drawer-merchant">{txn.merchant}</span>
            <span className={`status-pill ${txn.status === "cleared" ? "cleared" : txn.status === "failed" ? "overdue" : "open"}`}>{txn.status === "cleared" && <Check size={11} />} {txn.status === "cleared" ? "Cleared" : txn.status === "failed" ? "Failed" : "Pending"}</span>
          </div>
          <div className="timeline">
            {steps.map((s, i) => (
              <motion.div key={s} className="tl-item" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                <i />
                <div><b>{s}</b><small>{longDate(txn.date + i * (incoming ? 90_000 : 45 * 60_000))}</small></div>
              </motion.div>
            ))}
          </div>
          <dl className="drawer-rows">
            {rows.map(([k, v], i) => (
              <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.04 }}>
                <dt>{k}</dt>
                <dd className={k === "Rewards earned" ? "in" : k === "Scout savings" ? "violet-text" : ""}>{v}</dd>
              </motion.div>
            ))}
          </dl>
          <div className="drawer-actions">
            {!incoming && txn.method === "Card" && <Link className="ghost-btn danger" to={`/app/disputes?txn=${txn.id}`} onClick={onClose}><ShieldAlert size={14} /> Report</Link>}
            <button type="button" className="ghost-btn" onClick={copyRef}><Copy size={14} /> Copy reference</button>
            <button type="button" className="solid-btn" onClick={download}><Download size={14} /> Receipt</button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function WelcomeModal() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { account } = useAcct();
  const { openDeposit } = useMoneyFlow();
  const open = params.get("welcome") === "1" && !!account;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("welcome");
    setParams(next, { replace: true });
  };
  const first = user?.name.split(" ")[0] ?? "there";
  const personal = user?.accountType === "personal";
  const steps = [
    { icon: <Landmark size={14} />, text: `Checking account •••• ${account?.bankDetails.accountNumber.slice(-4) ?? ""} is open` },
    { icon: <CreditCard size={14} />, text: personal ? "Your everyday debit card is ready to use" : "Your first virtual card is ready to use" },
    { icon: <Sparkles size={14} />, text: "Scout AI is now watching for savings" },
  ];
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="flow-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
          <motion.div className="flow-modal welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title"
            initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
            <div className="welcome-confetti"><Confetti count={34} /></div>
            <motion.div className="welcome-card" style={{ transformPerspective: 900 }} initial={{ rotateX: 55, y: 50, opacity: 0 }} animate={{ rotateX: 0, y: 0, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 110, damping: 15 }}>
              <VirtualCard label={personal ? "Everyday debit" : "Business"} holder={user?.name ?? "Cardholder"} last4={account?.cards[0]?.last4} type={personal ? "physical" : "virtual"} />
            </motion.div>
            <motion.h2 id="welcome-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>Welcome to Veyra, {first}</motion.h2>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>Your {personal ? "personal checking" : "business"} account is open and ready. Here's what we set up for you.</motion.p>
            <ul className="welcome-list">
              {steps.map((s, i) => (
                <motion.li key={s.text} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 + i * 0.12 }}>
                  <span>{s.icon}</span>{s.text}<Check size={15} className="welcome-check" />
                </motion.li>
              ))}
            </ul>
            <div className="flow-actions">
              <button type="button" className="ghost-btn" onClick={() => { close(); openDeposit(); }}><ArrowDownLeft size={15} /> Add funds</button>
              <button type="button" className="solid-btn" onClick={close} autoFocus>Explore dashboard <ArrowRight size={15} /></button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ============================================================
   Layout
   ============================================================ */
/* ============================================================
   KYC request banner (admin-initiated verification)
   ============================================================ */

const KYC_DOC_LABELS: Record<string, string> = {
  identity: "photo ID",
  address: "proof of address",
  selfie: "selfie / liveness check",
  funds: "source-of-funds document",
};

/**
 * Persistent alert pinned to the top of every dashboard page while identity
 * verification is outstanding. Rendered when an admin requests verification
 * (status "requested"), when documents need attention, or quietly while a
 * review is in progress. Never shown once the member is verified.
 */
function KycAlertBanner() {
  const { account } = useAcct();
  const [dismissedReview, setDismissedReview] = useState(false);
  if (!account) return null;
  const { status, requestedBy, requestedAt, requestReason, requirements } = account.kyc;

  if (status === "approved" || status === "not_started") return null;
  if (status === "in_review" && dismissedReview) return null;

  const asked = status === "requested" || status === "needs_attention";
  const docs = (requirements ?? []).map(r => KYC_DOC_LABELS[r]).filter(Boolean);
  const docList = status === "requested" && docs.length > 0 ? ` Required: ${docs.join(", ")}.` : "";

  return (
    <motion.section
      className={`kyc-banner ${asked ? "is-urgent" : "is-info"}`}
      role="alert"
      aria-label="Identity verification"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <span className="kyc-banner-icon">
        <img
          src={asked ? "/images/icon-shield-3d-alert.webp" : "/images/icon-shield-3d-check.webp"}
          alt=""
          width={34}
          height={34}
          loading="lazy"
          decoding="async"
        />
      </span>
      <div className="kyc-banner-copy">
        <strong>
          {status === "requested" && "Identity verification requested"}
          {status === "needs_attention" && "Verification needs your attention"}
          {status === "in_review" && "Identity verification is in review"}
        </strong>
        <span>
          {status === "requested" && (requestReason || "Our compliance team has asked you to verify your identity.")}
          {status === "needs_attention" && (account.kyc.nextStep || "Additional documents are needed before your review can continue.")}
          {status === "in_review" && "We received your documents. Most reviews complete within 1–2 business days."}
          {docList}
        </span>
        {status === "requested" && requestedBy && (
          <em className="kyc-banner-meta">Requested by {requestedBy}{requestedAt ? ` · ${shortDate(requestedAt)}` : ""}</em>
        )}
      </div>
      <div className="kyc-banner-actions">
        {asked ? (
          <Link to="/app/kyc" className="solid-btn sm"><ShieldCheck size={14} /> Verify identity</Link>
        ) : (
          <>
            <Link to="/app/kyc" className="ghost-btn sm">View status</Link>
            <button type="button" className="kyc-banner-dismiss" aria-label="Dismiss" onClick={() => setDismissedReview(true)}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </motion.section>
  );
}

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { account, accountError, markAllNotificationsRead, markNotificationRead } = useAcct();
  const { openDeposit } = useMoneyFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();
  const [notifOpen, setNotifOpen] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [scoutDrawerOpen, setScoutDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [checkDepositOpen, setCheckDepositOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unread = account?.notifications.filter(n => !n.read).length ?? 0;
  const prevUnread = useRef(unread);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(p => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { setNotifOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (unread > prevUnread.current) {
      prevUnread.current = unread;
      setRinging(true);
      const t = window.setTimeout(() => setRinging(false), 900);
      return () => window.clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread]);

  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => { if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNotifOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [notifOpen]);

  if (user?.role && user.role !== "user" && !location.pathname.startsWith("/app/superadmin")) {
    return <Navigate to="/app/superadmin" replace />;
  }
  if (accountError) {
    return (
      <div className="route-loading" style={{ flexDirection: "column", gap: 12, padding: 24, textAlign: "center" }}>
        <strong style={{ fontSize: 16 }}>We couldn't load your account</strong>
        <span style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 420, lineHeight: 1.6 }}>{accountError}</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" className="solid-btn sm" onClick={() => window.location.reload()}>Retry</button>
          {/* Belt and braces: whatever went wrong with the session, the member
              can always get back to a sign-in form from here. */}
          <button type="button" className="ghost-btn sm" onClick={logout}>Sign in again</button>
        </div>
      </div>
    );
  }
  if (!account || !user) return <div className="route-loading"><span className="spinner" /></div>;

  const personal = user.accountType === "personal";
  const nav = personal ? PERSONAL_NAV : BUSINESS_NAV;
  const notificationMenu = (
    <NotificationsMenu
      items={account.notifications}
      unread={unread}
      open={notifOpen}
      ringing={ringing}
      containerRef={notifRef}
      onToggle={() => setNotifOpen(o => !o)}
      onMarkAll={markAllNotificationsRead}
      onOpen={n => { markNotificationRead(n.id); setNotifOpen(false); navigate(NOTE_ROUTES[n.type] ?? "/app"); }}
    />
  );
  const content = (
    <>
      <SuspensionBanner />
      <KycAlertBanner />
      <motion.main key={location.pathname} className="app-content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
        {outlet}
      </motion.main>
      <Footer />
    </>
  );

  // Each account type gets its own shell: the personal dashboard is a warm,
  // pill-navigated surface, while the business workspace keeps the operating
  // rail and treasury top bar. They share state and behaviour, not looks.
  return (
    <>
      {personal
        ? (
          <div className="app-root personal-root">
            <PersonalChrome
              user={user}
              nav={nav}
              unread={unread}
              notifications={notificationMenu}
              onOpenPalette={() => setPaletteOpen(true)}
              onSignOut={() => { logout(); navigate("/"); }}
            >{content}</PersonalChrome>
          </div>
        )
        : (
          <BusinessChrome
            user={user}
            accountNumber={account.bankDetails.accountNumber}
            balance={account.balance}
            nav={nav}
            notifications={notificationMenu}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenScout={() => setScoutDrawerOpen(true)}
            onOpenDeposit={() => openDeposit()}
            onOpenCheckDeposit={() => setCheckDepositOpen(true)}
            onSignOut={() => { logout(); navigate("/"); }}
          >{content}</BusinessChrome>
        )}


      <WelcomeModal />
      <ScoutQuickDrawer open={scoutDrawerOpen} onClose={() => setScoutDrawerOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenDeposit={() => openDeposit()}
        onOpenCheckDeposit={() => setCheckDepositOpen(true)}
        onOpenZelleHub={() => navigate("/app/zelle")}
        onOpenScout={() => setScoutDrawerOpen(true)}
      />
      <MobileCheckDepositModal open={checkDepositOpen} onClose={() => setCheckDepositOpen(false)} />
    </>
  );
}

/* ============================================================
   Overview
   ============================================================ */
/**
 * The member home. Personal and business accounts get genuinely different
 * dashboards (see ./dashboards/*) rather than one layout with swapped labels.
 */
export function Overview() {
  const { account, user } = useAcct();
  if (!account) return null;
  return user?.accountType === "business" ? <BusinessOverview /> : <PersonalOverview />;
}

/* ============================================================
   Business overview
   ============================================================ */
function BusinessOverview() {
  const { account, user } = useAcct();
  const { openDeposit } = useMoneyFlow();
  const [selected, setSelected] = useState<Txn | null>(null);
  if (!account) return null;

  const businessName = user?.business || "Your business";
  const openInvoices = account.invoices
    .filter(invoice => invoice.status !== "paid")
    .sort((a, b) => a.due - b.due);
  const scheduledBills = account.scheduledPayments
    .filter(payment => payment.status === "active")
    .sort((a, b) => a.nextDate - b.nextDate);
  const monthFlow = account.analytics?.ranges[30] ?? buildCashFlow(account.transactions, 30);
  const monthlyIn = monthFlow.inflow;
  const monthlyOut = monthFlow.outflow;
  const expectedReceivables = openInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const plannedPayables = scheduledBills.reduce((sum, payment) => sum + payment.amount, 0);
  const activeTeam = account.team.filter(member => member.status === "active").length;
  const activeCards = account.cards.filter(card => !card.frozen).length;
  const totalCardLimit = account.cards.filter(card => !card.frozen).reduce((sum, card) => sum + card.limit, 0);
  const runwayDays = monthlyOut > 0 ? Math.floor((account.balance / monthlyOut) * 30) : null;
  const overdueInvoices = openInvoices.filter(invoice => invoice.status === "overdue");

  return (
    <div className="app-page business-dashboard">
      <motion.section className="business-hero" {...rise(0)}>
        <div className="business-hero-orbit business-hero-orbit-one" aria-hidden="true" />
        <div className="business-hero-orbit business-hero-orbit-two" aria-hidden="true" />
        <div className="business-hero-copy">
          <span className="business-overline"><Building2 size={14} /> Business command center <i /> Live treasury view</span>
          <h1>{businessName}</h1>
          <p>Decide what moves next with cash, receivables, cards and your team in one clear operating view.</p>
          <div className="business-hero-actions">
            <Link to="/app/invoices" className="business-primary-action"><ReceiptText size={15} /> Create invoice</Link>
            <Link to="/app/transfers" className="business-secondary-action"><Send size={15} /> Pay a vendor</Link>
            <button type="button" className="business-icon-action" onClick={() => openDeposit()}><Plus size={16} /> Add funds</button>
          </div>
        </div>
        <div className="business-cash-card">
          <div className="business-cash-top"><span>Available operating cash</span><span className="business-live-pill"><i /> Live</span></div>
          <AnimatedMoney value={account.balance} className="business-cash-value" cents fromZero />
          <div className="business-cash-foot">
            <div><span>Pending</span><strong>{money(account.pendingBalance)}</strong></div>
            <div><span>Last 30 days · net</span><strong className={monthlyIn >= monthlyOut ? "is-positive" : ""}>{monthlyIn >= monthlyOut ? "+" : "−"}{money(Math.abs(monthlyIn - monthlyOut), false)}</strong></div>
          </div>
          <div className="business-cash-progress" aria-hidden="true">
            <i style={{ width: `${Math.min(100, monthlyIn || monthlyOut ? (monthlyIn / Math.max(monthlyIn, monthlyOut || 1)) * 100 : 0)}%` }} />
          </div>
        </div>
      </motion.section>

      <nav className="business-action-grid" aria-label="Business shortcuts">
        <Link to="/app/invoices"><span className="business-action-icon invoice"><ReceiptText size={17} /></span><span><b>Invoice clients</b><small>{openInvoices.length ? `${openInvoices.length} awaiting payment` : "Create a branded invoice"}</small></span><ArrowRight size={15} /></Link>
        <Link to="/app/bills"><span className="business-action-icon bills"><CalendarClock size={17} /></span><span><b>Plan bills</b><small>{scheduledBills.length ? `${scheduledBills.length} active scheduled payments` : "Schedule a vendor payment"}</small></span><ArrowRight size={15} /></Link>
        <Link to="/app/cards"><span className="business-action-icon cards"><CreditCard size={17} /></span><span><b>Control cards</b><small>{activeCards} active · {money(totalCardLimit, false)} combined limit</small></span><ArrowRight size={15} /></Link>
        <Link to="/app/team"><span className="business-action-icon team"><Users size={17} /></span><span><b>Manage team</b><small>{activeTeam} active teammates</small></span><ArrowRight size={15} /></Link>
      </nav>

      <section className="business-metric-grid" aria-label="Business health overview">
        <motion.article className="business-metric-card accent-cash" {...rise(1)}>
          <span>Cash cover</span>
          <strong>{runwayDays === null ? "—" : `${runwayDays} days`}</strong>
          <small>{monthlyOut ? `Based on ${money(monthlyOut, false)} in last-30-day outflow` : "Add activity to see your operating cover"}</small>
          <div className="business-metric-line"><i style={{ width: `${Math.min(100, runwayDays === null ? 0 : runwayDays / 0.9)}%` }} /></div>
        </motion.article>
        <motion.article className="business-metric-card accent-receivable" {...rise(2)}>
          <span>Receivables</span>
          <AnimatedMoney value={expectedReceivables} className="business-metric-value" />
          <small>{openInvoices.length} open · {overdueInvoices.length ? `${overdueInvoices.length} overdue` : "none overdue"}</small>
          <Link to="/app/invoices">Review invoices <ArrowRight size={13} /></Link>
        </motion.article>
        <motion.article className="business-metric-card accent-payable" {...rise(3)}>
          <span>Planned payables</span>
          <AnimatedMoney value={plannedPayables} className="business-metric-value" />
          <small>{scheduledBills.length} scheduled payments</small>
          <Link to="/app/bills">Review schedule <ArrowRight size={13} /></Link>
        </motion.article>
        <motion.article className="business-metric-card accent-team" {...rise(4)}>
          <span>Controls & access</span>
          <strong>{activeCards + activeTeam}</strong>
          <small>{activeCards} card{activeCards === 1 ? "" : "s"} · {activeTeam} teammate{activeTeam === 1 ? "" : "s"}</small>
          <Link to="/app/team">Manage access <ArrowRight size={13} /></Link>
        </motion.article>
      </section>

      <div className="business-workspace-grid">
        <motion.section className="panel business-flow-panel" {...rise(5)}>
          <CashFlowExplorer analytics={account.analytics} transactions={account.transactions} title="Operating cash flow" business />
          <div className="business-flow-footer"><span><TrendingUp size={14} /> {monthlyIn >= monthlyOut ? "Cash-positive over the past 30 days" : "Outflows are higher than inflows over the past 30 days"}</span><Link to="/app/transactions">Open ledger <ArrowRight size={13} /></Link></div>
        </motion.section>

        <motion.aside className="business-readiness-card" {...rise(6)}>
          <div className="business-readiness-top"><span className="business-panel-kicker">Operating readiness</span><ShieldCheck size={18} /></div>
          <h2>Your controls are connected</h2>
          <p>Stay ready to collect, spend and delegate with the right financial controls in place.</p>
          <div className="business-readiness-list">
            <div><span className="business-readiness-check"><Check size={12} /></span><span><b>Business checking</b><small>Account ending •••• {account.bankDetails.accountNumber.slice(-4) || "—"}</small></span></div>
            <div><span className={`business-readiness-check ${account.kyc.status === "approved" ? "complete" : "pending"}`}>{account.kyc.status === "approved" ? <Check size={12} /> : <Clock size={12} />}</span><span><b>Identity verification</b><small>{account.kyc.status === "approved" ? "Verified" : account.kyc.nextStep || "Complete verification"}</small></span></div>
            <div><span className={`business-readiness-check ${activeCards ? "complete" : "pending"}`}>{activeCards ? <Check size={12} /> : <Plus size={12} />}</span><span><b>Spend controls</b><small>{activeCards ? `${activeCards} active card${activeCards === 1 ? "" : "s"}` : "Issue a business card"}</small></span></div>
          </div>
          <Link to={account.kyc.status === "approved" ? "/app/security" : "/app/kyc"} className="business-readiness-link">{account.kyc.status === "approved" ? "Review account security" : "Complete verification"} <ArrowRight size={14} /></Link>
        </motion.aside>
      </div>

      <div className="business-detail-grid">
        <motion.section className="panel business-list-panel" {...rise(7)}>
          <div className="panel-head"><div><span className="business-panel-kicker">Get paid</span><h2>Receivables watchlist</h2></div><Link to="/app/invoices" className="text-link">All invoices <ArrowRight size={14} /></Link></div>
          {openInvoices.length ? <div className="business-invoice-list">
            {openInvoices.slice(0, 4).map(invoice => <Link to="/app/invoices" className="business-invoice-row" key={invoice.id}>
              <span className={`business-invoice-status ${invoice.status}`}><ReceiptText size={14} /></span>
              <span className="business-row-main"><b>{invoice.client}</b><small>#{invoice.id} · Due {shortDate(invoice.due)}</small></span>
              <span className="business-row-value"><b>{money(invoice.amount)}</b><small className={invoice.status === "overdue" ? "is-overdue" : ""}>{invoice.status}</small></span>
            </Link>)}
          </div> : <div className="business-empty"><ReceiptText size={19} /><div><b>No outstanding invoices</b><span>Create an invoice when you are ready to collect.</span></div><Link to="/app/invoices">Create invoice <ArrowRight size={13} /></Link></div>}
        </motion.section>

        <motion.section className="panel business-list-panel" {...rise(8)}>
          <div className="panel-head"><div><span className="business-panel-kicker">Keep moving</span><h2>Upcoming payments</h2></div><Link to="/app/bills" className="text-link">View schedule <ArrowRight size={14} /></Link></div>
          {scheduledBills.length ? <div className="business-bill-list">
            {scheduledBills.slice(0, 4).map(payment => <Link to="/app/bills" className="business-bill-row" key={payment.id}>
              <span className="business-bill-date"><b>{new Date(payment.nextDate).getDate()}</b><small>{new Date(payment.nextDate).toLocaleDateString("en-US", { month: "short" })}</small></span>
              <span className="business-row-main"><b>{payment.payeeName}</b><small>{payment.frequency} · {payment.category}</small></span>
              <span className="business-row-value"><b>{money(payment.amount)}</b><small>{payment.autopay ? "Autopay" : "Scheduled"}</small></span>
            </Link>)}
          </div> : <div className="business-empty"><CalendarClock size={19} /><div><b>No scheduled payments</b><span>Plan recurring bills and vendor payments in advance.</span></div><Link to="/app/bills">Schedule bill <ArrowRight size={13} /></Link></div>}
        </motion.section>
      </div>

      <motion.section className="panel business-activity-panel" {...rise(9)}>
        <div className="panel-head"><div><span className="business-panel-kicker">Live ledger</span><h2>Recent business activity</h2><span className="panel-sub">Select a transaction to inspect its details.</span></div><Link to="/app/transactions" className="text-link">View all activity <ArrowRight size={14} /></Link></div>
        <TxnList txns={account.transactions.slice(0, 6)} onSelect={setSelected} />
      </motion.section>
      <motion.section className="panel business-activity-panel" {...rise(10)} aria-label="Recent deposits">
        <div className="panel-head"><h2>Recent deposits</h2><Link to="/app/transactions" className="text-link">View activity <ArrowRight size={14} /></Link></div>
        <TxnList txns={account.transactions.filter(t => t.category === "Funding" && t.amount > 0).slice(0, 5)} onSelect={setSelected} />
      </motion.section>
      <TxnDrawer txn={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ============================================================
   Cards
   ============================================================ */
type CardFilter = "all" | "virtual" | "physical" | "frozen";

type CardManagerTab = "details" | "controls" | "security" | "delivery";
const CARD_CONTROL_META: Array<{ key: keyof CardControls; title: string; text: string; icon: ReactNode; physicalOnly?: boolean }> = [
  { key: "online", title: "Online purchases", text: "Use this card on websites and in apps.", icon: <ShoppingBag size={16} /> },
  { key: "contactless", title: "Contactless payments", text: "Tap to pay at supported terminals.", icon: <Radio size={16} /> },
  { key: "atm", title: "ATM withdrawals", text: "Withdraw cash with this card and PIN.", icon: <Landmark size={16} />, physicalOnly: true },
  { key: "international", title: "International use", text: "Allow purchases outside your home country.", icon: <Globe2 size={16} /> },
  { key: "magstripe", title: "Magnetic stripe", text: "Enable swipe payments when chip is unavailable.", icon: <CreditCard size={16} />, physicalOnly: true },
];
const SHIPPING_ORDER: ShippingStatus[] = ["processing", "printing", "shipped", "in_transit", "delivered"];
const SHIPPING_LABEL: Record<ShippingStatus, string> = {
  not_applicable: "Not applicable", processing: "Order received", printing: "Card printing", shipped: "Shipped", in_transit: "In transit", delivered: "Delivered",
};

function CardManager({ card, onClose, onReplacement }: { card: Card | null; onClose: () => void; onReplacement: (card: Card) => void }) {
  const {
    user,
    setCardControl, setMerchantLock, setCategoryLock, setTransactionLimit, setAtmLimit, changeCardPin, toggleCardWallet,
    advanceCardShipping, replaceCard, toggleFreeze,
  } = useAcct();
  const toast = useToast();
  const [tab, setTab] = useState<CardManagerTab>("details");
  const [revealed, setRevealed] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [merchant, setMerchant] = useState("");
  const [reason, setReason] = useState("Card damaged");

  useEffect(() => {
    if (!card) return;
    setTab("details");
    setRevealed(false);
    setPinVisible(false);
    setNewPin("");
    setMerchant(card.merchantLock ?? "");
  }, [card?.id]);

  if (!card) return null;
  const tabs: Array<{ value: CardManagerTab; label: string }> = [
    { value: "details", label: "Card details" },
    { value: "controls", label: "Controls" },
    { value: "security", label: "Security & PIN" },
    ...(card.type === "physical" ? [{ value: "delivery" as const, label: "Delivery" }] : []),
  ];
  const copy = async (label: string, value: string) => {
    const ok = await copyText(value.replace(/\s/g, ""));
    toast(ok ? { tone: "success", title: `${label} copied` } : { tone: "error", title: `Couldn't copy ${label.toLowerCase()}` });
  };
  const saveLock = () => {
    setMerchantLock(card.id, merchant);
    toast({ tone: "success", title: merchant.trim() ? `Locked to ${merchant.trim()}` : "Merchant lock removed" });
  };
  const savePin = (e: FormEvent) => {
    e.preventDefault();
    if (!changeCardPin(card.id, newPin)) {
      toast({ tone: "error", title: "Enter a 4-digit PIN" });
      return;
    }
    setNewPin("");
    toast({ tone: "success", title: "PIN changed", description: "Your new PIN is ready for the next chip or ATM transaction." });
  };
  const replace = () => {
    const next = replaceCard(card.id, reason);
    if (!next) return;
    onReplacement(next);
    toast({ tone: "success", title: "Replacement issued", description: next.type === "physical" ? `•••• ${next.last4} is being printed and shipped.` : `•••• ${next.last4} is ready now.` });
  };
  const shippingIndex = Math.max(0, SHIPPING_ORDER.indexOf(card.shipping.status));

  return createPortal(
    <AnimatePresence>
      <motion.div className="card-manager-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <motion.div className="card-manager" role="dialog" aria-modal="true" aria-label={`Manage ${card.label}`}
          initial={{ opacity: 0, y: 32, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: .98 }} transition={{ type: "spring", stiffness: 330, damping: 31 }}>
          <div className="card-manager-head">
            <div><span>{card.type === "physical" ? `Physical ${user?.accountType === "personal" ? "personal" : "business"} debit` : `Virtual ${user?.accountType === "personal" ? "personal" : "business"} debit`}</span><h2>{card.label}</h2></div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close card manager"><X size={17} /></button>
          </div>
          <div className="card-manager-layout">
            <aside className="card-manager-preview">
              <VirtualCard label={card.label} holder={card.cardholder} last4={card.last4} number={card.fullNumber} exp={card.exp} cvv={card.cvv}
                frozen={card.frozen} flipped={revealed} type={card.type} />
              <button type="button" className="reveal-details-btn" onClick={() => setRevealed(v => !v)}>
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}{revealed ? "Hide sensitive details" : "Reveal card details"}
              </button>
              <div className="manager-card-status">
                <span className={`status-pill ${card.frozen ? "frozen" : "active"}`}>{card.frozen ? <Snowflake size={11} /> : <span className="dot" />}{card.frozen ? "Frozen" : "Active"}</span>
                <span>•••• {card.last4}</span>
              </div>
              <button type="button" className={`manager-freeze ${card.frozen ? "is-frozen" : ""}`} onClick={() => {
                const frozen = toggleFreeze(card.id);
                toast({ tone: "info", title: frozen ? "Card frozen" : "Card unfrozen", description: frozen ? "New payments will be declined." : "The card can be used again." });
              }}>
                <Snowflake size={15} /> {card.frozen ? "Unfreeze card" : "Freeze card"}
              </button>
            </aside>
            <div className="card-manager-main">
              <Segmented id={`manage-${card.id}`} value={tab} onChange={setTab} options={tabs} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} className="card-manager-tab" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: .22, ease }}>
                  {tab === "details" && (
                    <>
                      <div className="manager-details-grid">
                        <div className="wide">
                          <span>Card number</span>
                          {revealed
                            ? <button type="button" className="card-number-copy" aria-label="Copy card number" title="Click to copy" onClick={() => copy("Card number", card.fullNumber)}>{card.fullNumber}</button>
                            : <code>{`•••• •••• •••• ${card.last4}`}</code>}
                        </div>
                        <div><span>Expiration</span><code>{card.exp}</code></div>
                        <div><span>Security code</span><code>{revealed ? card.cvv : "•••"}</code></div>
                        <div><span>Cardholder</span><b>{card.cardholder}</b></div>
                        <div><span>Funding</span><b>Veyra checking</b></div>
                      </div>
                      <section className="manager-section">
                        <div className="manager-section-head"><div><h3>Digital wallet</h3><p>Add this card to a supported mobile wallet.</p></div><Smartphone size={18} /></div>
                        <button type="button" className={`wallet-btn ${card.walletStatus === "added" ? "added" : ""}`} onClick={() => {
                          const status = toggleCardWallet(card.id);
                          toast({ tone: "success", title: status === "added" ? "Added to mobile wallet" : "Removed from mobile wallet" });
                        }}><WalletCards size={16} /> {card.walletStatus === "added" ? "Added to wallet" : "Add to wallet"}{card.walletStatus === "added" && <Check size={14} />}</button>
                      </section>
                      <section className="manager-section">
                        <h3>Spending</h3>
                        <UsageBar spent={card.spent} limit={card.limit} />
                        <div className="manager-money-row"><span>Spent this month</span><b>{money(card.spent)}</b></div>
                        <div className="manager-money-row"><span>Available to spend</span><b>{money(Math.max(card.limit - card.spent, 0))}</b></div>
                      </section>
                    </>
                  )}
                  {tab === "controls" && (
                    <>
                      <div className="control-list">
                        {CARD_CONTROL_META.filter(c => !c.physicalOnly || card.type === "physical").map(control => (
                          <div className="card-control-row" key={control.key}>
                            <span className="control-icon">{control.icon}</span>
                            <Toggle checked={card.controls[control.key]} onChange={enabled => {
                              setCardControl(card.id, control.key, enabled);
                              toast({ tone: "info", title: `${control.title} ${enabled ? "enabled" : "disabled"}` });
                            }} label={control.title} description={control.text} />
                          </div>
                        ))}
                      </div>
                      <section className="manager-section merchant-control">
                        <div className="manager-section-head"><div><h3>Merchant lock</h3><p>Only approve purchases from one merchant.</p></div><Lock size={17} /></div>
                        <div className="inline-save"><input value={merchant} maxLength={40} placeholder="Leave empty for any merchant" onChange={e => setMerchant(e.target.value)} /><button type="button" className="solid-btn sm" onClick={saveLock}>Save</button></div>
                      </section>
                      <section className="manager-section restriction-grid">
                        <div>
                          <label htmlFor={`category-lock-${card.id}`}>Allowed category</label>
                          <select id={`category-lock-${card.id}`} value={card.categoryLock ?? ""} onChange={e => {
                            setCategoryLock(card.id, e.target.value || undefined);
                            toast({ tone: "info", title: e.target.value ? `Limited to ${e.target.value}` : "Category restriction removed" });
                          }}><option value="">Any category</option>{categories.map(category => <option key={category}>{category}</option>)}</select>
                        </div>
                        <div>
                          <label htmlFor={`txn-limit-${card.id}`}>Per-purchase limit <b>{money(card.singleTransactionLimit, false)}</b></label>
                          <input id={`txn-limit-${card.id}`} className="dash-range" type="range" min={100} max={Math.max(card.limit, 100)} step={100} value={Math.min(card.singleTransactionLimit, card.limit)} onChange={e => setTransactionLimit(card.id, Number(e.target.value))} style={rangeStyle(Math.min(card.singleTransactionLimit, card.limit), 100, Math.max(card.limit, 100))} />
                        </div>
                      </section>
                      {card.type === "physical" && (
                        <section className="manager-section">
                          <div className="manager-section-head"><div><h3>Daily ATM limit</h3><p>Applies separately from the monthly card limit.</p></div><b>{money(card.dailyAtmLimit, false)}</b></div>
                          <input className="dash-range" type="range" min={0} max={2500} step={100} value={card.dailyAtmLimit} onChange={e => setAtmLimit(card.id, Number(e.target.value))} style={rangeStyle(card.dailyAtmLimit, 0, 2500)} />
                        </section>
                      )}
                    </>
                  )}
                  {tab === "security" && (
                    <>
                      <section className="manager-section pin-section">
                        <div className="manager-section-head"><div><h3>Card PIN</h3><p>Used for chip purchases and ATM withdrawals.</p></div><KeyRound size={18} /></div>
                        <div className="pin-display"><code>{pinVisible ? card.pin : "••••"}</code><button type="button" className="ghost-btn sm" onClick={() => setPinVisible(v => !v)}>{pinVisible ? <EyeOff size={13} /> : <Eye size={13} />}{pinVisible ? "Hide" : "Reveal"}</button></div>
                        <form className="pin-form" onSubmit={savePin}><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="New 4-digit PIN" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /><button type="submit" className="solid-btn sm" disabled={newPin.length !== 4}>Change PIN</button></form>
                      </section>
                      <section className="manager-section replacement-section">
                        <div className="manager-section-head"><div><h3>Replace this card</h3><p>The current card will be frozen immediately.</p></div><RefreshCw size={17} /></div>
                        <select value={reason} onChange={e => setReason(e.target.value)}><option>Card damaged</option><option>Card lost</option><option>Card stolen</option><option>Card details compromised</option><option>Card retained by ATM</option></select>
                        <button type="button" className="danger-btn" onClick={replace}><RefreshCw size={14} /> Replace card</button>
                      </section>
                      <div className="security-note"><ShieldCheck size={16} /><span>Never share your PIN or one-time security codes. Veyra support will never ask for them.</span></div>
                    </>
                  )}
                  {tab === "delivery" && (
                    <>
                      <section className="shipping-hero">
                        <span className="shipping-icon">{card.shipping.status === "delivered" ? <PackageCheck /> : <Truck />}</span>
                        <div><small>Card delivery</small><h3>{SHIPPING_LABEL[card.shipping.status]}</h3><p>{card.shipping.status === "delivered" ? `Delivered ${card.shipping.deliveredAt ? longDate(card.shipping.deliveredAt) : ""}` : `Estimated by ${card.shipping.estimatedDelivery ? shortDate(card.shipping.estimatedDelivery) : "soon"}`}</p></div>
                      </section>
                      <div className="shipping-track">
                        {SHIPPING_ORDER.map((status, index) => {
                          const done = index <= shippingIndex;
                          return <div className={done ? "done" : ""} key={status}><span>{done ? <Check size={11} /> : index + 1}</span><small>{SHIPPING_LABEL[status]}</small></div>;
                        })}
                      </div>
                      <section className="manager-section shipping-details">
                        <div><span>Carrier</span><b>{card.shipping.carrier ?? "ParcelPost"}</b></div>
                        <div><span>Tracking</span><code>{card.shipping.tracking ?? "Assigning tracking…"}</code>{card.shipping.tracking && <button type="button" className="mini-copy" onClick={() => copy("Tracking number", card.shipping.tracking ?? "")}><Copy size={12} /></button>}</div>
                        <div><span>Ship to</span><b><MapPin size={13} /> {card.shipping.address}</b></div>
                      </section>
                      {card.shipping.status !== "delivered" && <button type="button" className="ghost-btn ship-action" onClick={() => {
                        const status = advanceCardShipping(card.id);
                        toast({ tone: "info", title: `Shipping updated: ${SHIPPING_LABEL[status]}` });
                      }}><Truck size={14} /> Advance shipment</button>}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>, document.body,
  );
}

export function CardsPage() {
  const { account, user, createCard, toggleFreeze, removeCard, setLimit } = useAcct();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<CardFilter>("all");
  const [flipped, setFlipped] = useState<string | null>(null);
  const [managedId, setManagedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState<{ label: string; holder: string; limit: number; lock: string; type: Card["type"]; address: string }>({ label: "", holder: user?.name ?? "", limit: 4000, lock: "", type: "virtual", address: "" });
  // Physical cards ship to the member's own address by default, not a placeholder.
  const mailingAddress = useMailingAddress(user?.accountType === "business");
  useEffect(() => { if (mailingAddress) setForm(f => (f.address ? f : { ...f, address: mailingAddress })); }, [mailingAddress]);
  if (!account) return null;

  const counts: Record<CardFilter, number> = {
    all: account.cards.length,
    virtual: account.cards.filter(c => c.type === "virtual").length,
    physical: account.cards.filter(c => c.type === "physical").length,
    frozen: account.cards.filter(c => c.frozen).length,
  };
  const visible = account.cards.filter(c => (filter === "all" ? true : filter === "frozen" ? c.frozen : c.type === filter));
  const totalSpent = account.cards.reduce((s, c) => s + c.spent, 0);
  const totalLimit = account.cards.reduce((s, c) => s + c.limit, 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const label = form.label.trim();
    if (!label) return;
    const card = createCard({ label, limit: form.limit, type: form.type, merchantLock: form.lock.trim() || undefined, cardholder: form.holder.trim() || user?.name || "Cardholder", shippingAddress: form.address.trim() || undefined });
    setOpen(false);
    setFilter("all");
    setForm(f => ({ ...f, label: "", lock: "" }));
    toast({ tone: "success", title: `${card.type === "virtual" ? "Virtual" : "Physical"} card issued`, description: `${card.label} •••• ${card.last4} is ${card.type === "virtual" ? "ready to use" : "on its way"}.` });
  };
  const onFreeze = (c: Card) => {
    const frozen = toggleFreeze(c.id);
    toast({ tone: "info", title: frozen ? `${c.label} card frozen` : `${c.label} card is active`, description: frozen ? "Purchases will be declined until you unfreeze it." : "You can use this card again right away." });
  };
  const onCopyNumber = async (c: Card) => {
    const ok = await copyText(c.fullNumber.replace(/\s/g, ""));
    toast(ok ? { tone: "success", title: "Card number copied" } : { tone: "error", title: "Couldn't copy the card number" });
  };
  const onTerminate = (c: Card) => {
    removeCard(c.id);
    setConfirmId(null);
    toast({ tone: "info", title: `${c.label} card closed`, description: `•••• ${c.last4} can no longer be used.` });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Virtual & physical cards · Custom limits · Instant controls" title="Cards">
        <button type="button" className="solid-btn" onClick={() => setOpen(true)}><Plus size={15} /> Issue new card</button>
      </PageHeader>

      <motion.div className="summary-strip" {...rise(0)}>
        <div><span>Spent this month</span><AnimatedMoney value={totalSpent} className="strip-value" cents /></div>
        <div><span>Combined limits</span><AnimatedMoney value={totalLimit} className="strip-value" /></div>
        <div><span>Active cards</span><strong className="strip-value">{account.cards.length - counts.frozen} of {account.cards.length}</strong></div>
        <div><span>Cards shipping</span><strong className="strip-value">{account.cards.filter(c => c.type === "physical" && c.shipping.status !== "delivered").length}</strong></div>
      </motion.div>

      <div className="toolbar">
        <Segmented id="cards" value={filter} onChange={setFilter} options={[
          { value: "all", label: `All · ${counts.all}` },
          { value: "virtual", label: `Virtual · ${counts.virtual}` },
          { value: "physical", label: `Physical · ${counts.physical}` },
          { value: "frozen", label: `Frozen · ${counts.frozen}` },
        ]} />
      </div>

      <div className="cards-grid">
        <AnimatePresence>
          {visible.map(c => {
            const isFlipped = flipped === c.id;
            const toggleFlip = () => setFlipped(f => (f === c.id ? null : c.id));
            return (
              <motion.article layout key={c.id} className={`card-tile ${c.frozen ? "is-frozen" : ""}`}
                initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }} transition={{ duration: 0.45, ease }}>
                <div className="card-face-btn" role="button" tabIndex={0} onClick={toggleFlip} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFlip(); } }}
                  aria-label={isFlipped ? "Hide card details" : "Show card details"}>
                  <VirtualCard label={c.label} holder={c.cardholder} last4={c.last4} number={c.fullNumber} exp={c.exp} cvv={c.cvv} frozen={c.frozen} flipped={isFlipped} type={c.type} />
                </div>
                <div className="card-tile-body">
                  <div className="card-tile-head">
                    <div><strong>{c.label}</strong><span className="chip chip-violet">{c.type === "virtual" ? "Virtual" : "Physical"}</span></div>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={c.frozen ? "frozen" : "active"} className={`status-pill ${c.frozen ? "frozen" : "active"}`}
                        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.18 }}>
                        {c.frozen ? <Snowflake size={11} /> : <span className="dot" />}{c.frozen ? "Frozen" : "Active"}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <div className="card-details">
                    <div className="cd-number">
                      <span>Card number</span>
                      {isFlipped
                        ? <button type="button" className="card-number-copy" aria-label="Copy card number" title="Click to copy" onClick={() => onCopyNumber(c)}>{c.fullNumber}</button>
                        : <code>{`•••• ${c.last4}`}</code>}
                    </div>
                    <div><span>Expires</span><code>{c.exp}</code></div>
                    <div><span>CVV</span><code>{isFlipped ? c.cvv : "•••"}</code></div>
                  </div>
                  {c.type === "physical" && c.shipping.status !== "delivered" && <button type="button" className="shipping-mini" onClick={() => setManagedId(c.id)}><Truck size={13} /><span>{SHIPPING_LABEL[c.shipping.status]}</span><small>{c.shipping.estimatedDelivery ? `ETA ${shortDate(c.shipping.estimatedDelivery)}` : "Tracking soon"}</small><ArrowRight size={12} /></button>}
                  {c.merchantLock && <div className="lock-note"><Lock size={12} /> Locked to <b>{c.merchantLock}</b></div>}
                  <UsageBar spent={c.spent} limit={c.limit} />
                  <label className="limit-label" htmlFor={`lim-${c.id}`}><span>Monthly limit</span><b>{money(c.limit, false)}</b></label>
                  <input id={`lim-${c.id}`} className="dash-range" type="range" min={250} max={30000} step={250} value={c.limit}
                    onChange={e => setLimit(c.id, Number(e.target.value))} style={rangeStyle(c.limit, 250, 30000)} />
                  <div className="card-actions">
                    <button type="button" onClick={() => setManagedId(c.id)}><SettingsIcon size={14} />Manage</button>
                    <button type="button" className={c.frozen ? "is-on" : ""} onClick={() => onFreeze(c)}><Snowflake size={14} />{c.frozen ? "Unfreeze" : "Freeze"}</button>
                    <button type="button" className="danger" onClick={() => setConfirmId(id => (id === c.id ? null : c.id))}><Trash2 size={14} />Close</button>
                  </div>
                  <AnimatePresence initial={false}>
                    {confirmId === c.id && (
                      <motion.div className="confirm-bar" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease }}>
                        <div className="confirm-inner">
                          <span>Close this card permanently?</span>
                          <div>
                            <button type="button" className="ghost-btn sm" onClick={() => setConfirmId(null)}>Keep</button>
                            <button type="button" className="danger-btn sm" onClick={() => onTerminate(c)}>Close card</button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
      {!visible.length && <EmptyState icon={<CreditCard size={18} />} title="No cards match this filter" text="Switch filters or issue a new card." />}

      <Modal open={open} onClose={() => setOpen(false)} title="Issue a new card" subtitle="Virtual cards work instantly. Physical metal cards ship in 5–7 days.">
        <form className="dash-form" onSubmit={submit}>
          <div className="issue-preview">
            <motion.div key={form.type} style={{ transformPerspective: 900 }} initial={{ rotateY: -90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.5, ease }}>
              <VirtualCard label={form.label || "New card"} holder={form.holder || "Cardholder"} last4="0000" type={form.type} />
            </motion.div>
          </div>
          <span className="field-label">Card type</span>
          <Segmented id="card-type" value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={[{ value: "virtual", label: "Virtual · instant" }, { value: "physical", label: "Physical · metal" }]} />
          <label htmlFor="card-label">Card name</label>
          <input id="card-label" required maxLength={28} placeholder="e.g. Software subscriptions" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <label htmlFor="card-holder">Cardholder</label>
          <input id="card-holder" required maxLength={32} value={form.holder} onChange={e => setForm(f => ({ ...f, holder: e.target.value }))} />
          <label htmlFor="card-limit">Monthly limit <output>{money(form.limit, false)}</output></label>
          <input id="card-limit" className="dash-range" type="range" min={250} max={30000} step={250} value={form.limit}
            onChange={e => setForm(f => ({ ...f, limit: Number(e.target.value) }))} style={rangeStyle(form.limit, 250, 30000)} />
          <label htmlFor="card-lock">Lock to a merchant <small>Optional</small></label>
          <input id="card-lock" maxLength={32} placeholder="e.g. Northstar Ads" value={form.lock} onChange={e => setForm(f => ({ ...f, lock: e.target.value }))} />
          <AnimatePresence initial={false}>
            {form.type === "physical" && <motion.div key="shipping-address" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
              <label htmlFor="card-address">Shipping address</label>
              <input id="card-address" required maxLength={100} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              <p className="shipping-form-note"><Truck size={13} /> Free tracked delivery in 5–7 business days.</p>
            </motion.div>}
          </AnimatePresence>
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="solid-btn"><Plus size={15} /> Issue card</button>
          </div>
        </form>
      </Modal>
      <CardManager card={account.cards.find(c => c.id === managedId) ?? null} onClose={() => setManagedId(null)} onReplacement={card => setManagedId(card.id)} />
    </div>
  );
}

/* ============================================================
   Transactions
   ============================================================ */
type Direction = "all" | "in" | "out";

export function TransactionsPage() {
  const { account, exportCSV } = useAcct();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [dir, setDir] = useState<Direction>("all");
  const [selected, setSelected] = useState<Txn | null>(null);

  const filtered = useMemo(() => {
    if (!account) return [];
    const needle = q.trim().toLowerCase();
    return account.transactions.filter(t => {
      const matchCat = cat === "All" || t.category === cat;
      const matchDir = dir === "all" || (dir === "in" ? t.amount > 0 : t.amount < 0);
      const matchQ = !needle || [t.merchant, t.note ?? "", t.reference ?? ""].some(v => v.toLowerCase().includes(needle));
      return matchCat && matchDir && matchQ;
    });
  }, [account, q, cat, dir]);
  if (!account) return null;

  const cleared = filtered.filter(t => t.status === "cleared" && t.date <= Date.now());
  const inflow = cleared.filter(t => t.amount > 0).reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;
  const outflow = cleared.filter(t => t.amount < 0).reduce((s, t) => s + Math.round(Math.abs(t.amount) * 100), 0) / 100;
  const rewards = cleared.reduce((s, t) => s + Math.round(t.reward * 100), 0) / 100;
  const fees = cleared.reduce((s, t) => s + Math.round((t.fee ?? 0) * 100), 0) / 100;

  const onExport = () => {
    const count = exportCSV(filtered);
    toast({ tone: "success", title: "Export ready", description: `${count} transactions downloaded as CSV.` });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow={`${filtered.length} of ${account.transactions.length} recent transactions · Latest 400 shown`} title="Transactions">
        <button type="button" className="ghost-btn" onClick={onExport}><Download size={15} /> Export CSV</button>
      </PageHeader>

      <div className="toolbar">
        <div className="search-field">
          <Search size={15} />
          <input placeholder="Search merchants, memos or references" value={q} onChange={e => setQ(e.target.value)} aria-label="Search transactions" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
        </div>
        <select className="toolbar-select" value={cat} onChange={e => setCat(e.target.value)} aria-label="Filter by category">
          {["All", ...new Set([...categories, ...account.transactions.map(t => t.category)])].map(c => <option key={c} value={c}>{c === "All" ? "All categories" : c}</option>)}
        </select>
        <Segmented id="direction" value={dir} onChange={setDir} options={[{ value: "all", label: "All" }, { value: "in", label: "Money in" }, { value: "out", label: "Money out" }]} />
      </div>

      <div className="summary-strip">
        <div><span>Cleared money in</span><AnimatedMoney value={inflow} className="strip-value in" cents /></div>
        <div><span>Cleared money out</span><AnimatedMoney value={outflow} className="strip-value" cents /></div>
        <div><span>Rewards earned</span><AnimatedMoney value={rewards} className="strip-value violet-text" cents /></div>
        <div><span>Fees paid</span><AnimatedMoney value={fees} className="strip-value" cents /></div>
      </div>

      <section className="panel table-panel">
        <div className="txn-table-head">
          <span>Merchant</span><span>Category</span><span>Date</span><span>Status</span><span className="ta-r">Rewards</span><span className="ta-r">Fee</span><span className="ta-r">Amount</span>
        </div>
        <div className="txn-table-body">
          <AnimatePresence>
            {filtered.map((t, i) => (
              <motion.button type="button" layout="position" key={t.id} className={`txn-trow ${isFresh(t) ? "is-new" : ""}`} onClick={() => setSelected(t)}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, delay: Math.min(i, 12) * 0.025 }}>
                <span className="tcol-merchant">
                  <MerchantIcon name={t.merchant} incoming={t.amount > 0} />
                  <span className="tcol-text">
                    <strong>{t.merchant}</strong>
                    {t.scout ? <small className="scout-text"><Sparkles size={11} /> Scout saved {money(t.scout)}</small> : <small>{t.note ?? t.method}</small>}
                  </span>
                </span>
                <span className="tcol-cat"><span className="cat-pill">{t.category}</span></span>
                <span className="tcol-date">{shortDate(t.date)}</span>
                <span className="tcol-status"><span className={`status-pill ${t.status === "cleared" ? "cleared" : t.status === "failed" ? "overdue" : "open"}`}><span className="dot" /> {t.status === "cleared" ? "Cleared" : t.status === "failed" ? "Failed" : "Pending"}</span></span>
                <span className="tcol-reward">{t.reward > 0 ? `+${money(t.reward)}` : "—"}</span>
                <span className="tcol-fee">{(t.fee ?? 0) > 0 ? money(t.fee ?? 0) : "—"}</span>
                <strong className={`tcol-amt ${t.amount > 0 ? "in" : ""}`}>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</strong>
              </motion.button>
            ))}
          </AnimatePresence>
          {!filtered.length && <EmptyState icon={<Search size={18} />} title="No transactions found" text="Try a different search or clear your filters." />}
        </div>
      </section>
      <TxnDrawer txn={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ============================================================
   Transfers
   ============================================================ */
export function PaymentsPage() {
  const demo = useDemoPayments();
  if (!demo.data || demo.error) return <div className="app-page"><DemoModeNotice /></div>;
  return <LegacyPaymentsPage />;
}
function LegacyPaymentsPage() {
  const isDemo = useDemoPayments().data?.demoMode;
  const { user } = useAuth();
  const { account, addPayee, removePayee } = useAcct();
  const { startSend, openDeposit } = useMoneyFlow();
  const toast = useToast();
  const [query] = useSearchParams();
  const [method, setMethod] = useState<SendMethod>(query.get("to") ? "Zelle" : "ACH");
  const [payee, setPayee] = useState(query.get("to") ?? "");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(user?.accountType === "personal" ? "" : categories[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [selected, setSelected] = useState<Txn | null>(null);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [payeeForm, setPayeeForm] = useState({ name: "", nickname: "", bankName: "", routing: "", accountLast4: "", accountType: "Checking" as "Checking" | "Savings" });
  const recent = useMemo(() => (account ? recentPayees(account.transactions) : []), [account]);

  if (user?.role && user.role !== "user") {
    return <Navigate to="/app/superadmin" replace />;
  }
  if (!account) {
    return (
      <div className="app-page">
        <div className="panel" style={{ padding: "32px 24px", maxWidth: 560, margin: "32px auto" }}>
          <h2>Send money</h2>
          <p className="form-intro" style={{ marginBottom: 18 }}>Your account details are still loading, or this transfer page is only available to member accounts.</p>
          <Link to="/app" className="solid-btn">Back to overview</Link>
        </div>
      </div>
    );
  }

  const value = Number.parseFloat(amount) || 0;
  const transferFee = method === "Veyra" ? quoteFee("deposit", 0) : quoteFee("transfer", Math.round(value * 100));
  const bank = account.bankDetails;
  const recentOut = account.transactions.filter(t => t.amount < 0 && t.method && t.method !== "Card").slice(0, 5);

  const fail = (msg: string) => { setError(msg); setErrorKey(k => k + 1); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!payee.trim()) return fail("Add who you're paying.");
    if (value <= 0) return fail("Enter an amount greater than $0.");
    if (value > account.balance) return fail(`That's more than your available balance of ${money(account.balance)}.`);
    startSend(
      { counterparty: payee.trim(), amount: Math.round(value * 100) / 100, method, category, note: note.trim() || undefined },
      { onComplete: () => { setPayee(""); setAmount(""); setNote(""); } },
    );
  };
  const copy = async (label: string, text: string) => {
    const ok = await copyText(text);
    toast(ok ? { tone: "success", title: `${label} copied` } : { tone: "error", title: `Couldn't copy ${label.toLowerCase()}` });
  };
  const savePayee = (e: FormEvent) => {
    e.preventDefault();
    if (!payeeForm.name.trim() || !payeeForm.bankName.trim() || !/^\d{9}$/.test(payeeForm.routing) || !/^\d{4}$/.test(payeeForm.accountLast4)) {
      toast({ tone: "error", title: "Check the recipient details", description: "Use a name, bank, 9-digit routing number and last 4 account digits." });
      return;
    }
    const saved = addPayee({ name: payeeForm.name, nickname: payeeForm.nickname, bankName: payeeForm.bankName, routingNumber: payeeForm.routing, accountLast4: payeeForm.accountLast4, accountType: payeeForm.accountType });
    setPayee(saved.name); setPayeeOpen(false); setPayeeForm({ name: "", nickname: "", bankName: "", routing: "", accountLast4: "", accountType: "Checking" });
    toast({ tone: "success", title: `${saved.name} saved`, description: "The recipient is verified and ready for transfers." });
  };
  const wireRows: Array<[string, string, boolean]> = [
    ["Bank", bank.bankName, false],
    ["Routing (ABA)", bank.routingNumber, true],
    ["Account number", bank.accountNumber, true],
    ["Account type", bank.accountType, false],
    ["Account name", bank.holder, false],
  ];

  return (
    <div className="app-page">
      <PageHeader eyebrow={isDemo ? "Move money from your account" : "Free domestic ACH, wires & Zelle® instant transfers"} title="Transfers">
        <Link to="/app/zelle" className="ghost-btn">
          <ZelleLogo size={14} /> Receive Zelle® QR
        </Link>
        <button type="button" className="ghost-btn" onClick={() => setCheckOpen(true)}>
          <Camera size={14} /> Deposit Check
        </button>
      </PageHeader>
      <div className="pay-layout">
        <motion.form className="panel dash-form" onSubmit={submit} noValidate {...rise(0)}>
          <h2>Send money</h2>
          <p className="form-intro">{method === "Veyra" ? "Veyra to Veyra transfers are free and arrive instantly. You'll confirm the recipient before anything is sent." : "Outgoing transfers include a 0.5% fee (minimum $0.10, maximum $10.00). You'll review everything before anything is sent."}</p>

          <span className="field-label">Transfer type</span>
          <Segmented
            id="method"
            value={method}
            onChange={setMethod}
            options={[
              {
                value: "Zelle",
                label: (
                  <span className="zelle-seg-label">
                    <ZelleLogo size={14} /> Zelle®
                  </span>
                ),
              },
              { value: "ACH", label: "ACH" },
              { value: "Wire", label: "Wire" },
              { value: "Vendor Bill", label: "Vendor bill" },
              { value: "Veyra", label: "Veyra" },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={method} className="method-note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {method === "Veyra" ? (
                <>
                  <Zap size={13} /> <strong>Veyra to Veyra</strong> · Send by email or Veyra ID · Instant · no fee
                </>
              ) : method === "Zelle" ? (
                <>
                  <ZelleLogo size={14} /> <strong>{isDemo ? "Pay with email or phone" : "Zelle® Instant Pay"}</strong> · {isDemo ? "Uses signup email or phone · account ledger only · 0.5% transfer fee" : "Send to US mobile # or email · Typically arrives in minutes · 0.5% transfer fee"}
                </>
              ) : (
                <>
                  <Clock size={13} /> {isDemo ? "Account transfer" : `Arrives ${ETA[method].toLowerCase()}`} · 0.5% transfer fee
                </>
              )}
            </motion.p>
          </AnimatePresence>

          {method !== "Veyra" && account.payees.length > 0 && (
            <>
              <div className="field-label recipient-label"><span>Saved recipients</span><button type="button" className="text-btn" onClick={() => setPayeeOpen(true)}>Manage</button></div>
              <div className="payee-row">
                {account.payees.slice(0, 6).map(p => (
                  <button type="button" key={p.id} className={`payee ${payee === p.name ? "on" : ""}`} onClick={() => { setPayee(p.name); const match = recent.find(item => item.name === p.name); if (match) setCategory(match.category); }}>
                    <MerchantIcon name={p.name} />
                    <small>{p.nickname || p.name}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {method !== "Veyra" && !account.payees.length && <button type="button" className="add-recipient" onClick={() => setPayeeOpen(true)}><Plus size={14} /> Add a saved recipient</button>}

          <label htmlFor="pay-to">
            {method === "Zelle" ? (isDemo ? "Pay to (Signup email or phone)" : "Pay to (Name, US Mobile # or Email)") : method === "Veyra" ? "Recipient email or Veyra ID" : "Pay to"}
          </label>
          <input
            id="pay-to"
            autoComplete="off"
            placeholder={method === "Zelle" ? (isDemo ? "Registered email or +country code phone" : "e.g. Jamie Chen, (555) 234-5678, jamie@email.com") : method === "Veyra" ? "name@email.com or VYR123456789" : "Business or person"}
            value={payee}
            onChange={e => setPayee(e.target.value)}
          />

          <div className="field-row">
            <div>
              <label htmlFor="pay-amount">Amount</label>
              <div className="amount-input">
                <span>$</span>
                <input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="pay-cat">Category{user?.accountType === "personal" ? " (optional)" : " (required)"}</label>
              <CategoryPicker id="pay-cat" value={category} onChange={setCategory} options={transferCategoryOptions(user?.accountType === "personal")} required={user?.accountType !== "personal"} />
            </div>
          </div>
          <div className="quick-row">
            {[250, 1000, 5000].map(q => (
              <button type="button" key={q} className={value === q ? "on" : ""} onClick={() => setAmount(String(q))}>{money(q, false)}</button>
            ))}
          </div>

          <label htmlFor="pay-note">Memo <small>Optional</small></label>
          <input id="pay-note" maxLength={60} placeholder="Invoice number or a short note" value={note} onChange={e => setNote(e.target.value)} />

          <div className="fee-lines">
            <div className="fee-line"><span>Transfer fee</span><strong className={transferFee.feeCents > 0 ? "" : "free"}>{transferFee.feeCents > 0 ? `${money(transferFee.feeCents / 100)} · ${transferFee.rateBps / 100}%` : "$0.00"}</strong></div>
            <div className="fee-line"><span>Estimated rewards</span><strong>+{money(method === "Veyra" ? 0 : value * rewardRate(category))}</strong></div>
            <div className="fee-line"><span>Balance after</span><strong>{money(Math.max(account.balance - value - transferFee.feeCents / 100, 0))}</strong></div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p key={errorKey} className="form-error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <button className="solid-btn dash-submit" type="submit"><Send size={15} /> Review {value > 0 ? money(value) : "payment"}</button>
        </motion.form>

        <div className="pay-side">
          <motion.section className="panel" {...rise(1)}>
            <div className="panel-head">
              <div><h2>Receive money</h2><span className="panel-sub">Share these for incoming ACH, wires & Zelle®</span></div>
              <div className="receive-head-btns">
                <Link to="/app/zelle" className="ghost-btn sm"><ZelleLogo size={13} /> Zelle®</Link>
                <button type="button" className="ghost-btn sm" onClick={() => setCheckOpen(true)}><Camera size={13} /> Check</button>
                <button type="button" className="ghost-btn sm" onClick={() => openDeposit()}><Plus size={13} /> Add funds</button>
              </div>
            </div>
            <VeyraIdCard veyraId={account.veyraId} email={account.veyraEmail || user?.email} />
            <div className="wire-box">
              {wireRows.map(([k, v, copyable]) => (
                <div className="wire-row" key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                  {copyable && <button type="button" className="mini-copy" onClick={() => copy(k, v)} aria-label={`Copy ${k}`}><Copy size={13} /></button>}
                </div>
              ))}
            </div>
          </motion.section>
          <motion.section className="panel" {...rise(2)}>
            <div className="panel-head">
              <div><h2>Recent transfers</h2><span className="panel-sub">ACH, wires and bill payments</span></div>
              <Link to="/app/transactions" className="text-link">All <ArrowRight size={14} /></Link>
            </div>
            {recentOut.length ? <TxnList txns={recentOut} onSelect={setSelected} /> : <p className="muted-note">No transfers yet.</p>}
          </motion.section>
        </div>
      </div>
      <TxnDrawer txn={selected} onClose={() => setSelected(null)} />
      <Modal open={payeeOpen} onClose={() => setPayeeOpen(false)} title="Saved recipients" subtitle="Add or remove bank accounts you send money to.">
        <div className="saved-payee-list">
          {account.payees.map(saved => <div className="saved-payee" key={saved.id}><MerchantIcon name={saved.name} /><div><strong>{saved.nickname || saved.name}</strong><small>{saved.name} · {saved.bankName} •••• {saved.accountLast4}</small></div><span className="status-pill active"><Check size={10} /> Verified</span><button type="button" className="icon-btn" onClick={() => { removePayee(saved.id); toast({ tone: "info", title: `${saved.name} removed` }); }} aria-label={`Remove ${saved.name}`}><Trash2 size={13} /></button></div>)}
        </div>
        <form className="dash-form recipient-form" onSubmit={savePayee}>
          <h3>Add recipient</h3>
          <div className="field-row"><div><label htmlFor="recipient-name">Full name</label><input id="recipient-name" required value={payeeForm.name} onChange={e => setPayeeForm(f => ({ ...f, name: e.target.value }))} placeholder="Person or business" /></div><div><label htmlFor="recipient-nick">Nickname <small>Optional</small></label><input id="recipient-nick" value={payeeForm.nickname} onChange={e => setPayeeForm(f => ({ ...f, nickname: e.target.value }))} placeholder="Rent, Mom, Accountant" /></div></div>
          <label htmlFor="recipient-bank">Bank name</label><input id="recipient-bank" required value={payeeForm.bankName} onChange={e => setPayeeForm(f => ({ ...f, bankName: e.target.value }))} placeholder="Bank or credit union" />
          <div className="field-row"><div><label htmlFor="recipient-routing">Routing number</label><input id="recipient-routing" inputMode="numeric" maxLength={9} required value={payeeForm.routing} onChange={e => setPayeeForm(f => ({ ...f, routing: e.target.value.replace(/\D/g, "").slice(0, 9) }))} placeholder="9 digits" /></div><div><label htmlFor="recipient-last4">Account last 4</label><input id="recipient-last4" inputMode="numeric" maxLength={4} required value={payeeForm.accountLast4} onChange={e => setPayeeForm(f => ({ ...f, accountLast4: e.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="0000" /></div></div>
          <label htmlFor="recipient-type">Account type</label><select id="recipient-type" value={payeeForm.accountType} onChange={e => setPayeeForm(f => ({ ...f, accountType: e.target.value as "Checking" | "Savings" }))}><option>Checking</option><option>Savings</option></select>
          <button type="submit" className="solid-btn dash-submit">Save recipient</button>
        </form>
      </Modal>
      <MobileCheckDepositModal open={checkOpen} onClose={() => setCheckOpen(false)} />
    </div>
  );
}

/* ============================================================
   Invoicing
   ============================================================ */
type InvoiceTab = "all" | "open" | "paid";

export function InvoicesPage() {
  const { account, markInvoicePaid, createInvoice, sendReminder } = useAcct();
  const toast = useToast();
  const [tab, setTab] = useState<InvoiceTab>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [form, setForm] = useState({ client: "", email: "", amount: "", due: 14, description: "" });
  const [inspectingInvoice, setInspectingInvoice] = useState<Invoice | null>(null);
  if (!account) return null;

  const invoices = account.invoices.filter(i => (tab === "all" ? true : tab === "paid" ? i.status === "paid" : i.status !== "paid"));
  const outstanding = account.invoices.filter(i => i.status !== "paid").reduce((s, i) => s + i.amount, 0);
  const collected = account.invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const overdue = account.invoices.filter(i => i.status === "overdue");
  const pulse = (id: string) => {
    setFlash(id);
    window.setTimeout(() => setFlash(f => (f === id ? null : f)), 1700);
  };

  const onPaid = (inv: Invoice) => {
    const paid = markInvoicePaid(inv.id);
    if (!paid) return;
    pulse(inv.id);
    toast({ tone: "success", title: `+${money(paid.amount)} received`, description: `${paid.client} paid invoice #${paid.id}.` });
  };
  const onRemind = (inv: Invoice) => {
    sendReminder(inv.id);
    toast({ tone: "info", title: "Reminder sent", description: `We emailed ${inv.clientEmail} about invoice #${inv.id}.` });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number.parseFloat(form.amount);
    const client = form.client.trim();
    if (!client || !(amount > 0)) {
      toast({ tone: "error", title: "Add a client and an amount" });
      return;
    }
    const email = form.email.trim() || `billing@${client.toLowerCase().replace(/[^a-z0-9]+/g, "") || "client"}.example`;
    const inv = createInvoice({ client, clientEmail: email, amount, dueDays: form.due, description: form.description.trim() || undefined });
    pulse(inv.id);
    setTab(t => (t === "paid" ? "all" : t));
    setForm({ client: "", email: "", amount: "", due: 14, description: "" });
    toast({ tone: "success", title: `Invoice #${inv.id} sent`, description: `${money(inv.amount)} to ${inv.clientEmail}` });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Branded invoices · Card & ACH checkout for clients" title="Invoicing" />
      <div className="kpi-row">
        <motion.div className="kpi" {...rise(0)}><span>Outstanding</span><AnimatedMoney value={outstanding} className="kpi-value" cents /><small>{account.invoices.filter(i => i.status !== "paid").length} open invoices</small></motion.div>
        <motion.div className="kpi" {...rise(1)}><span>Collected</span><AnimatedMoney value={collected} className="kpi-value" cents /><small>All time</small></motion.div>
        <motion.div className="kpi" {...rise(2)}><span>Overdue</span><strong className={`kpi-value ${overdue.length ? "warn" : ""}`}>{overdue.length}</strong><small>{overdue.length ? money(overdue.reduce((s, i) => s + i.amount, 0)) : "Nothing overdue"}</small></motion.div>
      </div>

      <div className="pay-layout">
        <motion.section className="panel" {...rise(3)}>
          <div className="panel-head">
            <h2>Invoices</h2>
            <Segmented id="inv-tab" value={tab} onChange={setTab} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "paid", label: "Paid" }]} />
          </div>
          <div className="inv-list">
            <AnimatePresence initial={false}>
              {invoices.map(inv => (
                <motion.div layout key={inv.id} className={`inv-row ${flash === inv.id ? "flash" : ""}`}
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.35, ease }}>
                  <MerchantIcon name={inv.client} />
                  <div className="inv-main"><strong>{inv.client}</strong><small>#{inv.id} · {inv.description ?? inv.clientEmail}</small></div>
                  <div className="inv-status">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={inv.status} className={`status-pill ${inv.status}`} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.2 }}>
                        {inv.status === "paid" ? <Check size={11} /> : <Clock size={11} />}{inv.status}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <div className="inv-amt"><b>{money(inv.amount)}</b><small>{inv.status === "paid" ? "Settled" : `Due ${shortDate(inv.due)}`}</small></div>
                  <div className="inv-action">
                    <button type="button" className="ghost-btn sm inv-view-btn" onClick={() => setInspectingInvoice(inv)} title="Inspect / Print Invoice">
                      <Eye size={13} /> View
                    </button>
                    {inv.status !== "paid" ? (
                      <>
                        {inv.status === "overdue" && <button type="button" className="ghost-btn sm" onClick={() => onRemind(inv)}><Mail size={13} /> Remind</button>}
                        <button type="button" className="solid-btn sm" onClick={() => onPaid(inv)}>Mark paid</button>
                      </>
                    ) : (
                      <motion.span className="paid-check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}><Check size={14} /></motion.span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {!invoices.length && <EmptyState icon={<ReceiptText size={18} />} title="Nothing here yet" text="Invoices you create will show up in this list." />}
          </div>
        </motion.section>

        <motion.form className="panel dash-form" onSubmit={submit} {...rise(4)}>
          <h2>New invoice</h2>
          <p className="form-intro">Clients can pay by card or ACH. Payments settle straight into checking.</p>
          <label htmlFor="inv-client">Client</label>
          <input id="inv-client" required maxLength={40} placeholder="Company name" value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} />
          <label htmlFor="inv-email">Billing email <small>Optional</small></label>
          <input id="inv-email" type="email" placeholder="billing@client.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <label htmlFor="inv-desc">Description <small>Optional</small></label>
          <input id="inv-desc" maxLength={60} placeholder="e.g. March retainer" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label htmlFor="inv-amount">Amount</label>
          <div className="amount-input">
            <span>$</span>
            <input id="inv-amount" type="number" inputMode="decimal" min="1" step="0.01" required placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <label htmlFor="inv-due">Due in <output>{form.due} days</output></label>
          <input id="inv-due" className="dash-range" type="range" min={7} max={60} step={1} value={form.due} onChange={e => setForm(f => ({ ...f, due: Number(e.target.value) }))} style={rangeStyle(form.due, 7, 60)} />
          <div className="fee-lines">
            <div className="fee-line"><span>Due date</span><strong>{shortDate(Date.now() + form.due * DAY)}</strong></div>
            <div className="fee-line"><span>You'll receive</span><strong>{money(Number.parseFloat(form.amount) || 0)}</strong></div>
          </div>
          <button type="submit" className="solid-btn dash-submit"><Send size={15} /> Send invoice</button>
        </motion.form>
      </div>
      <InvoiceDetailModal
        invoice={inspectingInvoice}
        onClose={() => setInspectingInvoice(null)}
        onMarkPaid={onPaid}
        onSendReminder={onRemind}
      />
    </div>
  );
}

// Re-export the elevated, intelligent Scout AI Experience with conversational copilot & live negotiation
export { ScoutAIPage } from "../components/ScoutAIAssistant";

/* ============================================================
   Rewards
   ============================================================ */
export function RewardsPage() {
  const { account, redeemRewards } = useAcct();
  const toast = useToast();
  const [burst, setBurst] = useState(0);
  const [selected, setSelected] = useState<Txn | null>(null);
  if (!account) return null;

  const earners = [...account.transactions].filter(t => t.reward > 0).sort((a, b) => b.reward - a.reward).slice(0, 6);
  const milestone = Math.max(1000, Math.ceil((account.lifetimeRewards + 1) / 1000) * 1000);
  const progress = Math.min(100, (account.lifetimeRewards / milestone) * 100);
  const rates = categories.map(c => ({ name: c, total: rewardRate(c) * 100 }));

  const onRedeem = () => {
    const amount = redeemRewards();
    if (amount > 0) {
      setBurst(b => b + 1);
      toast({ tone: "success", title: `${money(amount)} added to checking`, description: "Cash back redeemed 1:1 — no points, no catalogs." });
    }
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Unlimited cash back on every dollar · No categories to track" title="Rewards" />
      <div className="reward-hero">
        <motion.div className="reward-main" {...rise(0)}>
          <span>Available to redeem</span>
          <AnimatedMoney value={account.rewards} className="reward-big" cents fromZero />
          <p>Redeem instantly to your checking balance, any time.</p>
          <div className="burst-anchor">
            <button type="button" className="solid-btn" onClick={onRedeem} disabled={account.rewards < 0.01}><Sparkles size={15} /> Redeem {money(account.rewards)}</button>
            <Burst fire={burst} />
          </div>
          <div className="milestone">
            <div className="milestone-top"><span>Lifetime cash back</span><span>{money(account.lifetimeRewards)} of {money(milestone, false)}</span></div>
            <div className="milestone-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1.1, delay: 0.3, ease }} /></div>
          </div>
        </motion.div>
        <div className="reward-side">
          <motion.div {...rise(1)}><span>Lifetime cash back</span><AnimatedMoney value={account.lifetimeRewards} className="side-value" cents fromZero /></motion.div>
          <motion.div {...rise(2)}><span>Scout savings</span><AnimatedMoney value={account.scoutSaved} className="side-value" cents fromZero /></motion.div>
        </div>
      </div>

      <div className="two-col">
        <motion.section className="panel" {...rise(3)}>
          <div className="panel-head"><div><h2>Top earning purchases</h2><span className="panel-sub">Your biggest cash back moments</span></div></div>
          {earners.length ? <TxnList txns={earners} onSelect={setSelected} /> : <EmptyState icon={<Award size={18} />} title="No rewards yet" text="Card purchases earn cash back automatically." />}
        </motion.section>
        <motion.section className="panel" {...rise(4)}>
          <div className="panel-head"><div><h2>Rates by category</h2><span className="panel-sub">Applied automatically at checkout</span></div></div>
          <CategoryBars items={rates} format={n => `${n.toFixed(1)}%`} />
        </motion.section>
      </div>
      <TxnDrawer txn={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/* ============================================================
   Team
   ============================================================ */
export function TeamPage() {
  const { account, inviteTeamMember, removeTeamMember } = useAcct();
  const { user: me } = useAuth();
  // Teammates: only an Admin may invite or remove people (the server enforces it too).
  const canManage = !me?.teamRole || me.teamRole === "Admin";
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; role: TeamMember["role"]; limit: number }>({ name: "", email: "", role: "Member", limit: 5000 });
  if (!account) return null;

  const members = account.team;
  const totalLimits = members.reduce((s, m) => s + m.monthlyLimit, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      toast({ tone: "error", title: "Add a name and a valid email" });
      return;
    }
    const member = inviteTeamMember({ name: form.name.trim(), email: form.email.trim(), role: form.role, monthlyLimit: form.role === "Bookkeeper" ? 0 : form.limit });
    setOpen(false);
    setForm({ name: "", email: "", role: "Member", limit: 5000 });
    toast({ tone: "success", title: `Invite sent to ${member.name.split(" ")[0]}`, description: `${member.email} · ${member.role}` });
  };
  const onRemove = (m: TeamMember) => {
    removeTeamMember(m.id);
    toast({ tone: "info", title: `${m.name} removed`, description: "Their access and cards were revoked." });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Roles, permissions and per-person spend limits" title="Team">
        {canManage && <button type="button" className="solid-btn" onClick={() => setOpen(true)}><UserPlus size={15} /> Invite member</button>}
      </PageHeader>
      <div className="kpi-row">
        <motion.div className="kpi" {...rise(0)}><span>Members</span><AnimatedNumber value={members.length} className="kpi-value" /><small>{members.filter(m => m.status === "invited").length} pending invites</small></motion.div>
        <motion.div className="kpi" {...rise(1)}><span>Cards issued</span><AnimatedNumber value={members.reduce((s, m) => s + m.cardCount, 0)} className="kpi-value" /><small>Across your team</small></motion.div>
        <motion.div className="kpi" {...rise(2)}><span>Monthly limits</span><AnimatedMoney value={totalLimits} className="kpi-value" /><small>Combined</small></motion.div>
      </div>
      <motion.section className="panel" {...rise(3)}>
        <div className="panel-head"><h2>Members</h2></div>
        <p className="team-spend-policy">Admin and Member limits cover transfers, card payments, bill payments and crypto purchases together, per UTC calendar month. $0 permits no outgoing spend. Deposits and sales do not restore the allowance. Usage includes only actor-attributed payments; historical unattributed activity is excluded.</p>
        <div className="team-list">
          <AnimatePresence initial={false}>
            {members.map(m => (
              <motion.div layout key={m.id} className="team-row" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.3, ease }}>
                <span className="team-avatar">{m.name.split(" ").map(p => p.charAt(0)).slice(0, 2).join("").toUpperCase()}</span>
                <div className="team-info"><strong>{m.name}</strong><small>{m.email}</small></div>
                <span className={`role-badge role-${m.role.toLowerCase()}`}>{m.role}</span>
                <div className="team-limit"><b>{m.role === "Owner" ? "Owner · no teammate cap" : m.role === "Bookkeeper" ? "Read-only" : `${money(m.monthlyLimit)} / month`}</b>{m.role !== "Owner" && m.role !== "Bookkeeper" && <small>{m.monthlySpent === undefined ? "Usage pending refresh" : `${money(m.monthlySpent)} used · ${money(m.monthlyRemaining ?? 0)} left`}</small>}<small>{m.role === "Owner" || m.role === "Bookkeeper" ? `${m.cardCount} cards` : "Resets on the 1st · UTC"}</small></div>
                <span className={`status-pill team-status ${m.status}`}>{m.status === "active" ? <span className="dot" /> : <Mail size={11} />}{m.status}</span>
                <div className="team-act">
                  {m.status === "invited" && m.inviteUrl && canManage && (
                    <button type="button" className="icon-btn" aria-label={`Copy invite link for ${m.name}`} title="Copy invite link"
                      onClick={async () => toast(await copyText(m.inviteUrl!) ? { tone: "success", title: "Invite link copied", description: "No mail provider is set up, so share this link yourself." } : { tone: "error", title: "Couldn't copy the link" })}>
                      <Link2 size={14} />
                    </button>
                  )}
                  {m.role !== "Owner" && canManage && m.email.toLowerCase() !== me?.email.toLowerCase() && (
                    <button type="button" className="icon-btn" onClick={() => onRemove(m)} aria-label={`Remove ${m.name}`}><Trash2 size={14} /></button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.section>

      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member" subtitle="They'll get an email to set up their login and card.">
        <form className="dash-form" onSubmit={submit}>
          <label htmlFor="tm-name">Full name</label>
          <input id="tm-name" required maxLength={40} placeholder="Jordan Ellis" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label htmlFor="tm-email">Work email</label>
          <input id="tm-email" type="email" required placeholder="jordan@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <label htmlFor="tm-role">Role</label>
          <select id="tm-role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as TeamMember["role"] }))}>
            <option value="Admin">Admin — issue cards and manage spend</option>
            <option value="Member">Member — own card and receipts</option>
            <option value="Bookkeeper">Bookkeeper — read-only access</option>
          </select>
          <AnimatePresence initial={false}>
            {form.role !== "Bookkeeper" && (
              <motion.div key="limit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                <label htmlFor="tm-limit">Monthly spend limit <output>{money(form.limit, false)}</output></label>
                <input id="tm-limit" className="dash-range" type="range" min={500} max={25000} step={500} value={form.limit}
                  onChange={e => setForm(f => ({ ...f, limit: Number(e.target.value) }))} style={rangeStyle(form.limit, 500, 25000)} />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="solid-btn"><Mail size={15} /> Send invite</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ============================================================
   Perks
   ============================================================ */
export function PerksPage() {
  const { account, redeemPerk } = useAcct();
  const toast = useToast();
  const [cat, setCat] = useState("All");
  if (!account) return null;

  const cats = ["All", ...Array.from(new Set(account.perks.map(p => p.category)))];
  const visible = account.perks.filter(p => cat === "All" || p.category === cat);
  const claimed = account.perks.filter(p => p.status === "redeemed").length;

  const claim = async (p: Perk) => {
    const ok = await copyText(p.code);
    if (p.status !== "redeemed") redeemPerk(p.id);
    toast(ok
      ? { tone: "success", title: `${p.partner} code copied`, description: `${p.code} — paste it at checkout.` }
      : { tone: "info", title: `Your code: ${p.code}`, description: "Copy it manually to use the offer." });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow={`${claimed} of ${account.perks.length} offers claimed · Exclusive partner discounts`} title="Perks" />
      <div className="toolbar">
        <Segmented id="perk-cat" value={cat} onChange={setCat} options={cats.map(c => ({ value: c, label: c }))} />
      </div>
      <div className="perks-grid">
        <AnimatePresence>
          {visible.map((p, i) => {
            const [bg, fg] = TINTS[i % TINTS.length];
            return (
              <motion.article layout key={p.id} className="perk-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                whileHover={{ y: -4 }} transition={{ duration: 0.35, ease }}>
                <div className="perk-top">
                  <span className="perk-logo" style={{ background: bg, color: fg }}>{p.partner.charAt(0)}</span>
                  <span className="perk-cat">{p.category}</span>
                </div>
                <h3>{p.partner}</h3>
                <span className="perk-value">{p.value}</span>
                <p>{p.description}</p>
                <button type="button" className={`perk-btn ${p.status === "redeemed" ? "is-claimed" : ""}`} onClick={() => claim(p)}>
                  {p.status === "redeemed" ? <><Check size={14} /> <code>{p.code}</code></> : <><Gift size={14} /> Claim offer</>}
                </button>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============================================================
   Accounts & savings pockets
   ============================================================ */
const POCKET_COLORS = ["#7558dc", "#3f9a68", "#d28a48", "#4d7eae", "#a85478"];
const POCKET_ICONS: Record<SavingsPocket["icon"], ReactNode> = {
  shield: <ShieldCheck />, home: <Building2 />, travel: <Truck />, tax: <FileText />, payroll: <Users />, general: <PiggyBank />,
};

export function AccountsPage() {
  const { account, user, createSavingsPocket, transferSavings, deleteSavingsPocket } = useAcct();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [move, setMove] = useState<{ pocketId: string; direction: "to_pocket" | "to_checking" } | null>(null);
  const [amount, setAmount] = useState("");
  const [form, setForm] = useState<{ name: string; target: string; icon: SavingsPocket["icon"]; color: string }>({ name: "", target: "", icon: "general", color: POCKET_COLORS[0] });
  if (!account || !user) return null;

  const saved = account.savingsPockets.reduce((sum, pocket) => sum + pocket.balance, 0);
  const selected = move ? account.savingsPockets.find(p => p.id === move.pocketId) : undefined;
  const netWorth = account.balance + saved;
  const create = (e: FormEvent) => {
    e.preventDefault();
    const target = Number.parseFloat(form.target);
    if (!form.name.trim() || !(target > 0)) return toast({ tone: "error", title: "Add a name and target" });
    const pocket = createSavingsPocket({ name: form.name, target, color: form.color, icon: form.icon });
    setCreateOpen(false);
    setForm({ name: "", target: "", icon: "general", color: POCKET_COLORS[0] });
    toast({ tone: "success", title: `${pocket.name} created`, description: "Move money into it whenever you're ready." });
  };
  const transfer = (e: FormEvent) => {
    e.preventDefault();
    if (!move || !selected) return;
    const value = Number.parseFloat(amount);
    if (!(value > 0)) return toast({ tone: "error", title: "Enter an amount" });
    const ok = transferSavings(selected.id, value, move.direction);
    if (!ok) return toast({ tone: "error", title: "Not enough available money", description: move.direction === "to_pocket" ? `Checking has ${money(account.balance)} available.` : `${selected.name} has ${money(selected.balance)} available.` });
    setMove(null); setAmount("");
    toast({ tone: "success", title: `${money(value)} moved`, description: move.direction === "to_pocket" ? `Added to ${selected.name}.` : "Returned to checking." });
  };
  const closePocket = (pocket: SavingsPocket) => {
    const returned = deleteSavingsPocket(pocket.id);
    toast({ tone: "info", title: `${pocket.name} closed`, description: returned ? `${money(returned)} returned to checking.` : "The empty pocket was removed." });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow={`${user.accountType === "personal" ? "Personal" : "Business"} checking · Savings pockets`} title="Accounts & savings">
        <Link className="ghost-btn" to="/app/external-accounts"><Landmark size={15} /> External accounts</Link>
        <button type="button" className="solid-btn" onClick={() => setCreateOpen(true)}><Plus size={15} /> New savings pocket</button>
      </PageHeader>
      <div className="account-balance-grid">
        <motion.section className="checking-account-card" {...rise(0)}>
          <div className="account-card-top"><span><Landmark size={17} /> {account.bankDetails.accountType}</span><span className="status-pill active"><span className="dot" /> Active</span></div>
          <AnimatedMoney value={account.balance} className="account-big-money" cents fromZero />
          <p>Available · •••• {account.bankDetails.accountNumber.slice(-4)}</p>
          <div className="account-card-actions"><Link to="/app/transfers" className="account-action"><Send size={14} /> Send</Link><Link to="/app/transactions" className="account-action"><BarChart3 size={14} /> Activity</Link></div>
        </motion.section>
        <motion.section className="account-summary-card" {...rise(1)}>
          <span>Total cash</span><AnimatedMoney value={netWorth} className="account-summary-value" cents fromZero />
          <div><span>In checking</span><b>{money(account.balance)}</b></div><div><span>In savings pockets</span><b>{money(saved)}</b></div>
        </motion.section>
      </div>

      <div className="savings-head"><div><h2>Savings pockets</h2><p>Set money aside without opening another external account.</p></div><span>{account.savingsPockets.length} active</span></div>
      <div className="pocket-grid">
        <AnimatePresence>
          {account.savingsPockets.map((pocket, index) => {
            const pct = Math.min(100, pocket.target ? (pocket.balance / pocket.target) * 100 : 0);
            return (
              <motion.article layout key={pocket.id} className="pocket-card" style={{ "--pocket": pocket.color } as CSSProperties}
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .94 }} transition={{ delay: index * .04, duration: .35, ease }}>
                <div className="pocket-card-top"><span className="pocket-icon">{POCKET_ICONS[pocket.icon]}</span><button type="button" className="icon-btn" onClick={() => closePocket(pocket)} aria-label={`Close ${pocket.name}`}><Trash2 size={13} /></button></div>
                <h3>{pocket.name}</h3><AnimatedMoney value={pocket.balance} className="pocket-balance" cents />
                <div className="pocket-progress"><motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: .8, ease }} /></div>
                <div className="pocket-target"><span>{Math.round(pct)}% saved</span><span>Goal {money(pocket.target, false)}</span></div>
                <div className="pocket-actions"><button type="button" onClick={() => setMove({ pocketId: pocket.id, direction: "to_pocket" })}><ArrowDownLeft size={13} /> Add</button><button type="button" onClick={() => setMove({ pocketId: pocket.id, direction: "to_checking" })}><ArrowUpRight size={13} /> Withdraw</button></div>
              </motion.article>
            );
          })}
        </AnimatePresence>
        {!account.savingsPockets.length && <EmptyState icon={<PiggyBank size={18} />} title="No savings pockets" text="Create one for a goal, reserve or rainy day." />}
      </div>

      <SavingsActivityPanel transactions={account.transactions} />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New savings pocket" subtitle="Name a goal and set a target. You can move money after it is created.">
        <form className="dash-form" onSubmit={create}>
          <label htmlFor="pocket-name">Pocket name</label><input id="pocket-name" required maxLength={32} placeholder="Emergency fund" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label htmlFor="pocket-target">Savings target</label><div className="amount-input"><span>$</span><input id="pocket-target" type="number" min="1" step="1" required placeholder="5,000" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} /></div>
          <span className="field-label">Color</span><div className="color-row">{POCKET_COLORS.map(color => <button type="button" key={color} className={form.color === color ? "on" : ""} style={{ background: color }} onClick={() => setForm(f => ({ ...f, color }))} aria-label={`Use color ${color}`}>{form.color === color && <Check size={13} />}</button>)}</div>
          <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="solid-btn">Create pocket</button></div>
        </form>
      </Modal>

      <Modal open={!!move && !!selected} onClose={() => { setMove(null); setAmount(""); }} title={move?.direction === "to_pocket" ? `Add to ${selected?.name ?? "savings"}` : `Move from ${selected?.name ?? "savings"}`} subtitle={move?.direction === "to_pocket" ? `Checking available: ${money(account.balance)}` : `Pocket available: ${money(selected?.balance ?? 0)}`}>
        <form className="dash-form" onSubmit={transfer}><label htmlFor="saving-amount">Amount</label><div className="amount-input"><span>$</span><input autoFocus id="saving-amount" type="number" min="1" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></div><div className="quick-row">{[50, 100, 250, 500].map(value => <button type="button" key={value} onClick={() => setAmount(String(value))}>{money(value, false)}</button>)}</div><div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setMove(null)}>Cancel</button><button type="submit" className="solid-btn">Move money</button></div></form>
      </Modal>
    </div>
  );
}

/* ============================================================
   Bills & recurring payments
   ============================================================ */
export function BillsPage() {
  const { account, addScheduledPayment, toggleScheduledPayment, removeScheduledPayment, payScheduledNow } = useAcct();
  const [payingId, setPayingId] = useState<string | null>(null);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ payeeId: "", payeeName: "", amount: "", category: "Utilities", frequency: "monthly" as "once" | "weekly" | "monthly", date: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), autopay: true, memo: "" });
  if (!account) return null;
  const active = account.scheduledPayments.filter(p => p.status === "active");
  const next30 = active.filter(p => p.nextDate <= Date.now() + 30 * DAY).reduce((sum, p) => sum + p.amount, 0);
  const create = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number.parseFloat(form.amount);
    const payee = account.payees.find(p => p.id === form.payeeId);
    const name = payee?.name || form.payeeName.trim();
    const date = new Date(`${form.date}T12:00:00`).getTime();
    if (!name || !(amount > 0) || !Number.isFinite(date)) return toast({ tone: "error", title: "Complete the payment details" });
    const payment = addScheduledPayment({ payeeId: payee?.id, payeeName: name, amount, category: form.category, frequency: form.frequency, nextDate: date, autopay: form.autopay, memo: form.memo.trim() || undefined });
    setOpen(false);
    setForm(f => ({ ...f, payeeId: "", payeeName: "", amount: "", memo: "" }));
    toast({ tone: "success", title: `Payment scheduled for ${shortDate(payment.nextDate)}`, description: `${money(payment.amount)} to ${payment.payeeName}.` });
  };
  const pay = async (id: string) => {
    const payment = account.scheduledPayments.find(p => p.id === id);
    if (!payment || payingId) return;
    setPayingId(id);
    try {
      await payScheduledNow(id);
      toast({ tone: "success", title: `${money(payment.amount)} paid`, description: `Sent to ${payment.payeeName}.` });
    } catch (error) {
      toast({ tone: "error", title: "Payment could not be sent", description: error instanceof Error ? error.message : "Check the balance and payment status." });
    } finally { setPayingId(null); }
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow="Recurring payments · Autopay · Upcoming cash needs" title="Bills & scheduled payments"><button type="button" className="solid-btn" onClick={() => setOpen(true)}><Plus size={15} /> Schedule payment</button></PageHeader>
      <div className="kpi-row"><motion.div className="kpi" {...rise(0)}><span>Due in 30 days</span><AnimatedMoney value={next30} className="kpi-value" cents /><small>{active.length} active schedules</small></motion.div><motion.div className="kpi" {...rise(1)}><span>Autopay on</span><AnimatedNumber value={active.filter(p => p.autopay).length} className="kpi-value" /><small>Payments will run automatically</small></motion.div><motion.div className="kpi" {...rise(2)}><span>Available checking</span><AnimatedMoney value={account.balance} className="kpi-value" cents /><small>{next30 <= account.balance ? "Upcoming bills are covered" : "Add funds before bills are due"}</small></motion.div></div>
      <motion.section className="panel" {...rise(3)}>
        <div className="panel-head"><div><h2>Payment schedule</h2><span className="panel-sub">Pause, pay early or remove any schedule</span></div></div>
        <div className="bill-list">
          <AnimatePresence initial={false}>
            {[...account.scheduledPayments].sort((a, b) => a.nextDate - b.nextDate).map(payment => (
              <motion.div layout key={payment.id} className={`bill-row ${payment.status}`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}>
                <span className="bill-date"><b>{new Date(payment.nextDate).getDate()}</b><small>{new Date(payment.nextDate).toLocaleDateString("en-US", { month: "short" })}</small></span>
                <MerchantIcon name={payment.payeeName} />
                <div className="bill-main"><strong>{payment.payeeName}</strong><small>{payment.memo || payment.category} · {payment.frequency === "once" ? "One time" : `Every ${payment.frequency === "weekly" ? "week" : "month"}`}</small></div>
                <div className="bill-badges"><span className={`status-pill ${payment.status === "active" ? "active" : payment.status === "paused" ? "open" : "paid"}`}>{payment.status === "paused" ? <Pause size={11} /> : payment.status === "active" ? <Play size={11} /> : <Check size={11} />}{payment.status}</span>{payment.autopay && <span className="chip chip-violet">Autopay</span>}</div>
                <b className="bill-amount">{money(payment.amount)}</b>
                <div className="bill-actions">{payment.status !== "completed" && <><button type="button" className="ghost-btn sm" onClick={() => toggleScheduledPayment(payment.id)}>{payment.status === "paused" ? <Play size={12} /> : <Pause size={12} />}{payment.status === "paused" ? "Resume" : "Pause"}</button><button type="button" className="solid-btn sm" disabled={payingId !== null} onClick={() => void pay(payment.id)}>{payingId === payment.id ? "Paying…" : "Pay now"}</button></>}<button type="button" className="icon-btn" onClick={() => removeScheduledPayment(payment.id)} aria-label={`Remove ${payment.payeeName}`}><Trash2 size={13} /></button></div>
              </motion.div>
            ))}
          </AnimatePresence>
          {!account.scheduledPayments.length && <EmptyState icon={<CalendarClock size={18} />} title="No scheduled payments" text="Create recurring bills or a one-time future payment." />}
        </div>
      </motion.section>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule a payment" subtitle="Choose an existing recipient or enter a payee name.">
        <form className="dash-form" onSubmit={create}>
          <label htmlFor="bill-payee">Saved recipient</label><select id="bill-payee" value={form.payeeId} onChange={e => { const p = account.payees.find(payee => payee.id === e.target.value); setForm(f => ({ ...f, payeeId: e.target.value, payeeName: p?.name ?? f.payeeName })); }}><option value="">Enter a different payee</option>{account.payees.map(p => <option key={p.id} value={p.id}>{p.nickname || p.name} · •••• {p.accountLast4}</option>)}</select>
          {!form.payeeId && <><label htmlFor="bill-name">Payee name</label><input id="bill-name" required placeholder="Utility, landlord or vendor" value={form.payeeName} onChange={e => setForm(f => ({ ...f, payeeName: e.target.value }))} /></>}
          <div className="field-row"><div><label htmlFor="bill-amount">Amount</label><div className="amount-input"><span>$</span><input id="bill-amount" type="number" min="1" step=".01" required value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div></div><div><label htmlFor="bill-category">Category</label><select id="bill-category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{categories.map(c => <option key={c}>{c}</option>)}</select></div></div>
          <div className="field-row"><div><label htmlFor="bill-frequency">Frequency</label><select id="bill-frequency" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as typeof form.frequency }))}><option value="once">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div><div><label htmlFor="bill-date">First payment</label><input id="bill-date" type="date" required value={form.date} min={new Date().toISOString().slice(0, 10)} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div></div>
          <label htmlFor="bill-memo">Memo <small>Optional</small></label><input id="bill-memo" maxLength={60} value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Rent, phone bill, contractor" />
          <Toggle checked={form.autopay} onChange={autopay => setForm(f => ({ ...f, autopay }))} label="Autopay" description="Pay automatically on the scheduled date." />
          <div className="modal-actions"><button type="button" className="ghost-btn" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="solid-btn">Schedule payment</button></div>
        </form>
      </Modal>
    </div>
  );
}

/* ============================================================
   Disputes & transaction support
   ============================================================ */
export function DisputesPage() {
  const { account, createDispute } = useAcct();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.has("txn"));
  
  // Requirement 2: Dispute should show ALL transactions (all outflows across card, ach, wire, zelle)
  const allOutflows = useMemo(() => account?.transactions.filter(t => t.amount < 0) ?? [], [account]);
  const [transactionId, setTransactionId] = useState(params.get("txn") ?? allOutflows[0]?.id ?? "");
  const [disputeSearch, setDisputeSearch] = useState("");
  const [reason, setReason] = useState("I don't recognize this charge / Merchant fraud");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!transactionId && allOutflows[0]) setTransactionId(allOutflows[0].id);
  }, [allOutflows, transactionId]);

  if (!account) return null;

  const filteredOutflows = allOutflows.filter(t => 
    t.merchant.toLowerCase().includes(disputeSearch.toLowerCase()) ||
    t.category.toLowerCase().includes(disputeSearch.toLowerCase()) ||
    (t.note || "").toLowerCase().includes(disputeSearch.toLowerCase())
  );

  const selectedTxn = allOutflows.find(t => t.id === transactionId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const dispute = createDispute({ transactionId, reason, detail });
    if (!dispute) return toast({ tone: "error", title: "This transaction cannot be disputed", description: "It may already have an active claim filed." });
    setOpen(false); setDetail(""); setParams({}, { replace: true });
    toast({ tone: "success", title: "Arbitration Claim Filed", description: `${money(dispute.amount)} for ${dispute.merchant} has been queued for review.` });
  };

  const handleStartDisputeFor = (txnId: string) => {
    setTransactionId(txnId);
    setOpen(true);
  };

  return (
    <div className="app-page disputes-complete-page">
      <PageHeader eyebrow="Transaction Protection · Card & Transfer Arbitration · FDIC-Compliant" title="Disputes & Fraud Resolution">
        <button type="button" className="solid-btn" onClick={() => setOpen(true)}>
          <Plus size={15} /> File New Dispute
        </button>
      </PageHeader>

      <div className="dispute-callout">
        <ShieldAlert size={22} />
        <div>
          <strong>Zero Liability Guarantee on Unauthorized Transactions</strong>
          <p>You can dispute any debit card swipe, Zelle® transfer, ACH debit or wire within 60 days of settlement.</p>
        </div>
        <Link to="/app/cards" className="ghost-btn sm">Freeze Card</Link>
      </div>

      {/* Claims In Progress */}
      {account.disputes.length > 0 && (
        <section className="panel mb-4">
          <div className="panel-head">
            <div>
              <h2>Active Cases & Chargebacks ({account.disputes.length})</h2>
              <span className="panel-sub">Real-time status tracking and provisional credit timeline</span>
            </div>
          </div>
          <div className="dispute-list">
            {account.disputes.map(claim => {
              const steps: Dispute["status"][] = ["submitted", "reviewing", "resolved"];
              const index = claim.status === "denied" ? 1 : steps.indexOf(claim.status);
              return (
                <motion.article layout className="dispute-card" key={claim.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="dispute-card-head">
                    <MerchantIcon name={claim.merchant} />
                    <div>
                      <strong>{claim.merchant}</strong>
                      <small>{claim.reason} · Opened {shortDate(claim.openedAt)}</small>
                    </div>
                    <b>{money(claim.amount)}</b>
                  </div>
                  <div className="claim-progress">
                    {steps.map((step, i) => (
                      <div className={i <= index ? "done" : ""} key={step}>
                        <span>{i <= index ? <Check size={10} /> : i + 1}</span>
                        <small>{step === "submitted" ? "Filed" : step === "reviewing" ? "Investigating" : "Resolved & Refunded"}</small>
                      </div>
                    ))}
                  </div>
                  {claim.detail && <p className="dispute-detail-quote">"{claim.detail}"</p>}
                  <div className="dispute-foot">
                    <span className={`status-pill ${claim.status === "resolved" ? "paid" : claim.status === "denied" ? "overdue" : "open"}`}>
                      {claim.status === "resolved" ? "Provisional Credit Issued" : claim.status}
                    </span>
                    {claim.status !== "resolved" && claim.status !== "denied" && (
                      <small className="panel-sub">Our arbitration team reviews every claim — no action needed.</small>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>
      )}

      {/* Requirement 2: All Transactions Ledger with 1-click Dispute Action */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Select Any Transaction to Dispute</h2>
            <span className="panel-sub">Showing all {allOutflows.length} settled and pending outgoing charges across cards, wires, ACH and Zelle®</span>
          </div>
          <div className="dispute-table-search">
            <Search size={14} />
            <input
              placeholder="Search merchant, amount or category…"
              value={disputeSearch}
              onChange={e => setDisputeSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="dispute-transactions-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant / Payee</th>
                <th>Method</th>
                <th>Category</th>
                <th className="ta-r">Amount</th>
                <th className="ta-r">Dispute Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredOutflows.map(t => {
                const existingClaim = account.disputes.find(d => d.transactionId === t.id);
                return (
                  <tr key={t.id} className={existingClaim ? "disputed-row" : ""}>
                    <td>{shortDate(t.date)}</td>
                    <td>
                      <div className="dispute-row-merchant">
                        <MerchantIcon name={t.merchant} />
                        <div>
                          <strong>{t.merchant}</strong>
                          {t.note && <small className="dispute-sub-memo"> · {t.note}</small>}
                        </div>
                      </div>
                    </td>
                    <td><span className="chip">{t.method || "Card"}</span></td>
                    <td><span className="cat-pill">{t.category}</span></td>
                    <td className="ta-r"><strong>−{money(Math.abs(t.amount))}</strong></td>
                    <td className="ta-r">
                      {existingClaim ? (
                        <span className={`status-pill ${existingClaim.status === "resolved" ? "paid" : "open"}`}>
                          Claim: {existingClaim.status}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="ghost-btn sm dispute-btn-action"
                          onClick={() => handleStartDisputeFor(t.id)}
                        >
                          <ShieldAlert size={12} /> Dispute Charge
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!filteredOutflows.length && (
                <tr>
                  <td colSpan={6} className="text-center p-4">
                    No transactions match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Formal Dispute Filing Modal */}
      <Modal
        open={open}
        onClose={() => { setOpen(false); setParams({}, { replace: true }); }}
        title="File Formal Transaction Dispute"
        subtitle="Submit a complaint to the Card Dispute & Federal Electronic Funds Arbitration Desk."
      >
        <form className="dash-form" onSubmit={submit}>
          <label htmlFor="dispute-txn">Select Transaction ({allOutflows.length} available)</label>
          <select
            id="dispute-txn"
            required
            value={transactionId}
            onChange={e => setTransactionId(e.target.value)}
          >
            {allOutflows.map(txn => (
              <option key={txn.id} value={txn.id}>
                {txn.merchant} · −{money(Math.abs(txn.amount))} ({txn.method || "Card"}) · {shortDate(txn.date)}
              </option>
            ))}
          </select>

          {selectedTxn && (
            <div className="dispute-preview-box">
              <div className="dispute-prev-row"><span>Merchant:</span> <strong>{selectedTxn.merchant}</strong></div>
              <div className="dispute-prev-row"><span>Amount to Refund:</span> <strong className="warn-red">{money(Math.abs(selectedTxn.amount))}</strong></div>
              <div className="dispute-prev-row"><span>Date:</span> <b>{longDate(selectedTxn.date)}</b></div>
              <div className="dispute-prev-row"><span>Method:</span> <span>{selectedTxn.method || "Debit Card"}</span></div>
            </div>
          )}

          <label htmlFor="dispute-reason">Reason for Dispute</label>
          <select id="dispute-reason" value={reason} onChange={e => setReason(e.target.value)}>
            <option>I don't recognize this charge / Merchant fraud</option>
            <option>Duplicate charge (charged multiple times for one purchase)</option>
            <option>Incorrect charge amount (different from checkout receipt)</option>
            <option>Goods or services not received / Cancelled order</option>
            <option>Cancelled recurring subscription but was still debited</option>
            <option>ATM cash not dispensed / Machine error</option>
            <option>Zelle® payment error / Unauthorized account transfer</option>
          </select>

          <label htmlFor="dispute-detail">Explain What Happened</label>
          <textarea
            id="dispute-detail"
            required
            rows={4}
            maxLength={600}
            placeholder="Please provide any relevant details (e.g., cancellation emails, store communications, reason charge was unauthorized) to support your claim."
            value={detail}
            onChange={e => setDetail(e.target.value)}
          />

          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="solid-btn" disabled={!allOutflows.length}>
              <ShieldAlert size={15} /> Submit Formal Dispute
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ============================================================
   KYC
   ============================================================ */
/* Document tiles required by the compliance request (or sensible defaults). */
const KYC_TILES: Array<{ key: string; req: KycRequirement; label: string; note: string }> = [
  { key: "idFront", req: "identity", label: "Government ID — front", note: "Passport page or front of license / state ID" },
  { key: "idBack", req: "identity", label: "Government ID — back", note: "Back of the card or second passport page" },
  { key: "address", req: "address", label: "Proof of address", note: "Utility bill, lease or bank statement — last 3 months" },
  { key: "selfie", req: "selfie", label: "Selfie / liveness check", note: "A clear selfie holding your ID, good lighting" },
  { key: "funds", req: "funds", label: "Source-of-funds document", note: "Payslip, invoice, or bank statement showing income" },
];

const KYC_STEP_TITLES = ["Your details", "Documents", "Review & submit"];

const KYC_LIMITS: Array<[string, string, string]> = [
  ["Monthly send limit", "$10,000", "$250,000"],
  ["Card issuance", "3 cards", "Unlimited"],
  ["Outgoing wires", "Not available", "Enabled"],
  ["Savings pockets", "2", "Unlimited"],
];

export function KYCPage() {
  const { account, user, updateKyc } = useAcct();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState({
    legalName: user?.name ?? "",
    dob: "",
    country: account?.kyc.country ?? "United States",
    documentType: account?.kyc.documentType ?? "Passport",
    source: "Employment",
    taxId: "",
    registration: "",
    industry: "Professional services",
  });
  const [uploads, setUploads] = useState<Record<string, string>>({});
  if (!account) return null;

  const kyc = account.kyc;
  const status = kyc.status;
  const isBusiness = user?.accountType === "business";
  const requested = status === "requested";

  const requirements: KycRequirement[] =
    kyc.requirements && kyc.requirements.length > 0 ? kyc.requirements : ["identity", "address", "selfie"];
  const tiles = KYC_TILES.filter(t => requirements.includes(t.req));
  const uploadedCount = tiles.filter(t => uploads[t.key]).length;
  const detailsComplete = form.legalName.trim().length > 1 && form.dob !== "" && form.taxId.trim().length >= 4;
  const docsComplete = uploadedCount === tiles.length;

  const statusPill =
    status === "approved" ? <span className="status-pill paid"><span className="dot" />Verified</span>
    : status === "in_review" ? <span className="status-pill active"><span className="dot" />In review</span>
    : status === "needs_attention" ? <span className="status-pill overdue"><span className="dot" />Action needed</span>
    : requested ? <span className="status-pill open"><span className="dot" />Requested</span>
    : <span className="status-pill open"><span className="dot" />Not started</span>;

  const heading =
    status === "approved" ? "Your identity is verified"
    : status === "in_review" ? "Your verification is under review"
    : requested ? "Verify your identity to lift account limits"
    : status === "needs_attention" ? "Finish your identity verification"
    : "Verify your identity to lift account limits";

  const handleUpload = (key: string, file?: File | null) => {
    if (file && file.name) setUploads(prev => ({ ...prev, [key]: file.name }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!confirmed) return;
    updateKyc({
      status: "in_review",
      completeness: 100,
      documentType: form.documentType,
      country: form.country,
      nextStep: "Documents submitted — our compliance team is verifying your details. Most reviews complete within 1–2 business days.",
      requestedAt: undefined,
      submission: {
        legalName: form.legalName,
        dob: form.dob,
        country: form.country,
        documentType: form.documentType,
        source: form.source,
        taxId: form.taxId,
        registration: isBusiness ? form.registration : undefined,
        industry: isBusiness ? form.industry : undefined,
        documents: tiles.map(t => ({ key: t.key, label: t.label, name: uploads[t.key] ?? "" })),
        submittedAt: Date.now(),
      },
    });
    toast({ tone: "success", title: "Verification submitted", description: "We'll email you as soon as the review completes." });
  };

  const stepIndex = status === "in_review" || status === "approved" ? 3 : step;

  return (
    <div className="app-page">
      <PageHeader eyebrow="Identity verification · Compliance · Account limits" title="Identity verification">
        {status === "in_review" && (
          <Link to="/app" className="ghost-btn sm"><LayoutDashboard size={14} /> Back to dashboard</Link>
        )}
      </PageHeader>

      {/* Request context — why am I being asked? */}
      {requested && (kyc.requestedBy || kyc.requestReason) && (
        <div className="kyc-request-card">
          <ShieldAlert size={18} />
          <div>
            <strong>Verification requested by {kyc.requestedBy || "our compliance team"}{kyc.requestedAt ? ` · ${longDate(kyc.requestedAt)}` : ""}</strong>
            <span>{kyc.requestReason || "Please complete identity verification to keep your account limits."}</span>
          </div>
        </div>
      )}

      <div className="kyc-status-row panel">
        <div className="kyc-status-left">
          <div className={`kyc-status-ring ${status === "approved" ? "is-approved" : ""}`} style={{ ["--kyc-progress" as string]: `${kyc.completeness}` }}>
            <div className="kyc-status-ring-inner">
              <b>{kyc.completeness}</b>
              <small>%</small>
            </div>
          </div>
          <div>
            {statusPill}
            <h2>{heading}</h2>
            <p>{kyc.nextStep || "Complete the three steps below — it takes about five minutes."}</p>
          </div>
        </div>
        <div className="kyc-status-meta">
          <span>Country</span>
          <strong>{kyc.country}</strong>
          <span>Document</span>
          <strong>{kyc.documentType}</strong>
          <span>Last updated</span>
          <strong>{longDate(kyc.lastUpdated)}</strong>
        </div>
      </div>

      <div className="kyc-grid">
        <div className="kyc-main-col">
          {status === "approved" ? (
            <section className="panel kyc-submitted">
              <BadgeCheck size={34} />
              <div>
                <h2>Verification complete</h2>
                <p>Your identity was verified on {longDate(kyc.lastUpdated)}. All account limits are unlocked, and we'll only reach out if a periodic refresh is required by regulation.</p>
                <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                  <Link to="/app" className="solid-btn sm"><LayoutDashboard size={14} /> Back to dashboard</Link>
                </div>
              </div>
            </section>
          ) : status === "in_review" ? (
            <section className="panel kyc-submitted">
              <Clock size={34} />
              <div>
                <h2>Documents received — review in progress</h2>
                <p>Our compliance team is verifying your {kyc.documentType.toLowerCase()} and supporting documents. Most reviews complete within 1–2 business days, and we'll email you the moment there's a decision.</p>
                <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                  <Link to="/app" className="solid-btn sm"><LayoutDashboard size={14} /> Back to dashboard</Link>
                  <Link to="/app/support-desk" className="ghost-btn sm"><MessageSquare size={14} /> Contact support</Link>
                </div>
              </div>
            </section>
          ) : (
            <form className="panel dash-form kyc-wizard" onSubmit={submit}>
              <div className="panel-head">
                <div>
                  <h2>Complete your verification</h2>
                  <span className="panel-sub">Three short steps · about five minutes</span>
                </div>
                <span className="kyc-step-count">Step {step + 1} of 3</span>
              </div>

              <ol className="kyc-steps" aria-label="Verification progress">
                {KYC_STEP_TITLES.map((title, i) => (
                  <li key={title} className={`kyc-step ${i < stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`}>
                    <span className="kyc-step-dot">{i < stepIndex ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                    <span className="kyc-step-label">{title}</span>
                    {i < KYC_STEP_TITLES.length - 1 && <span className="kyc-step-sep" />}
                  </li>
                ))}
              </ol>

              {/* STEP 1 — personal details */}
              {step === 0 && (
                <fieldset className="kyc-form-grid">
                  <legend>Information exactly as it appears on your ID.</legend>
                  <div>
                    <label htmlFor="kyc-name">Legal full name</label>
                    <input id="kyc-name" required placeholder="e.g. Rae Kim" value={form.legalName} onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="kyc-dob">Date of birth</label>
                    <input id="kyc-dob" required type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} />
                  </div>
                  <div>
                    <label htmlFor="kyc-country">Country of residence</label>
                    <select id="kyc-country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                      {["United States", "Canada", "United Kingdom", "Nigeria", "Other"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="kyc-document">Document type</label>
                    <select id="kyc-document" value={form.documentType} onChange={e => setForm(f => ({ ...f, documentType: e.target.value }))}>
                      {["Passport", "Driver license", "State ID", "Residence permit"].map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="kyc-tax">Tax ID (last 4)</label>
                    <input id="kyc-tax" required inputMode="numeric" maxLength={4} placeholder="••••" value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value.replace(/\D/g, "") }))} />
                  </div>
                  <div>
                    <label htmlFor="kyc-source">Source of funds</label>
                    <select id="kyc-source" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                      {["Employment", "Business income", "Investments", "Family support"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  {isBusiness && (
                    <>
                      <div>
                        <label htmlFor="kyc-reg">Business registration number</label>
                        <input id="kyc-reg" placeholder="e.g. 88-3910274" value={form.registration} onChange={e => setForm(f => ({ ...f, registration: e.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor="kyc-industry">Industry</label>
                        <select id="kyc-industry" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                          {["Professional services", "E-commerce", "Software", "Retail", "Hospitality", "Other"].map(i => <option key={i}>{i}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="kyc-form-actions">
                    <span />
                    <button type="button" className="solid-btn" disabled={!detailsComplete} onClick={() => setStep(1)}>
                      Continue <ArrowRight size={15} />
                    </button>
                  </div>
                </fieldset>
              )}

              {/* STEP 2 — documents */}
              {step === 1 && (
                <div className="kyc-docs">
                  <div className="kyc-progress">
                    <div className="kyc-progress-head">
                      <span>Documents uploaded</span>
                      <b>{uploadedCount} of {tiles.length}</b>
                    </div>
                    <div className="kyc-progress-track"><i style={{ width: `${(uploadedCount / tiles.length) * 100}%` }} /></div>
                  </div>

                  <div className="kyc-upload-list">
                    {tiles.map(t => (
                      <div className={`kyc-upload-item ${uploads[t.key] ? "has-file" : ""}`} key={t.key}>
                        <div className="kyc-upload-copy">
                          <strong>{t.label}{uploads[t.key] && <BadgeCheck size={14} className="kyc-doc-done" />}</strong>
                          <small>{t.note}</small>
                        </div>
                        <label className="upload-btn">
                          <input type="file" accept="image/*,.pdf" onChange={e => handleUpload(t.key, e.target.files?.[0])} />
                          <Upload size={13} /> {uploads[t.key] ? "Replace" : "Upload"}
                        </label>
                        <p className="kyc-upload-name">{uploads[t.key] ?? "JPG, PNG or PDF · up to 10 MB"}</p>
                      </div>
                    ))}
                  </div>

                  <div className="kyc-form-actions">
                    <button type="button" className="ghost-btn" onClick={() => setStep(0)}>Back</button>
                    <button type="button" className="solid-btn" disabled={!docsComplete} onClick={() => setStep(2)}>
                      Continue <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3 — review & submit */}
              {step === 2 && (
                <div className="kyc-review">
                  <div className="kyc-review-rows">
                    {[
                      ["Legal name", form.legalName],
                      ["Date of birth", form.dob ? new Date(form.dob).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"],
                      ["Country", form.country],
                      ["Document", form.documentType],
                      ["Source of funds", form.source],
                      ...(isBusiness ? [["Registration", form.registration || "—"]] : []),
                      ["Documents", `${uploadedCount} of ${tiles.length} uploaded`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>

                  <label className="kyc-confirm">
                    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                    <span>I confirm my information is accurate and my documents are genuine. I understand false information can result in account closure.</span>
                  </label>

                  <div className="kyc-form-actions">
                    <button type="button" className="ghost-btn" onClick={() => setStep(1)}>Back</button>
                    <button type="submit" className="solid-btn" disabled={!confirmed}>
                      <ShieldCheck size={15} /> Submit for review
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>What verification unlocks</h2>
                <span className="panel-sub">Limits before and after verification</span>
              </div>
            </div>
            <div className="kyc-limits">
              <div className="kyc-limits-head"><span /><span>Unverified</span><span>Verified</span></div>
              {KYC_LIMITS.map(([label, before, after]) => (
                <div className="kyc-limit-row" key={label}>
                  <span>{label}</span>
                  <em>{before}</em>
                  <strong><Check size={13} strokeWidth={3} /> {after}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="kyc-side-col">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>What happens next</h2>
                <span className="panel-sub">The review journey</span>
              </div>
            </div>
            <ol className="kyc-timeline">
              {[
                { title: "Submit details & documents", note: "Three steps in this page", done: stepIndex >= 1, active: stepIndex === 0 },
                { title: "Compliance review", note: "Usually 1–2 business days", done: stepIndex >= 3, active: stepIndex === 1 || stepIndex === 2 },
                { title: "Decision by email", note: "Limits lift automatically on approval", done: stepIndex >= 3 && status === "approved", active: false },
              ].map((s, i) => (
                <li key={s.title} className={`${s.done ? "done" : ""} ${s.active ? "active" : ""}`}>
                  <span className="kyc-timeline-dot">{s.done ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                  <div><strong>{s.title}</strong><small>{s.note}</small></div>
                </li>
              ))}
            </ol>
            <div className="kyc-note">
              <strong>Document security</strong>
              <p>Uploads are encrypted in transit and at rest, visible only to the compliance team, and deleted after the retention window required by law.</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>What we check</h2>
                <span className="panel-sub">Standard identity review</span>
              </div>
            </div>
            <div className="kyc-checklist">
              <div className="kyc-check"><Check size={14} /><span>Proof of identity</span></div>
              <div className="kyc-check"><Check size={14} /><span>Address verification</span></div>
              <div className="kyc-check"><Check size={14} /><span>Source-of-funds declaration</span></div>
              <div className="kyc-check"><Check size={14} /><span>Risk and sanctions screening</span></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Security center
   ============================================================ */
export function SecurityCenterPage() {
  return <div className="app-page"><SecurityCenterContent variant="business" /></div>;
}

// Re-export high-fidelity institutional bank statement suite
export { StatementsPage } from "./StatementsPage";

/* ============================================================
   Settings
   ============================================================ */
export function SettingsPage() {
  const { user, updateUser, changePassword, logout } = useAuth();
  const { account, setPreference } = useAcct();
  const toast = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    name: user?.name ?? "",
    phone: user?.phone ?? "",
    business: user?.business ?? "",
    email: user?.email ?? "",
    avatarUrl: user?.avatarUrl || "/images/avatar-3d-default.svg"
  });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwError, setPwError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!account || !user) return null;
  const prefs = account.preferences;
  const personal = user.accountType === "personal";

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    updateUser({
      name: profile.name.trim(),
      phone: profile.phone.trim(),
      business: profile.business.trim(),
      email: profile.email.trim(),
      avatarUrl: profile.avatarUrl
    });
    toast({ tone: "success", title: "Profile saved", description: "Your details and profile photo are updated across Veyra." });
  };

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      toast({ tone: "error", title: "File too large", description: "Please choose an image under 2.5MB." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setProfile(p => ({ ...p, avatarUrl: result }));
        updateUser({ avatarUrl: result });
        toast({ tone: "success", title: "Profile Picture Updated", description: "Your custom photo has been saved." });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleResetTo3DAvatar = () => {
    setProfile(p => ({ ...p, avatarUrl: "/images/avatar-3d-default.svg" }));
    updateUser({ avatarUrl: "/images/avatar-3d-default.svg" });
    toast({ tone: "info", title: "3D Clay Avatar Restored", description: "Default stylized 3D avatar active." });
  };
  const savePw = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      toast({ tone: "success", title: "Password updated", description: "Use your new password next time you sign in." });
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Couldn't update your password.");
    }
  };
  const setPlan = (plan: "Starter" | "Pro") => {
    if (plan === user.plan) return;
    updateUser({ plan });
    const label = personal ? (plan === "Pro" ? "Plus" : "Everyday") : plan;
    toast({ tone: "success", title: `You're on ${label}`, description: plan === "Pro" ? "Scout AI and enhanced rewards are on." : "Core banking stays free." });
  };
  const pref = (key: keyof typeof prefs, value: boolean, label: string) => {
    setPreference(key, value);
    toast({ tone: "info", title: `${label} ${value ? "on" : "off"}` });
  };

  return (
    <div className="app-page">
      <PageHeader eyebrow={user.email} title="Settings" />
      <div className="settings-grid">
        <div className="settings-col">
          <motion.form className="panel dash-form settings-profile-form" onSubmit={saveProfile} {...rise(0)}>
            <h2>{personal ? "Personal Profile" : "Business Profile"}</h2>
            <div className="profile-type-note">
              {personal ? <UserRound size={15} /> : <Building2 size={15} />}
              <span><b>{personal ? "Personal Checking" : "Business Checking"}</b><small>{personal ? "Built for everyday personal banking" : "Built for company treasury & cards"}</small></span>
            </div>

            {/* Requirement 3: User Avatar Image with Upload & 3D Clay Fallback */}
            <div className="avatar-settings-uploader">
              <div className="avatar-preview-ring">
                <img
                  src={profile.avatarUrl || "/images/avatar-3d-default.svg"}
                  alt={user.name}
                  className="avatar-img-round"
                />
              </div>

              <div className="avatar-upload-info">
                <strong>Profile Avatar</strong>
                <p>Upload your real photo, or enjoy your default stylized 3D clay banking character.</p>
                <div className="avatar-btn-row">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleAvatarFile}
                  />
                  <button
                    type="button"
                    className="solid-btn sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload Picture
                  </button>
                  <button
                    type="button"
                    className="ghost-btn sm"
                    onClick={handleResetTo3DAvatar}
                  >
                    Use 3D Avatar
                  </button>
                </div>
              </div>
            </div>

            <label htmlFor="st-name">Your Full Name</label>
            <input id="st-name" required value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />

            <div className="field-row">
              <div>
                <label htmlFor="st-phone">Mobile Phone (2FA & Alerts)</label>
                <input id="st-phone" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="+1 (555) 019-2834" />
              </div>
              <div>
                <label htmlFor="st-email">Email Address</label>
                <input id="st-email" type="email" required value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>

            {!personal && (
              <>
                <label htmlFor="st-biz">Company Legal Name</label>
                <input id="st-biz" required value={profile.business} onChange={e => setProfile(p => ({ ...p, business: e.target.value }))} />
              </>
            )}
            <span className="field-label">Plan</span>
            <Segmented id="plan" value={user.plan} onChange={setPlan} options={PLANS[personal ? "personal" : "business"].map(p => ({ value: p.id, label: `${p.name} · $${p.monthly}/mo` }))} />
            <p className="form-intro">{PLAN_NOTICE}</p>
            <button type="submit" className="solid-btn dash-submit"><Check size={15} /> Save changes</button>
          </motion.form>

          <motion.section className="panel" {...rise(1)}>
            <div className="panel-head"><div><h2>Notifications</h2><span className="panel-sub">Choose what we tell you about</span></div></div>
            <Toggle checked={prefs.loginAlerts} onChange={v => pref("loginAlerts", v, "Sign-in alerts")} label="Sign-in alerts" description="Show an in-app security notification for sign-ins from untrusted browsers." />
            <Toggle checked={prefs.weeklyDigest} onChange={v => pref("weeklyDigest", v, "Weekly digest")} label="Weekly digest" description="A Monday summary of spend, rewards and savings." />
            <Toggle checked={prefs.scoutAuto} onChange={v => pref("scoutAuto", v, "Scout auto-savings")} label="Scout monitoring" description="Analyze saved activity. Estimates never credit your balance." />
          </motion.section>
        </div>

        <div className="settings-col">
          <motion.form className="panel dash-form" onSubmit={savePw} {...rise(2)}>
            <h2>Security</h2>
            <div className="security-settings-link"><ShieldCheck size={17} /><span><b>Two-step sign-in</b><small>{prefs.twoFactor ? "Authenticator protection is enabled." : "Authenticator protection is not set up."}</small></span><Link to="/app/security">Manage</Link></div>
            <label htmlFor="st-cur">Current password</label>
            <input id="st-cur" type="password" autoComplete="current-password" required value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
            <label htmlFor="st-next">New password</label>
            <input id="st-next" type="password" autoComplete="new-password" required minLength={8} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
            {pwError && <p className="form-error">{pwError}</p>}
            <button type="submit" className="solid-btn dash-submit"><ShieldCheck size={15} /> Update password</button>
          </motion.form>

          <motion.section className="panel danger-zone" {...rise(3)}>
            <h2>Session</h2>
            <p>Signing out revokes this session on the server immediately.</p>
            <div className="danger-actions">
              <button type="button" className="ghost-btn danger" onClick={() => { logout(); navigate("/"); }}><LogOut size={14} /> Sign out</button>
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
