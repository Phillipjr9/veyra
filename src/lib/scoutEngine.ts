import type { Account, Txn } from "./store";
import { money } from "./store";

export type ScoutInsight = {
  id: string;
  type: "savings_opportunity" | "anomaly" | "recurring_creep" | "card_optimization" | "runway_alert";
  title: string;
  impact: string;
  impactAmount?: number;
  description: string;
  actionText: string;
  actionType: "negotiate" | "freeze_card" | "move_savings" | "view_transfers" | "manage_card";
  targetMerchant?: string;
  targetAmount?: number;
  confidence: number;
}

export type ScoutChatMessage = {
  id: string;
  sender: "user" | "scout";
  text: string;
  timestamp: number;
  dataCard?: {
    type: "metrics" | "actions" | "breakdown";
    title?: string;
    items?: Array<{ label: string; value: string }>;
  };
}

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idFor = (value: string) => `scout-${slug(value)}`;

function within(t: Txn, start: number, end = Date.now()) {
  return t.date >= start && t.date <= end;
}

function periodFor(q: string) {
  const now = Date.now();
  if (q.includes("last month") || q.includes("previous month")) {
    const date = new Date();
    const start = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    const end = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    return { label: "last month", start, end };
  }
  if (q.includes("week") || q.includes("last 7") || q.includes("past 7")) return { label: "this week", start: now - 7 * DAY, end: now };
  if (q.includes("year") || q.includes("annual") || q.includes("this year")) {
    return { label: "this year", start: new Date(new Date().getFullYear(), 0, 1).getTime(), end: now };
  }
  return { label: "this month", start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), end: now };
}

function listByMerchant(txns: Txn[]) {
  const map = new Map<string, Txn[]>();
  txns.forEach(t => map.set(t.merchant, [...(map.get(t.merchant) ?? []), t]));
  return map;
}

/**
 * Insights are grounded in this account's saved data. Estimated merchant offers
 * are clearly labeled as estimates and are never claimed as live quotes.
 */
export function analyzeAccountWithScout(account: Account): ScoutInsight[] {
  const insights: ScoutInsight[] = [];
  const outflows = account.transactions.filter(t => t.amount < 0);
  const byMerchant = listByMerchant(outflows);

  // Find recurring merchants from repeated charges or explicit recurring memo text.
  for (const [merchant, charges] of byMerchant) {
    const sorted = [...charges].sort((a, b) => a.date - b.date);
    const recurringMemo = sorted.some(t => /monthly|subscription|recurring|annual seat/i.test(t.note ?? ""));
    const repeats = sorted.length >= 2 && (sorted[sorted.length - 1].date - sorted[0].date) >= 14 * DAY;
    if (!recurringMemo && !repeats) continue;
    const average = r2(sorted.reduce((sum, t) => sum + Math.abs(t.amount), 0) / sorted.length);
    const annualEstimate = Math.round(average * 0.08 * 12);
    const opportunityId = idFor(`subscription-${merchant}`);
    if (account.scoutApplied.includes(opportunityId)) continue;
    insights.push({
      id: opportunityId,
      type: "recurring_creep",
      title: `Review recurring spend at ${merchant}`,
      impact: `Potential ${money(annualEstimate, false)}/yr`,
      impactAmount: annualEstimate,
      description: `Your ledger shows ${sorted.length} charge${sorted.length === 1 ? "" : "s"} associated with ${merchant}, averaging ${money(average)}. Scout can prepare an 8% retention-offer estimate for planning; a live merchant quote is not connected yet.`,
      actionText: `Review ${merchant} estimate`,
      actionType: "negotiate",
      targetMerchant: merchant,
      targetAmount: r2(average * 0.08),
      confidence: repeats ? 0.82 : 0.64,
    });
  }

  // Flag suspicious duplicates using merchant, amount and a 36-hour time window.
  const duplicateGroups: Txn[][] = [];
  const sortedOutflows = [...outflows].sort((a, b) => a.date - b.date);
  for (let i = 0; i < sortedOutflows.length; i++) {
    const current = sortedOutflows[i];
    const match = sortedOutflows.slice(i + 1).find(candidate =>
      candidate.merchant === current.merchant &&
      Math.abs(Math.abs(candidate.amount) - Math.abs(current.amount)) < 0.01 &&
      Math.abs(candidate.date - current.date) <= 36 * 60 * 60 * 1000
    );
    if (match) duplicateGroups.push([current, match]);
  }
  duplicateGroups.slice(0, 2).forEach(([first, second]) => {
    const duplicateId = idFor(`duplicate-${first.id}-${second.id}`);
    if (account.disputes.some(d => d.transactionId === first.id || d.transactionId === second.id)) return;
    insights.push({
      id: duplicateId,
      type: "anomaly",
      title: `Possible duplicate at ${first.merchant}`,
      impact: `${money(Math.abs(first.amount))} to review`,
      impactAmount: Math.abs(first.amount),
      description: `Two matching charges appear within 36 hours. This may be a legitimate retry; review the receipts before opening a dispute.`,
      actionText: "Review transactions",
      actionType: "view_transfers",
      targetMerchant: first.merchant,
      confidence: 0.77,
    });
  });

  // Alert when a card's actual saved utilization is high.
  const nearLimitCard = account.cards.find(c => !c.frozen && c.limit > 0 && c.spent / c.limit >= 0.75);
  if (nearLimitCard) {
    insights.push({
      id: idFor(`card-limit-${nearLimitCard.id}`),
      type: "card_optimization",
      title: `${nearLimitCard.label} is nearing its limit`,
      impact: `${Math.round((nearLimitCard.spent / nearLimitCard.limit) * 100)}% used`,
      description: `Card •••• ${nearLimitCard.last4} has ${money(nearLimitCard.spent)} against a ${money(nearLimitCard.limit, false)} limit. Increase the limit or pause spending if that is unexpected.`,
      actionText: "Manage card",
      actionType: "manage_card",
      confidence: 0.99,
    });
  }

  // Surface a useful upcoming-payment summary rather than inventing merchant offers.
  const activeBills = account.scheduledPayments.filter(p => p.status === "active");
  const next30Bills = activeBills.filter(p => p.nextDate <= Date.now() + 30 * DAY);
  const totalDue = next30Bills.reduce((sum, p) => sum + p.amount, 0);
  if (next30Bills.length >= 2 && totalDue > account.balance * 0.4) {
    insights.push({
      id: "insight-upcoming-cash-buffer",
      type: "runway_alert",
      title: "Check your upcoming cash buffer",
      impact: `${money(totalDue)} scheduled`,
      description: `${next30Bills.length} active payments totaling ${money(totalDue)} are due in the next 30 days. Your checking balance is ${money(account.balance)}. Review dates or pause a schedule if needed.`,
      actionText: "Review scheduled payments",
      actionType: "view_transfers",
      confidence: 0.94,
    });
  }

  // Transfer only excess cash after a simple one-month outgoing spend reserve.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const monthSpend = outflows.filter(t => within(t, monthStart)).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const reserve = Math.max(monthSpend, 2000);
  const excess = Math.floor(account.balance - reserve);
  if (excess > 5000 && account.savingsPockets.length > 0) {
    insights.push({
      id: "insight-liquidity-buffer",
      type: "runway_alert",
      title: "You may have cash above your spending buffer",
      impact: `About ${money(excess, false)} above buffer`,
      description: `Based on ${money(monthSpend)} of recorded outflows this month, a one-month buffer would be about ${money(reserve)}. You could move some excess into an existing savings pocket. This is a planning suggestion, not financial advice.`,
      actionText: "Review savings pockets",
      actionType: "move_savings",
      confidence: 0.88,
    });
  }

  return insights.sort((a, b) => {
    const score = (x: ScoutInsight) => (x.type === "anomaly" ? 3 : x.type === "card_optimization" ? 2 : 1) + x.confidence;
    return score(b) - score(a);
  });
}

/** Answers financial questions using only the user's saved local account data. */
export function answerScoutQuery(query: string, account: Account, userName: string): ScoutChatMessage {
  const q = query.toLowerCase().trim();
  const outflows = account.transactions.filter(t => t.amount < 0);
  const now = Date.now();
  const period = periodFor(q);
  const periodTxns = account.transactions.filter(t => within(t, period.start, period.end));
  const periodOutflows = periodTxns.filter(t => t.amount < 0);
  const periodInflows = periodTxns.filter(t => t.amount > 0);
  const periodSpend = periodOutflows.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const periodIncome = periodInflows.reduce((sum, t) => sum + t.amount, 0);
  const totalSaved = account.savingsPockets.reduce((s, p) => s + p.balance, 0);
  const fresh = (text: string, dataCard?: ScoutChatMessage["dataCard"]): ScoutChatMessage => ({ id: `scout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sender: "scout", text, timestamp: Date.now(), dataCard });

  // A merchant-specific lookup takes priority over generic expense questions.
  const matchingMerchant = [...new Set(outflows.map(t => t.merchant))].find(merchant => q.includes(merchant.toLowerCase()));
  if (matchingMerchant) {
    const txns = outflows.filter(t => t.merchant === matchingMerchant && within(t, period.start, period.end));
    const total = txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const rewards = txns.reduce((sum, t) => sum + t.reward, 0);
    const recovered = txns.reduce((sum, t) => sum + (t.scout ?? 0), 0);
    return fresh(txns.length
      ? `I found ${txns.length} ${txns.length === 1 ? "charge" : "charges"} at **${matchingMerchant}** ${period.label}, totaling **${money(total)}**. They earned ${money(rewards)} in cash back and Scout recovered ${money(recovered)}.`
      : `I found no ${period.label} purchases at **${matchingMerchant}** in your saved ledger.`, {
      type: "metrics",
      title: `${matchingMerchant} · ${period.label}`,
      items: [{ label: "Purchases", value: String(txns.length) }, { label: "Spend", value: money(total) }, { label: "Rewards", value: money(rewards) }, { label: "Scout recovered", value: money(recovered) }],
    });
  }

  const categoryMatch = [...new Set(outflows.map(t => t.category))].find(category => q.includes(category.toLowerCase()));
  if (categoryMatch && /spend|spent|expense|cost|budget|category/.test(q)) {
    const txns = periodOutflows.filter(t => t.category === categoryMatch);
    const total = txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return fresh(`Your recorded **${categoryMatch}** spending ${period.label} is **${money(total)}** across ${txns.length} purchases.`, {
      type: "metrics", title: `${categoryMatch} · ${period.label}`, items: [{ label: "Category spend", value: money(total) }, { label: "Purchases", value: String(txns.length) }, { label: "Cash back", value: money(txns.reduce((sum, t) => sum + t.reward, 0)) }],
    });
  }

  // Compare actual calendar-month category data before responding to trend questions.
  if (/rising|increas|higher|month.over.month|trend|creep/.test(q)) {
    const date = new Date();
    const thisStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const previousStart = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
    const previousEnd = thisStart;
    const totals = (start: number, end: number) => {
      const result = new Map<string, number>();
      outflows.filter(t => t.date >= start && t.date < end).forEach(t => result.set(t.category, (result.get(t.category) ?? 0) + Math.abs(t.amount)));
      return result;
    };
    const current = totals(thisStart, now + 1);
    const previous = totals(previousStart, previousEnd);
    const changes = [...new Set([...current.keys(), ...previous.keys()])]
      .map(category => ({ category, current: current.get(category) ?? 0, previous: previous.get(category) ?? 0 }))
      .filter(row => row.previous > 0 && row.current > row.previous)
      .sort((a, b) => (b.current - b.previous) - (a.current - a.previous));
    const top = changes.slice(0, 4);
    return fresh(top.length
      ? `Comparing recorded calendar-month totals, **${top[0].category}** is up ${money(top[0].current - top[0].previous)} (${Math.round((top[0].current / top[0].previous - 1) * 100)}%) versus last month. This month's totals are partial, so treat the comparison as an early signal.`
      : "I don't see a category with higher recorded spend than last month yet. The current month is still in progress, and I only compare activity saved in this account.", {
      type: "breakdown", title: "Month-over-month spend", items: top.length ? top.map(row => ({ label: `${row.category} · ${money(row.previous, false)} → ${money(row.current, false)}`, value: `+${money(row.current - row.previous, false)}` })) : [{ label: "Recorded trend", value: "No increases found" }],
    });
  }

  if (/subscription|recurring charge|recurring payment|renewal/.test(q)) {
    const merchantCounts = new Map<string, { count: number; total: number; examples: string[] }>();
    outflows.forEach(txn => {
      const recurring = /monthly|subscription|recurring|renewal|annual seat/i.test(txn.note ?? "") || txn.category === "Software";
      if (!recurring) return;
      const current = merchantCounts.get(txn.merchant) ?? { count: 0, total: 0, examples: [] };
      current.count += 1; current.total += Math.abs(txn.amount);
      if (txn.note && !current.examples.includes(txn.note)) current.examples.push(txn.note);
      merchantCounts.set(txn.merchant, current);
    });
    const rows = [...merchantCounts.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    return fresh(rows.length
      ? `I found ${rows.length} merchants with a subscription-style memo or software category in your saved transactions. These are candidates to review, not confirmed active subscriptions.`
      : "I couldn't identify recurring charges from the saved transaction memos yet. Add a note like ‘monthly subscription’ to make future reviews more accurate.", {
      type: "breakdown", title: "Recurring-charge candidates", items: rows.map(([merchant, info]) => ({ label: `${merchant} · ${info.count} charge${info.count === 1 ? "" : "s"}`, value: money(info.total) })),
    });
  }

  if (/balance|how much money|worth|liquid|checking/.test(q)) {
    return fresh(`Your checking balance is **${money(account.balance)}**, with **${money(account.pendingBalance)}** pending. Your savings pockets hold **${money(totalSaved)}**, giving you **${money(account.balance + totalSaved)}** in total available plus saved funds.`, {
      type: "breakdown", title: "Your liquidity", items: [{ label: "Checking", value: money(account.balance) }, { label: "Pending", value: money(account.pendingBalance) }, { label: "Savings pockets", value: money(totalSaved) }, { label: "Checking + savings", value: money(account.balance + totalSaved) }],
    });
  }

  if (/spend|spent|expense|outflow|cost|budget/.test(q)) {
    const cats = new Map<string, number>();
    periodOutflows.forEach(t => cats.set(t.category, (cats.get(t.category) ?? 0) + Math.abs(t.amount)));
    const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return fresh(`Your recorded outflow ${period.label} is **${money(periodSpend)}** across ${periodOutflows.length} purchases. ${top[0] ? `Your largest category is **${top[0][0]}** at **${money(top[0][1])}**.` : "There are no purchases in that period yet."}`, {
      type: "breakdown", title: `Outflow · ${period.label}`, items: [{ label: "Total outflow", value: money(periodSpend) }, ...top.map(([label, value]) => ({ label, value: money(value) }))],
    });
  }

  if (/income|deposit|paycheck|pay check|salary|inflow/.test(q)) {
    return fresh(`Your recorded incoming funds ${period.label} total **${money(periodIncome)}** across ${periodInflows.length} deposits or credits.`, {
      type: "metrics", title: `Money in · ${period.label}`, items: [{ label: "Deposits and credits", value: money(periodIncome) }, { label: "Transactions", value: String(periodInflows.length) }, { label: "Pending", value: money(account.pendingBalance) }],
    });
  }

  if (/scout|saving|discount|negotiate|recovered|reward|cash.?back/.test(q)) {
    return fresh(`Scout has recorded **${money(account.scoutSaved)}** in historical ledger credits, which may include demo entries. New Scout credits are disabled until a funded savings provider is connected. You have **${money(account.rewards)}** in rewards ready to redeem. ${account.preferences.scoutAuto ? "Automatic monitoring is on." : "Automatic monitoring is paused."}`, {
      type: "metrics", title: "Value captured", items: [{ label: "Scout savings", value: money(account.scoutSaved) }, { label: "Ready to redeem", value: money(account.rewards) }, { label: "Lifetime cash back", value: money(account.lifetimeRewards) }, { label: "Auto-monitoring", value: account.preferences.scoutAuto ? "On" : "Paused" }],
    });
  }

  if (/card|limit|freeze|pin|utilization/.test(q)) {
    const active = account.cards.filter(c => !c.frozen);
    const near = active.filter(c => c.limit > 0 && c.spent / c.limit >= 0.75);
    return fresh(`You have **${active.length} active** and **${account.cards.length - active.length} frozen** cards. ${near.length ? `${near.map(c => c.label).join(", ")} ${near.length === 1 ? "is" : "are"} above 75% utilization.` : "No active cards are currently above 75% of their limit."}`, {
      type: "actions", title: "Card controls", items: account.cards.map(c => ({ label: `${c.label} · •••• ${c.last4}`, value: `${c.frozen ? "Frozen" : "Active"} · ${money(c.spent)} / ${money(c.limit, false)}` })),
    });
  }

  if (/saving pocket|goal|reserve|savings account/.test(q)) {
    return fresh(account.savingsPockets.length
      ? `Your savings pockets hold **${money(totalSaved)}** in total. ${account.savingsPockets.map(p => `${p.name}: ${money(p.balance)} of ${money(p.target, false)}`).join(" · ")}.`
      : "You do not have any savings pockets yet. Open Accounts & Savings to create one.", {
      type: "breakdown", title: "Savings pockets", items: account.savingsPockets.map(p => ({ label: p.name, value: `${money(p.balance)} / ${money(p.target, false)}` })),
    });
  }

  if (/bill|invoice|due|scheduled|upcoming|autopay/.test(q)) {
    const unpaid = account.invoices.filter(i => i.status !== "paid");
    const scheduled = account.scheduledPayments.filter(p => p.status === "active");
    const next30 = scheduled.filter(p => p.nextDate <= now + 30 * DAY).reduce((sum, p) => sum + p.amount, 0);
    return fresh(`There are **${scheduled.length} active scheduled payments**; **${money(next30)}** is scheduled in the next 30 days. You also have **${unpaid.length} unpaid invoices** totaling ${money(unpaid.reduce((sum, i) => sum + i.amount, 0))}.`, {
      type: "breakdown", title: "Upcoming obligations", items: [{ label: "Scheduled payments (30 days)", value: money(next30) }, ...scheduled.slice(0, 4).map(p => ({ label: `${p.payeeName} · ${new Date(p.nextDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, value: money(p.amount) })), { label: "Unpaid invoices", value: money(unpaid.reduce((sum, i) => sum + i.amount, 0)) }],
    });
  }

  if (/dispute|chargeback|fraud|unauthorized|duplicate/.test(q)) {
    return fresh(`There are **${account.disputes.filter(d => d.status !== "resolved" && d.status !== "denied").length} open disputes**. From any card transaction, choose **Report** to start a claim and track its review in Disputes. If a card may be compromised, freeze it first.`, { type: "actions", title: "Get help with a transaction", items: [{ label: "Open disputes", value: String(account.disputes.filter(d => d.status !== "resolved" && d.status !== "denied").length) }, { label: "Security", value: "Freeze a card immediately if needed" }] });
  }

  if (/help|what can you do|support|hello|hi\b/.test(q)) {
    return fresh(`Hi ${userName.split(" ")[0]}! I can summarize recent spending, check balances, review scheduled bills and savings goals, inspect card utilization, and explain your Scout savings. I only use the account data saved to your Veyra account; I can't access external bank networks.`, {
      type: "actions", title: "Try asking", items: [{ label: "Spending", value: "What did I spend this month?" }, { label: "Cash", value: "What is my total liquidity?" }, { label: "Payments", value: "What bills are coming up?" }, { label: "Cards", value: "Are any cards near their limit?" }],
    });
  }

  const net = periodIncome - periodSpend;
  return fresh(`For ${period.label}, I can see **${money(periodIncome)}** in and **${money(periodSpend)}** out, a net cash flow of **${money(net)}**. Ask me about a merchant, spending category, card, bill, savings pocket or rewards balance for a more specific breakdown.`, {
    type: "metrics", title: `Cash flow · ${period.label}`, items: [{ label: "Money in", value: money(periodIncome) }, { label: "Money out", value: money(periodSpend) }, { label: "Net", value: money(net) }],
  });
}