import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

export function formatSsn(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)].filter(Boolean).join("-");
}
const digitCount = (text: string) => text.replace(/\D/g, "").length;
const caretFor = (text: string, count: number) => {
  let index = 0, digits = 0;
  while (index < text.length && digits < count) { if (/\d/.test(text[index])) digits++; index++; }
  return index;
};

/** Display masking only; the original digits still go to the existing validated application endpoint. */
export function SsnField({ id, value, onChange, label = "SSN" }: {
  id: string; value: string; onChange: (value: string) => void; label?: string;
}) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const formatted = formatSsn(value);
  useLayoutEffect(() => {
    if (caret.current !== null && input.current && input.current === document.activeElement) {
      input.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });
  function update(raw: string, digitsBeforeCaret: number) {
    const next = formatSsn(raw);
    caret.current = caretFor(next, Math.min(9, digitsBeforeCaret));
    onChange(next);
  }
  function deleteSeparator(event: KeyboardEvent<HTMLInputElement>) {
    const el = event.currentTarget, position = el.selectionStart ?? 0;
    if (position !== el.selectionEnd) return;
    const backward = event.key === "Backspace" && formatted[position - 1] === "-";
    const forward = event.key === "Delete" && formatted[position] === "-";
    if (!backward && !forward) return;
    event.preventDefault();
    const digits = formatted.replace(/\D/g, "");
    const before = digitCount(formatted.slice(0, position));
    const remove = backward ? before - 1 : before;
    update(digits.slice(0, remove) + digits.slice(remove + 1), backward ? before - 1 : before);
  }
  return <>
    <div className="pw-field ssn-field">
      <input ref={input} id={id} type={shown ? "text" : "password"} inputMode="numeric" autoComplete="off"
        autoCorrect="off" spellCheck={false} required pattern="[0-9]{3}-[0-9]{2}-[0-9]{4}" maxLength={11}
        placeholder="000-00-0000" value={formatted} aria-describedby={`${id}-hint`} onKeyDown={deleteSeparator}
        onChange={event => update(event.target.value, digitCount(event.target.value.slice(0, event.target.selectionStart ?? event.target.value.length)))}
        onPaste={event => {
          event.preventDefault();
          const el = event.currentTarget, start = el.selectionStart ?? 0, end = el.selectionEnd ?? start;
          const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
          update(formatted.slice(0, start) + pasted + formatted.slice(end), digitCount(formatted.slice(0, start)) + pasted.length);
        }} />
      <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${label}`} aria-controls={id} aria-pressed={shown}
        onClick={() => setShown(current => !current)}>{shown ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
    <small className="ssn-hint" id={`${id}-hint`}>9 digits · dashes added automatically · hidden by default</small>
  </>;
}
