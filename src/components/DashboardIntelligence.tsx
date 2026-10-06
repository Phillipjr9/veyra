import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, CandlestickChart, ChevronDown, Layers3, LineChart, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { money, type Txn } from "../lib/store";
import { buildCashFlow, type FlowRange } from "../lib/dashboardAnalytics";

export function CashFlowExplorer({ transactions, title = "Cash flow", business = false }: { transactions: Txn[]; title?: string; business?: boolean }) {
  const [days, setDays] = useState<FlowRange>(30);
  const [chart, setChart] = useState<"area" | "bars">("area");
  const reduce = useReducedMotion();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const data = useMemo(() => buildCashFlow(transactions, days), [transactions, days]);
  const green = business ? "#39846b" : "#7770ae";
  const secondary = business ? "#b6cfc4" : "#cfbfdf";
  const axes = <><CartesianGrid vertical={false} stroke="#e8e5eb" strokeDasharray="3 5" />
    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={36} tick={{ fontSize: 10, fill: "#7b7387" }} />
    <YAxis width={44} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7b7387" }} tickFormatter={n => Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `$${n}`} />
    <Tooltip position={{ x: 46, y: 8 }} isAnimationActive={false} labelFormatter={label => `Period starting ${label}`} formatter={(value, name) => [money(Number(value)), name === "inflow" ? "Money in" : "Money out"]} contentStyle={{ borderRadius: 10, border: "1px solid #ddd6e5", fontSize: 12, boxShadow: "0 8px 28px #30223a12" }} /></>;
  return <section className={`dx-flow ${business ? "dx-flow-business" : ""}`} aria-label={`${title} explorer`}>
    <div className="dx-flow-head"><div><span className="dx-kicker">LEDGER INTELLIGENCE</span><h2>{title}</h2></div>
      <div className="dx-range" role="group" aria-label="Cash flow period">{([7, 30, 90] as const).map(range => <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)}>{range}D</button>)}</div>
    </div>
    <div className="dx-flow-stats" aria-live="polite">
      <div><span><ArrowDownLeft size={13} /> Money in</span><strong data-flow="in">{money(data.inflow)}</strong></div>
      <div><span><ArrowUpRight size={13} /> Money out</span><strong data-flow="out">{money(data.outflow)}</strong></div>
      <div><span><TrendingUp size={13} /> Net movement</span><strong data-flow="net" className={data.net < 0 ? "negative" : "positive"}>{data.net > 0 ? "+" : ""}{money(data.net)}</strong></div>
    </div>
    <div className="dx-chart-toolbar"><span>Last {days} days · Cleared transactions</span><div role="group" aria-label="Cash flow chart style"><button type="button" aria-label="Area chart" aria-pressed={chart === "area"} onClick={() => setChart("area")}><LineChart size={15} /></button><button type="button" aria-label="Bar chart" aria-pressed={chart === "bars"} onClick={() => setChart("bars")}><BarChart3 size={15} /></button></div></div>
    {data.included ? <div className="dx-chart" role="img" aria-label={`${days}-day cash flow: ${money(data.inflow)} in, ${money(data.outflow)} out. Tabular data available below.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {chart === "area" ? <AreaChart data={data.buckets} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <defs><linearGradient id={`dx-in-${id}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={green} stopOpacity={.26} /><stop offset="1" stopColor={green} stopOpacity={.01} /></linearGradient></defs>
          {axes}<Area dataKey="outflow" type="linear" stroke={secondary} fill={secondary} fillOpacity={.1} strokeWidth={2} isAnimationActive={!reduce} animationDuration={550} />
          <Area dataKey="inflow" type="linear" stroke={green} fill={`url(#dx-in-${id})`} strokeWidth={2.4} isAnimationActive={!reduce} animationDuration={550} />
        </AreaChart> : <BarChart data={data.buckets} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>{axes}<Bar dataKey="inflow" fill={green} radius={[3, 3, 0, 0]} maxBarSize={17} isAnimationActive={!reduce} animationDuration={450} /><Bar dataKey="outflow" fill={secondary} radius={[3, 3, 0, 0]} maxBarSize={17} isAnimationActive={!reduce} animationDuration={450} /></BarChart>}
      </ResponsiveContainer>
    </div> : <div className="dx-flow-empty"><LineChart size={28} /><strong>No cleared activity in this period</strong><p>Your real activity will appear here. Try a longer period.</p></div>}
    <div className="dx-flow-foot"><span><i style={{ background: green }} /> Money in <i style={{ background: secondary }} /> Money out</span><small>{data.included} movements · {data.pending} pending excluded</small></div>
    <details className="dx-flow-data"><summary>View chart data <ChevronDown size={14} /></summary><p>Rolling {days}-day window. Account transfers may be included; net movement is not profit.</p><div className="dx-data-scroll" role="region" aria-label="Cash flow data table" tabIndex={0}><table><thead><tr><th scope="col">Period starting</th><th scope="col">Money in</th><th scope="col">Money out</th></tr></thead><tbody>{data.buckets.map(bucket => <tr key={bucket.at}><th scope="row">{new Date(bucket.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</th><td>{money(bucket.inflow)}</td><td>{money(bucket.outflow)}</td></tr>)}</tbody></table></div></details>
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
