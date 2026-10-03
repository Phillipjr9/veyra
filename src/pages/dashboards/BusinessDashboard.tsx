/**
 * Business banking dashboard — "treasury desk" design.
 *
 * Deliberately unlike the personal and admin surfaces: a dark icon rail with
 * a company header band, a KPI strip with tabular numerals, and ledger-style
 * tables (receivables, payables, spend by card) with hairline rules and
 * uppercase micro-labels. Sharp radii and monospace figures — the visual
 * language of an operations console, not a consumer app.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight, ArrowUpRight, Building2, CalendarClock, CreditCard, FileText, LogOut, Menu, ReceiptText,
  Search, Send, ShieldCheck, Sparkles, Users, Wallet, X,
} from "lucide-react";
import { Logo, ease } from "../../components/common";
import { BackButton } from "../../components/BackButton";
import { money, shortDate, useAcct, type Invoice, type ScheduledPayment } from "../../lib/store";
import { Delta, Sparkline, type NavGroup } from "./parts";

const rise = (i = 0) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05, duration: 0.45, ease } });
const DAY = 86_400_000;

type ChromeProps = {
  user: { name: string; business?: string; avatarUrl?: string; plan?: string };
  accountNumber: string;
  nav: NavGroup[];
  notifications: ReactNode;
  onOpenPalette: () => void;
  onOpenDeposit: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function BusinessChrome({ user, accountNumber, nav, notifications, onOpenPalette, onOpenDeposit, onSignOut, children }: ChromeProps) {
  const [railOpen, setRailOpen] = useState(false);
  const navigate = useNavigate();
  const company = user.business || "My business";

  return (
    <div className={`bshell ${railOpen ? "rail-open" : ""}`}>
      <aside className="bshell-rail" aria-label="Business navigation">
        <div className="bshell-rail-top">
          <Logo to="/app" inverse />
        </div>
        <nav className="bshell-rail-nav">
          {nav.map(group => (
            <div className="bshell-rail-group" key={group.title}>
              <span className="bshell-rail-title">{group.title}</span>
              {group.items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bshell-link ${isActive ? "on" : ""}`}>
                  <span className="bshell-link-icon">{item.icon}</span>
                  <span className="bshell-link-label">{item.label}</span>
                  {item.badge && <span className="bshell-link-badge">{item.badge}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="bshell-rail-foot">
          <div className="bshell-status"><span className="dot-live" /> All systems operational</div>
          <button type="button" className="bshell-signout" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>

      {railOpen && <button type="button" className="bshell-scrim" aria-label="Close navigation" onClick={() => setRailOpen(false)} />}

      <div className="bshell-body">
        <header className="bshell-bar">
          <button type="button" className="bshell-burger" onClick={() => setRailOpen(o => !o)} aria-label="Toggle navigation">
            {railOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <BackButton />
          <div className="bshell-org">
            <span className="bshell-org-icon"><Building2 size={15} /></span>
            <div>
              <strong>{company}</strong>
              <small>{user.plan ?? "Business"} · Checking •••• {accountNumber.slice(-4)}</small>
            </div>
          </div>
          <button type="button" className="bshell-search" onClick={onOpenPalette} aria-label="Search (Command K)">
            <Search size={14} /> <span>Search vendors, invoices, people…</span> <kbd>⌘K</kbd>
          </button>
          <div className="bshell-bar-actions">
            <button type="button" className="bshell-act" onClick={onOpenDeposit}><Wallet size={14} /> Deposit</button>
            <Link className="bshell-act primary" to="/app/transfers"><Send size={14} /> New transfer</Link>
            {notifications}
          </div>
        </header>

        <main className="bshell-main" onClick={() => railOpen && setRailOpen(false)}>
          {children}
        </main>
      </div>
      <button type="button" className="bshell-fab" onClick={() => navigate("/app/invoices")} aria-label="Create invoice">
        <ReceiptText size={18} /><span>New invoice</span>
      </button>
    </div>
  );
}

/* ============================================================
   Business overview
   ============================================================ */

const aging = (inv: Invoice) => {
  const days = Math.floor((Date.now() - inv.due) / DAY);
  if (inv.status === "paid") return { label: "Paid", tone: "ok" as const };
  if (days > 0) return { label: `${days}d overdue`, tone: days > 30 ? "bad" as const : "warn" as const };
  return { label: `Due in ${Math.abs(days)}d`, tone: "open" as const };
};

export function BusinessOverview() {
  const { account, user } = useAcct();
  const [range, setRange] = useState<30 | 90>(30);
  if (!account || !user) return null;

  const txns = account.transactions;
  const now = Date.now();
  const window = range * DAY;
  const recent = txns.filter(t => t.date >= now - window);
  const prev = txns.filter(t => t.date < now - window && t.date >= now - 2 * window);

  const sumIn = (list: typeof txns) => list.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const sumOut = (list: typeof txns) => Math.abs(list.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const inflow = sumIn(recent), outflow = sumOut(recent);
  const prevNet = sumIn(prev) - sumOut(prev);
  const net = inflow - outflow;
  const burn = Math.max(1, outflow / (range / 30));
  const runwayMonths = account.balance / burn;

  const open = account.invoices.filter(i => i.status !== "paid");
  const receivables = open.reduce((s, i) => s + i.amount, 0);
  const overdue = open.filter(i => i.due < now);
  const payables = account.scheduledPayments.filter(p => p.status !== "completed");
  const payableTotal = payables.reduce((s, p) => s + p.amount, 0);
  const cardsSpend = account.cards.reduce((s, c) => s + c.spent, 0);
  const cardsLimit = account.cards.reduce((s, c) => s + c.limit, 0);

  const weeks = useMemo(() => {
    const out: Array<{ label: string; net: number }> = [];
    for (let w = 7; w >= 0; w--) {
      const end = now - w * 7 * DAY, start = end - 7 * DAY;
      const slice = txns.filter(t => t.date >= start && t.date < end);
      out.push({
        label: shortDate(end),
        net: slice.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0) -
          Math.abs(slice.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)),
      });
    }
    return out;
  }, [txns, now]);

  const kpis = [
    { id: "balance", label: "Available balance", value: money(account.balance), raw: account.balance, sub: `${money(account.pendingBalance)} pending`, spark: weeks.map(w => w.net), delta: null as number | null },
    { id: "inflow", label: `Inflow ${range}d`, value: money(inflow, false), raw: inflow, sub: `${recent.filter(t => t.amount > 0).length} credits`, spark: weeks.map(w => w.net + Math.abs(w.net)), delta: prev.length ? ((inflow - sumIn(prev)) / Math.max(1, sumIn(prev))) * 100 : 0 },
    { id: "outflow", label: `Outflow ${range}d`, value: money(outflow, false), raw: outflow, sub: `${recent.filter(t => t.amount < 0).length} debits`, spark: weeks.map(w => Math.abs(w.net)), delta: prev.length ? ((outflow - sumOut(prev)) / Math.max(1, sumOut(prev))) * 100 : 0 },
    { id: "net", label: "Net position", value: `${net >= 0 ? "+" : "−"}${money(Math.abs(net), false)}`, raw: net, sub: `${range === 30 ? "30" : "90"}-day movement`, spark: weeks.map(w => w.net), delta: prevNet ? ((net - prevNet) / Math.max(1, Math.abs(prevNet))) * 100 : 0 },
  ];

  return (
    <div className="bdash">
      <motion.header className="b-head" {...rise(0)}>
        <div>
          <span className="b-eyebrow">Treasury overview</span>
          <h1>{user.business || "Your business"}</h1>
          <p>Cash position, receivables and payables for the last {range} days.</p>
        </div>
        <div className="b-head-actions">
          <div className="b-range" role="group" aria-label="Range">
            {([30, 90] as const).map(r => (
              <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}d</button>
            ))}
          </div>
          <Link className="b-btn" to="/app/invoices"><ReceiptText size={14} /> Invoice</Link>
          <Link className="b-btn primary" to="/app/transfers"><Send size={14} /> Pay</Link>
        </div>
      </motion.header>

      {/* ---- KPI strip ---- */}
      <div className="b-kpis">
        {kpis.map((k, i) => (
          <motion.div className="b-kpi" key={k.id} {...rise(i + 1)}>
            <span className="b-kpi-label">{k.label}</span>
            <strong className="b-kpi-value">{k.value}</strong>
            <div className="b-kpi-foot">
              <span className="b-kpi-sub">{k.sub}</span>
              {k.delta !== null && <Delta value={k.delta} />}
            </div>
            <Sparkline className="b-kpi-spark" data={k.spark} />
          </motion.div>
        ))}
        <motion.div className="b-kpi b-kpi-runway" {...rise(5)}>
          <span className="b-kpi-label">Cash runway</span>
          <strong className="b-kpi-value">{runwayMonths.toFixed(1)}<small> months</small></strong>
          <div className="b-kpi-foot"><span className="b-kpi-sub">at {money(burn, false)}/mo burn</span></div>
          <div className="b-runway-track"><i style={{ width: `${Math.min(100, (runwayMonths / 12) * 100)}%` }} /></div>
        </motion.div>
      </div>

      <div className="b-grid">
        {/* ---- receivables ---- */}
        <motion.section className="b-panel" {...rise(2)}>
          <div className="b-panel-head">
            <div>
              <h2>Receivables</h2>
              <span>{open.length} open · {money(receivables, false)} outstanding{overdue.length ? ` · ${money(overdue.reduce((s, i) => s + i.amount, 0), false)} overdue` : ""}</span>
            </div>
            <Link to="/app/invoices" className="b-link">Invoicing <ArrowUpRight size={13} /></Link>
          </div>
          {open.length ? (
            <div className="b-table-wrap">
              <table className="b-table">
                <thead>
                  <tr><th>Client</th><th>Invoice</th><th>Due</th><th>Status</th><th className="ta-r">Amount</th></tr>
                </thead>
                <tbody>
                  {open.sort((a, b) => a.due - b.due).slice(0, 6).map(inv => {
                    const a = aging(inv);
                    return (
                      <tr key={inv.id}>
                        <td><strong>{inv.client}</strong><small>{inv.clientEmail}</small></td>
                        <td className="b-mono">#{inv.id}</td>
                        <td className="b-mono">{shortDate(inv.due)}</td>
                        <td><span className={`b-tag ${a.tone}`}>{a.label}</span></td>
                        <td className="ta-r b-mono strong">{money(inv.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="b-empty">Every invoice is settled. <Link to="/app/invoices">Send a new one</Link>.</p>}
        </motion.section>

        {/* ---- payables ---- */}
        <motion.section className="b-panel" {...rise(3)}>
          <div className="b-panel-head">
            <div>
              <h2>Payables &amp; autopay</h2>
              <span>{payables.length} scheduled · {money(payableTotal, false)} committed</span>
            </div>
            <Link to="/app/bills" className="b-link">Schedule <ArrowUpRight size={13} /></Link>
          </div>
          {payables.length ? (
            <div className="b-table-wrap">
              <table className="b-table">
                <thead>
                  <tr><th>Payee</th><th>Frequency</th><th>Next</th><th>Auto</th><th className="ta-r">Amount</th></tr>
                </thead>
                <tbody>
                  {payables.sort((a, b) => a.nextDate - b.nextDate).slice(0, 6).map((p: ScheduledPayment) => (
                    <tr key={p.id}>
                      <td><strong>{p.payeeName}</strong><small>{p.category}</small></td>
                      <td className="b-mono">{p.frequency}{p.status === "paused" ? " · paused" : ""}</td>
                      <td className="b-mono">{shortDate(p.nextDate)}</td>
                      <td>{p.autopay ? <span className="b-tag ok">On</span> : <span className="b-tag open">Manual</span>}</td>
                      <td className="ta-r b-mono strong">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="b-empty">No scheduled payments — <Link to="/app/bills">set up autopay</Link> to stop late fees.</p>}
        </motion.section>

        {/* ---- card spend ---- */}
        <motion.section className="b-panel" {...rise(4)}>
          <div className="b-panel-head">
            <div>
              <h2>Card programme</h2>
              <span>{account.cards.length} cards · {money(cardsSpend, false)} of {money(cardsLimit, false)} used this cycle</span>
            </div>
            <Link to="/app/cards" className="b-link">Manage <ArrowUpRight size={13} /></Link>
          </div>
          {account.cards.length ? (
            <div className="b-cards">
              {account.cards.slice(0, 4).map(c => {
                const pct = c.limit ? Math.min(100, (c.spent / c.limit) * 100) : 0;
                return (
                  <div className="b-card-row" key={c.id}>
                    <span className={`b-card-icon ${c.frozen ? "frozen" : ""}`}><CreditCard size={15} /></span>
                    <span className="b-card-copy">
                      <strong>{c.label}</strong>
                      <small>{c.cardholder || "—"} · •••• {c.last4}{c.frozen ? " · frozen" : ""}</small>
                    </span>
                    <span className="b-card-usage">
                      <span className="b-mono">{money(c.spent, false)} / {money(c.limit, false)}</span>
                      <span className="b-usage-track"><i style={{ width: `${pct}%` }} className={pct > 85 ? "hot" : ""} /></span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <p className="b-empty">No cards issued to this entity yet.</p>}
        </motion.section>

        {/* ---- team & controls ---- */}
        <motion.section className="b-panel" {...rise(5)}>
          <div className="b-panel-head">
            <div>
              <h2>Team &amp; approvals</h2>
              <span>{account.team.length} people · {account.team.filter(t => t.status === "invited").length} pending invitation{account.team.filter(t => t.status === "invited").length === 1 ? "" : "s"}</span>
            </div>
            <Link to="/app/team" className="b-link">Manage <ArrowUpRight size={13} /></Link>
          </div>
          <div className="b-team">
            {account.team.slice(0, 5).map(m => (
              <div className="b-team-row" key={m.id}>
                <span className={`b-team-avatar ${m.status === "invited" ? "pending" : ""}`}>{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="b-team-copy"><strong>{m.name}</strong><small>{m.role} · {m.email}</small></span>
                <span className="b-team-meta">
                  <span className="b-mono">{m.cardCount} card{m.cardCount === 1 ? "" : "s"}</span>
                  <small>{m.monthlyLimit ? `${money(m.monthlyLimit, false)}/mo` : "no limit"}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="b-controls">
            <Link to="/app/security" className="b-control"><ShieldCheck size={15} /><span><strong>Approval rules</strong><small>Dual approval over threshold</small></span><ArrowRight size={13} /></Link>
            <Link to="/app/scout" className="b-control"><Sparkles size={15} /><span><strong>Scout for business</strong><small>{money(account.scoutSaved, false)} recovered</small></span><ArrowRight size={13} /></Link>
          </div>
        </motion.section>

        {/* ---- recent ledger ---- */}
        <motion.section className="b-panel b-panel-wide" {...rise(6)}>
          <div className="b-panel-head">
            <div><h2>Ledger</h2><span>Latest movements across all accounts</span></div>
            <Link to="/app/transactions" className="b-link">Full ledger <ArrowUpRight size={13} /></Link>
          </div>
          <div className="b-table-wrap">
            <table className="b-table b-table-ledger">
              <thead>
                <tr><th>Date</th><th>Counterparty</th><th>Category</th><th>Method</th><th>Reference</th><th className="ta-r">Amount</th></tr>
              </thead>
              <tbody>
                {txns.slice(0, 8).map(t => (
                  <tr key={t.id}>
                    <td className="b-mono">{shortDate(t.date)}</td>
                    <td><strong>{t.merchant}</strong></td>
                    <td>{t.category}</td>
                    <td className="b-mono">{t.method ?? "ACH"}</td>
                    <td className="b-mono dim">{t.reference ?? "—"}</td>
                    <td className={`ta-r b-mono strong ${t.amount > 0 ? "in" : ""}`}>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      </div>

      <div className="b-foot-actions">
        <Link className="b-foot-link" to="/app/accounts"><Wallet size={14} /> Accounts &amp; pockets</Link>
        <Link className="b-foot-link" to="/app/statements"><FileText size={14} /> Statements</Link>
        <Link className="b-foot-link" to="/app/team"><Users size={14} /> Team access</Link>
        <Link className="b-foot-link" to="/app/bills"><CalendarClock size={14} /> Scheduled payments</Link>
      </div>
    </div>
  );
}
