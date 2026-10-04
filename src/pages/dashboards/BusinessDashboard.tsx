/**
 * Business banking dashboard — the "operating view" shell.
 *
 * The business workspace is its own surface: a persistent module rail, a
 * treasury top bar that keeps available cash in sight, and a dark-on-light
 * data language. It is deliberately unlike the personal dashboard (warm,
 * airy, pill navigation) and unlike the admin console (near-black control
 * room) — one account type must never be mistaken for another.
 *
 * The member-facing content lives in `BusinessOverview` (see ../Dashboard.tsx);
 * this file is only the chrome it sits inside.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft, ArrowUpRight, Building2, Camera, ExternalLink, LogOut, Menu, Plus, Search, Send,
  ShieldCheck, Sparkles, X,
} from "lucide-react";
import { AnimatedMoney, Logo, ease } from "../../components/common";
import { money } from "../../lib/store";
import type { NavGroup } from "./parts";

type BusinessUser = {
  name: string;
  email?: string;
  avatarUrl?: string;
  plan?: string;
  business?: string;
  accountType?: string;
  role?: string;
};

type ChromeProps = {
  user: BusinessUser;
  /** Last four digits shown in the account badge. */
  accountNumber: string;
  balance: number;
  nav: NavGroup[];
  notifications: ReactNode;
  onOpenPalette: () => void;
  onOpenScout: () => void;
  onOpenDeposit: () => void;
  onOpenCheckDeposit: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

/**
 * The balance ticker in the top bar: when the number moves, the change slides
 * up and fades, so a deposit landing (or a payment going out) is visible
 * without watching the dashboard body.
 */
function BalanceDelta({ value }: { value: number }) {
  const prev = useRef(value);
  const timers = useRef<number[]>([]);
  const [items, setItems] = useState<Array<{ id: number; diff: number }>>([]);
  useEffect(() => () => { timers.current.forEach(t => window.clearTimeout(t)); }, []);
  useEffect(() => {
    const diff = Math.round((value - prev.current) * 100) / 100;
    prev.current = value;
    if (Math.abs(diff) < 0.01) return;
    const id = performance.now() + Math.random();
    setItems(list => [...list.slice(-1), { id, diff }]);
    timers.current.push(window.setTimeout(() => setItems(list => list.filter(i => i.id !== id)), 3400));
  }, [value]);
  return (
    <span className="balance-delta-wrap" aria-hidden="true">
      <AnimatePresence>
        {items.map(i => (
          <motion.span key={i.id} className={`balance-delta ${i.diff > 0 ? "up" : "down"}`}
            initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.4, ease }}>
            {i.diff > 0 ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
            {i.diff > 0 ? "+" : "−"}{money(Math.abs(i.diff))}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}

export function BusinessChrome({
  user, accountNumber, balance, nav, notifications,
  onOpenPalette, onOpenScout, onOpenDeposit, onOpenCheckDeposit, onSignOut, children,
}: ChromeProps) {
  const [navOpen, setNavOpen] = useState(false);
  const isAdmin = Boolean(user.role && user.role !== "user");

  return (
    <div className="app-shell business-shell">
      <aside className={`app-nav ${navOpen ? "open" : ""}`} aria-label="Business navigation">
        <div className="app-nav-top">
          <Logo to="/app" />
          <button type="button" className="app-nav-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="app-biz-badge">
          <span className="biz-icon">{isAdmin ? <ShieldCheck size={16} /> : <Building2 size={16} />}</span>
          <div className="biz-info">
            <strong>{isAdmin ? "Super Admin Control" : user.business || "My business"}</strong>
            <small>{isAdmin ? "Master Oversight" : user.plan} · Checking •••• {accountNumber.slice(-4)}</small>
          </div>
        </div>

        {isAdmin && (
          <div className="admin-shortcut-box">
            <Link to="/app/superadmin" className="admin-shortcut-link">
              <ShieldCheck size={14} /> Master Super Admin Console →
            </Link>
          </div>
        )}

        <nav className="dash-nav">
          {nav.map(group => (
            <div className="dash-nav-group" key={group.title}>
              <span className="dash-nav-title">{group.title}</span>
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setNavOpen(false)} className={({ isActive }) => `dash-link ${isActive ? "on" : ""}`}>
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="dash-active" className="dash-active" transition={{ type: "spring", stiffness: 460, damping: 38 }} />}
                      <span className="dash-link-icon">{item.icon}</span>
                      <span className="dash-link-label">{item.label}</span>
                      {item.badge && <span className="dash-pill-badge">{item.badge}</span>}
                    </>
                  )}
                </NavLink>
              ))}
              {group.title === "Money" && (
                <button type="button" className="dash-link dash-link-btn" onClick={() => { setNavOpen(false); onOpenCheckDeposit(); }}>
                  <span className="dash-link-icon"><Camera size={18} /></span>
                  <span className="dash-link-label">Check deposit</span>
                </button>
              )}
            </div>
          ))}
        </nav>

        <div className="app-nav-foot">
          <div className="app-user">
            <span className="app-avatar avatar-with-image">
              <img src={user.avatarUrl || "/images/avatar-3d-default.svg"} alt="" />
            </span>
            <div className="app-user-info"><strong>{user.name}</strong><small>{user.email}</small></div>
          </div>
          <div className="app-foot-actions">
            <button type="button" className="logout" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
            <Link to="/" className="back-site">Website <ExternalLink size={12} /></Link>
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {navOpen && <motion.div className="app-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setNavOpen(false)} />}
      </AnimatePresence>

      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-left">
            <button type="button" className="app-burger icon-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
            <div className="topbar-balance">
              <span>Available business cash</span>
              <div className="topbar-balance-value">
                <AnimatedMoney value={balance} className="topbar-amount" cents />
                <BalanceDelta value={balance} />
              </div>
            </div>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="topbar-search-trigger"
              onClick={onOpenPalette}
              aria-label="Search or quick jump (Command K)"
            >
              <Search size={14} />
              <span>Quick jump…</span>
              <kbd>⌘K</kbd>
            </button>

            <button
              type="button"
              className="topbar-btn scout-quick-btn"
              onClick={onOpenScout}
              aria-label="Open Scout Copilot"
            >
              <Sparkles size={14} />
              <span>Ask Scout</span>
            </button>

            <button type="button" className="topbar-btn" onClick={onOpenDeposit} aria-label="Add funds"><Plus size={15} /><span>Add funds</span></button>
            <Link to="/app/transfers" className="topbar-btn solid" aria-label="Send money"><Send size={14} /><span>Send</span></Link>

            {notifications}

            <Link to="/app/settings" className="app-avatar top-avatar avatar-with-image" aria-label="Account settings">
              <img src={user.avatarUrl || "/images/avatar-3d-default.svg"} alt={user.name} />
            </Link>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
