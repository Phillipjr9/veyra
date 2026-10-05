import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Building2, Check, Eye, EyeOff, Globe, KeyRound, Loader2, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Logo } from "../components/common";
import { Footer } from "../components/Chrome";
import { useAuth, type User } from "../lib/auth";
import { apiGet, describeAuthError } from "../lib/api";
import { storageBlocked } from "../lib/api";
import { useToast } from "../components/Toast";

/** 3D artwork shown beside the form (desktop) and above it (phones). */
const AUTH_ART = {
  signin: { src: "/images/auth-signin.jpg", alt: "A Veyra phone showing a glowing fingerprint pad beside a crystal sphere holding a key, with two toggle switches" },
  signup: { src: "/images/auth-signup.jpg", alt: "A purple person and office building with a plus sign between them, beside a crystal sphere holding a key" },
};

export function AuthShell({ title, sub, children, foot, art = AUTH_ART.signin, wide = false }: {
  title: string; sub: string; children: ReactNode; foot: ReactNode;
  art?: { src: string; alt: string };
  /** Application forms (sign-up) need the room; sign-in stays a compact card. */
  wide?: boolean;
}) {
  return (
    <>
      <div className="auth-page">
        <div className="auth-visual">
          <div className="auth-visual-inner">
            <Logo inverse />
            <img className="auth-art" src={art.src} alt={art.alt} />
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
          <img className="auth-art-mobile" src={art.src} alt="" aria-hidden="true" loading="lazy" />
          <motion.div className={wide ? "auth-card is-wide" : "auth-card"} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }}>
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

/**
 * One-click demo sign-in.
 *
 * These are the accounts the local database holds: two members seeded by
 * `npm run seed:demo` (personal and business) and the Super Admin the server
 * bootstraps from ADMIN_EMAIL / ADMIN_PASSWORD in .env. Clicking a row fills
 * the form and signs in, so switching between the three dashboards is one
 * click instead of typing a password.
 *
 * Only rendered in demo mode — any `npm run dev` session, or a built bundle
 * opened with `?demo=1` — so production traffic never sees credentials in the
 * page. Before a real launch, change ADMIN_PASSWORD and delete this block
 * (the seed script warns if the admin password drifts from this list).
 */
const DEMO_ICONS: Record<string, typeof UserRound> = { personal: UserRound, business: Building2, admin: ShieldCheck };

const DEMO_ACCOUNTS: Array<{ id: string; label: string; detail: string; email: string; password: string }> = [
  { id: "personal", label: "Personal", detail: "Everyday money · goals, cash back, cards", email: "demo.personal@veyra.dev", password: "veyra-demo-2026" },
  { id: "business", label: "Business", detail: "Lagos Logistics Ltd · treasury, invoices, team", email: "demo.business@veyra.dev", password: "veyra-demo-2026" },
  { id: "admin", label: "Super Admin", detail: "Platform oversight console", email: "admin@veyra.dev", password: "veyra-admin-2026" },
];

type DemoAccount = { id: string; label: string; detail: string; email: string; password: string };

/**
 * Which accounts to offer is the server's answer, not the bundle's: it returns
 * them from `/api/demo/accounts` when it actually holds them (dev servers and
 * the static preview), and an empty list in production. The hard-coded list
 * below is only a fallback for a dev build whose API call failed.
 */
function useDemoAccounts(): DemoAccount[] {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ accounts: DemoAccount[] }>("/api/demo/accounts", { handleUnauthorized: false })
      .then(res => { if (!cancelled) setAccounts(res.accounts ?? []); })
      .catch(() => { if (!cancelled && import.meta.env.DEV) setAccounts(DEMO_ACCOUNTS); });
    return () => { cancelled = true; };
  }, []);
  return accounts;
}

/** The demo-credential panel: one click per account, filled and submitted. */
function DemoAccounts({ accounts, onPick, busyEmail }: { accounts: DemoAccount[]; onPick: (email: string, password: string) => void; busyEmail: string }) {
  return (
    <section className="demo-logins" aria-label="Demo accounts">
      <header className="demo-logins-head">
        <strong><Sparkles size={14} /> Demo accounts</strong>
        <span>One click signs you in — dev only</span>
      </header>
      <div className="demo-logins-list">
        {accounts.map((account, i) => {
          const Icon = DEMO_ICONS[account.id] ?? UserRound;
          const busyNow = busyEmail === account.email;
          return (
            <motion.button
              key={account.id}
              type="button"
              className="demo-login"
              disabled={Boolean(busyEmail)}
              onClick={() => onPick(account.email, account.password)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.05, duration: 0.35 }}
            >
              <span className="demo-login-icon"><Icon size={16} /></span>
              <span className="demo-login-copy">
                <strong>{account.label}</strong>
                <small>{account.detail}</small>
                <code>{account.email} · {account.password}</code>
              </span>
              <span className="demo-login-go">
                {busyNow ? <Loader2 className="spin" size={15} /> : <>Sign in <ArrowRight size={14} /></>}
              </span>
            </motion.button>
          );
        })}

      </div>
    </section>
  );
}

export function LoginPage() {
  const { login, verifyLoginCode, offline, sessionNotice, sessionDetail, dismissSessionNotice, resetSession } = useAuth();

  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorHint, setErrorHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [challengeEmail, setChallengeEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const demos = useDemoAccounts();

  function finishSignIn(me: User) {
    const fallback = me.role && me.role !== "user" ? "/app/superadmin" : "/app";
    navigate(location.state?.from && location.state.from !== "/app" ? location.state.from : fallback, { replace: true });
  }

  async function signIn(asEmail: string, asPassword: string) {
    setError(""); setErrorHint("");
    try {
      const result = await login(asEmail, asPassword);
      if ("twoFactorRequired" in result) {
        setChallengeId(result.challengeId);
        setChallengeEmail(asEmail.trim());
        setVerificationCode("");
        setPassword("");
        return;
      }
      finishSignIn(result);

    } catch (err) {
      // Say what happened AND what to do about it: the server's own wording, a
      // hint for the cause, and the status code. "Can't log in" with no reason
      // is exactly what this screen used to do.
      const described = describeAuthError(err, "sign in");
      setError(described.message);
      setErrorHint(described.status ? `${described.hint} (HTTP ${described.status})` : described.hint);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (!challengeId) {
      await signIn(email, password);
      setBusy(false);
      return;
    }

    setError(""); setErrorHint("");
    try {
      finishSignIn(await verifyLoginCode(challengeId, verificationCode.trim()));
    } catch (err) {
      const described = describeAuthError(err, "verify your sign-in code");
      setError(described.message);
      setErrorHint(described.status ? `${described.hint} (HTTP ${described.status})` : described.hint);
    } finally {
      setBusy(false);
    }
  }

  /** One click: show the credentials in the form, then sign in with them. */
  async function useDemo(asEmail: string, asPassword: string) {
    setEmail(asEmail);
    setPassword(asPassword);
    setDemoBusy(asEmail);
    await signIn(asEmail, asPassword);
    setDemoBusy("");
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
      foot={
        <>
          New to Veyra? <Link to="/signup">Create an account</Link>
          {import.meta.env.DEV && (
            <span className="auth-build">build {__BUILD_STAMP__} · {offline ? "API unreachable" : "API connected"}</span>
          )}
        </>
      }>
      {sessionNotice && !offline && (
        <div className="auth-notice" role="status">
          <ShieldCheck size={18} />
          <div>
            <strong>Session ended</strong>
            <small>{sessionNotice}</small>
            {sessionDetail && <small className="auth-notice-detail">Server said: {sessionDetail}</small>}
          </div>
          <div className="auth-notice-actions">
            {/* Forgets the session everywhere it could be hiding (memory, both
                web storages, the frame name) so the next attempt starts clean. */}
            <button type="button" onClick={resetSession}>Reset session</button>
            <button type="button" onClick={dismissSessionNotice} aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      {offline && (
        <div className="otp-banner-box" role="alert" style={{ marginBottom: 14 }}>
          <ShieldCheck size={20} className="text-green" />
          <div>
            <strong>Can't reach the Veyra server</strong>
            <small>Check your connection — the app requires the backend to be running.</small>
          </div>
        </div>
      )}

      {!challengeId && demos.length > 0 && <DemoAccounts accounts={demos} onPick={useDemo} busyEmail={demoBusy} />}

      {!challengeId && <AuthProviders onGoogle={handleGoogle} onPasskey={handlePasskey} />}

      <form className="auth-form" onSubmit={submit}>
        {challengeId ? (
          <>
            <div className="auth-code-prompt">
              <ShieldCheck size={21} />
              <div>
                <strong>Verify it’s you</strong>
                <small>Enter a six-digit authenticator code or one of your unused recovery codes for {challengeEmail}.</small>
              </div>
            </div>
            <label htmlFor="authenticator-code">Authenticator or recovery code</label>
            <input
              id="authenticator-code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              maxLength={24}
              required
              autoFocus
              placeholder="123456 or ABCD-EFGH-JKLM"
              value={verificationCode}
              onChange={e => setVerificationCode(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 24))}
            />
          </>
        ) : (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            <div className="label-row"><label htmlFor="password">Password</label><Link to="/forgot-password">Forgot?</Link></div>
            <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            <strong>{error}</strong>
            {errorHint && <small>{errorHint}</small>}
          </div>
        )}
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "Signing in…" : challengeId ? "Verify and sign in" : "Sign in"}
        </button>
        {challengeId ? (
          <button type="button" className="auth-code-back" disabled={busy} onClick={() => {
            setChallengeId(""); setChallengeEmail(""); setVerificationCode(""); setError(""); setErrorHint("");
          }}>Use a different account</button>
        ) : storageBlocked() && (
          <p className="auth-storage-note">
            This browser blocks web storage (preview frames and private mode often do), so sign-in works for this
            tab only — a reload asks again.
          </p>
        )}
      </form>
    </AuthShell>
  );
}

/** Every field of the account application, empty. */
const EMPTY_APPLICATION = {
  firstName: "", middleName: "", lastName: "", dob: "", ssn: "", citizenship: "United States", phone: "",
  addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", country: "United States",
  idType: "Driver's license", idNumber: "", idIssuer: "", idExpiry: "",
  occupation: "", employer: "", incomeRange: "", sourceOfFunds: "",
  legalName: "", dba: "", ein: "", businessType: "", formationState: "", formationDate: "",
  industry: "", website: "", monthlyVolume: "",
  bizAddressLine1: "", bizAddressLine2: "", bizCity: "", bizState: "", bizPostalCode: "", bizCountry: "United States",
  ownerName: "", ownerTitle: "", ownerDob: "", ownerSsn: "", ownerOwnership: 100,
};

const ID_TYPE_OPTIONS = [
  "Driver's license", "State ID card", "US passport", "Permanent resident card", "Military ID",
];
const INCOME_OPTIONS = ["Under $25,000", "$25,000 – $50,000", "$50,000 – $100,000", "$100,000 – $250,000", "Over $250,000"];
const FUNDS_OPTIONS = ["Salary or wages", "Business income", "Savings", "Investments", "Inheritance or gift", "Property sale", "Other"];
const BUSINESS_TYPE_OPTIONS = [
  "Sole proprietorship", "Single-member LLC", "Multi-member LLC", "Corporation", "S corporation", "Partnership", "Non-profit",
];
const VOLUME_OPTIONS = ["Under $10,000", "$10,000 – $50,000", "$50,000 – $250,000", "$250,000 – $1,000,000", "Over $1,000,000"];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX",
  "UT","VT","VA","WA","WV","WI","WY","DC"];

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const initialType = params.get("type") === "personal" ? "personal" : "business";
  const [form, setForm] = useState({
    ...EMPTY_APPLICATION,
    accountType: initialType as "personal" | "business",
    email: params.get("email") ?? "",
    password: "",
    plan: (params.get("plan") as "Starter" | "Pro") ?? (initialType === "personal" ? "Starter" : "Pro"),
    terms: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean | number) => setForm(f => ({ ...f, [k]: v }));
  const business = form.accountType === "business";

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
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("Add your legal first and last name to continue.");
    if (form.password.length < 8) return setError("Use at least 8 characters for your password.");
    if (!form.terms) return setError("Please accept the terms to continue.");
    setBusy(true);
    try {
      const { accountType, email, password, plan, terms, ...application } = form;
      void terms;
      await signup({
        // The account holder's display name is the applicant's legal name.
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email,
        password,
        accountType,
        plan,
        // The account record keeps the trading name; the full application,
        // including the registered legal name, is stored as the application.
        business: business ? (form.dba.trim() || form.legalName.trim()) : "",
        phone: form.phone || application.phone,
        profile: application,
      });
      // Not the dashboard: the account is not open until a human approves it.
      // The status page says so, and says when to expect news.
      navigate("/application", { replace: true });
    } catch (err) {
      const field = (err as { field?: string })?.field;
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (field) {
        // Put the cursor on the field the server rejected, so the fix is one
        // keystroke away instead of a hunt through the form.
        requestAnimationFrame(() => {
          const el = document.getElementById(`su-${field}`);
          if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
        });
      }
    } finally { setBusy(false); }
  }

  return (
    <AuthShell art={AUTH_ART.signup} wide title="Open your account"
      sub={business ? "A few details and your business account is ready." : "Simple checking for spending, saving and everyday life."}
      foot={<>Already with us? <Link to="/login">Sign in</Link></>}>
      <AuthProviders onGoogle={handleGoogle} onPasskey={handlePasskey} />
      <form className="auth-form" onSubmit={submit}>
        <span className="auth-choice-label">I want to open</span>
        <div className="account-type-toggle">
          <button type="button" className={form.accountType === "personal" ? "on" : ""} onClick={() => setForm(f => ({ ...f, accountType: "personal", plan: "Starter" }))}>
            <UserRound /><span><strong>Personal account</strong><small>For daily spending, bills and savings</small></span>
          </button>
          <button type="button" className={form.accountType === "business" ? "on" : ""} onClick={() => setForm(f => ({ ...f, accountType: "business", plan: "Pro" }))}>
            <Building2 /><span><strong>Business account</strong><small>For company cards, invoices and teams</small></span>
          </button>
        </div>

        <p className="auth-req-note">Federal law requires us to collect and verify the information below before we can open an account. It's used for identity checks only.</p>

        {/* ------------------------------ Applicant ------------------------------ */}
        <div className="app-section"><span>Your details</span></div>
        <div className="field-row">
          <div>
            <label htmlFor="su-firstName">Legal first name</label>
            <input id="su-firstName" required autoComplete="given-name" placeholder="Jamie" value={form.firstName} onChange={e => set("firstName", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-middleName">Middle name <em>(optional)</em></label>
            <input id="su-middleName" autoComplete="additional-name" placeholder="—" value={form.middleName} onChange={e => set("middleName", e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div>
            <label htmlFor="su-lastName">Legal last name</label>
            <input id="su-lastName" required autoComplete="family-name" placeholder="Chen" value={form.lastName} onChange={e => set("lastName", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-dob">Date of birth</label>
            <input id="su-dob" type="date" required autoComplete="bday" max={new Date(Date.now() - 18 * 365 * 864e5).toISOString().slice(0, 10)} value={form.dob} onChange={e => set("dob", e.target.value)} />
          </div>
        </div>
        <label htmlFor="su-ssn">Social Security number <em>· never shown to other members</em></label>
        <input id="su-ssn" required inputMode="numeric" autoComplete="off" placeholder="123-45-6789" maxLength={11} value={form.ssn} onChange={e => set("ssn", e.target.value)} />
        <div className="field-row">
          <div>
            <label htmlFor="su-phone">Mobile phone (for 2FA & alerts)</label>
            <input id="su-phone" type="tel" required autoComplete="tel" placeholder="+1 (555) 019-2834" value={form.phone} onChange={e => set("phone", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-email">Email address</label>
            <input id="su-email" type="email" required autoComplete="email" placeholder={business ? "you@company.com" : "you@example.com"} value={form.email} onChange={e => set("email", e.target.value)} />
          </div>
        </div>
        <label htmlFor="su-citizenship">Country of citizenship</label>
        <input id="su-citizenship" required placeholder="United States" value={form.citizenship} onFocus={e => e.target.select()} onChange={e => set("citizenship", e.target.value)} />

        {/* ------------------------------ Address ------------------------------ */}
        <div className="app-section"><span>Home address</span></div>
        <label htmlFor="su-addressLine1">Street address</label>
        <input id="su-addressLine1" required autoComplete="address-line1" placeholder="1841 Maple Grove Avenue" value={form.addressLine1} onChange={e => set("addressLine1", e.target.value)} />
        <label htmlFor="su-addressLine2">Apartment, suite, unit <em>(optional)</em></label>
        <input id="su-addressLine2" autoComplete="address-line2" placeholder="Apt 4B" value={form.addressLine2} onChange={e => set("addressLine2", e.target.value)} />
        <div className="field-row-3">
          <div>
            <label htmlFor="su-city">City</label>
            <input id="su-city" required autoComplete="address-level2" placeholder="Brooklyn" value={form.city} onChange={e => set("city", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-state">State</label>
            <select id="su-state" required value={form.state} onChange={e => set("state", e.target.value)}>
              <option value="">—</option>
              {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="su-postalCode">ZIP</label>
            <input id="su-postalCode" required autoComplete="postal-code" inputMode="numeric" placeholder="11218" maxLength={10} value={form.postalCode} onChange={e => set("postalCode", e.target.value)} />
          </div>
        </div>
        <label htmlFor="su-country">Country of residence</label>
        <input id="su-country" required autoComplete="country-name" placeholder="United States" value={form.country} onFocus={e => e.target.select()} onChange={e => set("country", e.target.value)} />

        {/* ------------------------------ Government ID ------------------------------ */}
        <div className="app-section"><span>Government ID</span></div>
        <label htmlFor="su-idType">Document type</label>
        <select id="su-idType" required value={form.idType} onChange={e => set("idType", e.target.value)}>
          {ID_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="field-row">
          <div>
            <label htmlFor="su-idNumber">Document number</label>
            <input id="su-idNumber" required placeholder="B4720-9183-2244" value={form.idNumber} onChange={e => set("idNumber", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-idIssuer">Issued by</label>
            <input id="su-idIssuer" required placeholder="New York" value={form.idIssuer} onChange={e => set("idIssuer", e.target.value)} />
          </div>
        </div>
        <label htmlFor="su-idExpiry">Expiry date</label>
        <input id="su-idExpiry" type="date" required value={form.idExpiry} onChange={e => set("idExpiry", e.target.value)} />

        {/* ------------------------------ Employment & funds ------------------------------ */}
        <div className="app-section"><span>Employment & funds</span></div>
        <div className="field-row">
          <div>
            <label htmlFor="su-occupation">Occupation</label>
            <input id="su-occupation" required placeholder="Product designer" value={form.occupation} onChange={e => set("occupation", e.target.value)} />
          </div>
          <div>
            <label htmlFor="su-employer">Employer <em>(optional)</em></label>
            <input id="su-employer" placeholder="Northwind Studio" value={form.employer} onChange={e => set("employer", e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div>
            <label htmlFor="su-incomeRange">Annual income</label>
            <select id="su-incomeRange" required value={form.incomeRange} onChange={e => set("incomeRange", e.target.value)}>
              <option value="">—</option>
              {INCOME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="su-sourceOfFunds">Where the money comes from</label>
            <select id="su-sourceOfFunds" required value={form.sourceOfFunds} onChange={e => set("sourceOfFunds", e.target.value)}>
              <option value="">—</option>
              {FUNDS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {/* ------------------------------ Business (business accounts only) ------------------------------ */}
        {business && <>
          <div className="app-section"><span>The business</span></div>
          <label htmlFor="su-legalName">Registered legal name</label>
          <input id="su-legalName" required autoComplete="organization" placeholder="Lagos Logistics Ltd" value={form.legalName} onChange={e => set("legalName", e.target.value)} />
          <div className="field-row">
            <div>
              <label htmlFor="su-dba">Trading name (DBA) <em>(optional)</em></label>
              <input id="su-dba" placeholder="Lagos Logistics" value={form.dba} onChange={e => set("dba", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-ein">EIN (Employer Identification Number)</label>
              <input id="su-ein" required inputMode="numeric" placeholder="84-2917716" maxLength={10} value={form.ein} onChange={e => set("ein", e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div>
              <label htmlFor="su-businessType">Business structure</label>
              <select id="su-businessType" required value={form.businessType} onChange={e => set("businessType", e.target.value)}>
                <option value="">—</option>
                {BUSINESS_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="su-formationState">State of formation</label>
              <select id="su-formationState" required value={form.formationState} onChange={e => set("formationState", e.target.value)}>
                <option value="">—</option>
                {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div>
              <label htmlFor="su-formationDate">Date formed</label>
              <input id="su-formationDate" type="date" required value={form.formationDate} onChange={e => set("formationDate", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-industry">Industry</label>
              <input id="su-industry" required placeholder="Freight & logistics" value={form.industry} onChange={e => set("industry", e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div>
              <label htmlFor="su-website">Website <em>(optional)</em></label>
              <input id="su-website" placeholder="lagoslogistics.com" value={form.website} onChange={e => set("website", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-monthlyVolume">Expected monthly deposits</label>
              <select id="su-monthlyVolume" required value={form.monthlyVolume} onChange={e => set("monthlyVolume", e.target.value)}>
                <option value="">—</option>
                {VOLUME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <label htmlFor="su-bizAddressLine1">Business street address</label>
          <input id="su-bizAddressLine1" required placeholder="220 West 34th Street" value={form.bizAddressLine1} onChange={e => set("bizAddressLine1", e.target.value)} />
          <label htmlFor="su-bizAddressLine2">Suite, floor, unit <em>(optional)</em></label>
          <input id="su-bizAddressLine2" placeholder="Suite 12" value={form.bizAddressLine2} onChange={e => set("bizAddressLine2", e.target.value)} />
          <div className="field-row-3">
            <div>
              <label htmlFor="su-bizCity">City</label>
              <input id="su-bizCity" required placeholder="New York" value={form.bizCity} onChange={e => set("bizCity", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-bizState">State</label>
              <select id="su-bizState" required value={form.bizState} onChange={e => set("bizState", e.target.value)}>
                <option value="">—</option>
                {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="su-bizPostalCode">ZIP</label>
              <input id="su-bizPostalCode" required inputMode="numeric" placeholder="10001" maxLength={10} value={form.bizPostalCode} onChange={e => set("bizPostalCode", e.target.value)} />
            </div>
          </div>

          <div className="app-section"><span>Beneficial owner</span></div>
          <p className="auth-req-note">Every business account needs one person who owns 25% or more of it — that's who banks are required to identify.</p>
          <div className="field-row">
            <div>
              <label htmlFor="su-ownerName">Owner's full legal name</label>
              <input id="su-ownerName" required placeholder="Tunde Ola" value={form.ownerName} onChange={e => set("ownerName", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-ownerTitle">Title</label>
              <input id="su-ownerTitle" required placeholder="Managing Member" value={form.ownerTitle} onChange={e => set("ownerTitle", e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div>
              <label htmlFor="su-ownerDob">Owner's date of birth</label>
              <input id="su-ownerDob" type="date" required value={form.ownerDob} onChange={e => set("ownerDob", e.target.value)} />
            </div>
            <div>
              <label htmlFor="su-ownerSsn">Owner's SSN</label>
              <input id="su-ownerSsn" required inputMode="numeric" placeholder="123-45-6789" maxLength={11} value={form.ownerSsn} onChange={e => set("ownerSsn", e.target.value)} />
            </div>
          </div>
          <label htmlFor="su-ownerOwnership">Ownership percentage</label>
          {/* Prefilled at 100% (the common case); focusing selects it so typing
              replaces the default instead of appending to it. */}
          <input id="su-ownerOwnership" type="number" required min={25} max={100} step={1} value={form.ownerOwnership}
            onFocus={e => e.target.select()} onChange={e => set("ownerOwnership", Number(e.target.value))} />
        </>}

        {/* ------------------------------ Security & plan ------------------------------ */}
        <div className="app-section"><span>Secure your account</span></div>
        <label htmlFor="su-pw">Password</label>
        <PasswordField id="su-pw" value={form.password} onChange={v => set("password", v)} autoComplete="new-password" />
        <div className="strength"><div className="strength-bars">{[0, 1, 2, 3].map(i => <i key={i} className={i < strength ? `on s${strength}` : ""} />)}</div><span>{labels[strength]}</span></div>
        <label htmlFor="su-plan">Plan</label>
        <div className="plan-toggle">
          {(["Starter", "Pro"] as const).map(p => (
            <button type="button" key={p} className={form.plan === p ? "on" : ""} onClick={() => set("plan", p)}>
              <strong>{business ? p : (p === "Pro" ? "Plus" : "Everyday")}</strong>
              <small>{business ? (p === "Pro" ? "$99/mo · Scout AI" : "$0/mo · core banking") : (p === "Pro" ? "$9/mo · enhanced rewards" : "$0/mo · daily banking")}</small>
            </button>
          ))}
        </div>
        <label className="check-row"><input type="checkbox" checked={form.terms} onChange={e => set("terms", e.target.checked)} /><span>I agree to the <Link to="/legal/terms">Terms</Link> and <Link to="/legal/privacy">Privacy Policy</Link>, and I confirm the information above is accurate.</span></label>
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
  // Only set outside production, where there is no mail provider yet — the code
  // is shown on screen instead of being "sent" somewhere it would never arrive.
  const [demoCode, setDemoCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { devCode } = await forgotPassword(email);
      if (devCode) { setDemoCode(devCode); setToken(devCode); }
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
    <AuthShell title="Reset your password"
      sub={sent
        ? (demoCode ? "Your code is filled in below — choose a new password." : "Enter the code from your reset email and choose a new password.")
        : "We'll email you a secure reset code."}
      foot={<>Remembered it? <Link to="/login">Back to sign in</Link></>}>
      {sent ? (
        <form className="auth-form" onSubmit={complete}>
          {demoCode && (
            <p className="auth-note" data-testid="demo-reset-code">
              This demo has no mail service, so the code is shown here rather than emailed. It is already filled in
              for you.
            </p>
          )}
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
      // Not the dashboard: the account is not open until a human approves it.
      // The status page says so, and says when to expect news.
      navigate("/application", { replace: true });
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
