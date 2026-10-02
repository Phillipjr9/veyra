import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Info, Sparkles, X } from "lucide-react";

export type ToastTone = "success" | "info" | "error" | "scout";
export type ToastInput = { title: string; description?: string; tone?: ToastTone; duration?: number };
type ToastItem = { id: number; title: string; description?: string; tone: ToastTone; duration: number };

const ICONS: Record<ToastTone, ReactNode> = {
  success: <Check size={15} strokeWidth={2.6} />,
  info: <Info size={15} />,
  error: <Info size={15} />,
  scout: <Sparkles size={15} />,
};

const ToastCtx = createContext<(toast: ToastInput) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), []);

  const push = useCallback(
    (toast: ToastInput) => {
      counter.current += 1;
      const item: ToastItem = {
        id: counter.current,
        title: toast.title,
        description: toast.description,
        tone: toast.tone ?? "info",
        duration: toast.duration ?? 3800,
      };
      setItems(list => [...list.slice(-2), item]);
      window.setTimeout(() => dismiss(item.id), item.duration);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map(t => (
            <motion.div
              key={t.id}
              layout
              className={`toast toast-${t.tone}`}
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.22 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              <span className="toast-icon">{ICONS[t.tone]}</span>
              <div className="toast-body">
                <strong>{t.title}</strong>
                {t.description && <p>{t.description}</p>}
              </div>
              <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={14} />
              </button>
              <motion.i
                className="toast-progress"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: t.duration / 1000, ease: "linear" }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
