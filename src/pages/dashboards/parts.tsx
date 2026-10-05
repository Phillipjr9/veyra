/**
 * Pieces the three dashboards share.
 *
 * The three surfaces are deliberately different designs (personal = warm and
 * airy, business = the operating rail and treasury top bar, admin = dark control
 * room), so what is shared here is behaviour, not looks: the notification menu,
 * and small primitives (sparkline, donut, delta) that each design renders in its
 * own way.
 */
import type { ReactNode, RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router-dom";
import { Bell, CreditCard, FileText, Info, ShieldAlert, ShieldCheck, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { ease } from "../../components/common";
import { shortDate, useAcct, type NotificationItem } from "../../lib/store";

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: string };
export type NavGroup = { title: string; items: NavItem[] };

const NOTE_ICONS: Record<NotificationItem["type"], ReactNode> = {
  scout: <Sparkles size={14} />,
  card: <CreditCard size={14} />,
  transfer: <TrendingUp size={14} />,
  security: <ShieldCheck size={14} />,
  invoice: <FileText size={14} />,
  info: <Info size={14} />,
};

export const NOTE_ROUTES: Record<NotificationItem["type"], string> = {
  scout: "/app/scout",
  card: "/app/cards",
  transfer: "/app/transactions",
  security: "/app/security",
  invoice: "/app/invoices",
  info: "/app",
};

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return shortDate(ts);
}

/**
 * The bell + panel. Markup keeps the original `notif-*` class names so both
 * designs inherit the interaction, while the shells restyle it in CSS.
 */
export function NotificationsMenu({
  items, unread, open, ringing, containerRef, onToggle, onMarkAll, onOpen,
}: {
  items: NotificationItem[];
  unread: number;
  open: boolean;
  ringing: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onMarkAll: () => void;
  onOpen: (item: NotificationItem) => void;
}) {
  return (
    <div className="notif-wrap" ref={containerRef}>
      <button
        type="button"
        className={`icon-btn ${ringing ? "is-ringing" : ""}`}
        onClick={onToggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell size={17} />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="dot"
              className="notif-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 600, damping: 24 }}
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="notif-panel"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.2, ease }}
          >
            <div className="notif-head">
              <strong>Notifications</strong>
              {unread > 0 && <button type="button" className="text-btn" onClick={onMarkAll}>Mark all read</button>}
            </div>
            <div className="notif-list">
              {items.length ? (
                items.slice(0, 8).map((n, i) => (
                  <motion.button
                    type="button"
                    key={n.id}
                    className={`notif-item ${n.read ? "" : "unread"}`}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => onOpen(n)}
                  >
                    <span className={`notif-icon t-${n.type}`}>{NOTE_ICONS[n.type] ?? <Bell size={14} />}</span>
                    <span className="notif-body">
                      <strong>{n.title}</strong>
                      <span className="notif-detail">{n.detail}</span>
                      <small>{timeAgo(n.time)}</small>
                    </span>
                    {!n.read && <span className="notif-unread-dot" />}
                  </motion.button>
                ))
              ) : (
                <p className="notif-empty">You're all caught up.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inline sparkline — used at different sizes/weights by each design. */
export function Sparkline({ data, className = "", stroke = "currentColor" }: { data: number[]; className?: string; stroke?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 30 - ((v - min) / span) * 26]).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  return (
    <svg className={`spark ${className}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Donut progress, drawn with strokes so it scales cleanly in both layouts. */
export function Ring({ value, size = 56, stroke = 6, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const pct = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track, rgba(120,110,150,.18))" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke}
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{children ?? `${Math.round(pct * 100)}%`}</span>
    </span>
  );
}

/** Signed delta with an arrow, for KPI tiles. */
export function Delta({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
}

/* ============================================================
   Account suspension banner
   ============================================================ */

/**
 * The suspension notice, pinned to the top of the member's own dashboard the
 * moment an admin restricts the account — and only then.
 *
 * This is one of the few banners that is deliberately *not* dismissible: the
 * member's outgoing transfers are blocked, so the reason has to stay in front
 * of them until the hold is lifted. The wording is exactly what the operator
 * chose in the console (the server stored that sentence at suspend time), the
 * account type decides whether it says "account" or "business account", and
 * every route out of the state is offered: contact support, review security,
 * and the account status page.
 */
export function SuspensionBanner() {
  const { account, user } = useAcct();
  if (!account || account.accountStatus !== "restricted") return null;

  const business = user?.accountType === "business";
  const reason = account.statusReason?.trim()
    || "Your account is on hold while our compliance team reviews it.";
  const effectiveDate = account.statusChangedAt ? shortDate(account.statusChangedAt) : null;

  return (
    <motion.section
      className="suspension-banner"
      role="alert"
      aria-label="Account suspended"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
    >
      <span className="suspension-banner-icon" aria-hidden="true">
        <ShieldAlert size={20} />
      </span>
      <div className="suspension-banner-copy">
        <strong>{business ? "Your business account is suspended" : "Your account is suspended"}</strong>
        <p className="suspension-banner-reason">{reason}</p>
        <span className="suspension-banner-note">
          Outgoing transfers and sends are paused{business ? " for this business" : ""} while we review. Money can still
          be received, and your balance is untouched.
        </span>
        <em className="suspension-banner-meta">
          {effectiveDate ? `Suspension effective ${effectiveDate}` : "Suspension currently active"}
        </em>
      </div>
      <div className="suspension-banner-actions">
        <Link to="/app/support-desk" className="solid-btn sm">Contact support</Link>
        <Link to="/app/security" className="ghost-btn sm">Review security</Link>
      </div>
    </motion.section>
  );
}
