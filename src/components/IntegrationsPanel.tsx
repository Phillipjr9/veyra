import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../lib/api";

type Check = { label: string; done: boolean };
type Integration = { id: string; label: string; group: string; description: string; on: boolean; ready: boolean; available: boolean; checks: Check[] };

/**
 * Administrator control of every integration. Switching one off hides it from
 * members immediately (used during upgrades). Setup checks are shown here only,
 * because status belongs to administrators, not members.
 */
export function IntegrationsPanel() {
  const [items, setItems] = useState<Integration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    apiGet<{ integrations: Integration[] }>("/api/admin/integrations")
      .then(data => { if (live) setItems(data.integrations); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Integrations could not be loaded."); });
    return () => { live = false; };
  }, []);

  const toggle = async (item: Integration) => {
    setBusy(item.id); setError("");
    try {
      const data = await apiPut<{ integrations: Integration[] }>(`/api/admin/integrations/${item.id}`, { enabled: !item.on });
      setItems(data.integrations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The switch could not be changed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const groups = Array.from(new Set((items ?? []).map(item => item.group)));

  return (
    <section className="panel admin-panel" aria-labelledby="integrations-heading">
      <div className="panel-head">
        <div>
          <h2 id="integrations-heading">Integrations and features</h2>
          <span className="panel-sub">Switch any feature off during an upgrade. Members stop seeing it at once. Changes are audit-logged.</span>
        </div>
      </div>
      {error && <p role="alert" className="banking-error">{error}</p>}
      {!items && !error && <p role="status">Loading integrations…</p>}
      {groups.map(group => (
        <div key={group} className="integration-group">
          <h3>{group}</h3>
          <ul className="integration-list">
            {(items ?? []).filter(item => item.group === group).map(item => (
              <li key={item.id} className="integration-row">
                <div className="integration-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                  {item.checks.length > 0 && (
                    <ul className="integration-checks" aria-label={`${item.label} setup checks`}>
                      {item.checks.map(check => <li key={check.label}><span className={`status-pill ${check.done ? "active" : "overdue"}`}><span className="dot" />{check.done ? "Done" : "Needed"}</span> {check.label}</li>)}
                    </ul>
                  )}
                </div>
                <div className="integration-state">
                  <span className={`status-pill ${item.available ? "active" : "pending"}`}><span className="dot" />{item.available ? "Live for members" : item.on ? "Switched on, setup incomplete" : "Switched off"}</span>
                  <label className="integration-switch">
                    <input type="checkbox" role="switch" aria-label={`${item.label} switch`} checked={item.on} disabled={busy === item.id} onChange={() => void toggle(item)} />
                    <span>{item.on ? "On" : "Off"}</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
