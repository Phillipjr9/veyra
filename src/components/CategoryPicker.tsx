import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Tag, type LucideIcon } from "lucide-react";
import "../styles/category-picker.css";

export type CategoryOption = { value: string; label: string; description: string; Icon: LucideIcon; rate?: number };

/** 0.045 → "4.5", 0.04 → "4" — whole and fractional rates without trailing zeros. */
const percent = (rate: number) => String(Number((rate * 100).toFixed(2)));

/**
 * Category chooser for outgoing payments. It is a listbox that expands in place
 * (the transfer form scrolls, so a floating panel would be clipped), and each
 * choice shows what it covers and the cash back it earns.
 * Keyboard: arrows/Home/End move, Enter or Space chooses, Escape closes.
 */
export function CategoryPicker({ id, value, options, onChange, disabled = false, placeholder = "Choose a category", required = false }: {
  id?: string; value: string; options: CategoryOption[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId(), labelId = useId();
  const current = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => {
    if (open) items.current[Math.max(0, options.findIndex(option => option.value === value))]?.focus();
    // Focus the current choice once per opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const choose = (next: string) => { if (next !== value) onChange(next); close(true); };
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    const active = items.current.indexOf(document.activeElement as HTMLButtonElement);
    if (active < 0) return;
    const last = options.length - 1;
    const next = e.key === "ArrowDown" ? Math.min(last, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next >= 0) { e.preventDefault(); items.current[next]?.focus(); }
  }

  const tile = (Icon: LucideIcon) => <span className="cat-picker-tile" aria-hidden="true"><Icon size={17} /></span>;
  return <div className="cat-picker" ref={root} onKeyDown={onKey}>
    <button type="button" id={id} ref={trigger} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      aria-required={required || undefined} aria-labelledby={`${labelId} ${id ?? ""}-value`} disabled={disabled || !options.length}
      className={`cat-picker-trigger ${open ? "is-open" : ""}`} onClick={() => setOpen(o => !o)}>
      {tile(current?.Icon ?? Tag)}
      <span className="cat-picker-text">
        <strong id={`${id ?? labelId}-value`}>{current ? current.label : placeholder}</strong>
        <small>{current ? (current.rate !== undefined ? `${percent(current.rate)}% cash back · ${current.description}` : current.description) : "Helps track where money goes"}</small>
      </span>
      <ChevronDown size={16} className="cat-picker-chevron" aria-hidden="true" />
    </button>
    <span id={labelId} hidden>Category</span>
    {open && <div className="cat-picker-list" id={listId} role="listbox" aria-labelledby={labelId}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return <button key={option.value || "none"} type="button" role="option" aria-selected={selected} className={`cat-picker-option ${selected ? "is-selected" : ""}`}
          ref={el => { items.current[index] = el; }} onClick={() => choose(option.value)}>
          {tile(option.Icon)}
          <span className="cat-picker-text"><strong>{option.label}</strong><small>{option.description}</small></span>
          {option.rate !== undefined && <span className="cat-picker-rate">{percent(option.rate)}%</span>}
          {selected && <Check size={16} aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </div>;
}
