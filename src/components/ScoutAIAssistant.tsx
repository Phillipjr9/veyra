import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bot, Check, CircleHelp, CreditCard, LoaderCircle, MessageCircle, Pause, Play, RefreshCw, Send, ShieldCheck, Sparkles, TrendingUp, Wallet, X, Zap } from "lucide-react";
import { longDate, money, shortDate, useAcct, type Account } from "../lib/store";
import { analyzeAccountWithScout, answerScoutQuery, type ScoutChatMessage, type ScoutInsight } from "../lib/scoutEngine";
import { AnimatedMoney, AnimatedNumber, ease } from "./common";
import { useToast } from "./Toast";

const DAY = 86_400_000;
const suggestions = ["Summarize this month", "Which costs are rising?", "Check my cash runway", "Find recurring charges"];
const rise = (i = 0) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * .05, duration: .42, ease } });

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="app-head"><div className="app-head-text"><span className="app-eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children && <div className="app-head-actions">{children}</div>}</header>;
}

function RichText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>)}</>;
}

function FinancialCharts({ account }: { account: Account }) {
  const week = 7 * DAY;
  const now = Date.now();
  const start = now - 8 * week;
  const recentTransactions = account.transactions.filter(t => t.date >= start && t.date <= now);
  let balance = account.balance - recentTransactions.reduce((sum, txn) => sum + txn.amount, 0);
  const history = Array.from({ length: 8 }, (_, index) => {
    const from = start + index * week;
    const txns = recentTransactions.filter(t => t.date >= from && t.date < from + week);
    const income = txns.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const spend = txns.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    balance += income - spend;
    return { label: new Date(from).toLocaleDateString("en-US", { month: "short", day: "numeric" }), balance: Math.max(0, Math.round(balance)), projection: undefined as number | undefined };
  });
  const last = history[history.length - 1];
  last.projection = last.balance;
  const lastMonth = recentTransactions.filter(t => t.date >= now - 28 * DAY);
  const avgWeeklyNet = lastMonth.reduce((sum, t) => sum + t.amount, 0) / 4;
  history.push({ label: "Estimate", balance: 0, projection: Math.max(0, Math.round(last.balance + avgWeeklyNet)) });

  const categoryTotals = new Map<string, number>();
  recentTransactions.filter(t => t.amount < 0).forEach(t => categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + Math.abs(t.amount)));
  const categories = [...categoryTotals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount).slice(0, 6);
  const net = history[history.length - 2].balance - history[0].balance;

  return <div className="scout-analytics-grid">
    <section className="scout-chart-panel">
      <div className="scout-chart-head"><div><span className="scout-kicker">From saved transactions</span><h3>Balance trend</h3></div><span className={`scout-trend-chip ${net >= 0 ? "positive" : "negative"}`}>{net >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}{money(Math.abs(net), false)} net</span></div>
      <div className="scout-chart-canvas"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={history} margin={{ top: 10, right: 12, bottom: 2, left: 0 }}><defs><linearGradient id="scout-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7558dc" stopOpacity={.24} /><stop offset="100%" stopColor="#7558dc" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece8f1" strokeDasharray="3 5" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#8b8694", fontSize: 10 }} minTickGap={12} /><YAxis axisLine={false} tickLine={false} width={48} tick={{ fill: "#8b8694", fontSize: 10 }} tickFormatter={value => value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${value}`} /><Tooltip formatter={(value, key) => [money(Number(value), false), key === "balance" ? "Recorded balance" : "Illustrative trend"]} contentStyle={{ borderRadius: 11, borderColor: "#e6e0ef", fontSize: 12 }} /><Area type="monotone" dataKey="balance" stroke="#7558dc" strokeWidth={2.4} fill="url(#scout-chart-fill)" dot={false} activeDot={{ r: 4 }} /><Area type="monotone" dataKey="projection" stroke="#aa95ed" strokeWidth={2} strokeDasharray="5 5" fill="transparent" dot={false} connectNulls /></ComposedChart></ResponsiveContainer></div>
      <p className="scout-chart-caption">Historical ledger activity with an illustrative one-week estimate. This is not a prediction.</p>
    </section>
    <section className="scout-chart-panel"><div className="scout-chart-head"><div><span className="scout-kicker">Eight-week outflow</span><h3>Spend by category</h3></div></div><div className="scout-spend-chart">{categories.map((item, index) => { const max = Math.max(1, ...categories.map(value => value.amount)); return <div className="scout-spend-row" key={item.category}><div className="scout-spend-label"><span>{item.category}</span><b>{money(item.amount, false)}</b></div><div className="scout-spend-track"><motion.i initial={{ width: 0 }} whileInView={{ width: `${item.amount / max * 100}%` }} viewport={{ once: true }} transition={{ delay: index * .05, duration: .52, ease }} style={{ background: `hsl(${258 - index * 12} 58% ${56 + index * 3}%)` }} /></div></div>; })}{!categories.length && <p className="muted-note">No outflow records in this period.</p>}</div><div className="scout-spend-footer"><span><i /> {recentTransactions.filter(t => t.amount < 0).length} purchases analyzed</span><span>Transaction ledger</span></div></section>
  </div>;
}

function ScoutChat({ account, userName, storageId }: { account: Account; userName: string; storageId: string }) {
  const intro: ScoutChatMessage = { id: "intro", sender: "scout", text: `Hi ${userName.split(" ")[0]} — I'm Scout, your financial copilot. I can analyze saved spending, deposits, cards, rewards, savings pockets and upcoming payments. What would you like to know?`, timestamp: Date.now() };
  const [messages, setMessages] = useState<ScoutChatMessage[]>(() => { try { const saved = localStorage.getItem(storageId); return saved ? JSON.parse(saved) as ScoutChatMessage[] : [intro]; } catch { return [intro]; } });
  const [query, setQuery] = useState(""); const [thinking, setThinking] = useState(false); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(storageId, JSON.stringify(messages.slice(-50))); } catch { /* ignore */ } }, [messages, storageId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);
  const send = (text: string) => { if (!text.trim() || thinking) return; const userMessage: ScoutChatMessage = { id: `user-${Date.now()}`, sender: "user", text: text.trim(), timestamp: Date.now() }; setMessages(items => [...items, userMessage]); setQuery(""); setThinking(true); window.setTimeout(() => { setMessages(items => [...items, answerScoutQuery(userMessage.text, account, userName)]); setThinking(false); }, 420); };
  return <div className="scout-chat-shell"><div className="scout-chat-toolbar"><span><span className="live-dot" /> Answers use saved account activity</span><button type="button" onClick={() => { setMessages([intro]); try { localStorage.removeItem(storageId); } catch { /* ignore */ } }}>Clear conversation</button></div><div className="scout-chat-messages">{messages.map(message => <div key={message.id} className={`scout-chat-row ${message.sender}`}>{message.sender === "scout" && <span className="scout-chat-avatar"><Bot size={16} /></span>}<div className="scout-chat-message"><p><RichText text={message.text} /></p>{message.dataCard && <div className="scout-answer-card"><strong>{message.dataCard.title}</strong>{message.dataCard.items?.map(item => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</div>}<small>{new Date(message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div></div>)}{thinking && <div className="scout-chat-row scout"><span className="scout-chat-avatar"><Bot size={16} /></span><div className="scout-chat-message scout-typing"><i /><i /><i /></div></div>}<div ref={end} /></div><div className="scout-chat-suggestions">{suggestions.map(text => <button key={text} type="button" disabled={thinking} onClick={() => send(text)}>{text}</button>)}</div><form className="scout-chat-composer" onSubmit={e => { e.preventDefault(); send(query); }}><input value={query} onChange={e => setQuery(e.target.value)} disabled={thinking} placeholder="Ask about spending, a merchant, cards or bills…" aria-label="Ask Scout a financial question" /><button type="submit" disabled={!query.trim() || thinking}>{thinking ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}</button></form><p className="scout-chat-disclaimer"><ShieldCheck size={12} /> Scout uses local demo data. Verify important decisions and amounts.</p></div>;
}

export function ScoutAIPage() {
  const { account, user, setPreference, applyScoutSavings, transferSavings } = useAcct();
  const toast = useToast();
  const [tab, setTab] = useState<"insights" | "chat" | "history">("insights");
  const [negotiatingId, setNegotiatingId] = useState<string | null>(null); const [stage, setStage] = useState(0); const [handled, setHandled] = useState<string[]>([]); const [lastAction, setLastAction] = useState<{ label: string; amount: number } | null>(null); const [reviewedAt, setReviewedAt] = useState(Date.now());
  const timer = useRef<number | null>(null);
  const insights = useMemo(() => account ? analyzeAccountWithScout(account).filter(i => !handled.includes(i.id)) : [], [account, handled]);
  const recoveries = useMemo(() => account ? account.transactions.filter(t => (t.scout ?? 0) > 0).sort((a, b) => b.date - a.date) : [], [account]);
  const auto = account?.preferences.scoutAuto ?? false;
  useEffect(() => () => { if (timer.current !== null) window.clearInterval(timer.current); }, []);
  if (!account || !user) return null;
  const isBusiness = user.accountType === "business";
  const typeNames: Record<ScoutInsight["type"], string> = { savings_opportunity: "Savings opportunity", anomaly: "Activity to review", recurring_creep: "Recurring charge", card_optimization: "Card health", runway_alert: "Cash-flow review" };
  const toggleAuto = (enabled: boolean) => { setPreference("scoutAuto", enabled); toast(enabled ? { tone: "scout", title: "Scout monitoring enabled", description: "Saved account activity will be included in analysis." } : { tone: "info", title: "Scout monitoring paused", description: "Manual review and chat remain available." }); };
  const actOnInsight = (item: ScoutInsight) => {
    if (item.actionType === "manage_card") { window.location.hash = "/app/cards"; return; }
    if (item.actionType === "view_transfers") { window.location.hash = "/app/transactions"; return; }
    if (item.actionType === "move_savings") {
      const pocket = account.savingsPockets[0];
      if (!pocket) { window.location.hash = "/app/accounts"; return; }
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      const spend = account.transactions.filter(t => t.amount < 0 && t.date >= monthStart).reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const amount = Math.min(Math.floor(account.balance - Math.max(spend, 2000)), 1000);
      if (amount <= 0 || !transferSavings(pocket.id, amount, "to_pocket")) return toast({ tone: "info", title: "Keep your cash buffer", description: "No funds are available above the suggested reserve." });
      setHandled(list => [...list, item.id]); setLastAction({ label: pocket.name, amount }); toast({ tone: "success", title: `${money(amount)} moved to ${pocket.name}` }); return;
    }
    if (item.actionType !== "negotiate" || !item.targetMerchant || !item.targetAmount || negotiatingId) return;
    setNegotiatingId(item.id); setStage(0); setTab("insights"); let current = 0;
    timer.current = window.setInterval(() => {
      current += 1; setStage(current);
      if (current >= negotiationStages.length) {
        if (timer.current !== null) window.clearInterval(timer.current); timer.current = null;
        const saved = applyScoutSavings(item.id, item.targetMerchant!, item.targetAmount!, "Illustrative Scout estimate · simulated locally"); setNegotiatingId(null);
        if (saved) { setHandled(list => [...list, item.id]); setLastAction({ label: item.targetMerchant!, amount: item.targetAmount! }); toast({ tone: "scout", title: `Demo estimate credited: ${money(item.targetAmount!)}`, description: `Illustrative estimate for ${item.targetMerchant}. No external merchant was contacted.` }); }
        else toast({ tone: "info", title: "This estimate was already applied" });
      }
    }, 520);
  };

  return <div className="app-page scout-ai-page">
    <PageHeader eyebrow="Account-aware financial copilot" title="Scout AI"><button type="button" className="ghost-btn" onClick={() => setReviewedAt(Date.now())}><RefreshCw size={14} /> Review account</button></PageHeader>
    <motion.section className="scout-dashboard-hero" {...rise(0)}><div className="scout-dashboard-orbit" aria-hidden="true"><i /><i /><i /><span><Bot size={24} /></span></div><div className="scout-dashboard-copy"><span className="scout-agent-state"><span className={`live-dot ${auto ? "" : "is-off"}`} /> {auto ? "Monitoring enabled" : "Monitoring paused"} · {isBusiness ? "Business" : "Personal"} account</span><h2>Your financial picture,<br /><em>understood.</em></h2><p>Scout analyzes your saved account activity, explains its findings and suggests useful actions. Estimates are labelled and actions require your approval.</p><div className="scout-hero-buttons"><button type="button" className="scout-hero-primary" onClick={() => setTab("chat")}><MessageCircle size={15} /> Ask Scout</button><button type="button" className="scout-hero-secondary" onClick={() => toggleAuto(!auto)}>{auto ? <Pause size={14} /> : <Play size={14} />}{auto ? "Pause monitoring" : "Resume monitoring"}</button></div></div><div className="scout-hero-metric"><small>Recorded Scout savings</small><AnimatedMoney value={account.scoutSaved} className="scout-dashboard-total" cents fromZero /><span><Sparkles size={13} /> {recoveries.length} ledger credits</span></div></motion.section>
    <div className="scout-quick-metrics"><motion.div {...rise(1)}><span>Purchases reviewed</span><AnimatedNumber value={account.transactions.filter(t => t.amount < 0).length} className="scout-metric-value" /><small>Saved transaction history</small></motion.div><motion.div {...rise(2)}><span>Savings credits</span><AnimatedNumber value={recoveries.length} className="scout-metric-value" /><small>Posted to the ledger</small></motion.div><motion.div {...rise(3)}><span>Suggestions available</span><AnimatedNumber value={insights.length} className="scout-metric-value" /><small>Derived from account data</small></motion.div><motion.div {...rise(4)}><span>Review date</span><strong className="scout-metric-value scout-date-value">{shortDate(reviewedAt)}</strong><small>Rules recalculated locally</small></motion.div></div>
    <div className="scout-tabs-bar"><button className={`scout-tab-btn ${tab === "insights" ? "on" : ""}`} onClick={() => setTab("insights")}><Sparkles size={16} /> Insights <span className="scout-tab-count">{insights.length}</span></button><button className={`scout-tab-btn ${tab === "chat" ? "on" : ""}`} onClick={() => setTab("chat")}><Bot size={16} /> Financial copilot</button><button className={`scout-tab-btn ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}><TrendingUp size={16} /> Savings history <span className="scout-tab-count">{recoveries.length}</span></button></div>

    {tab === "insights" && <motion.div className="scout-tab-content" key="insights" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {lastAction && <motion.div className="scout-applied-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}><span><Check size={14} /></span><div><strong>Action recorded</strong><small>{money(lastAction.amount)} · {lastAction.label}</small></div><button type="button" onClick={() => setLastAction(null)} aria-label="Dismiss"><X size={14} /></button></motion.div>}
      <div className="scout-content-heading"><div><span className="scout-kicker">Based on saved activity</span><h2>Recommended next steps</h2><p>Review each insight before acting. Merchant discount values are estimates, not live offers.</p></div><span className="scout-data-badge"><ShieldCheck size={13} /> Private analysis</span></div>
      {insights.length ? <div className="scout-insights-grid">{insights.map((item, index) => { const running = negotiatingId === item.id; const applied = account.scoutApplied.includes(item.id) || handled.includes(item.id); return <motion.article className={`scout-insight-card insight-${item.type}`} key={item.id} {...rise(index)}><div className="insight-card-top"><span className="insight-type-tag"><InsightIcon type={item.type} />{typeNames[item.type]}</span><span className="insight-confidence">{Math.round(item.confidence * 100)}% data match</span></div><h3>{item.title}</h3><p>{item.description}</p>{running && <NegotiationProgress stage={stage} />}<div className="insight-action-footer">{item.actionType === "negotiate" ? <button type="button" className="solid-btn sm scout-action-btn" disabled={running || applied} onClick={() => actOnInsight(item)}>{running ? <><LoaderCircle className="spin" size={14} /> Applying demo estimate…</> : applied ? <><Check size={14} /> Estimate posted</> : <><Zap size={14} /> {item.actionText}</>}</button> : item.actionType === "manage_card" ? <Link to="/app/cards" className="ghost-btn sm scout-action-btn">{item.actionText}<ArrowRight size={14} /></Link> : item.actionType === "move_savings" ? <button type="button" className="ghost-btn sm scout-action-btn" onClick={() => actOnInsight(item)}>{item.actionText}<ArrowRight size={14} /></button> : <Link to="/app/transactions" className="ghost-btn sm scout-action-btn">{item.actionText}<ArrowRight size={14} /></Link>}</div>{item.actionType === "negotiate" && <small className="scout-estimate-note">Illustrative demo estimate · simulated locally</small>}</motion.article>; })}</div> : <div className="scout-no-insights"><span><Check size={18} /></span><div><strong>Nothing needs attention right now.</strong><p>Scout recalculates when saved account activity changes.</p></div></div>}
      <div className="scout-content-heading chart-heading"><div><span className="scout-kicker">From your saved ledger</span><h2>Account activity</h2><p>Transaction history with an illustrative one-week trend estimate.</p></div></div><FinancialCharts account={account} />
      <section className="scout-audit-explain"><div><span><CircleHelp size={17} /></span><div><strong>How Scout works</strong><p>Pattern checks use saved data. Estimates are local simulations; Scout does not contact merchants, banks or credit bureaus.</p></div></div><Link to="/help-center">Learn about Scout <ArrowRight size={14} /></Link></section>
    </motion.div>}
    {tab === "chat" && <motion.div className="scout-tab-content" key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ScoutChat account={account} userName={user.name} storageId={`veyra.scout.chat.${user.id}`} /></motion.div>}
    {tab === "history" && <motion.div className="scout-tab-content" key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><section className="panel scout-history-panel"><div className="panel-head"><div><h2>Recorded savings</h2><span className="panel-sub">Credits already reflected in account transactions.</span></div><strong className="scout-history-total">{money(account.scoutSaved)}</strong></div>{recoveries.length ? <div className="scout-recoveries-ledger">{recoveries.map(t => <div key={t.id} className="scout-recovery-row"><div className="recovery-left"><span className="scout-star-icon"><Sparkles size={15} /></span><div><strong>{t.merchant}</strong><small>{t.category} · Purchase {money(Math.abs(t.amount))} · {longDate(t.date)}</small></div></div><div className="recovery-right"><strong className="in">+{money(t.scout ?? 0)}</strong><span className="chip chip-green">Credited</span></div></div>)}</div> : <div className="scout-no-insights"><span><Sparkles size={17} /></span><div><strong>No savings recorded yet.</strong><p>Any future transaction credits will appear here.</p></div></div>}</section><div className="scout-history-note"><ShieldCheck size={15} /><span>Demo estimates are clearly labeled in their ledger memo.</span></div></motion.div>}
  </div>;
}

const negotiationStages = ["Reviewing account activity", "Checking recurring patterns", "Preparing a demo estimate", "Posting the demo credit"];
function InsightIcon({ type }: { type: ScoutInsight["type"] }) { if (type === "anomaly") return <CircleHelp size={15} />; if (type === "card_optimization") return <CreditCard size={15} />; if (type === "recurring_creep") return <RefreshCw size={15} />; if (type === "runway_alert") return <Wallet size={15} />; return <Sparkles size={15} />; }
function NegotiationProgress({ stage }: { stage: number }) { return <div className="scout-negotiation-progress">{negotiationStages.map((label, index) => <div key={label} className={index < stage ? "done" : index === stage ? "active" : ""}><span>{index < stage ? <Check size={12} /> : index === stage ? <LoaderCircle className="spin" size={12} /> : index + 1}</span><small>{label}</small></div>)}</div>; }

export function ScoutQuickDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, user } = useAcct(); const [messages, setMessages] = useState<ScoutChatMessage[]>([]); const [query, setQuery] = useState(""); const [thinking, setThinking] = useState(false); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && user && !messages.length) setMessages([{ id: "quick-intro", sender: "scout", text: `Hi ${user.name.split(" ")[0]} — ask about your spending, balance, cards or scheduled payments.`, timestamp: Date.now() }]); }, [open, user, messages.length]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);
  if (!open || !account) return null;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!query.trim() || thinking) return; const text = query.trim(); setMessages(items => [...items, { id: `quick-${Date.now()}`, sender: "user", text, timestamp: Date.now() }]); setQuery(""); setThinking(true); window.setTimeout(() => { setMessages(items => [...items, answerScoutQuery(text, account, user?.name ?? "Member")]); setThinking(false); }, 380); };
  return createPortal(<div className="scout-quick-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><motion.aside className="scout-quick-panel" role="dialog" aria-modal="true" aria-label="Scout financial assistant" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 340, damping: 34 }}><header><span><i><Sparkles size={15} /></i><b>Scout copilot</b></span><button type="button" className="icon-btn" onClick={onClose} aria-label="Close Scout"><X size={16} /></button></header><div className="scout-chat-messages mini">{messages.map(message => <div className={`scout-chat-row ${message.sender}`} key={message.id}><div className="scout-chat-message"><p><RichText text={message.text} /></p></div></div>)}{thinking && <div className="scout-chat-message scout-typing"><i /><i /><i /></div>}<div ref={end} /></div><form className="scout-chat-composer" onSubmit={submit}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask Scout…" aria-label="Ask Scout" /><button type="submit" disabled={!query.trim() || thinking}>{thinking ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}</button></form><Link className="scout-open-full" to="/app/scout" onClick={onClose}>Open full Scout workspace <ArrowRight size={13} /></Link></motion.aside></div>, document.body);
}