import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { BadgeCheck, Building2, Check, Eye, EyeOff, Globe, KeyRound, Loader2, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Logo } from "../components/common";
import { Footer } from "../components/Chrome";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";

function AuthShell({ title, sub, children, foot }: { title: string; sub: string; children: ReactNode; foot: ReactNode }) {
  return (
    <>
      <div className="auth-page">
        <div className="auth-visual">
          <div className="auth-visual-inner">
            <Logo inverse />
            <h2>Banking that works<br />while you do.</h2>
            <ul>
              <li><BadgeCheck /> Personal and business checking</li>
              <li><Sparkles /> Rewards and savings on everyday spending</li>
              <li><ShieldCheck /> Secure transfers and real card controls</li>
            </ul>
            <div className="auth-stat"><strong>$6,000+</strong><span>average member savings each year</span></div>
          </div>
          <div className="auth-visual-glow" />
        </div>
        <div className="auth-form-side">
          <motion.div className="auth-card" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }}>
            <Link to="/" className="auth-back">← Back to site</Link>
            <h1>{title}</h1>
            <p className="auth-sub">{sub}</p>
            {children}
            <div className="auth-foot">{foot}</div>
          </motion.div>
        </div>
      </div>
      <Footer />
    </>
  );
}

function PasswordField({ value, onChange, id, placeholder = "••••••••", autoComplete }: {
  value: string; onChange: (v: string) => void; id: string; placeholder?: string; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input id={id} type={show ? "text" : "password"} value={value} required autoComplete={autoComplete}
        placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function AuthProviders({ onGoogle, onPasskey }: { onGoogle: () => void; onPasskey: () => void }) {
  return (
    <>
      <div className="auth-provider-stack">
        <button type="button" className="auth-provider-button google" onClick={onGoogle}>
          <Globe size={18} />
          <span>Continue with Google</span>
        </button>
        <button type="button" className="auth-provider-button passkey" onClick={onPasskey}>
          <KeyRound size={18} />
          <span>Use passkey</span>
        </button>
      </div>
      <div className="auth-divider"><span>or continue with email</span></div>
    </>
  );
}

export function LoginPage() {
  const { login, offline } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const me = await login(email, password);
      const fallback = me.role && me.role !== "user" ? "/app/superadmin" : "/app";
      navigate(location.state?.from && location.state.from !== "/app" ? location.state.from : fallback, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  const handleGoogle = () => {
    toast({
      title: "Google sign-in is not configured yet",
      description: "Add your Google OAuth client and callback before enabling this flow.",
      tone: "info",
    });
  };

  const handlePasskey = () => {
    const supported = "PublicKeyCredential" in window;
    toast({
      title: supported ? "Passkey flow is ready to connect" : "Passkey is not supported in this browser",
      description: supported
        ? "Connect WebAuthn to your backend to complete the sign-in flow."
        : "Use a modern browser with passkeys enabled to continue.",
      tone: supported ? "scout" : "info",
    });
  };

  return (
    <AuthShell title="Welcome back" sub="Sign in to your personal or business Veyra account."
      foot={<>New to Veyra? <Link to="/signup">Create an account</Link></>}>
      {offline && (
        <div className="otp-banner-box" role="alert" style={{ marginBottom: 14 }}>
          <ShieldCheck size={20} className="text-green" />
          <div>
            <strong>Can't reach the Veyra server</strong>
            <small>Check your connection — the app requires the backend to be running.</small>
          </div>
        </div>
      )}

      <AuthProviders onGoogle={handleGoogle} onPasskey={handlePasskey} />

      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <div className="label-row"><label htmlFor="password">Password</label><Link to="/forgot-password">Forgot?</Link></div>
        <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="form-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const initialType = params.get("type") === "personal" ? "personal" : "business";
  const [form, setForm] = useState({
    name: "", phone: "", business: "", accountType: initialType as "personal" | "business", email: params.get("email") ?? "", password: "",
    plan: (params.get("plan") as "Starter" | "Pro") ?? (initialType === "personal" ? "Starter" : "Pro"), terms: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const handleGoogle = () => {
    toast({
      title: "Google sign-up is not configured yet",
      description: "Connect your OAuth provider and callback before enabling Google registration.",
      tone: "info",
    });
  };

  const handlePasskey = () => {
    const supported = "PublicKeyCredential" in window;
    toast({
      title: supported ? "Passkey registration is ready for setup" : "Passkey is not supported in this browser",
      description: supported
        ? "Enable WebAuthn registration to allow passwordless sign-up."
        : "Use a browser that supports WebAuthn to continue.",
      tone: supported ? "scout" : "info",
    });
  };

  const strength = Math.min(4, (form.password.length >= 8 ? 1 : 0) + (/[A-Z]/.test(form.password) ? 1 : 0) + (/[0-9]/.test(form.password) ? 1 : 0) + (/[^A-Za-z0-9]/.test(form.password) ? 1 : 0));
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.accountType === "business" && !form.business.trim()) return setError("Add your business name to continue.");
    if (form.password.length < 8) return setError("Use at least 8 characters for your password.");
    if (!form.terms) return setError("Please accept the terms to continue.");
    setBusy(true);
    try {
      await signup(form);
      navigate("/app?welcome=1", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Open your account" sub={form.accountType === "personal" ? "Simple checking for spending, saving and everyday life." : "A few details and your business account is ready."}
      foot={<>Already with us? <Link to="/login">Sign in</Link></>}>
      <AuthProviders onGoogle={handleGoogle} onPasskey={handlePasskey} />
      <form className="auth-form" onSubmit={submit}>
        <span className="auth-choice-label">I want to open</span>
        <div className="account-type-toggle">
          <button type="button" className={form.accountType === "personal" ? "on" : ""} onClick={() => setForm(f => ({ ...f, accountType: "personal", business: "", plan: "Starter" }))}>
            <UserRound /><span><strong>Personal account</strong><small>For daily spending, bills and savings</small></span>
          </button>
          <button type="button" className={form.accountType === "business" ? "on" : ""} onClick={() => setForm(f => ({ ...f, accountType: "business", plan: "Pro" }))}>
            <Building2 /><span><strong>Business account</strong><small>For company cards, invoices and teams</small></span>
          </button>
        </div>
        <label htmlFor="name">Your legal name</label>
        <input id="name" required autoComplete="name" placeholder={form.accountType === "personal" ? "Jamie Chen" : "Rae Kim"} value={form.name} onChange={e => set("name", e.target.value)} />

        <div className="field-row">
          <div>
            <label htmlFor="su-phone">Mobile Phone (for 2FA & alerts)</label>
            <input
              id="su-phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="+1 (555) 019-2834"
              value={form.phone}
              onChange={e => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="su-email">Email address</label>
            <input
              id="su-email"
              type="email"
              required
              autoComplete="email"
              placeholder={form.accountType === "personal" ? "you@example.com" : "you@company.com"}
              value={form.email}
              onChange={e => set("email", e.target.value)}
            />
          </div>
        </div>

        {form.accountType === "business" && <>
          <label htmlFor="business">Business name</label>
          <input id="business" required autoComplete="organization" placeholder="Rae & Co Studio" value={form.business} onChange={e => set("business", e.target.value)} />
        </>}
        <label htmlFor="su-pw">Password</label>
        <PasswordField id="su-pw" value={form.password} onChange={v => set("password", v)} autoComplete="new-password" />
        <div className="strength"><div className="strength-bars">{[0, 1, 2, 3].map(i => <i key={i} className={i < strength ? `on s${strength}` : ""} />)}</div><span>{labels[strength]}</span></div>
        <label htmlFor="plan">Plan</label>
        <div className="plan-toggle">
          {(["Starter", "Pro"] as const).map(p => (
            <button type="button" key={p} className={form.plan === p ? "on" : ""} onClick={() => set("plan", p)}>
              <strong>{form.accountType === "personal" ? (p === "Pro" ? "Plus" : "Everyday") : p}</strong>
              <small>{form.accountType === "personal" ? (p === "Pro" ? "$9/mo · enhanced rewards" : "$0/mo · daily banking") : (p === "Pro" ? "$99/mo · Scout AI" : "$0/mo · core banking")}</small>
            </button>
          ))}
        </div>
        <label className="check-row"><input type="checkbox" checked={form.terms} onChange={e => set("terms", e.target.checked)} /><span>I agree to the <Link to="/legal/terms">Terms</Link> and <Link to="/legal/privacy">Privacy Policy</Link>.</span></label>
        {error && <p className="form-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "Creating account…" : "Create account"}
        </button>
        <p className="auth-note">Bank-grade encryption · passwords stored as one-way scrypt hashes.</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { forgotPassword, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function complete(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <AuthShell title="Password updated" sub="Your password has been changed and all other sessions were signed out."
        foot={<><Link to="/login">Back to sign in</Link></>}>
        <div className="reset-success">
          <Check /><p>You can now sign in with your new password.</p>
          <Link className="auth-submit" to="/login">Sign in</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" sub={sent ? "Enter the code from your reset email and choose a new password." : "We'll email you a secure reset code."}
      foot={<>Remembered it? <Link to="/login">Back to sign in</Link></>}>
      {sent ? (
        <form className="auth-form" onSubmit={complete}>
          <label htmlFor="reset-token">Reset code</label>
          <input id="reset-token" type="text" required autoFocus placeholder="Paste the code from your email" value={token} onChange={e => setToken(e.target.value.trim())} />
          <label htmlFor="new-password">New password</label>
          <PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          {error && <p className="form-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy || token.length < 8 || password.length < 8}>
            {busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "Updating…" : "Update password"}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={request}>
          <label htmlFor="forgot-email">Email</label>
          <input id="forgot-email" type="email" required autoFocus placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          {error && <p className="form-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "Sending…" : "Send reset code"}
          </button>
          <p className="panel-sub" style={{ textAlign: "center" }}>If an account exists for that email, reset instructions are on their way.</p>
        </form>
      )}
    </AuthShell>
  );
}

/* ============================================================
   Team invite acceptance (linked from the "You're invited" email)
   ============================================================ */
export function InviteAcceptPage() {
  const { signup, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const business = params.get("business") ?? "";
  const role = params.get("role") ?? "Team member";
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in — nothing to accept, straight to the dashboard.
  if (user) { navigate("/app", { replace: true }); return null; }

  const valid = email.includes("@") && business.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password.length < 8) return setError("Use at least 8 characters for your password.");
    setBusy(true);
    try {
      await signup({ name: form.name, business, accountType: "business", email, password: form.password, plan: "Pro" });
      navigate("/app?welcome=1", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  if (!valid) {
    return (
      <AuthShell title="Invitation not found" sub="This invitation link is incomplete or has expired."
        foot={<>Want an account anyway? <Link to="/signup">Open one now</Link></>}>
        <div className="reset-success">
          <Building2 />
          <p>Ask your team admin to resend the invitation, or open a Veyra account on your own.</p>
          <Link className="auth-submit" to="/signup">Open an account</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${business} on Veyra`} sub="Create your password to accept the invitation."
      foot={<>Already have a Veyra account? <Link to="/login">Sign in</Link></>}>
      <form className="auth-form" onSubmit={submit}>
        <div className="invite-summary">
          <Building2 size={16} />
          <div>
            <strong>{business}</strong>
            <small>{role} · invited to {email}</small>
          </div>
        </div>
        <label htmlFor="inv-name">Your legal name</label>
        <input id="inv-name" required autoComplete="name" placeholder="June Okafor" value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <label htmlFor="inv-pass">Create a password</label>
        <input id="inv-pass" type="password" required autoComplete="new-password" placeholder="At least 8 characters" value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        {error && <p className="form-error">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />} Accept invitation
        </button>
        <p className="auth-legal">You'll get your own password — the person who invited you never sees it.</p>
      </form>
    </AuthShell>
  );
}
