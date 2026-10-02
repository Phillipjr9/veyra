import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { BadgeCheck, Building2, Check, Eye, EyeOff, Loader2, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Logo } from "../components/common";
import { Footer } from "../components/Chrome";
import { useAuth } from "../lib/auth";

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

export function LoginPage() {
  const { login, loginWithGoogle, loginWithPasskey } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authMethod, setAuthMethod] = useState<"standard" | "passkey" | "google">("standard");
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setAuthMethod("standard");
    try {
      // Validate credentials first
      await login(email, password);
      // Show SMS 2FA code verification for authenticated session
      setShowOtpStep(true);
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpCode.length < 6) {
      setError("Please enter the complete 6-digit verification code.");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      navigate(location.state?.from ?? "/app", { replace: true });
    }, 600);
  }

  function handleAutoFillOtp() {
    setOtpCode("123456");
    setError("");
  }

  async function handleGoogleLogin() {
    setBusy(true); setError(""); setAuthMethod("google");
    try {
      await loginWithGoogle("personal");
      navigate(location.state?.from ?? "/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google authentication failed.");
    } finally { setBusy(false); }
  }

  async function handlePasskeyLogin() {
    setBusy(true); setError(""); setAuthMethod("passkey");
    try {
      await loginWithPasskey(email);
      navigate(location.state?.from ?? "/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey verification failed.");
    } finally { setBusy(false); }
  }

  function useDemo(kind: "business" | "personal" | "admin") {
    if (kind === "admin") {
      setEmail("admin@veyra.com");
      setPassword("admin123");
    } else {
      setEmail(kind === "personal" ? "personal@veyra.com" : "demo@veyra.com");
      setPassword("veyra123");
    }
    setError("");
  }

  if (showOtpStep) {
    return (
      <AuthShell
        title="Verify your identity"
        sub={`We sent a 6-digit security code via SMS to the mobile phone registered to ${email}.`}
        foot={<button type="button" className="text-btn" onClick={() => setShowOtpStep(false)}>← Back to password sign-in</button>}
      >
        <form className="auth-form otp-auth-form" onSubmit={handleVerifyOtp}>
          <div className="otp-banner-box">
            <ShieldCheck size={20} className="text-green" />
            <div>
              <strong>Two-Factor SMS Verification</strong>
              <small>Code expires in 10 minutes</small>
            </div>
            <button
              type="button"
              className="otp-autofill-tag"
              onClick={handleAutoFillOtp}
            >
              Fill 123456
            </button>
          </div>

          <label htmlFor="otp-input">6-Digit Verification Code</label>
          <input
            id="otp-input"
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            autoFocus
            className="otp-code-input"
            placeholder="123456"
            value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />

          {error && <p className="form-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={busy || otpCode.length < 6}>
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {busy ? "Verifying Token…" : "Verify & Sign in"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" sub="Sign in to your personal or business Veyra account."
      foot={<>New to Veyra? <Link to="/signup">Create an account</Link></>}>
      <div className="demo-options demo-three-options">
        <button type="button" className="demo-banner" onClick={() => useDemo("personal")}>
          <UserRound size={15} />
          <span><strong>Personal</strong><small>Tap to fill demo</small></span>
        </button>
        <button type="button" className="demo-banner" onClick={() => useDemo("business")}>
          <Building2 size={15} />
          <span><strong>Business</strong><small>Tap to fill demo</small></span>
        </button>
        <button type="button" className="demo-banner admin-demo-banner" onClick={() => useDemo("admin")}>
          <ShieldCheck size={15} />
          <span><strong>Super Admin</strong><small>admin@veyra.com</small></span>
        </button>
      </div>

      {/* Google OAuth & Passkey Authentication */}
      <div className="modern-auth-providers">
        <button
          type="button"
          className="google-auth-btn"
          disabled={busy}
          onClick={handleGoogleLogin}
        >
          {busy && authMethod === "google" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
          )}
          <span>Continue with Google</span>
        </button>

        <button
          type="button"
          className="passkey-auth-btn"
          disabled={busy}
          onClick={handlePasskeyLogin}
        >
          {busy && authMethod === "passkey" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 10a2 2 0 0 0-2 2c0 1.02.77 1.86 1.76 1.98l.24.02V20h2v-6c1.1 0 2-.9 2-2a2 2 0 0 0-2-2z" />
              <path d="M7 10h-.5a3.5 3.5 0 0 0 0 7h.5" />
              <path d="M17 10h.5a3.5 3.5 0 0 1 0 7h-.5" />
              <path d="M12 6c-3.31 0-6 2.69-6 6v2h12v-2c0-3.31-2.69-6-6-6z" />
            </svg>
          )}
          <span>Sign in with Passkey / Face ID</span>
        </button>
      </div>

      <div className="auth-divider">
        <span>or sign in with password</span>
      </div>

      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
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
  const [params] = useSearchParams();
  const initialType = params.get("type") === "personal" ? "personal" : "business";
  const [form, setForm] = useState({
    name: "", phone: "", business: "", accountType: initialType as "personal" | "business", email: params.get("email") ?? "", password: "",
    plan: (params.get("plan") as "Starter" | "Pro") ?? (initialType === "personal" ? "Starter" : "Pro"), terms: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

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
        <input id="name" required autoComplete="name" placeholder={form.accountType === "personal" ? "Alex Morgan" : "Hana Park"} value={form.name} onChange={e => set("name", e.target.value)} />

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
          <input id="business" required autoComplete="organization" placeholder="Park & Co Studio" value={form.business} onChange={e => set("business", e.target.value)} />
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
        <p className="auth-note">Demo product — no real banking data is collected or transmitted.</p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [temp, setTemp] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setTemp("");
    try { setTemp(await resetPassword(email)); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
  }

  return (
    <AuthShell title="Reset your password" sub="We'll generate a temporary password for this demo."
      foot={<>Remembered it? <Link to="/login">Back to sign in</Link></>}>
      {temp ? (
        <div className="reset-success">
          <Check /><p>Your temporary password is</p><code>{temp}</code>
          <Link className="auth-submit" to="/login">Sign in with it</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="fp-email">Email</label>
          <input id="fp-email" type="email" required placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          {error && <p className="form-error">{error}</p>}
          <button className="auth-submit" type="submit">Send reset</button>
        </form>
      )}
    </AuthShell>
  );
}
