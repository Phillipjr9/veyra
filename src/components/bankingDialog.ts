import { useEffect, useRef } from "react";
import { lockScroll } from "../lib/scrollLock";

export function useBankingDialog(close: () => void, busy: boolean) {
  const ref = useRef<HTMLElement>(null), state = useRef({ close, busy });
  state.current = { close, busy };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockScroll(); ref.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.current.busy) {e.preventDefault();state.current.close();}
      if (e.key !== 'Tab') return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') ?? [])].filter(el => el.getClientRects().length > 0 && !el.closest('fieldset:disabled'));
      if (!items.length) { e.preventDefault(); return; }
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey && (document.activeElement === first || document.activeElement === ref.current || !ref.current?.contains(document.activeElement))) {e.preventDefault();last.focus();}
      else if(!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current || !ref.current?.contains(document.activeElement))) {e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);
    return () => { document.removeEventListener('keydown',keydown); unlock(); previous?.focus(); };
  },[]);
  return ref;
}
