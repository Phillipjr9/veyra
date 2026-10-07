import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Building2, Check, ChevronDown, CircleHelp, CreditCard, FileCheck2, Landmark, ArrowDownLeft, WalletCards, type LucideIcon } from "lucide-react";
import { quoteFee } from "../../shared/fees";
import { ZelleLogo } from "./MoneyFlow";

export type PickerMethod = { id: string; label: string; kind?: string; unavailable?: boolean };

const CARD_FEE_PERCENT = quoteFee("card_deposit", 10_000).rateBps / 100;

// One icon and one short plain-English hint per funding kind. Zelle keeps its
// own logo so members recognise it at a glance.
const KIND: Record<string, { Icon: LucideIcon; hint: string }> = {
  ach: { Icon: Landmark, hint: "Link a bank account" },
  card: { Icon: CreditCard, hint: `Debit card · ${CARD_FEE_PERCENT}% fee` },
  zelle: { Icon: ArrowDownLeft, hint: "Zelle® · instant, no fee" },
  bank: { Icon: ArrowDownLeft, hint: "Transfer from another bank" },
  wire: { Icon: Building2, hint: "Incoming domestic wire" },
  direct_deposit: { Icon: WalletCards, hint: "Payroll or employer deposit" },
  check: { Icon: FileCheck2, hint: "Mail-in check deposit" },
  other: { Icon: CircleHelp, hint: "Instructions from your administrator" },
};
const fallback = { Icon: CircleHelp, hint: "Funding method" };
const meta = (kind?: string) => KIND[kind ?? ""] ?? fallback;

function MethodTile({ kind }: { kind?: string }) {
  if (kind === "zelle") return <span className="funding-picker-tile funding-icon-zelle" aria-hidden="true"><ZelleLogo size={28} /></span>;
  const { Icon } = meta(kind);
  return <span className={`funding-picker-tile funding-icon-${kind ?? "other"}`} aria-hidden="true"><Icon size={18} /></span>;
}

/**
 * Funding method chooser. A listbox that expands in place (not as an overlay),
 * because the details form scrolls and a floating panel would be clipped.
 * Keyboard: arrows/Home/End move, Enter or Space chooses, Escape closes.
 */
export function FundingMethodPicker({ methods, selected, disabled, onChange }: {
  methods: PickerMethod[]; selected: string; disabled: boolean; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId(), labelId = useId(), valueId = useId();
  const ready = methods.filter(m => !m.unavailable), setup = methods.filter(m => m.unavailable);
  const ordered = [...ready, ...setup];
  const current = methods.find(m => m.id === selected);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => {
    if (open) options.current[Math.max(0, ordered.findIndex(m => m.id === selected))]?.focus();
    // Focus the current choice once per opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (id: string) => { if (id !== selected) onChange(id); close(true); };
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    const active = options.current.indexOf(document.activeElement as HTMLButtonElement);
    if (active < 0) return;
    const last = ordered.length - 1;
    const next = e.key === "ArrowDown" ? Math.min(last, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next >= 0) { e.preventDefault(); options.current[next]?.focus(); }
  }

  const option = (m: PickerMethod, index: number) => (
    <button key={m.id} type="button" role="option" aria-selected={m.id === selected} id={`${listId}-${index}`}
      ref={el => { options.current[index] = el; }} className={`funding-picker-option ${m.unavailable ? "is-setup" : ""} ${m.id === selected ? "is-selected" : ""}`}
      onClick={() => choose(m.id)}>
      <MethodTile kind={m.kind} />
      <span className="funding-picker-text"><strong>{m.label}</strong><small>{meta(m.kind).hint}</small></span>
      {m.unavailable ? <span className="funding-badge">Setup needed</span> : m.id === selected ? <Check size={16} aria-hidden="true" /> : null}
    </button>
  );

  return <div className="funding-picker" ref={root} onKeyDown={onKey}>
    <button type="button" id="funding-method" ref={trigger} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      aria-labelledby={`${labelId} ${valueId}`} disabled={disabled || !methods.length} className={`funding-picker-trigger ${open ? "is-open" : ""}`}
      onClick={() => setOpen(o => !o)}>
      <MethodTile kind={current?.kind} />
      <span className="funding-picker-text"><strong id={valueId}>{current?.label ?? "No funding methods available"}</strong><small>{current ? meta(current.kind).hint : "Ask your administrator to enable one"}</small></span>
      <ChevronDown size={16} className="funding-picker-chevron" aria-hidden="true" />
    </button>
    <span id={labelId} hidden>Funding method</span>
    {open && <div className="funding-picker-list" id={listId} role="listbox" aria-labelledby={labelId}>
      {ready.length > 0 && <div role="group" aria-label={setup.length ? "Ready now" : "Available methods"}>
        <p className="funding-picker-group" aria-hidden="true">{setup.length ? "Ready now" : "Available methods"}</p>
        {ready.map((m, i) => option(m, i))}
      </div>}
      {setup.length > 0 && <div role="group" aria-label="Needs setup">
        <p className="funding-picker-group" aria-hidden="true">Needs setup</p>
        {setup.map((m, i) => option(m, ready.length + i))}
      </div>}
    </div>}
  </div>;
}
