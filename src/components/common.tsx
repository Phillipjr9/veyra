import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Snowflake, Wifi } from "lucide-react";
import { VeyraMark } from "./VeyraMark";

export const ease = [0.22, 1, 0.36, 1] as const;

export function Logo({ compact = false, inverse = false, to = "/" }: { compact?: boolean; inverse?: boolean; to?: string | null }) {
  const mark = (
    <>
      <VeyraMark className="logo-mark" title="Veyra logo icon" />
      {!compact && <span>veyra</span>}
    </>
  );
  const cls = `logo ${inverse ? "logo-inverse" : ""}`;
  if (!to) return <span className={cls} aria-label="Veyra">{mark}</span>;
  return <Link to={to} className={cls} aria-label="Veyra home">{mark}</Link>;
}

export function Btn({ children, to = "/signup", light = false, className = "", arrow = true, onClick, type }: {
  children: ReactNode; to?: string; light?: boolean; className?: string; arrow?: boolean;
  onClick?: () => void; type?: "button" | "submit";
}) {
  const cls = `button ${light ? "button-light" : ""} ${className}`;
  if (onClick || type) return <button type={type ?? "button"} className={cls} onClick={onClick}>{children}{arrow && <ArrowRight size={15} />}</button>;
  return <Link className={cls} to={to}>{children}{arrow && <ArrowRight size={15} />}</Link>;
}

export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 38 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12%" }} transition={{ duration: .75, delay, ease }}>
      {children}
    </motion.div>
  );
}

/** Smoothly tweens a number toward its latest value with requestAnimationFrame. */
export function useCountUp(value: number, options: { duration?: number; from?: number } = {}) {
  const { duration = 750, from } = options;
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(from ?? value);
  const shownRef = useRef(from ?? value);

  useEffect(() => {
    const start = shownRef.current;
    const target = value;
    if (reduce || Math.abs(target - start) < 0.005) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = start + (target - start) * eased;
      shownRef.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduce]);

  return shown;
}

const usd = (n: number, cents: boolean) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export function AnimatedMoney({ value, className = "animated-money", cents = false, fromZero = false, duration }: {
  value: number; className?: string; cents?: boolean; fromZero?: boolean; duration?: number;
}) {
  const shown = useCountUp(value, { duration, from: fromZero ? 0 : undefined });
  return <strong className={className}>{usd(shown, cents)}</strong>;
}

export function AnimatedNumber({ value, className, decimals = 0, suffix = "" }: { value: number; className?: string; decimals?: number; suffix?: string }) {
  const shown = useCountUp(value, { from: 0, duration: 900 });
  return <strong className={className}>{shown.toFixed(decimals)}{suffix}</strong>;
}

/**
 * Card artwork sized with container-query units so every element keeps its
 * proportions from a 140px floating card up to a full-width dashboard tile.
 */
export function VirtualCard({ small = false, label = "Business", holder = "Hana Park", last4 = "2903", number, exp = "09/28", cvv, frozen = false, flipped = false, type = "virtual" }: {
  small?: boolean; label?: string; holder?: string; last4?: string; number?: string; exp?: string; cvv?: string;
  frozen?: boolean; flipped?: boolean; type?: "virtual" | "physical";
}) {
  const masked = `•••• •••• •••• ${last4}`;
  return (
    <div className={`vcard ${small ? "vcard-small" : ""} ${frozen ? "is-frozen" : ""}`}>
      <motion.div className="vcard-flipper" initial={false} animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: .8, ease }}>
        <div className={`vcard-face vcard-front ${type === "physical" ? "is-metal" : ""}`}>
          <div className="vcard-grain" />
          <div className="vcard-shine" />
          <div className="vcard-inner">
            <div className="vcard-top">
              <span className="vcard-brand" aria-label="Veyra">
                <VeyraMark className="vcard-brand-mark" />
                <b>veyra</b>
              </span>
              <span className="vcard-product"><small>{type === "physical" ? "Business debit" : "Virtual debit"}</small><b>{label}</b></span>
            </div>
            <div className="vcard-mid">
              <svg className="vcard-chip" viewBox="0 0 44 34" aria-label="EMV chip">
                <rect x=".75" y=".75" width="42.5" height="32.5" rx="6" fill="url(#chipGold)" stroke="rgba(70,52,20,.35)" strokeWidth="1.5"/>
                <path d="M15 1v32M29 1v32M1 12h13l5 5-5 5H1M43 12H30l-5 5 5 5h13" fill="none" stroke="rgba(70,52,20,.4)" strokeWidth="1.25"/>
                <defs><linearGradient id="chipGold" x1="2" y1="1" x2="42" y2="33"><stop stopColor="#f5e7af"/><stop offset=".52" stopColor="#cdbb78"/><stop offset="1" stopColor="#f4e8b5"/></linearGradient></defs>
              </svg>
              <Wifi className="vcard-contactless" />
            </div>
            <div className="vcard-number">{masked}</div>
            <div className="vcard-bottom">
              <div className="vcard-holder">
                <small>Cardholder</small>
                <strong>{holder}</strong>
              </div>
              <div className="vcard-exp"><small>Valid thru</small><b>{exp}</b></div>
              <span className="vcard-network" aria-label="Arc debit network"><i /><i /><b>arc</b><small>DEBIT</small></span>
            </div>
          </div>
          <div className="vcard-frost" aria-hidden={!frozen}>
            <Snowflake />
            <span>Frozen</span>
          </div>
        </div>
        <div className="vcard-face vcard-back" aria-hidden={!flipped}>
          <div className="vcard-grain" />
          <div className="vcard-stripe" />
          <div className="vcard-back-body">
            <div className="vcard-back-help">Authorized signature · Not valid unless signed</div>
            <div className="vcard-sig"><i><span>{holder}</span></i><b>{cvv ?? "•••"}</b></div>
            <div className="vcard-back-number">{number ?? masked}</div>
            <div className="vcard-back-row"><span>Exp {exp}</span><span>Debit · Customer care 1 800 555 0198</span></div>
            <div className="vcard-back-brand"><span>veyra</span><i /><i /><b>arc</b></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** Scrolls to top on route change, or to the hash target when one is present. */
export function ScrollManager({ pathname, hash }: { pathname: string; hash: string }) {
  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);
  return null;
}
