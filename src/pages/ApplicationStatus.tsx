/**
 * What a member sees between signing up and being approved.
 *
 * The dashboard is deliberately out of reach until a human decides, so this page
 * is the whole account experience for those hours: it says plainly where the
 * application stands, what happens next and by when, and — when compliance needs
 * something — exactly what to send. It is a real page, not a toast, because
 * people come back to it over a couple of days.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  AlertTriangle, ArrowRight, Check, Clock, FileText, Landmark, LifeBuoy,
  Loader2, Lock, Mail, ShieldCheck, Upload, XCircle,
} from "lucide-react";
import { useAcct, type ReviewRequirement } from "../lib/store";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { VeyraMark } from "../components/VeyraMark";
import PhoneVerifyCard from "../components/PhoneVerifyCard";

const REQUIREMENT_COPY: Record<ReviewRequirement, { title: string; detail: string; example: string }> = {
  identity: { title: "Government photo ID", detail: "A clear photo of your passport, driver's licence or state ID.", example: "passport-2026.jpg" },
  address: { title: "Proof of address", detail: "A utility bill, bank statement or lease from the last 3 months.", example: "utility-bill-july.pdf" },
  selfie: { title: "Selfie holding your ID", detail: "Your face and the ID in the same photo, both readable.", example: "selfie-with-id.jpg" },
  funds: { title: "Proof of funds", detail: "A statement or contract showing where the money came from.", example: "savings-statement.pdf" },
};

function Shell({ children, tone = "violet" }: { children: ReactNode; tone?: "violet" | "amber" | "red" | "green" }) {
  return (
    <div className={`appstatus tone-${tone}`}>
      <div className="appstatus-card">
        <div className="appstatus-brand">
          <VeyraMark width={26} height={26} />
          <span>veyra</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The waiting state: the message the brief asks for, on its own page. */
function UnderReview({ submittedAt, checking, onRefresh }: {
  submittedAt?: number | null; checking: boolean; onRefresh: () => void;
}) {
  const { user } = useAuth();
  const first = user?.name.split(" ")[0] ?? "there";
  const when = submittedAt ? new Date(submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null;
  return (
    <Shell>
      <motion.span className="appstatus-icon" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}>
        <Clock size={26} />
      </motion.span>
      <h1>Thanks {first} — your application is in review</h1>
      <p className="appstatus-lead">
        We've received everything you submitted{when ? ` on ${when}` : ""}. A specialist is checking your details now,
        and <strong>most applications are reviewed within 1–2 business days</strong>.
      </p>

      <ul className="appstatus-steps">
        <li className="done"><span><Check size={13} /></span><div><strong>Application received</strong><small>All your details and documents are with us.</small></div></li>
        <li className="now"><span><Loader2 size={13} className="spin" /></span><div><strong>In review</strong><small>A specialist is verifying your identity and details.</small></div></li>
        <li><span><Landmark size={13} /></span><div><strong>Account opens</strong><small>Your dashboard, card and account number unlock straight away.</small></div></li>
      </ul>

      <PhoneVerifyCard />

      <div className="appstatus-note">
        <Mail size={15} />
        {/* Sending mail needs an SMTP provider (see README), so the promise points
            at the notification that this app really does deliver. */}
        <span>We'll notify you here the moment there's news — you don't need to do anything else. Nothing is charged while you wait.</span>
      </div>

      <button type="button" className="ghost-btn" onClick={onRefresh} disabled={checking}>
        {checking && <Loader2 size={14} className="spin" />}
        {checking ? "Checking…" : "Check for updates"}
      </button>
      <p className="appstatus-foot">
        You can close this page and come back any time; sign in to see this status again.
        Need help? <Link to="/support">Contact support</Link>.
      </p>
      <SignOutRow />
    </Shell>
  );
}

/** Compliance needs something — the fraud-hold path. */
function MoreInformation({ note, requirements, reviewedBy }: { note: string; requirements: ReviewRequirement[]; reviewedBy?: string }) {
  const { user } = useAuth();
  const { updateKyc } = useAcct();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const list = requirements.length ? requirements : (["identity", "address"] as ReviewRequirement[]);
  const complete = list.every(r => (docs[r] ?? "").trim().length > 2);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // The store posts this straight to /api/me/kyc/submit, which returns the
      // application to the review queue and notifies the member.
      await updateKyc(prev => ({
        ...prev,
        lastUpdated: Date.now(),
        submission: {
          legalName: user?.name ?? "",
          dob: prev.submission?.dob ?? "",
          country: prev.submission?.country ?? "",
          documentType: list[0] ? REQUIREMENT_COPY[list[0]].title : "",
          source: prev.submission?.source ?? "",
          taxId: prev.submission?.taxId ?? "",
          documents: list.map(r => ({ key: r, label: REQUIREMENT_COPY[r].title, name: docs[r] })),
          submittedAt: Date.now(),
        },
      }));
      setSent(true);
      toast({ tone: "success", title: "Sent for review", description: "A specialist will pick this up shortly." });
    } catch (err) {
      toast({ tone: "error", title: "Could not send", description: err instanceof Error ? err.message : "Try again in a moment." });
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <Shell tone="green">
        <motion.span className="appstatus-icon" initial={{ scale: 0.8 }} animate={{ scale: 1 }}><Check size={26} /></motion.span>
        <h1>That's with us — thank you</h1>
        <p className="appstatus-lead">
          Your application is back in the review queue with the extra information. Reviews usually finish within
          1–2 business days from now.
        </p>
        <SignOutRow />
      </Shell>
    );
  }

  return (
    <Shell tone="amber">
      <motion.span className="appstatus-icon" initial={{ scale: 0.8 }} animate={{ scale: 1 }}><AlertTriangle size={26} /></motion.span>
      <h1>We need a bit more from you</h1>
      <p className="appstatus-lead">
        Before we can open your account we need to confirm a few things. This is routine, and it keeps your account safe.
      </p>
      <PhoneVerifyCard />
      {note && (
        <blockquote className="appstatus-quote">
          <span>From the review team</span>
          {note}
          {reviewedBy && <em>— {reviewedBy}</em>}
        </blockquote>
      )}

      <form className="auth-form appstatus-form" onSubmit={send}>
        <span className="app-section"><span>What we need</span></span>
        {list.map(r => (
          <div className="appstatus-req" key={r}>
            <div className="appstatus-req-head">
              <strong>{REQUIREMENT_COPY[r].title}</strong>
              <small>{REQUIREMENT_COPY[r].detail}</small>
            </div>
            <label className={`appstatus-upload ${docs[r] ? "on" : ""}`}>
              <Upload size={15} />
              <input
                id={`req-${r}`}
                value={docs[r] ?? ""}
                placeholder={`Add a filename — e.g. ${REQUIREMENT_COPY[r].example}`}
                onChange={e => setDocs(d => ({ ...d, [r]: e.target.value }))}
              />
            </label>
          </div>
        ))}
        <label htmlFor="appstatus-message">Anything you want to add (optional)</label>
        <textarea
          id="appstatus-message"
          rows={3}
          value={message}
          placeholder="Explain anything that might look unusual on your application."
          onChange={e => setMessage(e.target.value)}
        />
        <button className="auth-submit" type="submit" disabled={busy || !complete}>
          {busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={15} />}
          {busy ? "Sending…" : "Send for review"}
        </button>
        <p className="auth-note">Sending more information doesn't open the account — it returns your application to the review queue.</p>
      </form>
      <SignOutRow />
    </Shell>
  );
}

function Rejected({ note, reviewedBy }: { note: string; reviewedBy?: string }) {
  return (
    <Shell tone="red">
      <motion.span className="appstatus-icon" initial={{ scale: 0.8 }} animate={{ scale: 1 }}><XCircle size={26} /></motion.span>
      <h1>We can't open this account</h1>
      <p className="appstatus-lead">
        We've reviewed your application and we're not able to open an account for you at this time.
      </p>
      {note && (
        <blockquote className="appstatus-quote">
          <span>From the review team</span>
          {note}
          {reviewedBy && <em>— {reviewedBy}</em>}
        </blockquote>
      )}
      <div className="appstatus-note">
        <LifeBuoy size={15} />
        <span>
          Think this is a mistake, or something has changed? Reply to the message in your notifications or
          <Link to="/support"> contact support</Link> and a person will take another look. No money ever moved —
          the account was never opened.
        </span>
      </div>
      <SignOutRow />
    </Shell>
  );
}

function SignOutRow() {
  const { logout } = useAuth();
  return (
    <div className="appstatus-signout">
      <button type="button" className="ghost-btn" onClick={logout}><Lock size={14} /> Sign out</button>
      <Link className="ghost-btn" to="/">Back to veyra.com</Link>
    </div>
  );
}

export function ApplicationStatusPage() {
  const { account, accountError, refreshAccount } = useAcct();
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const review = account?.kyc.review;

  // A decision is made in another session. Keep the waiting member's shared
  // account snapshot current, rather than leaving the route guard stuck on
  // the review state it loaded at signup. Hidden tabs do not keep polling.
  useEffect(() => {
    let inFlight = false;
    const check = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void refreshAccount().catch(() => undefined).finally(() => { inFlight = false; });
    };
    check();
    const timer = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refreshAccount]);

  const checkNow = async () => {
    setChecking(true);
    try { await refreshAccount(); }
    catch (err) {
      toast({ tone: "info", title: "Couldn't check your application",
        description: err instanceof Error ? err.message : "Please try again in a moment." });
    } finally { setChecking(false); }
  };

  if (accountError) {
    return (
      <Shell tone="red">
        <span className="appstatus-icon"><AlertTriangle size={26} /></span>
        <h1>We can't load your application</h1>
        <p className="appstatus-lead">{accountError}</p>
        <SignOutRow />
      </Shell>
    );
  }
  if (!account || !review) {
    return (
      <Shell>
        <div className="appstatus-loading"><span className="spinner" /></div>
        <h1>Loading your application…</h1>
        <p className="appstatus-lead">Checking where things stand with your account.</p>
      </Shell>
    );
  }

  if (review.state === "approved") return <Navigate to="/app" replace />;
  if (review.state === "more_info") {
    return <MoreInformation note={review.note} requirements={review.requirements} reviewedBy={review.reviewedBy} />;
  }
  if (review.state === "rejected") {
    return <Rejected note={review.note} reviewedBy={review.reviewedBy} />;
  }
  return <UnderReview submittedAt={review.submittedAt} checking={checking} onRefresh={() => { void checkNow(); }} />;
}

/** A compact summary of what was submitted, shared by the status screens. */
export function ApplicationSummary({ fields }: { fields: Array<[string, string]> }) {
  return (
    <dl className="appstatus-summary">
      <div className="appstatus-summary-head"><FileText size={13} /> What you submitted</div>
      {fields.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>
      ))}
      <div className="appstatus-summary-foot"><ShieldCheck size={13} /> Encrypted and visible only to our compliance team.</div>
    </dl>
  );
}
