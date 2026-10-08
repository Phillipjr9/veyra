import { buildCashFlow } from "../../lib/dashboardAnalytics";
/**
 * Personal banking dashboard — "everyday money" design.
 *
 * Deliberately unlike the business and admin surfaces: a horizontal pill nav
 * instead of a side rail, a single oversized balance hero with rounded quick
 * actions, goal rings for savings pockets, a social-style activity feed, and
 * cash-back as a first-class strip. Warm paper, soft radii, no tabular data
 * grids — that language belongs to the business treasury view.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight, Award, CalendarClock, Check, Copy, Eye, EyeOff,
  ChevronDown, Gift, Landmark, Menu, PiggyBank, Plus, Search, Send, Sparkles, Target, TrendingUp, X,
} from "lucide-react";
import { AnimatedMoney, Logo, VirtualCard, ease } from "../../components/common";
import { money, useAcct } from "../../lib/store";
import { Ring, Sparkline, type NavGroup } from "./parts";

const rise = (i = 0) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05, duration: 0.5, ease } });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const ago = (ts: number) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type ChromeProps = {
  user: { name: string; avatarUrl?: string; plan?: string };
  nav: NavGroup[];
  unread: number;
  notifications: ReactNode;
  onOpenPalette: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function PersonalChrome({ user, nav, unread, notifications, onOpenPalette, onSignOut, children }: ChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const flat = nav.flatMap(g => g.items);
  // The rail-equivalent here is a pill row, so it carries the primary
  // destinations only — everything else lives in the account menu (and the
  // bottom tabs on phones) rather than scrolling off the edge.
  const PRIMARY_PILLS = ["/app", "/app/accounts", "/app/cards", "/app/transactions", "/app/transfers", "/app/bills"];
  const pills = flat.filter(i => PRIMARY_PILLS.includes(i.to));
  const tabs = flat.filter(i => ["/app", "/app/accounts", "/app/transfers", "/app/cards", "/app/settings"].includes(i.to));
  const first = user.name.split(" ")[0];

  return (
    <div className="pshell">
      <header className="pshell-top">
        <div className="pshell-top-inner">
          <Logo to="/app" />
          <nav className="pshell-pills" aria-label="Personal banking">
            {pills.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `pshell-pill ${isActive ? "on" : ""}`}>
                {item.label}
                {item.badge && <span className="pshell-pill-badge">{item.badge}</span>}
              </NavLink>
            ))}
            <button type="button" className={`pshell-pill pshell-pill-more ${menuOpen ? "on" : ""}`} onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}>
              More <ChevronDown size={13} />
            </button>
          </nav>
          <div className="pshell-top-right">
            <button type="button" className="pshell-icon-btn" onClick={onOpenPalette} aria-label="Search (Command K)"><Search size={16} /></button>
            {notifications}
            <button type="button" className="pshell-avatar" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-label="Account menu">
              <img src={user.avatarUrl || "/images/avatar-3d-default.svg"} alt="" />
              {unread > 0 && <span className="pshell-avatar-dot" />}
            </button>
            <button type="button" className="pshell-icon-btn pshell-burger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <motion.div className="pshell-menu" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }}>
            <div className="pshell-menu-head">
              <strong>{user.name}</strong>
              <small>{user.plan === "Pro" ? "Veyra Plus" : "Veyra Everyday"}</small>
            </div>
            {nav.map(group => (
              <div className="pshell-menu-group" key={group.title}>
                <span>{group.title}</span>
                {group.items.map(item => (
                  <button type="button" key={item.to} onClick={() => { setMenuOpen(false); navigate(item.to); }}>
                    {item.icon}{item.label}
                  </button>
                ))}
              </div>
            ))}
            <button type="button" className="pshell-menu-signout" onClick={onSignOut}>Sign out</button>
          </motion.div>
        )}
      </header>

      <main className="pshell-main">
        <div className="pshell-greeting">
          <span>{greeting()}, {first}</span>
        </div>
        {children}
      </main>

      {/* Phone-style bottom tabs: the personal dashboard is the one people check on a phone. */}
      <nav className="pshell-tabbar" aria-label="Quick navigation">
        {tabs.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `pshell-tab ${isActive ? "on" : ""}`}>
            {item.icon}
            <span>{item.label.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/* ============================================================
   Personal overview
   ============================================================ */

export function PersonalOverview() {
  const { account, user, redeemRewards } = useAcct();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const flow = useMemo(() => account?.analytics?.ranges[30] ?? buildCashFlow(account?.transactions ?? [], 30), [account]);
  if (!account || !user) return null;

  const pockets = account.savingsPockets.slice(0, 4);
  const card = account.cards[0];
  const perks = account.perks.filter(p => p.status === "available").slice(0, 3);
  const feed = account.transactions.slice(0, 7);
  const netUp = flow.inflow >= flow.outflow;

  const copy = async () => {
    const bank = account.bankDetails;
    try {
      await navigator.clipboard.writeText(`${bank.bankName}\nRouting (ABA): ${bank.routingNumber}\nAccount: ${bank.accountNumber}\nAccount name: ${bank.holder}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — the numbers stay selectable */ }
  };

  return (
    <div className="pdash">
      {/* ---- hero: one oversized number, four ways to move money ---- */}
      <motion.section className="p-hero" {...rise(0)}>
        <div className="p-hero-glow" aria-hidden="true" />
        <div className="p-hero-main">
          <span className="p-hero-label">Available to spend</span>
          <AnimatedMoney value={account.balance} className="p-hero-balance" cents fromZero />
          <div className="p-hero-sub">
            <span className={`p-hero-delta ${netUp ? "up" : "down"}`}>
              <TrendingUp size={13} /> {money(Math.abs(flow.net), false)} net {netUp ? "in" : "out"} · last 30 days
            </span>
            {account.pendingBalance > 0 && <span className="p-hero-pending">{money(account.pendingBalance)} pending</span>}
          </div>
          <Sparkline className="p-hero-spark" data={flow.buckets.map(w => w.inflow - w.outflow)} stroke="rgba(255,255,255,.75)" />
        </div>
        <div className="p-quick">
          <Link className="p-quick-tile" to="/app/transfers"><span className="p-quick-icon send"><Send size={18} /></span>Send</Link>
          <Link className="p-quick-tile" to="/app/accounts"><span className="p-quick-icon save"><PiggyBank size={18} /></span>Save</Link>
          <Link className="p-quick-tile" to="/app/bills"><span className="p-quick-icon bill"><CalendarClock size={18} /></span>Pay bill</Link>
          <Link className="p-quick-tile" to="/app/cards"><span className="p-quick-icon card"><Plus size={18} /></span>Add card</Link>
        </div>
      </motion.section>

      {/* ---- cash back strip ---- */}
      <motion.section className="p-rewards" {...rise(1)}>
        <span className="p-rewards-icon"><Award size={18} /></span>
        <div className="p-rewards-copy">
          <strong>{money(account.rewards)} cash back ready</strong>
          <small>Unlimited 2% on every purchase · {money(account.lifetimeRewards, false)} earned all time</small>
        </div>
        <button type="button" className="p-rewards-btn" disabled={account.rewards < 0.01} onClick={() => redeemRewards()}>
          Move to balance <ArrowRight size={14} />
        </button>
      </motion.section>

      <div className="p-grid">
        <div className="p-col-main">
          {/* ---- goals ---- */}
          <motion.section className="p-card" {...rise(2)}>
            <div className="p-card-head">
              <div><h2>Your goals</h2><span>Goals you create and fund from checking</span></div>
              <Link to="/app/accounts" className="p-link">All goals <ArrowRight size={13} /></Link>
            </div>
            {pockets.length ? (
              <div className="p-goals">
                {pockets.map(p => (
                  <Link className="p-goal" to="/app/accounts" key={p.id}>
                    <Ring value={p.target > 0 ? p.balance / p.target : 0} size={58} stroke={6}>
                      <span className="p-goal-pct">{p.target > 0 ? Math.round((p.balance / p.target) * 100) : 0}%</span>
                    </Ring>
                    <span className="p-goal-copy">
                      <strong>{p.name}</strong>
                      <small>{money(p.balance, false)} of {money(p.target, false)}</small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="p-empty">No goals yet — create one, then move money into it from checking. <Link to="/app/accounts">Create a goal</Link></p>
            )}
          </motion.section>

          {/* ---- activity feed ---- */}
          <motion.section className="p-card" {...rise(3)}>
            <div className="p-card-head">
              <div><h2>Recent activity</h2><span>Tap to see the details</span></div>
              <Link to="/app/transactions" className="p-link">See all <ArrowRight size={13} /></Link>
            </div>
            <div className="p-feed">
              {feed.length ? feed.map((t, i) => (
                <motion.div className="p-feed-row" key={t.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.03 }}>
                  <span className={`p-feed-avatar ${t.amount > 0 ? "in" : ""}`}>{(t.merchant || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="p-feed-copy">
                    <strong>{t.merchant}</strong>
                    <small>{t.category} · {ago(t.date)}{t.status === "pending" ? " · pending" : ""}</small>
                  </span>
                  <span className={`p-feed-amount ${t.amount > 0 ? "in" : ""}`}>
                    {t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}
                    {t.reward > 0 && <small>+{money(t.reward)} back</small>}
                    {(t.fee ?? 0) > 0 && <small>Fee {money(t.fee ?? 0)}</small>}
                  </span>
                </motion.div>
              )) : <p className="p-empty">Nothing here yet — your purchases will show up as you spend.</p>}
            </div>
          </motion.section>
        </div>

        <div className="p-col-side">
          {/* ---- card ---- */}
          <motion.section className="p-card p-card-card" {...rise(2)}>
            <div className="p-card-head"><div><h2>Your card</h2><span>{card ? `${card.label} · ${card.type}` : "No card issued yet"}</span></div></div>
            {card ? (
              <>
                <VirtualCard small label={card.label} holder={card.cardholder} last4={card.last4} frozen={card.frozen} type={card.type} />
                <div className="p-card-usage">
                  <span><small>Spent this month</small><strong>{money(card.spent)}</strong></span>
                  <span><small>Free limit</small><strong>{money(Math.max(0, card.limit - card.spent), false)}</strong></span>
                </div>
                <div className="p-card-track"><i style={{ width: `${Math.min(100, card.limit ? (card.spent / card.limit) * 100 : 0)}%` }} /></div>
                <Link to="/app/cards" className="p-link p-link-block">Freeze or set limits <ArrowRight size={13} /></Link>
              </>
            ) : (
              <p className="p-empty">Issue a virtual card in seconds — <Link to="/app/cards">get started</Link>.</p>
            )}
          </motion.section>

          {/* ---- where money went ---- */}
          <motion.section className="p-card" {...rise(3)}>
            <div className="p-card-head"><div><h2>Where money went</h2><span>Last 30 days</span></div></div>
            {flow.categories.length ? (
              <div className="p-cats">
                {flow.categories.slice(0, 4).map(({name, total}, i) => (
                  <div className="p-cat" key={name}>
                    <span className="p-cat-name"><b>{name}</b><small>{money(total, false)}</small></span>
                    <span className="p-cat-bar"><i style={{ width: `${flow.outflow ? Math.min(100, (total / flow.outflow) * 100) : 0}%`, animationDelay: `${i * 60}ms` }} /></span>
                  </div>
                ))}
              </div>
            ) : <p className="p-empty">No spending in the last 30 days.</p>}
          </motion.section>

          {/* ---- offers ---- */}
          <motion.section className="p-card" {...rise(4)}>
            <div className="p-card-head"><div><h2>Offers picked for you</h2><span>Cash back at places you already shop</span></div></div>
            {perks.length ? (
              <div className="p-perks">
                {perks.map(p => (
                  <div className="p-perk" key={p.id}>
                    <span className="p-perk-gift"><Gift size={15} /></span>
                    <span className="p-perk-copy"><strong>{p.partner}</strong><small>{p.value} · {p.category}</small></span>
                    <span className="p-perk-code">{p.code}</span>
                  </div>
                ))}
              </div>
            ) : <p className="p-empty">New offers arrive every week.</p>}
          </motion.section>

          {/* ---- account details ---- */}
          <motion.section className="p-card" {...rise(5)}>
            <div className="p-card-head"><div><h2>Account details</h2><span>{account.bankDetails.bankName}</span></div></div>
            <div className="p-details">
              <span><small>Routing</small><code>{account.bankDetails.routingNumber}</code></span>
              <span><small>Account</small><code>{reveal ? account.bankDetails.accountNumber : `•••• ${account.bankDetails.accountNumber.slice(-4)}`}</code></span>
              <button type="button" className="p-icon-btn" onClick={() => setReveal(r => !r)} aria-label={reveal ? "Hide account number" : "Show account number"}>
                {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button type="button" className="p-icon-btn" onClick={copy} aria-label="Copy account details">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </motion.section>

          <motion.section className="p-scout" {...rise(6)}>
            <Sparkles size={18} />
            <div><strong>{money(account.scoutSaved, false)} historical Scout entries</strong><small>Estimates are informational. Legacy entries are retained; no new savings credits are issued.</small></div>
            <Link to="/app/scout">Review Scout estimates <ArrowRight size={13} /></Link>
          </motion.section>
        </div>
      </div>

      <motion.section className="p-strip" {...rise(7)}>
        <span className="p-strip-icon"><Landmark size={16} /></span>
        <div><strong>Deposit a check</strong><small>Snap a photo and the funds are yours</small></div>
        <Link to="/app/transfers" className="p-strip-btn">Deposit <ArrowRight size={13} /></Link>
        <span className="p-strip-dot" />
        <span className="p-strip-icon alt"><Sparkles size={16} /></span>
        <div><strong>Ask Scout anything</strong><small>“How much did I spend on coffee?”</small></div>
        <Link to="/app/scout" className="p-strip-btn">Open Scout <ArrowRight size={13} /></Link>
        <span className="p-strip-dot" />
        <span className="p-strip-icon warm"><Target size={16} /></span>
        <div><strong>{pockets.length ? `${pockets.length} goal${pockets.length === 1 ? "" : "s"} in progress` : "Start a goal"}</strong><small>Pockets keep savings out of reach</small></div>
        <Link to="/app/accounts" className="p-strip-btn">Goals <ArrowRight size={13} /></Link>
      </motion.section>

      <p className="p-foot">Personal banking · Insured up to $250,000 per depositor through our partner banks.</p>
    </div>
  );
}
