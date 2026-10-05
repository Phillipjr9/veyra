import { useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowRight, Bell, Check, Clock3, Copy, KeyRound, Laptop, Loader2,
  MapPin, Monitor, ShieldAlert, ShieldCheck, Smartphone, Snowflake, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { apiPatch, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAcct } from "../lib/store";
import { useToast } from "./Toast";
import { PasskeysPanel } from "./PasskeysPanel";

type Variant = "personal" | "business";
type TotpSetup = { secret: string; otpauthUrl: string; expiresAt: number };

function lastActive(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Activity time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export function SecurityCenterContent({ variant }: { variant: Variant }) {
  const { user, changePassword } = useAuth();
  const { account, refreshAccount } = useAcct();
  const toast = useToast();
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [totpPassword, setTotpPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryTotpCode, setRecoveryTotpCode] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [twoFactorOverride, setTwoFactorOverride] = useState<boolean | null>(null);
  const [recoveryCountOverride, setRecoveryCountOverride] = useState<number | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [freezeConfirm, setFreezeConfirm] = useState(false);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  if (!account || !user) return null;

  const twoFactorEnabled = twoFactorOverride ?? account.preferences.twoFactor;
  const recoveryCodesRemaining = recoveryCountOverride ?? account.recoveryCodesRemaining ?? 0;
  const sessions = account.sessions;
  const otherSessions = sessions.filter(session => !session.current);
  const accountLabel = variant === "personal" ? "personal account" : "business account";

  async function requestSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    try {
      const result = await apiPost<TotpSetup>("/api/me/security/two-factor/setup", { password: totpPassword });
      setSetup(result);
      setTotpCode("");
    } catch (error) {
      setTotpError(errorText(error));
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    try {
      const result = await apiPost<{ enabled: boolean; recoveryCodes: string[] }>("/api/me/security/two-factor/confirm", { password: totpPassword, code: totpCode.trim() });
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCountOverride(result.recoveryCodes.length);
      setTwoFactorOverride(true);
      setSetup(null);
      setSetupOpen(false);
      setTotpPassword("");
      setTotpCode("");
      toast({ tone: "success", title: "Two-step sign-in is on", description: "Save your one-time recovery codes now. Each can be used once if you lose your authenticator." });
      try {
        await refreshAccount();
        setTwoFactorOverride(null);
        setRecoveryCountOverride(null);
      } catch {
        // The successful confirmation response is authoritative for this view.
      }
    } catch (error) {
      setTotpError(errorText(error));
    } finally {
      setTotpBusy(false);
    }
  }

  async function disableTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError("");
    try {
      await apiPost("/api/me/security/two-factor/disable", { password: totpPassword, code: totpCode.trim() });
      setTwoFactorOverride(false);
      setRecoveryCountOverride(0);
      setDisableOpen(false);
      setRecoveryOpen(false);
      setRecoveryCodes(null);
      setRecoveryPassword("");
      setRecoveryTotpCode("");
      setTotpPassword("");
      setTotpCode("");
      toast({ tone: "success", title: "Two-step sign-in turned off" });
      try {
        await refreshAccount();
        setTwoFactorOverride(null);
        setRecoveryCountOverride(null);
      } catch {
        // The successful disable response is authoritative for this view.
      }
    } catch (error) {
      setTotpError(errorText(error));
    } finally {
      setTotpBusy(false);
    }
  }

  async function copySetupKey() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      toast({ tone: "success", title: "Setup key copied" });
    } catch {
      setTotpError("Clipboard access is unavailable. Select the key and copy it manually.");
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes?.length) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast({ tone: "success", title: "Recovery codes copied", description: "Store them somewhere private and separate from this device." });
    } catch {
      toast({ tone: "error", title: "Could not copy recovery codes", description: "Select the codes and copy them manually." });
    }
  }

  async function regenerateRecoveryCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      const result = await apiPost<{ recoveryCodes: string[] }>("/api/me/security/two-factor/recovery-codes/regenerate", {
        password: recoveryPassword,
        code: recoveryTotpCode.trim(),
      });
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCountOverride(result.recoveryCodes.length);
      setRecoveryOpen(false);
      setRecoveryPassword("");
      setRecoveryTotpCode("");
      toast({ tone: "success", title: "New recovery codes ready", description: "Previous codes no longer work. Save these new codes now." });
      try {
        await refreshAccount();
        setRecoveryCountOverride(null);
      } catch {
        // The successful regeneration response is authoritative for this view.
      }
    } catch (error) {
      setRecoveryError(errorText(error));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function changeAlerts(enabled: boolean) {
    setAlertsBusy(true);
    try {
      await apiPut("/api/me/preferences", { key: "loginAlerts", value: enabled });
      await refreshAccount();
      toast({ tone: "success", title: `New sign-in alerts ${enabled ? "on" : "off"}` });
    } catch (error) {
      toast({ tone: "error", title: "Alert setting was not saved", description: errorText(error) });
    } finally {
      setAlertsBusy(false);
    }
  }

  async function setSessionTrust(id: string, trusted: boolean) {
    setSessionBusy(id);
    try {
      await apiPatch(`/api/me/sessions/${encodeURIComponent(id)}`, { trusted });
      await refreshAccount();
      toast({ tone: "success", title: trusted ? "Device trusted for sign-in alerts" : "Device is no longer trusted" });
    } catch (error) {
      toast({ tone: "error", title: "Device setting was not saved", description: errorText(error) });
    } finally {
      setSessionBusy("");
    }
  }

  async function signOutSession(id: string, device: string) {
    if (!window.confirm(`Sign out ${device}? That browser will need to sign in again.`)) return;
    setSessionBusy(id);
    try {
      await apiPost(`/api/me/sessions/${encodeURIComponent(id)}/revoke`);
      await refreshAccount();
      toast({ tone: "success", title: `${device} signed out` });
    } catch (error) {
      toast({ tone: "error", title: "Session could not be signed out", description: errorText(error) });
    } finally {
      setSessionBusy("");
    }
  }

  async function signOutOthers() {
    if (!otherSessions.length || !window.confirm(`Sign out ${otherSessions.length} other session${otherSessions.length === 1 ? "" : "s"}? This device will stay signed in.`)) return;
    setBulkBusy(true);
    try {
      const result = await apiPost<{ revokedCount: number }>("/api/me/sessions/revoke-others");
      await refreshAccount();
      toast({ tone: "success", title: "Other devices signed out", description: `${result.revokedCount} session${result.revokedCount === 1 ? " was" : "s were"} revoked.` });
    } catch (error) {
      toast({ tone: "error", title: "Other sessions were not signed out", description: errorText(error) });
    } finally {
      setBulkBusy(false);
    }
  }

  async function freezeAllCards() {
    setFreezeBusy(true);
    try {
      await apiPost("/api/me/cards/freeze-all");
      await refreshAccount();
      setFreezeConfirm(false);
      toast({ tone: "success", title: "All cards are frozen", description: "Unfreeze cards individually from Cards when you are ready." });
    } catch (error) {
      toast({ tone: "error", title: "Cards were not frozen", description: errorText(error) });
    } finally {
      setFreezeBusy(false);
    }
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      await refreshAccount();
      toast({ tone: "success", title: "Password changed", description: "Other signed-in devices were signed out." });
    } catch (error) {
      setPasswordError(errorText(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className={`security-center-content security-center--${variant}`}>
      <header className="security-page-heading">
        <div>
          <span className="security-eyebrow">ACCOUNT PROTECTION</span>
          <h1>Security center</h1>
          <p>Manage sign-in verification, device access, and urgent account controls for your {accountLabel}.</p>
        </div>
        <div className={`security-protection-pill ${twoFactorEnabled ? "is-on" : "is-off"}`}>
          {twoFactorEnabled ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />}
          <span>{twoFactorEnabled ? "Authenticator on" : "Authenticator off"}</span>
        </div>
      </header>

      <div className="security-summary-grid" aria-label="Security status">
        <div className="security-summary-item">
          <span className="security-summary-icon"><KeyRound size={17} /></span>
          <div><small>Two-step sign-in</small><strong>{twoFactorEnabled ? "Enabled" : "Not set up"}</strong></div>
        </div>
        <div className="security-summary-item">
          <span className="security-summary-icon"><Bell size={17} /></span>
          <div><small>New-device alerts</small><strong>{account.preferences.loginAlerts ? "On" : "Off"}</strong></div>
        </div>
        <div className="security-summary-item">
          <span className="security-summary-icon"><Monitor size={17} /></span>
          <div><small>Live sessions</small><strong>{sessions.length} active</strong></div>
        </div>
      </div>

      <div className="security-content-grid">
        <section className="security-panel security-mfa-panel">
          <div className="security-panel-heading">
            <span className="security-panel-icon"><ShieldCheck size={18} /></span>
            <div><h2>Two-step sign-in</h2><p>Use a code from an authenticator app when you sign in.</p></div>
            <span className={`security-status-tag ${twoFactorEnabled ? "is-on" : "is-off"}`}>{twoFactorEnabled ? "On" : "Off"}</span>
          </div>

          {twoFactorEnabled ? (
            <div className="security-control-body">
              <div className="security-inline-note is-positive"><Check size={16} /><span>An authenticator code is required at every password sign-in. Use a one-time recovery code if you lose access to your authenticator.</span></div>
              <div className="security-recovery-panel">
                <div className="security-recovery-heading">
                  <div><strong>Recovery codes</strong><small>{recoveryCodesRemaining} unused · each code works once</small></div>
                  {!recoveryOpen && <button type="button" className="security-secondary-button" onClick={() => { setRecoveryOpen(true); setRecoveryError(""); setRecoveryPassword(""); setRecoveryTotpCode(""); setDisableOpen(false); }}>Regenerate</button>}
                </div>
                {recoveryCodes && (
                  <div className="security-recovery-display" role="status" aria-live="polite">
                    <p>Save these codes somewhere private and separate from this device. They are shown only now.</p>
                    <ul aria-label="One-time recovery codes">
                      {recoveryCodes.map(code => <li key={code}><code>{code}</code></li>)}
                    </ul>
                    <div className="security-recovery-actions">
                      <button type="button" className="security-secondary-button" onClick={() => void copyRecoveryCodes()}><Copy size={14} />Copy codes</button>
                      <button type="button" className="security-secondary-button" onClick={() => setRecoveryCodes(null)}>Hide codes</button>
                    </div>
                  </div>
                )}
                {recoveryOpen && (
                  <form className="security-form security-inline-form" onSubmit={regenerateRecoveryCodes}>
                    <p>Confirm with your current password and six-digit authenticator code. Regenerating invalidates all previous recovery codes.</p>
                    <label htmlFor="security-recovery-password">Current password</label>
                    <input id="security-recovery-password" type="password" autoComplete="current-password" required value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} />
                    <label htmlFor="security-recovery-totp">Authenticator code</label>
                    <input id="security-recovery-totp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" value={recoveryTotpCode} onChange={event => setRecoveryTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                    {recoveryError && <p className="security-form-error" role="alert">{recoveryError}</p>}
                    <div className="security-form-actions">
                      <button type="button" className="security-secondary-button" disabled={recoveryBusy} onClick={() => { setRecoveryOpen(false); setRecoveryPassword(""); setRecoveryTotpCode(""); setRecoveryError(""); }}>Cancel</button>
                      <button type="submit" className="security-primary-button" disabled={recoveryBusy}>{recoveryBusy && <Loader2 size={15} className="spin" />}Regenerate codes</button>
                    </div>
                  </form>
                )}
              </div>
              {!disableOpen ? (
                <button type="button" className="security-secondary-button" onClick={() => { setDisableOpen(true); setRecoveryOpen(false); setRecoveryPassword(""); setRecoveryTotpCode(""); setTotpError(""); setTotpCode(""); setTotpPassword(""); }}>
                  Turn off two-step sign-in
                </button>
              ) : (
                <form className="security-form security-inline-form" onSubmit={disableTwoFactor}>
                  <p>Confirm with your current password and an authenticator code or one unused recovery code.</p>
                  <label htmlFor="security-disable-password">Current password</label>
                  <input id="security-disable-password" type="password" autoComplete="current-password" required value={totpPassword} onChange={event => setTotpPassword(event.target.value)} />
                  <label htmlFor="security-disable-code">Authenticator or recovery code</label>
                  <input id="security-disable-code" type="text" inputMode="text" autoComplete="one-time-code" maxLength={24} required placeholder="123456 or ABCD-EFGH-JKLM" value={totpCode} onChange={event => setTotpCode(event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 24))} />
                  {totpError && <p className="security-form-error" role="alert">{totpError}</p>}
                  <div className="security-form-actions">
                    <button type="button" className="security-secondary-button" disabled={totpBusy} onClick={() => { setDisableOpen(false); setTotpPassword(""); setTotpCode(""); setTotpError(""); }}>Cancel</button>
                    <button type="submit" className="security-danger-button" disabled={totpBusy}>{totpBusy && <Loader2 size={15} className="spin" />}Turn off</button>
                  </div>
                </form>
              )}
              <p className="security-footnote">Regenerating recovery codes requires your password and authenticator. Turning off two-step sign-in invalidates every remaining code.</p>
            </div>
          ) : (
            <div className="security-control-body">
              <p className="security-body-copy">Add an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password. You will confirm a code before protection is enabled.</p>
              {!setup && !setupOpen && (
                <button type="button" className="security-primary-button" onClick={() => { setSetupOpen(true); setTotpError(""); }}>
                  <ShieldCheck size={16} /> Set up authenticator
                </button>
              )}
              {setupOpen && !setup && (
                <form className="security-form security-inline-form" onSubmit={requestSetup}>
                  <label htmlFor="security-setup-password">Current password</label>
                  <input id="security-setup-password" type="password" autoComplete="current-password" required value={totpPassword} onChange={event => setTotpPassword(event.target.value)} />
                  {totpError && <p className="security-form-error" role="alert">{totpError}</p>}
                  <div className="security-form-actions">
                    <button type="button" className="security-secondary-button" disabled={totpBusy} onClick={() => { setSetupOpen(false); setTotpPassword(""); setTotpError(""); }}>Cancel</button>
                    <button type="submit" className="security-primary-button" disabled={totpBusy}>{totpBusy && <Loader2 size={15} className="spin" />}Continue</button>
                  </div>
                </form>
              )}
              {setup && (
                <form className="security-form security-enrollment-form" onSubmit={confirmSetup}>
                  <div className="security-setup-instructions">
                    <strong>Add this account in your authenticator app</strong>
                    <span>Open the authenticator link on this device, or enter the key manually.</span>
                    <a className="security-authenticator-link" href={setup.otpauthUrl}><KeyRound size={14} /> Open authenticator app</a>
                    <label htmlFor="security-secret">Manual setup key</label>
                    <div className="security-secret-row">
                      <code id="security-secret" className="security-secret">{setup.secret}</code>
                      <button type="button" className="security-copy-button" onClick={() => void copySetupKey()} aria-label="Copy authenticator setup key"><Copy size={15} /></button>
                    </div>
                    <small>This key can generate sign-in codes for your account. Keep it private and do not share it.</small>
                    <small className="security-expiry"><Clock3 size={13} /> Setup expires {lastActive(setup.expiresAt)}.</small>
                  </div>
                  <label htmlFor="security-setup-code">Six-digit code</label>
                  <input id="security-setup-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="000000" value={totpCode} onChange={event => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                  {totpError && <p className="security-form-error" role="alert">{totpError}</p>}
                  <div className="security-form-actions">
                    <button type="button" className="security-secondary-button" disabled={totpBusy} onClick={() => { setSetup(null); setSetupOpen(false); setTotpPassword(""); setTotpCode(""); setTotpError(""); }}>Cancel setup</button>
                    <button type="submit" className="security-primary-button" disabled={totpBusy}>{totpBusy && <Loader2 size={15} className="spin" />}Confirm and enable</button>
                  </div>
                </form>
              )}
              <p className="security-footnote">Trusting a browser only changes new-device alerts. It never skips the authenticator code.</p>
            </div>
          )}
        </section>

        <PasskeysPanel />

        <section className="security-panel security-alerts-panel">
          <div className="security-panel-heading">
            <span className="security-panel-icon"><Bell size={18} /></span>
            <div><h2>Sign-in alerts</h2><p>In-app notification for sign-ins from an untrusted browser.</p></div>
          </div>
          <div className="security-control-body">
            <div className="security-switch-row">
              <div><strong>New-device alerts</strong><small>This is an in-app alert, not an email or text message.</small></div>
              <button type="button" role="switch" aria-checked={account.preferences.loginAlerts} aria-label="New-device sign-in alerts" className={`security-switch ${account.preferences.loginAlerts ? "is-on" : ""}`} disabled={alertsBusy} onClick={() => void changeAlerts(!account.preferences.loginAlerts)}>
                <span />
              </button>
            </div>
            <p className="security-footnote">Recognized devices do not trigger this alert. Sign-in verification is managed separately above.</p>
          </div>
        </section>

        <section className="security-panel security-password-panel">
          <div className="security-panel-heading">
            <span className="security-panel-icon"><KeyRound size={18} /></span>
            <div><h2>Change password</h2><p>Use a unique password that you do not reuse elsewhere.</p></div>
          </div>
          <form className="security-form security-password-form" onSubmit={event => void submitPasswordChange(event)}>
            <label htmlFor="security-current-password">Current password</label>
            <input id="security-current-password" type="password" autoComplete="current-password" required value={passwordForm.current} onChange={event => setPasswordForm(value => ({ ...value, current: event.target.value }))} />
            <label htmlFor="security-new-password">New password</label>
            <input id="security-new-password" type="password" autoComplete="new-password" minLength={8} required value={passwordForm.next} onChange={event => setPasswordForm(value => ({ ...value, next: event.target.value }))} />
            <label htmlFor="security-confirm-password">Confirm new password</label>
            <input id="security-confirm-password" type="password" autoComplete="new-password" minLength={8} required value={passwordForm.confirm} onChange={event => setPasswordForm(value => ({ ...value, confirm: event.target.value }))} />
            {passwordError && <p className="security-form-error" role="alert">{passwordError}</p>}
            <button type="submit" className="security-primary-button" disabled={passwordBusy}>{passwordBusy && <Loader2 size={15} className="spin" />}Update password</button>
            <p className="security-footnote">Changing your password signs out other sessions. This device stays signed in.</p>
          </form>
        </section>

        <section className="security-panel security-emergency-panel">
          <div className="security-panel-heading">
            <span className="security-panel-icon is-alert"><ShieldAlert size={18} /></span>
            <div><h2>Emergency controls</h2><p>Act quickly if your card or account activity looks wrong.</p></div>
          </div>
          <div className="security-emergency-list">
            <div className="security-emergency-action">
              <span className="security-emergency-icon"><Snowflake size={17} /></span>
              <div><strong>Freeze every card</strong><small>Decline new card purchases. Unfreeze cards individually later.</small></div>
              <button type="button" className="security-danger-button" disabled={!account.cards.length || freezeBusy} onClick={() => setFreezeConfirm(true)}>{freezeBusy ? <Loader2 size={15} className="spin" /> : null}Freeze</button>
            </div>
            {freezeConfirm && (
              <div className="security-confirm-box" role="alertdialog" aria-label="Confirm freeze all cards">
                <p>This freezes all {account.cards.length} card{account.cards.length === 1 ? "" : "s"}. Payments already processing are not affected.</p>
                <div><button type="button" className="security-secondary-button" disabled={freezeBusy} onClick={() => setFreezeConfirm(false)}>Cancel</button><button type="button" className="security-danger-button" disabled={freezeBusy} onClick={() => void freezeAllCards()}>{freezeBusy ? <Loader2 size={15} className="spin" /> : <Snowflake size={15} />}Confirm freeze</button></div>
              </div>
            )}
            <Link className="security-emergency-action is-link" to="/app/disputes">
              <span className="security-emergency-icon"><ShieldAlert size={17} /></span>
              <div><strong>Report a transaction</strong><small>Review and dispute an unrecognized card purchase.</small></div>
              <ArrowRight size={16} />
            </Link>
            <Link className="security-emergency-action is-link" to="/app/cards">
              <span className="security-emergency-icon"><Smartphone size={17} /></span>
              <div><strong>Manage individual cards</strong><small>Lock, freeze, or update controls for one card.</small></div>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="security-panel security-sessions-panel">
          <div className="security-panel-heading security-sessions-heading">
            <span className="security-panel-icon"><Monitor size={18} /></span>
            <div><h2>Devices & sessions</h2><p>Live sign-ins to your {accountLabel}.</p></div>
            <button type="button" className="security-secondary-button" disabled={!otherSessions.length || bulkBusy} onClick={() => void signOutOthers()}>{bulkBusy && <Loader2 size={14} className="spin" />}Sign out other devices</button>
          </div>
          <p className="security-session-explainer">Trusted devices only suppress new-device alerts. An authenticator code is still required at each sign-in when two-step sign-in is enabled.</p>
          {sessions.length ? (
            <div className="security-session-list">
              {sessions.map(session => {
                const isMobile = /mobile|android|iphone|ipad/i.test(session.device);
                const DeviceIcon = isMobile ? Smartphone : /desktop|computer|mac|windows/i.test(session.device) ? Monitor : Laptop;
                const meta = [session.browser, session.location].filter(Boolean).join(" · ");
                const working = sessionBusy === session.id;
                return (
                  <article className="security-session-row" key={session.id}>
                    <span className="security-device-icon"><DeviceIcon size={19} /></span>
                    <div className="security-session-info">
                      <strong>{session.device}{session.current && <span className="security-current-badge">This device</span>}</strong>
                      <small>{meta || "Browser details unavailable"}</small>
                      <small className="security-session-time"><Clock3 size={12} /> Last active {lastActive(session.lastActive)}</small>
                    </div>
                    <div className="security-session-actions">
                      <button type="button" className={`security-trust-button ${session.trusted ? "is-trusted" : ""}`} aria-pressed={session.trusted} disabled={working} onClick={() => void setSessionTrust(session.id, !session.trusted)}>
                        {session.trusted ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}{session.trusted ? "Trusted" : "Trust"}
                      </button>
                      {!session.current && <button type="button" className="security-revoke-button" disabled={working} onClick={() => void signOutSession(session.id, session.device)}>{working ? <Loader2 size={14} className="spin" /> : <X size={14} />}Sign out</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="security-empty-state">No active browser sessions are listed yet.</p>
          )}
          <div className="security-session-privacy"><MapPin size={14} /><span>Device labels are based on your browser. Location is not collected in this view.</span></div>
        </section>
      </div>
    </div>
  );
}
