import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, CandlestickChart, ChevronDown, Layers3, LineChart, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { money, type Txn } from "../lib/store";
import { buildCashFlow, type FlowRange, type LedgerAnalytics } from "../lib/dashboardAnalytics";

const POSTED_PREVIEW = 100;

function utcStamp(at: number) {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function utcDay(at: number) {
  return new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function CashFlowExplorer({ transactions, analytics, title = "Cash flow", business = false, platform = false, days: controlledDays, onDaysChange }: { transactions: Txn[]; analytics?: LedgerAnalytics; title?: string; business?: boolean; platform?: boolean; days?: FlowRange; onDaysChange?: (days: FlowRange) => void }) {
  const [localDays, setLocalDays] = useState<FlowRange>(30);
  const days = controlledDays ?? localDays;
  const setDays = (value: FlowRange) => { setLocalDays(value); onDaysChange?.(value); };
  const [chart, setChart] = useState<"area" | "bars">("bars");
  const reduce = useReducedMotion();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const data = useMemo(() => analytics?.ranges[days] ?? buildCashFlow(transactions, days), [transactions, days, analytics]);
  const posted = useMemo(() => [...transactions]
    .filter(row => row.status === "cleared" && Number.isFinite(row.amount) && Number.isFinite(row.date) && Math.round(Math.abs(row.amount) * 100) !== 0 && row.date >= data.start && row.date <= data.end)
    .sort((a, b) => b.date - a.date || a.id.localeCompare(b.id)), [transactions, data.start, data.end]);
  const activeDays = useMemo(() => data.buckets.filter(bucket => bucket.inflow || bucket.outflow), [data.buckets]);
  const green = "#39846b";
  const secondary = "#9269b0";
  const barSize = days === 7 ? 18 : days === 30 ? 9 : 4;
  const axes = <>
    <CartesianGrid vertical={false} stroke="#e8e5eb" strokeDasharray="3 5" />
    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={days === 7 ? 4 : 28} interval={days === 7 ? 0 : "preserveStartEnd"} tick={{ fontSize: 10, fill: "#7b7387" }} />
    <YAxis width={44} domain={[0, "auto"]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7b7387" }} tickFormatter={n => Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${n}`} />
    <Tooltip position={{ x: 46, y: 8 }} isAnimationActive={false} labelFormatter={(_label, payload) => payload?.[0]?.payload ? `${utcDay(payload[0].payload.at)} UTC` : "Day (UTC)"} formatter={(value, name) => [money(Number(value)), name === "inflow" ? "Money in" : "Money out"]} contentStyle={{ borderRadius: 10, border: "1px solid #ddd6e5", fontSize: 12, boxShadow: "0 8px 28px #30223a12" }} />
  </>;
  return <section className={`dx-flow ${business ? "dx-flow-business" : ""}`} aria-label={`${title} explorer`}>
    <div className="dx-flow-head"><div><span className="dx-kicker">LEDGER INTELLIGENCE</span><h2>{title}</h2></div>
      <div className="dx-range" role="group" aria-label="Cash flow period">{([7, 30, 90] as const).map(range => <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)}>{range}D</button>)}</div>
    </div>
    <div className="dx-flow-stats" aria-live="polite">
      <div><span><ArrowDownLeft size={13} /> Money in</span><strong data-flow="in">{money(data.inflow)}</strong></div>
      <div><span><ArrowUpRight size={13} /> Money out</span><strong data-flow="out">{money(data.outflow)}</strong></div>
      <div><span><TrendingUp size={13} /> Net movement</span><strong data-flow="net" className={data.net < 0 ? "negative" : "positive"}>{data.net > 0 ? "+" : ""}{money(data.net)}</strong></div>
    </div>
    <div className="dx-chart-toolbar"><span>One UTC day per column · last {days} days · cleared</span><div role="group" aria-label="Cash flow chart style"><button type="button" aria-label="Area chart" aria-pressed={chart === "area"} onClick={() => setChart("area")}><LineChart size={15} /></button><button type="button" aria-label="Bar chart" aria-pressed={chart === "bars"} onClick={() => setChart("bars")}><BarChart3 size={15} /></button></div></div>
    {data.included ? <div className="dx-chart" role="img" aria-label={`${days}-day cash flow, one UTC day per column: ${money(data.inflow)} in, ${money(data.outflow)} out across ${data.included} movements. Tabular data available below.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {chart === "area" ? <AreaChart data={data.buckets} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <defs><linearGradient id={`dx-in-${id}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={green} stopOpacity={.26} /><stop offset="1" stopColor={green} stopOpacity={.01} /></linearGradient></defs>
          {axes}
          <Area dataKey="outflow" type="stepAfter" stroke={secondary} fill={secondary} fillOpacity={.1} strokeWidth={2} dot={false} isAnimationActive={!reduce} animationDuration={550} />
          <Area dataKey="inflow" type="stepAfter" stroke={green} fill={`url(#dx-in-${id})`} strokeWidth={2.4} dot={false} isAnimationActive={!reduce} animationDuration={550} />
        </AreaChart> : <BarChart data={data.buckets} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barCategoryGap={days === 7 ? "18%" : "12%"}>{axes}<Bar dataKey="inflow" fill={green} radius={[3, 3, 0, 0]} maxBarSize={barSize} isAnimationActive={!reduce} animationDuration={450} /><Bar dataKey="outflow" fill={secondary} radius={[3, 3, 0, 0]} maxBarSize={barSize} isAnimationActive={!reduce} animationDuration={450} /></BarChart>}
      </ResponsiveContainer>
    </div> : <div className="dx-flow-empty"><LineChart size={28} /><strong>No cleared activity in this period</strong><p>Your real activity will appear here. Try a longer period.</p></div>}
    <div className="dx-flow-foot"><span><i style={{ background: green }} /> Money in <i style={{ background: secondary }} /> Money out</span><small>{data.included} movements · {data.pending} pending excluded</small></div>
    <p className="dx-flow-asof">{analytics ? `Ledger updated ${utcStamp(analytics.asOf)} UTC. Refreshes automatically while this page is open.` : "Based on the loaded transaction history."}</p>
    <details className="dx-flow-data">
      <summary>View chart data <ChevronDown size={14} /></summary>
      <p>Each column is one UTC calendar day from {utcDay(data.start)} through {utcDay(data.end)}. Totals are the posted principal on cleared ledger rows — the same figures as the transaction list. Fees stay on the row and are not added here. Pending, failed and future-dated transactions are excluded. {platform ? "Transfers between members appear on both sides of the platform ledger; this is not external settlement volume." : "Includes account transfers and savings-pocket movements."} Net movement is not profit or your available balance.</p>
      {posted.length < data.included ? <p>This session loaded {posted.length} of {data.included} posted movements in the window. Chart totals still include the full ledger.</p> : null}
      <div className="dx-data-scroll" role="region" aria-label="Posted movements in this period" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Posted (UTC)</th><th scope="col">Movement</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            {posted.length ? posted.slice(0, POSTED_PREVIEW).map(row => (
              <tr key={row.id}>
                <th scope="row">{utcStamp(row.date)}</th>
                <td className="dx-data-merchant">{row.merchant || row.category || "Posted movement"}</td>
                <td className={row.amount > 0 ? "in" : ""}>{row.amount > 0 ? "+" : "−"}{money(Math.abs(row.amount))}</td>
              </tr>
            )) : <tr><th scope="row" colSpan={3}>No posted movements loaded for this window.</th></tr>}
          </tbody>
        </table>
      </div>
      {posted.length > POSTED_PREVIEW ? <p>Showing the {POSTED_PREVIEW} most recent loaded movements.</p> : null}
      <p className="dx-data-days">{activeDays.length} day{activeDays.length === 1 ? "" : "s"} with posted activity · {days - activeDays.length} quiet.</p>
      <div className="dx-data-scroll" role="region" aria-label="Cash flow by day" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Day (UTC)</th><th scope="col">Money in</th><th scope="col">Money out</th></tr></thead>
          <tbody>{activeDays.map(bucket => <tr key={bucket.at}><th scope="row">{utcDay(bucket.at)}</th><td>{money(bucket.inflow)}</td><td>{money(bucket.outflow)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

export function PersonalShortcuts() {
  const items = [
    { to: "/app/accounts", label: "Build your savings", detail: "Give your next goal a home", icon: Wallet },
    { to: "/app/markets", label: "Explore the markets", detail: "Bitcoin & digital assets", icon: CandlestickChart },
    { to: "/app/plan", label: "Plan your next move", detail: "Budgets with a clearer view", icon: Layers3 },
    { to: "/app/security", label: "Your security center", detail: "Passkeys, sessions & access", icon: ShieldCheck },
  ];
  return <nav className="dx-shortcuts" aria-label="Personal shortcuts">{items.map(item => <Link key={item.to} to={item.to}><span className="dx-shortcut-icon"><item.icon size={18} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={15} /></Link>)}</nav>;
}
