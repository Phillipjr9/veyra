import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowDownLeft, ArrowRight, Building2, Check, Download, Landmark, Lock, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { downloadFile, longDate, money, rewardRate, useAcct, type MoveResult } from "../lib/store";
import { useToast } from "./Toast";
import { ease, useCountUp } from "./common";
import { VeyraMark } from "./VeyraMark";
import { lockScroll } from "../lib/scrollLock";

/* ============================================================
   Types & constants
   ============================================================ */
export type SendMethod = "ACH" | "Wire" | "Zelle" | "Vendor Bill";
export type SendDraft = { counterparty: string; amount: number; method: SendMethod; category: string; note?: string };

type Stage = "form" | "review" | "processing" | "success";
type DepositFlow = { kind: "deposit"; stage: Stage; sourceId: string; amount: number };
type SendFlow = { kind: "send"; stage: Stage; draft: SendDraft };
type FlowState = DepositFlow | SendFlow;
type NodeInfo = { label: string; sub: string; icon: ReactNode };
export type Track = { from: NodeInfo; to: NodeInfo };
type Row = { label: string; value: ReactNode; tone?: "free" | "reward" | "scout" };

export const ETA: Record<SendMethod, string> = {
  Zelle: "Instant (within minutes)",
  ACH: "Next business day",
  Wire: "Today, within 2 hours",
  "Vendor Bill": "1–2 business days",
};

export function ZelleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Zelle">
      <rect width="48" height="48" rx="12" fill="#7414CA" />
      {/* Characteristic Zelle Z-stroke with vertical cross bars */}
      <path d="M13 14H31L17 34H35" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 8V14M24 34V40" stroke="#72F674" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Deposit limits, in dollars. These mirror the server (see MAX_DEPOSIT_CENTS in
 * server/src/app.ts): the form refuses an over-limit amount before the request
 * is made, so the member sees why next to the field instead of a rejection
 * arriving after the transfer was already submitted.
 */
const DEPOSIT_MIN = 10;
const DEPOSIT_MAX = 100_000;
const DEPOSIT_MIN_LABEL = "$10";
const DEPOSIT_MAX_LABEL = "$100,000";

const SOURCES = [
  { id: "processor", label: "Card processor payout", short: "Card processor", sub: "Daily sales settlement", Icon: Zap },
  { id: "client", label: "Client wire transfer", short: "Client wire", sub: "Incoming domestic wire", Icon: Building2 },
  { id: "external", label: "External checking •••• 4471", short: "External bank", sub: "Linked account · ACH pull", Icon: Landmark },
  { id: "capital", label: "Owner capital contribution", short: "Owner funds", sub: "Founder or equity funds", Icon: ArrowDownLeft },
];
const sourceById = (id: string) => SOURCES.find(s => s.id === id) ?? SOURCES[0];

export const CONFETTI_VIOLET = ["#7558dc", "#a48cf2", "#d9d0fb", "#f2c96b", "#6cc493"];
export const CONFETTI_GREEN = ["#4f9a6c", "#7fd1a2", "#c9ecd7", "#f2c96b", "#a48cf2"];

function trackFor(flow: FlowState, acct: string): Track {
  const veyra: NodeInfo = { label: "Veyra Checking", sub: `•••• ${acct}`, icon: <VeyraMark width={20} height={20} /> };
  if (flow.kind === "deposit") {
    const s = sourceById(flow.sourceId);
    return { from: { label: s.short, sub: s.sub, icon: <s.Icon size={18} /> }, to: veyra };
  }
  const initial = flow.draft.counterparty.trim().charAt(0).toUpperCase() || "?";
  const icon = flow.draft.method === "Zelle"
    ? <ZelleLogo size={22} />
    : <span className="flow-initial">{initial}</span>;
  return { from: veyra, to: { label: flow.draft.counterparty, sub: `${flow.draft.method === "Zelle" ? "Zelle® Instant" : flow.draft.method} transfer`, icon } };
}

function stepsFor(flow: FlowState): string[] {
  if (flow.kind === "deposit") {
    const s = sourceById(flow.sourceId);
    return [`Connecting to ${s.short.toLowerCase()}`, "Authorizing the ACH pull", "Clearing funds with Northfield Bank", "Updating your balance"];
  }
  const network = flow.draft.method === "Zelle"
    ? "Connecting to Zelle® instant network"
    : flow.draft.method === "Wire"
    ? "Routing over the domestic wire network"
    : flow.draft.method === "ACH"
    ? "Submitting to the ACH network"
    : "Scheduling the vendor payment";
  return ["Verifying available balance", "Encrypting & authorizing transfer", network, "Scout checking for savings"];
}

/* ============================================================
   Reusable celebration pieces
   ============================================================ */
export function Confetti({ palette = CONFETTI_VIOLET, count = 28 }: { palette?: string[]; count?: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const dist = 90 + Math.random() * 120;
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.7 - 60,
          rot: Math.random() * 520 - 260,
          size: 5 + Math.random() * 6,
          color: palette[i % palette.length],
          round: i % 3 === 0,
          delay: Math.random() * 0.12,
        };
      }),
    [count, palette],
  );
  if (reduce) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map(p => (
        <motion.i
          key={p.id}
          style={{ width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? "50%" : 2 }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: [0, p.x, p.x * 1.08], y: [0, p.y, p.y + 140], rotate: [0, p.rot * 0.6, p.rot], opacity: [0, 1, 0], scale: [0.4, 1, 0.8] }}
          transition={{ duration: 1.6, delay: 0.25 + p.delay, times: [0, 0.35, 1], ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export function AnimatedCheck({ tone = "violet" }: { tone?: "violet" | "green" }) {
  return (
    <div className={`check-wrap tone-${tone}`}>
      <motion.span className="check-bg" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} />
      <motion.span className="check-ring" initial={{ scale: 0.8, opacity: 0.7 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.1, delay: 0.2, ease: "easeOut" }} />
      <svg className="check-svg" viewBox="0 0 52 52" aria-hidden="true">
        <motion.path d="M15 27.5l7.2 7.2L37.5 19" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.28, ease }} />
      </svg>
    </div>
  );
}

/* ============================================================
   Flow building blocks
   ============================================================ */
function StageDots({ kind, stage }: { kind: FlowState["kind"]; stage: Stage }) {
  const order: Stage[] = kind === "deposit" ? ["form", "review", "processing", "success"] : ["review", "processing", "success"];
  const labels: Record<Stage, string> = { form: "Details", review: "Review", processing: "Processing", success: "Done" };
  const idx = order.indexOf(stage);
  return (
    <ol className="flow-steps" aria-label="Progress">
      {order.map((s, i) => (
        <li key={s} className={`flow-step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}`} aria-current={i === idx ? "step" : undefined}>
          {i === idx && <motion.span layoutId="flow-step-pill" className="flow-step-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span className="flow-step-dot">{i < idx ? <Check size={10} strokeWidth={3.4} /> : i + 1}</span>
          <span className="flow-step-label">{labels[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function FlowTrack({ from, to, state, progress }: Track & { state: "idle" | "moving" | "done"; progress: number }) {
  const reduce = useReducedMotion();
  const moving = state === "moving" && !reduce;
  return (
    <div className={`flow-track is-${state}`}>
      <div className="flow-node">
        <motion.span className="flow-node-icon" animate={moving ? { y: [0, -3, 0] } : { y: 0 }}
          transition={moving ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}>
          {from.icon}
        </motion.span>
        <strong>{from.label}</strong>
        <small>{from.sub}</small>
      </div>
      <div className="flow-line" aria-hidden="true">
        <motion.i className="flow-line-fill" initial={false} animate={{ scaleX: state === "done" ? 1 : progress }} transition={{ duration: 0.5, ease }} />
        {moving && [0, 1, 2].map(i => (
          <motion.span key={i} className="flow-dot" initial={{ left: "0%", opacity: 0 }}
            animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.25, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }} />
        ))}
        <motion.span key={state === "done" ? "done" : "go"} className="flow-line-badge" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}>
          {state === "done" ? <Check size={13} strokeWidth={3} /> : <ArrowRight size={13} />}
        </motion.span>
      </div>
      <div className={`flow-node ${state === "done" ? "is-done" : ""}`}>
        <span className="flow-node-icon">
          {to.icon}
          {state === "done" && !reduce && (
            <motion.i className="flow-node-pulse" initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 1.1, repeat: 1 }} />
          )}
        </span>
        <strong>{to.label}</strong>
        <small>{to.sub}</small>
      </div>
    </div>
  );
}

function DepositForm({ flow, balance, onSource, onContinue, onCancel }: {
  flow: DepositFlow; balance: number; onSource: (id: string) => void; onContinue: (amount: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(String(flow.amount));
  const amount = Number.parseFloat(value) || 0;
  const empty = value.trim() === "";
  const tooSmall = !empty && amount < DEPOSIT_MIN;
  const tooLarge = !empty && amount > DEPOSIT_MAX;
  const invalid = !empty && (tooSmall || tooLarge);
  const valid = !empty && !invalid;
  return (
    <form className="flow-pane" onSubmit={e => { e.preventDefault(); if (valid) onContinue(Math.round(amount * 100) / 100); }}>
      <h2 className="flow-title" id="flow-title">Add funds</h2>
      <p className="flow-sub">Move money into your Veyra checking account. Deposits are always free.</p>
      <span className="flow-label">From</span>
      <div className="source-list" role="radiogroup" aria-label="Deposit source">
        {SOURCES.map(s => {
          const on = flow.sourceId === s.id;
          return (
            <button type="button" role="radio" aria-checked={on} key={s.id} className={`source-item ${on ? "on" : ""}`} onClick={() => onSource(s.id)}>
              <span className="source-icon"><s.Icon size={16} /></span>
              <span className="source-text"><strong>{s.label}</strong><small>{s.sub}</small></span>
              <span className="source-radio">{on && <motion.i layoutId="source-dot" transition={{ type: "spring", stiffness: 500, damping: 32 }} />}</span>
            </button>
          );
        })}
      </div>
      <label className="flow-label" htmlFor="flow-amount">Amount</label>
      <div className={`flow-amount-field ${invalid ? "is-invalid" : ""}`}>
        <span>$</span>
        <input
          id="flow-amount"
          type="number"
          inputMode="decimal"
          min={DEPOSIT_MIN}
          max={DEPOSIT_MAX}
          step="0.01"
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? "flow-amount-error" : "flow-amount-limit"}
          onChange={e => setValue(e.target.value)}
        />
      </div>
      {/* The limit lives at the field, not below the fold: an over-limit amount
          is refused here, with the reason in view, and never reaches the server. */}
      {invalid ? (
        <p className="flow-field-error" id="flow-amount-error" role="alert">
          <AlertCircle size={14} />
          <span>
            {tooLarge
              ? `Maximum ${DEPOSIT_MAX_LABEL} per deposit. Enter ${money(DEPOSIT_MAX, false)} or less.`
              : `Minimum ${DEPOSIT_MIN_LABEL} per deposit.`}
          </span>
        </p>
      ) : (
        <p className="flow-field-note" id="flow-amount-limit">Minimum {DEPOSIT_MIN_LABEL} · Maximum {DEPOSIT_MAX_LABEL} per deposit</p>
      )}
      <div className="quick-row">
        {[1000, 5000, 10000, 25000].map(q => (
          <button type="button" key={q} className={amount === q ? "on" : ""} onClick={() => setValue(String(q))}>{money(q, false)}</button>
        ))}
      </div>
      <div className="flow-rows compact">
        <div className="flow-row"><span>Balance after deposit</span><b>{money(balance + (valid ? amount : 0))}</b></div>
      </div>
      <div className="flow-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="solid-btn" disabled={!valid} title={invalid ? "Amount is outside the deposit limits" : undefined}>
          Review deposit <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}

function Review({ flow, balance, track, onBack, onConfirm }: { flow: FlowState; balance: number; track: Track; onBack: () => void; onConfirm: () => void }) {
  const amount = flow.kind === "deposit" ? flow.amount : flow.draft.amount;
  const shown = useCountUp(amount, { from: 0, duration: 650 });
  const rows: Row[] =
    flow.kind === "deposit"
      ? [
          { label: "From", value: sourceById(flow.sourceId).label },
          { label: "To", value: `${track.to.label} ${track.to.sub}` },
          { label: "Available", value: "Instantly" },
          { label: "Fee", value: "Free", tone: "free" },
          { label: "Balance after", value: money(balance + amount) },
        ]
      : [
          { label: "Method", value: flow.draft.method },
          { label: "Arrives", value: ETA[flow.draft.method] },
          { label: "Category", value: flow.draft.category },
          ...(flow.draft.note ? [{ label: "Memo", value: flow.draft.note }] : []),
          { label: "Fee", value: "$0.00 · Free", tone: "free" as const },
          { label: "Est. rewards", value: `+${money(amount * rewardRate(flow.draft.category))}`, tone: "reward" as const },
          { label: "Balance after", value: money(balance - amount) },
        ];
  return (
    <div className="flow-pane">
      <h2 className="flow-title" id="flow-title">{flow.kind === "deposit" ? "Review deposit" : "Review payment"}</h2>
      <p className="flow-sub">
        {flow.kind === "deposit" ? "Check the details, then confirm to move the funds." : `Make sure everything looks right before sending to ${flow.draft.counterparty}.`}
      </p>
      <strong className="flow-amount">{money(shown)}</strong>
      <FlowTrack from={track.from} to={track.to} state="idle" progress={0} />
      <div className="flow-rows">
        {rows.map((r, i) => (
          <motion.div key={r.label} className={`flow-row ${r.tone ?? ""}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.045, duration: 0.3 }}>
            <span>{r.label}</span><b>{r.value}</b>
          </motion.div>
        ))}
      </div>
      <div className="flow-actions">
        <button type="button" className="ghost-btn" onClick={onBack}>{flow.kind === "deposit" ? "Back" : "Edit"}</button>
        <button type="button" className="solid-btn flow-confirm" onClick={onConfirm} autoFocus>
          <Lock size={14} /> {flow.kind === "deposit" ? `Deposit ${money(amount)}` : `Send ${money(amount)}`}
        </button>
      </div>
    </div>
  );
}

function Processing({ flow, track, onDone }: { flow: FlowState; track: Track; onDone: () => void }) {
  const reduce = useReducedMotion();
  const steps = useMemo(() => stepsFor(flow), [flow]);
  const [index, setIndex] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  const stepMs = reduce ? 200 : 780;
  useEffect(() => {
    if (index >= steps.length) {
      const t = window.setTimeout(() => doneRef.current(), reduce ? 120 : 520);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setIndex(i => i + 1), stepMs);
    return () => window.clearTimeout(t);
  }, [index, steps.length, stepMs, reduce]);

  const amount = flow.kind === "deposit" ? flow.amount : flow.draft.amount;
  const progress = Math.min(1, index / steps.length);
  const finished = index >= steps.length;

  return (
    <div className="flow-pane flow-processing" aria-live="polite">
      <div className="flow-processing-head">
        <span className={`flow-orbit ${finished ? "is-done" : ""}`}><i /><VeyraMark width={20} height={20} /></span>
        <h2 className="flow-title" id="flow-title">{finished ? "Wrapping up…" : flow.kind === "deposit" ? "Adding funds" : "Sending payment"}</h2>
        <p className="flow-sub"><b>{money(amount)}</b> · {Math.round(progress * 100)}% complete</p>
      </div>
      <FlowTrack from={track.from} to={track.to} state={finished ? "done" : "moving"} progress={progress} />
      <div className="flow-progress"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: progress }} transition={{ duration: 0.5, ease }} /></div>
      <ul className="flow-steplist">
        {steps.map((label, i) => {
          const state = i < index ? "done" : i === index ? "active" : "pending";
          return (
            <motion.li key={label} className={state} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
              <span className="flow-step-icon">
                {state === "done" ? (
                  <motion.span className="flow-step-check" initial={{ scale: 0, rotate: -60 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
                    <Check size={12} strokeWidth={3.2} />
                  </motion.span>
                ) : state === "active" ? <span className="flow-step-spin" /> : null}
              </span>
              <span>{label}</span>
            </motion.li>
          );
        })}
      </ul>
      <p className="flow-secure"><ShieldCheck size={14} /> Bank-grade encryption in transit and at rest</p>
    </div>
  );
}

function receiptText(flow: FlowState, r: MoveResult, acct: string) {
  const pad = (k: string) => `${k}:`.padEnd(16);
  const lines = [
    `VEYRA — ${flow.kind === "deposit" ? "DEPOSIT" : "PAYMENT"} RECEIPT`,
    "========================================",
    `${pad("Reference")}${r.reference}`,
    `${pad("Date")}${longDate(r.date)}`,
    `${pad("Amount")}${money(r.amount)}`,
    flow.kind === "deposit" ? `${pad("From")}${sourceById(flow.sourceId).label}` : `${pad("To")}${flow.draft.counterparty}`,
    `${pad("Account")}Checking •••• ${acct}`,
    `${pad("Method")}${flow.kind === "deposit" ? "ACH deposit" : flow.draft.method === "Zelle" ? "Zelle® Instant Payment" : flow.draft.method}`,
  ];
  if (flow.kind === "send") {
    lines.push(`${pad("Category")}${flow.draft.category}`, `${pad("Memo")}${flow.draft.note ?? "—"}`, `${pad("Rewards earned")}${money(r.reward)}`, `${pad("Scout savings")}${money(r.scout)}`);
  }
  lines.push(`${pad("Fee")}$0.00`, `${pad("New balance")}${money(r.balanceAfter)}`, "", "Keep this receipt for your records.");
  return lines.join("\n");
}

function Success({ flow, result, acct, onClose, onAgain }: { flow: FlowState; result: MoveResult; acct: string; onClose: () => void; onAgain: () => void }) {
  const isDeposit = flow.kind === "deposit";
  const amount = useCountUp(result.amount, { from: 0, duration: 900 });
  const newBalance = useCountUp(result.balanceAfter, { from: result.balanceBefore, duration: 1500 });
  const counterparty = flow.kind === "deposit" ? sourceById(flow.sourceId).label : flow.draft.counterparty;
  const rows: Row[] = [
    { label: "Reference", value: result.reference },
    { label: "Date", value: longDate(result.date) },
    { label: isDeposit ? "From" : "To", value: counterparty },
    { label: "Method", value: flow.kind === "deposit" ? "ACH deposit" : flow.draft.method },
    { label: isDeposit ? "Available" : "Arrives", value: flow.kind === "deposit" ? "Now" : ETA[flow.draft.method] },
    { label: "Fee", value: "$0.00", tone: "free" },
    ...(flow.kind === "send" ? [{ label: "Rewards earned", value: `+${money(result.reward)}`, tone: "reward" as const }] : []),
    ...(flow.kind === "send" && result.scout > 0 ? [{ label: "Scout savings", value: `+${money(result.scout)}`, tone: "scout" as const }] : []),
  ];
  const download = () => downloadFile(`veyra-receipt-${result.reference}.txt`, receiptText(flow, result, acct));

  return (
    <div className="flow-pane flow-success">
      <Confetti palette={isDeposit ? CONFETTI_GREEN : CONFETTI_VIOLET} />
      <AnimatedCheck tone={isDeposit ? "green" : "violet"} />
      <motion.h2 className="flow-title" id="flow-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        {isDeposit ? "Funds added" : "Payment sent"}
      </motion.h2>
      <motion.strong className={`flow-amount ${isDeposit ? "is-in" : ""}`} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4, type: "spring", stiffness: 260, damping: 20 }}>
        {isDeposit ? "+" : "−"}{money(amount)}
      </motion.strong>
      <motion.p className="flow-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        {isDeposit ? `Now available in Checking •••• ${acct}` : `On its way to ${counterparty} · ${flow.kind === "send" ? ETA[flow.draft.method].toLowerCase() : ""}`}
      </motion.p>
      {flow.kind === "send" && result.scout > 0 && (
        <motion.div className="scout-found" initial={{ opacity: 0, y: 8, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.95, type: "spring", stiffness: 300, damping: 22 }}>
          <Sparkles size={15} /> <span>Scout found <b className="scout-shimmer">{money(result.scout)}</b> in savings on this payment</span>
        </motion.div>
      )}
      <div className="receipt">
        {rows.map((r, i) => (
          <motion.div key={r.label} className={`receipt-row ${r.tone ?? ""}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 + i * 0.06 }}>
            <span>{r.label}</span><b>{r.value}</b>
          </motion.div>
        ))}
        <motion.div className="receipt-total" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + rows.length * 0.06 }}>
          <span>New balance</span><b>{money(newBalance)}</b>
        </motion.div>
      </div>
      <div className="flow-actions three">
        <button type="button" className="ghost-btn" onClick={download}><Download size={15} /> Receipt</button>
        <button type="button" className="ghost-btn" onClick={onAgain}>{isDeposit ? "Add more" : "Send another"}</button>
        <button type="button" className="solid-btn" onClick={onClose} autoFocus>Done</button>
      </div>
    </div>
  );
}

/* ============================================================
   Provider: owns the modal and exposes openDeposit / startSend
   ============================================================ */
type FlowApi = {
  openDeposit: (amount?: number) => void;
  startSend: (draft: SendDraft, options?: { onComplete?: (result: MoveResult) => void }) => void;
};
const FlowCtx = createContext<FlowApi | null>(null);

export function useMoneyFlow() {
  const ctx = useContext(FlowCtx);
  if (!ctx) throw new Error("useMoneyFlow must be used inside MoneyFlowProvider");
  return ctx;
}

export function MoneyFlowProvider({ children }: { children: ReactNode }) {
  const { account, deposit, sendPayment } = useAcct();
  const toast = useToast();
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [result, setResult] = useState<MoveResult | null>(null);
  const onComplete = useRef<((r: MoveResult) => void) | undefined>(undefined);
  const committed = useRef(false);

  const openDeposit = useCallback((amount = 5000) => {
    committed.current = false;
    setResult(null);
    setFlow({ kind: "deposit", stage: "form", sourceId: SOURCES[0].id, amount });
  }, []);

  const startSend = useCallback((draft: SendDraft, options?: { onComplete?: (r: MoveResult) => void }) => {
    committed.current = false;
    onComplete.current = options?.onComplete;
    setResult(null);
    setFlow({ kind: "send", stage: "review", draft });
  }, []);

  const close = useCallback(() => setFlow(f => (f && f.stage === "processing" ? f : null)), []);
  const goTo = useCallback((stage: Stage) => setFlow(f => (f ? { ...f, stage } : f)), []);

  const finish = useCallback(() => {
    if (!flow || committed.current) return;
    committed.current = true;
    let r: MoveResult;
    try {
      if (flow.kind === "deposit") {
        r = deposit(flow.amount, sourceById(flow.sourceId).label);
      } else {
        r = sendPayment(
          { counterparty: flow.draft.counterparty, amount: flow.draft.amount, category: flow.draft.category, method: flow.draft.method, note: flow.draft.note },
          // Swap in the server's booked receipt (real reference, rewards and
          // any Scout savings) as soon as it arrives.
          booked => setResult(current => (current && current.date === booked.date ? booked : current)),
        );
        onComplete.current?.(r);
      }
      setResult(r);
      setFlow({ ...flow, stage: "success" });
    } catch (err) {
      committed.current = false;
      toast({ tone: "error", title: "Transfer blocked", description: err instanceof Error ? err.message : "Something went wrong." });
      setFlow(null);
    }
  }, [flow, deposit, sendPayment, toast]);

  const open = flow !== null;
  const stage = flow?.stage;

  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    return unlock;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stage !== "processing") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, close]);

  const api = useMemo(() => ({ openDeposit, startSend }), [openDeposit, startSend]);
  const acct = account?.bankDetails.accountNumber.slice(-4) ?? "0000";
  const balance = account?.balance ?? 0;

  let content: ReactNode = null;
  if (flow) {
    const track = trackFor(flow, acct);
    if (flow.stage === "form" && flow.kind === "deposit") {
      content = (
        <DepositForm
          flow={flow}
          balance={balance}
          onSource={id => setFlow(f => (f && f.kind === "deposit" ? { ...f, sourceId: id } : f))}
          onContinue={amount => setFlow(f => (f && f.kind === "deposit" ? { ...f, amount, stage: "review" } : f))}
          onCancel={close}
        />
      );
    } else if (flow.stage === "review") {
      content = <Review flow={flow} balance={balance} track={track} onBack={() => (flow.kind === "deposit" ? goTo("form") : close())} onConfirm={() => goTo("processing")} />;
    } else if (flow.stage === "processing") {
      content = <Processing flow={flow} track={track} onDone={finish} />;
    } else if (flow.stage === "success" && result) {
      content = (
        <Success
          flow={flow}
          result={result}
          acct={acct}
          onClose={close}
          onAgain={() => {
            if (flow.kind === "deposit") {
              committed.current = false;
              setResult(null);
              setFlow({ kind: "deposit", stage: "form", sourceId: flow.sourceId, amount: flow.amount });
            } else {
              close();
            }
          }}
        />
      );
    }
  }

  return (
    <FlowCtx.Provider value={api}>
      {children}
      {createPortal(
        <AnimatePresence>
          {flow && (
            <motion.div key="flow-scrim" className="flow-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
              <motion.div className={`flow-modal kind-${flow.kind}`} role="dialog" aria-modal="true" aria-labelledby="flow-title"
                initial={{ opacity: 0, y: 48, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 32, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}>
                <div className="flow-head">
                  <StageDots kind={flow.kind} stage={flow.stage} />
                  <button type="button" className="flow-close" onClick={close} aria-label="Close" disabled={flow.stage === "processing"}><X size={16} /></button>
                </div>
                <div className="flow-body">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={flow.stage} className="flow-stage" initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -32 }} transition={{ duration: 0.28, ease }}>
                      {content}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </FlowCtx.Provider>
  );
}
