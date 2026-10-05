/**
 * Candlestick chart, drawn by hand in SVG.
 *
 * recharts is already a dependency, but it has no candlestick primitive —
 * building one means a custom Bar shape fighting the library's scales for
 * wick placement. Plain SVG is less code, gives exact control over the wick
 * and body geometry, and matches how Sparkline in dashboards/parts.tsx is
 * already done.
 *
 * Prices arrive as integer cents and stay integers through every comparison.
 * The only division by 100 is at the point of rendering a label, so nothing
 * here can accumulate float error the way a running total would.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type Candle = { t: number; o: number; h: number; l: number; c: number };

const UP = "#3f8358";
const DOWN = "#a04545";

const usd = (cents: number) => {
  const dollars = cents / 100;
  const digits = Math.abs(dollars) >= 1000 ? 0 : dollars >= 1 ? 2 : 4;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

/**
 * Axis labels on a phone. "$102,955" at the width a 360px screen gives each
 * tick is unreadable, so large numbers collapse to "$103k" — the gridline
 * carries the precision, the label only needs to carry the magnitude.
 */
const axisLabel = (cents: number, narrow: boolean) => {
  const dollars = cents / 100;
  if (!narrow || Math.abs(dollars) < 1000) return usd(cents);
  const k = dollars / 1000;
  return `$${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
};

/**
 * The rendered width of the chart, in CSS pixels.
 *
 * The SVG viewBox is then set to match, so one viewBox unit is one real pixel
 * and a 10px axis label is actually 10px at every screen size. A fixed 760-unit
 * viewBox squeezed into a 340px phone renders that same label at 4.5px.
 */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const timeLabel = (ms: number, range: string) =>
  range === "1d"
    ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function CandleChart({ candles, range, label }: { candles: Candle[]; range: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, measured] = useMeasuredWidth<HTMLDivElement>();

  const geom = useMemo(() => {
    // Before the first measurement, assume a desktop width rather than 0 —
    // a zero-width viewBox makes the first paint collapse.
    const W = Math.max(260, Math.min(measured || 760, 1100));
    const narrow = W < 480;
    const H = narrow ? 190 : 260;
    const PAD = {
      top: 12,
      right: narrow ? 6 : 10,
      bottom: narrow ? 20 : 24,
      left: narrow ? 42 : 58,
    };
    return { W, H, PAD, narrow, PLOT_W: W - PAD.left - PAD.right, PLOT_H: H - PAD.top - PAD.bottom };
  }, [measured]);

  const { W, H, PAD, narrow, PLOT_W, PLOT_H } = geom;

  const view = useMemo(() => {
    const highs = candles.map(c => c.h);
    const lows = candles.map(c => c.l);
    const top = Math.max(...highs);
    const bottom = Math.min(...lows);
    // A stablecoin barely moves, so an unpadded range would amplify a
    // fraction of a cent into a mountain range. The floor keeps it flat.
    const spread = Math.max(top - bottom, Math.round(top * 0.002), 1);
    const pad = spread * 0.08;
    const hi = top + pad;
    const lo = Math.max(0, bottom - pad);
    const y = (cents: number) => PAD.top + PLOT_H - ((cents - lo) / (hi - lo || 1)) * PLOT_H;
    const slot = PLOT_W / candles.length;
    const x = (i: number) => PAD.left + slot * (i + 0.5);
    const body = Math.max(1, Math.min(slot * 0.62, 18));
    // Fewer gridlines on a phone; five would stack labels on top of each other.
    const tickCount = narrow ? 4 : 5;
    const ticks = Array.from({ length: tickCount }, (_, i) => lo + ((hi - lo) / (tickCount - 1)) * i);
    return { hi, lo, y, x, slot, body, ticks };
  }, [candles, PAD.top, PAD.left, PLOT_W, PLOT_H, narrow]);

  const first = candles[0];
  const last = candles[candles.length - 1];
  const delta = last.c - first.o;
  const pct = first.o > 0 ? (delta / first.o) * 100 : 0;
  const active = hover === null ? null : candles[hover];

  /* Index from the pointer's horizontal fraction — survives any CSS scaling
     of the SVG, which reading clientX against viewBox units would not. */
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / box.width;
    const plotFrac = (frac * W - PAD.left) / PLOT_W;
    const i = Math.floor(plotFrac * candles.length);
    setHover(i >= 0 && i < candles.length ? i : null);
  };

  return (
    <div className="candle-chart" ref={wrapRef}>
      <div className="candle-head">
        <div>
          <strong>{active ? usd(active.c) : usd(last.c)}</strong>
          <span className={delta >= 0 ? "candle-up" : "candle-down"}>
            {delta >= 0 ? "▲" : "▼"} {usd(Math.abs(delta))} ({pct >= 0 ? "+" : "−"}{Math.abs(pct).toFixed(2)}%)
          </span>
        </div>
        <small>{active ? timeLabel(active.t, range) : `${label} · ${candles.length} periods`}</small>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`} className="candle-svg" role="img"
        aria-label={`${label} price history, ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)} percent over the period`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      >
        {view.ticks.map((cents, i) => {
          const y = view.y(cents);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className="candle-grid" />
              <text x={PAD.left - 6} y={y + 3.5} className="candle-axis" textAnchor="end">{axisLabel(cents, narrow)}</text>
            </g>
          );
        })}

        {candles.map((c, i) => {
          // Evenly spaced labels, never crowding the axis: about six across a
          // desktop chart, three on a phone.
          const step = Math.max(1, Math.ceil(candles.length / (narrow ? 3 : 6)));
          if (i % step !== 0) return null;
          // The last slot would overflow the right edge once anchored middle.
          if (view.x(i) > W - PAD.right - 18) return null;
          return <text key={`t${i}`} x={view.x(i)} y={H - 6} className="candle-axis" textAnchor="middle">{timeLabel(c.t, range)}</text>;
        })}

        {candles.map((c, i) => {
          const rising = c.c >= c.o;
          const colour = rising ? UP : DOWN;
          const x = view.x(i);
          const yOpen = view.y(c.o);
          const yClose = view.y(c.c);
          const top = Math.min(yOpen, yClose);
          // A doji would collapse to nothing, so every body keeps 1px.
          const height = Math.max(1, Math.abs(yClose - yOpen));
          return (
            <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.42}>
              <line x1={x} x2={x} y1={view.y(c.h)} y2={view.y(c.l)} stroke={colour} strokeWidth={1.2} />
              <rect x={x - view.body / 2} y={top} width={view.body} height={height} fill={colour} rx={Math.min(1.5, view.body / 3)} />
            </g>
          );
        })}

        {active && <line x1={view.x(hover!)} x2={view.x(hover!)} y1={PAD.top} y2={PAD.top + PLOT_H} className="candle-cross" />}
      </svg>

      {active && (
        <dl className="candle-readout">
          <div><dt>Open</dt><dd>{usd(active.o)}</dd></div>
          <div><dt>High</dt><dd>{usd(active.h)}</dd></div>
          <div><dt>Low</dt><dd>{usd(active.l)}</dd></div>
          <div><dt>Close</dt><dd className={active.c >= active.o ? "candle-up" : "candle-down"}>{usd(active.c)}</dd></div>
        </dl>
      )}
    </div>
  );
}
