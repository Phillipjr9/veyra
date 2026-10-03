/**
 * Admin console shell — "control room" design.
 *
 * The third visual language on purpose: near-black canvas, an icon rail for
 * modules, a status bar carrying environment signals, and monospace data. It
 * shares nothing with the personal (warm, airy, pill nav) or business (dense
 * treasury, dark rail on light canvas) dashboards but the data it reports — an
 * operator should know which surface they are on from across the room.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, LogOut, Menu, Radio, X } from "lucide-react";
import { Logo } from "../../components/common";
import { BackButton } from "../../components/BackButton";

export type AdminModule = { id: string; label: string; icon: ReactNode; perm?: string; count?: number };

export function AdminShell({
  user, roleLabel, modules, activeTab, onSelect, onSignOut, health, uptimeSec, children,
}: {
  user: { name: string; email: string; avatarUrl?: string };
  roleLabel: string;
  modules: AdminModule[];
  activeTab: string;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  health: "checking" | "online" | "offline";
  uptimeSec: number | null;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const uptime = uptimeSec === null ? null : uptimeSec > 3600
    ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
    : `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

  return (
    <div className={`admin-app ${railOpen ? "rail-open" : ""}`}>
      <aside className="cr-rail" aria-label="Admin modules">
        <div className="cr-rail-brand">
          <Logo to="/app/superadmin" inverse />
          <span className="cr-rail-tag">OPS</span>
        </div>
        <nav className="cr-rail-nav">
          {modules.map(m => (
            <button
              key={m.id}
              type="button"
              className={`cr-rail-item ${activeTab === m.id ? "on" : ""}`}
              onClick={() => onSelect(m.id)}
              aria-current={activeTab === m.id ? "page" : undefined}
            >
              <span className="cr-rail-icon">{m.icon}</span>
              <span className="cr-rail-label">{m.label}</span>
              {m.count !== undefined && <span className="cr-rail-count">{m.count}</span>}
              {activeTab === m.id && <span className="cr-rail-caret" />}
            </button>
          ))}
        </nav>
        <div className="cr-rail-foot">
          <span className={`cr-signal ${health}`}>
            <Radio size={12} />
            {health === "online" ? `API online${uptime ? ` · ${uptime}` : ""}` : health === "offline" ? "API offline" : "checking…"}
          </span>
          <Link to="/app" className="cr-rail-link"><Activity size={13} /> Member view</Link>
          <button type="button" className="cr-rail-link" onClick={onSignOut}><LogOut size={13} /> Sign out</button>
        </div>
      </aside>

      <button type="button" className="cr-scrim" aria-label="Close modules" onClick={() => setRailOpen(false)} />

      <div className="cr-body">
        <header className="cr-bar">
          <button type="button" className="cr-burger" onClick={() => setRailOpen(o => !o)} aria-expanded={railOpen} aria-label="Toggle modules">
            {railOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <BackButton />
          <div className="cr-bar-left">
            <span className="cr-env">PRODUCTION</span>
            <span className="cr-sep" />
            <strong>{(modules.find(m => m.id === activeTab)?.label) ?? "Console"}</strong>
          </div>
          <div className="cr-bar-right">
            <span className={`cr-led ${health}`} title={`API ${health}`} />
            <span className="cr-identity">
              <strong>{user.name}</strong>
              <small>{roleLabel} · {user.email}</small>
            </span>
            <span className="cr-avatar"><img src={user.avatarUrl || "/images/avatar-3d-default.svg"} alt="" /></span>
          </div>
        </header>
        <main className="cr-main" onClick={() => railOpen && setRailOpen(false)}>{children}</main>
      </div>
    </div>
  );
}
