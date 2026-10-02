import { useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import {
  Users, CreditCard, ShieldAlert,
  RefreshCw, Check, Search, Lock,
  FileText, Activity, AlertOctagon, UserCheck
} from "lucide-react";
import { useAuth, getUsers } from "../lib/auth";
import { useAcct, money, longDate } from "../lib/store";
import { useToast } from "../components/Toast";

export function SuperAdminPage() {
  const { user } = useAuth();
  const { account, advanceDispute, toggleFreeze, exportCSV, adminAdjustBalance } = useAcct();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"overview" | "users" | "ledger" | "cards" | "disputes" | "system">("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [systemFrozen, setSystemFrozen] = useState(false);
  const [interestRate, setInterestRate] = useState("4.25");
  const [adjustModal, setAdjustModal] = useState(false);
  const [targetUser, setTargetUser] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<"credit" | "debit">("credit");
  const [adjustMemo, setAdjustMemo] = useState("");

  // Protect route
  if (user?.role !== "superadmin" && user?.email !== "admin@veyra.com") {
    return <Navigate to="/app" replace />;
  }

  const allUsers = getUsers();
  const txns = account?.transactions || [];
  const cards = account?.cards || [];
  const disputes = account?.disputes || [];

  const totalPlatformVolume = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalUsersCount = allUsers.length;
  const activeCardsCount = cards.filter(c => !c.frozen).length;

  const filteredUsers = useMemo(() => {
    return allUsers.filter(u =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.business.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allUsers, searchTerm]);

  const handleSystemHaltToggle = () => {
    setSystemFrozen(prev => !prev);
    toast({
      tone: systemFrozen ? "success" : "error",
      title: systemFrozen ? "Core Payment Gateway Resumed" : "EMERGENCY: Payment Rails Halted",
      description: systemFrozen ? "All transaction flows operational." : "All outgoing wire and card authorizations paused.",
    });
  };

  const handleCommitAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(adjustAmount);
    if (!val || val <= 0) return;
    adminAdjustBalance(val, `${adjustMemo || "Administrative override"} · ${targetUser?.name || "Member"}`, adjustType);
    setAdjustModal(false);
    setAdjustAmount("");
    setAdjustMemo("");
    toast({
      tone: "success",
      title: `Ledger Adjustment Succeeded`,
      description: `${adjustType === "credit" ? "+" : "−"}${money(val)} recorded for ${targetUser?.name || "Account"}.`,
    });
  };

  return (
    <div className="app-page superadmin-page">
      {/* Super Admin Top Header */}
      <header className="app-head admin-head">
        <div>
          <span className="admin-master-badge">
            <AlertOctagon size={13} /> MASTER SUPER ADMIN CONSOLE
          </span>
          <h1>System Control & Oversight</h1>
          <p className="app-eyebrow">
            Logged in as {user.name} ({user.email}) · Full Ledger Privileges · Node 01-US-WEST
          </p>
        </div>

        <div className="admin-head-controls">
          <button
            type="button"
            className={`admin-emergency-btn ${systemFrozen ? "active-halt" : ""}`}
            onClick={handleSystemHaltToggle}
          >
            <AlertOctagon size={15} />
            {systemFrozen ? "Resume Payment Rails" : "Emergency Rail Freeze"}
          </button>
          <button type="button" className="ghost-btn" onClick={() => exportCSV()}>
            <FileText size={14} /> Global Ledger CSV
          </button>
        </div>
      </header>

      {/* KPI Overview Strip */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <span className="kpi-label">Registered Profiles</span>
          <strong className="kpi-val">{totalUsersCount}</strong>
          <small className="kpi-sub"><UserCheck size={12} /> Personal & Business accounts</small>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label">Total Platform Volume</span>
          <strong className="kpi-val">{money(totalPlatformVolume)}</strong>
          <small className="kpi-sub"><Activity size={12} /> Real-time settled flow</small>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label">Active Plastic & Virtual Cards</span>
          <strong className="kpi-val">{activeCardsCount} / {cards.length}</strong>
          <small className="kpi-sub"><CreditCard size={12} /> {cards.length - activeCardsCount} frozen</small>
        </div>
        <div className="admin-kpi-card">
          <span className="kpi-label">Open Risk Disputes</span>
          <strong className={`kpi-val ${disputes.length > 0 ? "warn-red" : ""}`}>{disputes.length}</strong>
          <small className="kpi-sub"><ShieldAlert size={12} /> Awaiting arbitrator review</small>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="admin-tabs-nav">
        {[
          { id: "overview", label: "Executive Overview", icon: <Activity size={15} /> },
          { id: "users", label: `User Directory (${allUsers.length})`, icon: <Users size={15} /> },
          { id: "ledger", label: `Transaction Log (${txns.length})`, icon: <FileText size={15} /> },
          { id: "cards", label: `Card Fleet (${cards.length})`, icon: <CreditCard size={15} /> },
          { id: "disputes", label: `Arbitration (${disputes.length})`, icon: <ShieldAlert size={15} /> },
          { id: "system", label: "System Parameters", icon: <Lock size={15} /> },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            className={`admin-tab-btn ${activeTab === t.id ? "on" : ""}`}
            onClick={() => setActiveTab(t.id as any)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: EXECUTIVE OVERVIEW */}
      {activeTab === "overview" && (
        <div className="admin-tab-pane">
          <div className="admin-grid-split">
            <section className="panel admin-panel">
              <div className="panel-head">
                <div>
                  <h2>System Health & Gateway Status</h2>
                  <span className="panel-sub">Real-time bank partner and card network telemetry</span>
                </div>
              </div>
              <div className="telemetry-list">
                <div className="telemetry-row">
                  <span>ACH Batch Settlement (Evolve Bank & Trust)</span>
                  <span className="status-pill active"><Check size={11} /> 100% Operational</span>
                </div>
                <div className="telemetry-row">
                  <span>Zelle® Instant Payment Network</span>
                  <span className="status-pill active"><Check size={11} /> Sub-Second P99</span>
                </div>
                <div className="telemetry-row">
                  <span>Visa® Card Tokenization Service</span>
                  <span className="status-pill active"><Check size={11} /> Healthy (0.01% error)</span>
                </div>
                <div className="telemetry-row">
                  <span>Scout AI™ Automated Negotiation Worker</span>
                  <span className="status-pill active"><Check size={11} /> Idle Listening</span>
                </div>
              </div>
            </section>

            <section className="panel admin-panel">
              <div className="panel-head">
                <div>
                  <h2>Quick Administrative Actions</h2>
                </div>
              </div>
              <div className="admin-quick-links">
                <button
                  type="button"
                  className="admin-action-tile"
                  onClick={() => {
                    toast({
                      tone: "success",
                      title: "Audit Webhook Dispatched",
                      description: "Broadcasting health check to all FDIC partner institutions.",
                    });
                  }}
                >
                  <RefreshCw size={16} />
                  <div>
                    <strong>Sync Federal Reserve Node</strong>
                    <small>Force reconciliation check</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="admin-action-tile"
                  onClick={() => {
                    toast({
                      tone: "scout",
                      title: "Scout Retention Rule Reparsed",
                      description: "Updated 42,000+ merchant affiliate codes.",
                    });
                  }}
                >
                  <Activity size={16} />
                  <div>
                    <strong>Flush Scout Rule Cache</strong>
                    <small>Reload discount tables</small>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: USER DIRECTORY */}
      {activeTab === "users" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Registered Accounts</h2>
                <span className="panel-sub">Inspect profiles, roles, and KYC contact information</span>
              </div>
              <div className="admin-search-wrap">
                <Search size={14} />
                <input
                  placeholder="Filter by name, email, phone or business…"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Name</th>
                    <th>Account Type</th>
                    <th>Email Address</th>
                    <th>Phone #</th>
                    <th>Company / Entity</th>
                    <th>Role</th>
                    <th>Membership</th>
                    <th className="ta-r">Admin Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id}>
                      <td><code>{u.id}</code></td>
                      <td><strong>{u.name}</strong></td>
                      <td>
                        <span className={`chip ${u.accountType === "personal" ? "chip-green" : "chip-violet"}`}>
                          {u.accountType.toUpperCase()}
                        </span>
                      </td>
                      <td>{u.email}</td>
                      <td>{u.phone || "—"}</td>
                      <td>{u.business || "Personal Account"}</td>
                      <td>
                        {u.role === "superadmin" ? (
                          <span className="admin-badge-super">SUPER ADMIN</span>
                        ) : (
                          <span className="admin-badge-std">User</span>
                        )}
                      </td>
                      <td><strong>{u.plan}</strong></td>
                      <td className="ta-r">
                        <button
                          type="button"
                          className="solid-btn sm"
                          onClick={() => {
                            setTargetUser(u);
                            setAdjustModal(true);
                          }}
                        >
                          Adjust Balance
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: TRANSACTION LOG */}
      {activeTab === "ledger" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Global System Ledger</h2>
                <span className="panel-sub">Audit trail of all settled, pending and reversal transactions</span>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ref #</th>
                    <th>Date & Time</th>
                    <th>Merchant / Beneficiary</th>
                    <th>Category</th>
                    <th>Method</th>
                    <th>2% Reward</th>
                    <th>Scout Auto</th>
                    <th className="ta-r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map(t => (
                    <tr key={t.id}>
                      <td><code>{t.reference || t.id.slice(0, 8)}</code></td>
                      <td>{longDate(t.date)}</td>
                      <td><strong>{t.merchant}</strong></td>
                      <td><span className="cat-pill">{t.category}</span></td>
                      <td>{t.method || "Card"}</td>
                      <td>{t.reward > 0 ? `+${money(t.reward)}` : "—"}</td>
                      <td>{t.scout ? <span className="scout-chip">+{money(t.scout)}</span> : "—"}</td>
                      <td className={`ta-r ${t.amount > 0 ? "in" : ""}`}>
                        <strong>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: CARD FLEET */}
      {activeTab === "cards" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Fleet Card Manager</h2>
                <span className="panel-sub">Remote freeze, kill-switch, and limit override for cards</span>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Card Label</th>
                    <th>Cardholder</th>
                    <th>Last 4</th>
                    <th>Type</th>
                    <th>Current Spend</th>
                    <th>Spend Limit</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.label}</strong></td>
                      <td>{c.cardholder}</td>
                      <td><code>•••• {c.last4}</code></td>
                      <td><span className="chip chip-violet">{c.type.toUpperCase()}</span></td>
                      <td>{money(c.spent)}</td>
                      <td>{money(c.limit, false)}</td>
                      <td>
                        <span className={`status-pill ${c.frozen ? "frozen" : "active"}`}>
                          {c.frozen ? "Frozen" : "Active"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost-btn sm"
                          onClick={() => {
                            toggleFreeze(c.id);
                            toast({
                              tone: "info",
                              title: `Card ${c.frozen ? "Unfrozen" : "Frozen"} by Admin`,
                            });
                          }}
                        >
                          {c.frozen ? "Unfreeze" : "Override Freeze"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 5: DISPUTES & ARBITRATION */}
      {activeTab === "disputes" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Arbitration & Chargeback Queue</h2>
                <span className="panel-sub">Review user claims and grant provisional chargeback credits</span>
              </div>
            </div>

            {disputes.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Claim ID</th>
                      <th>Merchant</th>
                      <th>Amount</th>
                      <th>Reason</th>
                      <th>Detail</th>
                      <th>Status</th>
                      <th>Admin Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map(d => (
                      <tr key={d.id}>
                        <td><code>{d.id}</code></td>
                        <td><strong>{d.merchant}</strong></td>
                        <td><strong>{money(d.amount)}</strong></td>
                        <td>{d.reason}</td>
                        <td><small>{d.detail || "No details provided"}</small></td>
                        <td>
                          <span className={`status-pill ${d.status === "resolved" ? "paid" : "open"}`}>
                            {d.status}
                          </span>
                        </td>
                        <td>
                          {d.status !== "resolved" ? (
                            <button
                              type="button"
                              className="solid-btn sm"
                              onClick={() => {
                                advanceDispute(d.id);
                                toast({
                                  tone: "success",
                                  title: `Dispute Approved & Refunded`,
                                  description: `${money(d.amount)} credited back to user.`,
                                });
                              }}
                            >
                              Approve & Refund
                            </button>
                          ) : (
                            <span className="text-muted">Settled</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <ShieldAlert size={28} />
                <strong>Dispute Queue is Empty</strong>
                <p>No open customer fraud claims require administrative arbitration.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 6: SYSTEM PARAMETERS */}
      {activeTab === "system" && (
        <div className="admin-tab-pane">
          <section className="panel admin-panel">
            <div className="panel-head">
              <div>
                <h2>Global Bank Parameters</h2>
                <span className="panel-sub">Configure base APY, card rewards, and risk throttles</span>
              </div>
            </div>

            <div className="admin-params-form">
              <div className="field-row">
                <div>
                  <label htmlFor="adm-apy">Core High-Yield APY Rate (%)</label>
                  <input
                    id="adm-apy"
                    type="number"
                    step="0.05"
                    value={interestRate}
                    onChange={e => setInterestRate(e.target.value)}
                  />
                </div>
                <div>
                  <label>Base Debit Cash Back Rate</label>
                  <input disabled value="2.00% Unlimited" />
                </div>
              </div>

              <div className="field-row">
                <div>
                  <label>Daily Wire Velocity Threshold</label>
                  <input disabled value="$250,000 / day per entity" />
                </div>
                <div>
                  <label>Zelle® Instant Transaction Ceiling</label>
                  <input disabled value="$2,500 / transaction" />
                </div>
              </div>

              <button
                type="button"
                className="solid-btn"
                onClick={() => {
                  toast({
                    tone: "success",
                    title: "System Parameters Saved",
                    description: `Core Treasury yield updated to ${interestRate}%.`,
                  });
                }}
              >
                Save Global Config
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Manual Balance Adjustment Modal */}
      {adjustModal && (
        <div className="modal-scrim" onClick={() => setAdjustModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Manual Ledger Override: {targetUser?.name}</h3>
            </div>
            <form onSubmit={handleCommitAdjustment} className="dash-form">
              <label>Adjustment Action</label>
              <div className="card-type-toggle">
                <button
                  type="button"
                  className={adjustType === "credit" ? "on" : ""}
                  onClick={() => setAdjustType("credit")}
                >
                  Credit Funds (+)
                </button>
                <button
                  type="button"
                  className={adjustType === "debit" ? "on" : ""}
                  onClick={() => setAdjustType("debit")}
                >
                  Debit / Clawback (−)
                </button>
              </div>

              <label htmlFor="adm-adj-amt">Amount ($ USD)</label>
              <div className="amount-input">
                <span>$</span>
                <input
                  id="adm-adj-amt"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                />
              </div>

              <label htmlFor="adm-adj-memo">Administrative Audit Reason</label>
              <input
                id="adm-adj-memo"
                required
                placeholder="e.g. KYC verification bonus, provisional dispute resolution, manual wire credit"
                value={adjustMemo}
                onChange={e => setAdjustMemo(e.target.value)}
              />

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setAdjustModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="solid-btn">
                  Commit Ledger Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
