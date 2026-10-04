import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDollarSign, Plus, ReceiptText, Sparkles, Trash2, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { categories, money, shortDate, useAcct, type Txn } from "../lib/store";
import { useAuth } from "../lib/auth";
import { useToast } from "./Toast";

const DAY = 86_400_000;
const startOfMonth = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

const recurringSpend = (transactions: Txn[]) => {
  const cutoff = Date.now() - 120 * DAY;
  const merchantTotals = new Map<string, { amount: number; count: number; latest: number }>();
  transactions.filter(txn => txn.amount < 0 && txn.date >= cutoff).forEach(txn => {
    const current = merchantTotals.get(txn.merchant) ?? { amount: 0, count: 0, latest: 0 };
    merchantTotals.set(txn.merchant, { amount: current.amount + Math.abs(txn.amount), count: current.count + 1, latest: Math.max(current.latest, txn.date) });
  });
  return [...merchantTotals.entries()]
    .filter(([, item]) => item.count >= 2)
    .map(([merchant, item]) => ({ merchant, monthly: item.amount / Math.max(1, item.count / 2), count: item.count, latest: item.latest }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 5);
};

/**
 * A server-backed planning workspace. Budgets are durable records; spend,
 * receivables and upcoming commitments are all calculated from the live ledger
 * snapshot so this page never invents financial data locally.
 */
export function MoneyPlanPage() {
  const { account, createBudget, removeBudget } = useAcct();
  const { user } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", category: "All spending", monthlyLimit: "", alertPercent: "80" });

  const analysis = useMemo(() => {
    if (!account) return null;
    const monthStart = startOfMonth();
    const monthTransactions = account.transactions.filter(txn => txn.date >= monthStart);
    const spent = monthTransactions.filter(txn => txn.amount < 0).reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
    const income = monthTransactions.filter(txn => txn.amount > 0).reduce((sum, txn) => sum + txn.amount, 0);
    const dueSoon = account.scheduledPayments
      .filter(payment => payment.status === "active" && payment.nextDate <= Date.now() + 30 * DAY)
      .sort((a, b) => a.nextDate - b.nextDate);
    const plannedOutflow = dueSoon.reduce((sum, payment) => sum + payment.amount, 0);
    const receivables = account.invoices.filter(invoice => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
    const categorySpend = new Map<string, number>();
    monthTransactions.filter(txn => txn.amount < 0).forEach(txn => categorySpend.set(txn.category, (categorySpend.get(txn.category) ?? 0) + Math.abs(txn.amount)));
    const recurring = recurringSpend(account.transactions);
    return {
      spent, income, dueSoon, plannedOutflow, receivables, categorySpend, recurring,
      safeToUse: Math.max(0, account.balance - plannedOutflow),
      nextThirtyDayPosition: account.balance + (user?.accountType === "business" ? receivables : 0) - plannedOutflow,
    };
  }, [account, user?.accountType]);

  if (!account || !analysis) return null;
  const business = user?.accountType === "business";
  const budgetSpend = (category: string) => category === "All spending"
    ? analysis.spent
    : analysis.categorySpend.get(category) ?? 0;

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    const monthlyLimit = Number(form.monthlyLimit);
    const alertPercent = Number(form.alertPercent);
    const budget = createBudget({ name: form.name, category: form.category, monthlyLimit, alertPercent });
    if (!budget) {
      toast({ tone: "error", title: "Check your plan details", description: "Add a name, a positive monthly limit, and an alert threshold between 50% and 100%." });
      return;
    }
    setForm({ name: "", category: "All spending", monthlyLimit: "", alertPercent: "80" });
    setAdding(false);
    toast({ tone: "success", title: "Plan added", description: `${budget.name} is now tracked against your live ledger.` });
  };

  return (
    <div className="app-page money-plan-page">
      <header className="money-plan-hero">
        <div>
          <span className="app-eyebrow"><Sparkles size={14} /> {business ? "Business cash planning" : "Your money plan"}</span>
          <h1>{business ? "Operate with a clear cash runway." : "Know what you can safely use."}</h1>
          <p>{business ? "Track operating limits, incoming invoices and committed vendor payments from one live plan." : "Turn recent activity and scheduled bills into a simple monthly spending plan."}</p>
        </div>
        <div className="money-plan-hero-value">
          <span>{business ? "Operating cash after planned bills" : "Safe to use after planned bills"}</span>
          <strong>{money(analysis.safeToUse)}</strong>
          <small><CheckCircle2 size={13} /> {analysis.dueSoon.length} commitment{analysis.dueSoon.length === 1 ? "" : "s"} in the next 30 days</small>
        </div>
      </header>

      <section className="money-plan-kpis" aria-label="Cash plan summary">
        <div className="money-plan-kpi"><span><TrendingDown size={16} /> Month-to-date outflow</span><strong>{money(analysis.spent)}</strong><small>{analysis.income ? `${money(analysis.income)} received this month` : "No income posted this month"}</small></div>
        <div className="money-plan-kpi"><span><CalendarClock size={16} /> Planned next 30 days</span><strong>{money(analysis.plannedOutflow)}</strong><small>{analysis.dueSoon.length ? `Next: ${analysis.dueSoon[0].payeeName} on ${shortDate(analysis.dueSoon[0].nextDate)}` : "No scheduled payments"}</small></div>
        {business ? <div className="money-plan-kpi"><span><ReceiptText size={16} /> Open receivables</span><strong>{money(analysis.receivables)}</strong><small>{account.invoices.filter(invoice => invoice.status !== "paid").length} invoice{account.invoices.filter(invoice => invoice.status !== "paid").length === 1 ? "" : "s"} awaiting payment</small></div>
          : <div className="money-plan-kpi"><span><WalletCards size={16} /> Next 30-day position</span><strong className={analysis.nextThirtyDayPosition < 0 ? "is-risk" : ""}>{money(analysis.nextThirtyDayPosition)}</strong><small>{analysis.nextThirtyDayPosition < 0 ? "Review scheduled payments" : "On track with current commitments"}</small></div>}
      </section>

      <div className="money-plan-grid">
        <section className="panel money-plan-budget-panel">
          <div className="panel-head"><div><span className="money-plan-kicker">Live limits</span><h2>{business ? "Operating budgets" : "Monthly spending plans"}</h2><span className="panel-sub">Budget records are saved to your account. Spend updates from cleared ledger activity.</span></div><button type="button" className="solid-btn sm" onClick={() => setAdding(value => !value)}><Plus size={14} /> Add plan</button></div>
          {adding && <form className="money-plan-form" onSubmit={submitBudget}>
            <input required maxLength={48} value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} placeholder={business ? "e.g. Monthly software" : "e.g. Eating out"} aria-label="Plan name" />
            <select value={form.category} onChange={event => setForm(value => ({ ...value, category: event.target.value }))} aria-label="Spend category"><option>All spending</option>{categories.map(category => <option key={category}>{category}</option>)}</select>
            <label><span>Monthly limit</span><input required type="number" min="1" step="1" value={form.monthlyLimit} onChange={event => setForm(value => ({ ...value, monthlyLimit: event.target.value }))} placeholder="0" /></label>
            <label><span>Alert at</span><select value={form.alertPercent} onChange={event => setForm(value => ({ ...value, alertPercent: event.target.value }))}>{[50, 60, 70, 80, 90, 100].map(percent => <option value={percent} key={percent}>{percent}%</option>)}</select></label>
            <div className="money-plan-form-actions"><button type="button" className="ghost-btn sm" onClick={() => setAdding(false)}>Cancel</button><button className="solid-btn sm" type="submit">Save plan</button></div>
          </form>}
          {account.budgets.length ? <div className="money-plan-budget-list">{account.budgets.map(budget => {
            const spend = budgetSpend(budget.category);
            const progress = Math.min(100, (spend / budget.monthlyLimit) * 100);
            const alerting = progress >= budget.alertPercent;
            const exceeded = spend > budget.monthlyLimit;
            return <article className="money-plan-budget" key={budget.id}>
              <div className="money-plan-budget-top"><div><strong>{budget.name}</strong><small>{budget.category}</small></div><button className="icon-btn" type="button" onClick={() => { removeBudget(budget.id); toast({ tone: "info", title: "Plan removed" }); }} aria-label={`Remove ${budget.name}`}><Trash2 size={15} /></button></div>
              <div className="money-plan-budget-numbers"><strong>{money(spend)}</strong><span>of {money(budget.monthlyLimit)}</span><b className={exceeded ? "is-risk" : alerting ? "is-warn" : ""}>{Math.round(progress)}%</b></div>
              <div className={`money-plan-progress ${exceeded ? "is-risk" : alerting ? "is-warn" : ""}`}><i style={{ width: `${progress}%` }} /></div>
              <small className={alerting ? "money-plan-alert" : ""}>{exceeded ? `${money(spend - budget.monthlyLimit)} over plan` : alerting ? `${Math.round(budget.alertPercent - progress)}% to your alert threshold` : `${money(Math.max(0, budget.monthlyLimit - spend))} remaining this month`}</small>
            </article>;
          })}</div> : <div className="money-plan-empty"><CircleDollarSign size={20} /><div><strong>Set your first plan</strong><span>{business ? "Create an operating limit for a category such as software, payroll or travel." : "Set a monthly limit and track it against your real spending."}</span></div></div>}
        </section>

        <section className="panel money-plan-commitments">
          <div className="panel-head"><div><span className="money-plan-kicker">Forward view</span><h2>{business ? "Cash commitments" : "Upcoming commitments"}</h2><span className="panel-sub">Scheduled payments that will affect your available cash.</span></div><Link to="/app/bills" className="text-link">Manage bills <ArrowRight size={13} /></Link></div>
          {analysis.dueSoon.length ? <div className="money-plan-commitment-list">{analysis.dueSoon.slice(0, 6).map(payment => <div className="money-plan-commitment" key={payment.id}><span className="money-plan-commitment-icon"><CalendarClock size={15} /></span><div><strong>{payment.payeeName}</strong><small>{payment.category} · {payment.autopay ? "Autopay" : "Scheduled"}</small></div><div><strong>{money(payment.amount)}</strong><small>{shortDate(payment.nextDate)}</small></div></div>)}</div> : <div className="money-plan-empty"><CalendarClock size={20} /><div><strong>No scheduled commitments</strong><span>Add recurring bills to make the forecast useful.</span></div></div>}
          <div className="money-plan-position"><span>{business ? "Expected position after receivables and commitments" : "Expected position after commitments"}</span><strong className={analysis.nextThirtyDayPosition < 0 ? "is-risk" : ""}>{money(analysis.nextThirtyDayPosition)}</strong></div>
        </section>
      </div>

      <section className="panel money-plan-signals">
        <div className="panel-head"><div><span className="money-plan-kicker">Activity signals</span><h2>{business ? "Recurring operating spend" : "Recurring spending signals"}</h2><span className="panel-sub">Detected from repeated ledger activity over the last four months.</span></div>{business && <Link to="/app/invoices" className="text-link">Review receivables <ArrowRight size={13} /></Link>}</div>
        {analysis.recurring.length ? <div className="money-plan-signal-grid">{analysis.recurring.map(item => <div className="money-plan-signal" key={item.merchant}><span><TrendingUp size={16} /></span><div><strong>{item.merchant}</strong><small>{item.count} similar transactions · latest {shortDate(item.latest)}</small></div><b>~{money(item.monthly)}/mo</b></div>)}</div> : <div className="money-plan-empty"><Sparkles size={20} /><div><strong>More activity will unlock signals</strong><span>Repeated merchant activity will appear here as your ledger builds.</span></div></div>}
      </section>

      {account.budgets.some(budget => (budgetSpend(budget.category) / budget.monthlyLimit) * 100 >= budget.alertPercent) && <div className="money-plan-notice" role="status"><AlertTriangle size={17} /><span><strong>Plan attention needed.</strong> One or more limits have reached their alert threshold. Review the highlighted plans before approving more spend.</span></div>}
    </div>
  );
}
