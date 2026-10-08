import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { ArrowUpRight, Check, Copy, Download, Link2, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { apiGet } from "../lib/api";
import { copyText, useAcct } from "../lib/store";
import { ZelleLogo } from "../components/MoneyFlow";
import "../styles/zelle-page.css";

type FundingRow = { id: string; kind: string; label: string; instructions: string; recipient: string; recipient_contact?: string };

/**
 * Zelle® for a Veyra member: receiving identifiers as a Code 128 barcode and a
 * QR code, plus the deposit information an administrator set for the account.
 * Nothing here sends or requests a Zelle payment; Veyra only records deposits
 * that staff confirm.
 */
export function ZellePage() {
  const { user, account } = useAcct();
  const [methods, setMethods] = useState<FundingRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [choice, setChoice] = useState<"email" | "phone">("email");
  const [qr, setQr] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean }>({ text: "", ok: true });
  const svg = useRef<SVGSVGElement>(null);

  const email = account?.veyraEmail || user?.email || "";
  const phone = user?.phone?.trim() || "";
  const selected = choice === "phone" && phone ? "phone" : "email";
  const identifier = selected === "phone" ? phone : email;
  const link = identifier ? `${window.location.origin}${window.location.pathname}#/app/transfers?to=${encodeURIComponent(identifier)}` : "";
  // A deposit method counts only once an administrator has entered an enrolled contact for it.
  const zelle = methods?.find(row => row.kind === "zelle" && row.recipient_contact);
  const last4 = account?.bankDetails?.accountNumber?.slice(-4);

  useEffect(() => {
    let live = true;
    apiGet<{ methods: FundingRow[] }>("/api/me/funding")
      .then(data => { if (live) setMethods(data.methods); })
      .catch(e => { if (live) setLoadError(e instanceof Error ? e.message : "Deposit information could not be loaded."); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!svg.current || !identifier) return;
    try {
      JsBarcode(svg.current, identifier, { format: "CODE128", displayValue: false, lineColor: "#291440", background: "#ffffff", width: 2, height: 90, margin: 10 });
    } catch {
      // A value the encoder cannot render leaves the identifier text visible beside it.
    }
  }, [identifier]);

  useEffect(() => {
    let active = true;
    setQr("");
    if (link) {
      QRCode.toDataURL(link, { width: 512, margin: 3, errorCorrectionLevel: "M", color: { dark: "#291440", light: "#ffffff" } })
        .then(value => { if (active) setQr(value); })
        .catch(() => { if (active) setFeedback({ text: "QR code unavailable. You can still copy the payment link.", ok: false }); });
    }
    return () => { active = false; };
  }, [link]);

  async function copy(value: string, label: string) {
    const ok = await copyText(value);
    setFeedback(ok ? { text: `${label} copied.`, ok: true } : { text: "Copy is unavailable in this browser. Select the text and copy it instead.", ok: false });
  }

  return <div className="app-page zelle-page">
    <header className="zelle-head">
      <span className="zelle-head-icon" aria-hidden="true"><ZelleLogo size={26} /></span>
      <div className="zelle-head-copy">
        <span className="zelle-eyebrow">Receive and deposit</span>
        <h1>Zelle<sup>®</sup></h1>
        <p>Your receiving identifier, a scannable barcode and QR code, and the deposit details for your Veyra account.</p>
      </div>
      <Link to="/app/transfers" className="ghost-btn sm zelle-send">Send with Zelle <ArrowUpRight size={14} aria-hidden="true" /></Link>
    </header>

    <div className="zelle-grid">
      <section className="zelle-card" aria-labelledby="zelle-receive-title">
        <h2 id="zelle-receive-title">Receive with Zelle<sup>®</sup></h2>
        <p className="zelle-sub">Give this identifier to the sender. They enter it in their own bank’s Zelle service.</p>
        <div className="zelle-choice" role="group" aria-label="Receiving identifier">
          <button type="button" aria-pressed={selected === "email"} onClick={() => setChoice("email")}><Mail size={15} aria-hidden="true" /> Email</button>
          <button type="button" aria-pressed={selected === "phone"} disabled={!phone} onClick={() => setChoice("phone")}><Smartphone size={15} aria-hidden="true" /> Mobile</button>
        </div>
        <div className="zelle-identifier">
          <span>{selected === "phone" ? "Mobile number" : "Email address"}</span>
          <strong data-testid="zelle-identifier">{identifier || "Not available"}</strong>
        </div>
        <div className="zelle-barcode">
          {identifier
            ? <svg ref={svg} role="img" aria-label={`Barcode for ${identifier}`} />
            : <p className="zelle-muted">No receiving identifier is saved on your profile yet.</p>}
        </div>
        <div className="zelle-actions">
          <button type="button" disabled={!identifier} onClick={() => void copy(identifier, selected === "phone" ? "Mobile number" : "Email address")}><Copy size={14} aria-hidden="true" /> Copy identifier</button>
          <button type="button" disabled={!link} onClick={() => void copy(link, "Payment link")}><Link2 size={14} aria-hidden="true" /> Copy payment link</button>
        </div>
      </section>

      <section className="zelle-card zelle-qr-card" aria-labelledby="zelle-qr-title">
        <h2 id="zelle-qr-title">Scan to pay</h2>
        <p className="zelle-sub">A QR code for your Veyra payment link. It is not an official Zelle® code.</p>
        <div className="zelle-qr">
          {qr
            ? <img src={qr} width="220" height="220" alt="Scannable QR for this Veyra payment link" />
            : <span className="zelle-muted">{identifier ? "Preparing your code…" : "Code unavailable"}</span>}
        </div>
        <div className="zelle-actions">
          {qr
            ? <a className="zelle-download" download="veyra-zelle-qr.png" href={qr}><Download size={14} aria-hidden="true" /> Save QR</a>
            : <button type="button" disabled><Download size={14} aria-hidden="true" /> Save QR</button>}
        </div>
        <p className={`zelle-feedback${feedback.ok ? "" : " is-error"}`} role="status">{feedback.text && <>{feedback.ok && <Check size={14} aria-hidden="true" />} {feedback.text}</>}</p>
      </section>
    </div>

    <section className="zelle-card zelle-deposit" aria-labelledby="zelle-deposit-title">
      <h2 id="zelle-deposit-title">Deposit information</h2>
      {loadError
        ? <p role="alert" className="banking-error">{loadError}</p>
        : !methods
          ? <p className="zelle-muted">Loading deposit information…</p>
          : zelle
            ? <dl className="zelle-rows">
                <div><dt>Account holder</dt><dd>{user?.name || "—"}</dd></div>
                <div><dt>Credited to</dt><dd>Veyra checking{last4 ? ` •••• ${last4}` : ""}</dd></div>
                <div><dt>Zelle recipient</dt><dd>{zelle.recipient || "—"}</dd></div>
                <div><dt>Enrolled Zelle contact</dt><dd className="zelle-contact">{zelle.recipient_contact}
                  <button type="button" className="zelle-inline-copy" aria-label="Copy enrolled Zelle contact" onClick={() => void copy(zelle.recipient_contact ?? "", "Enrolled Zelle contact")}><Copy size={13} aria-hidden="true" /></button>
                </dd></div>
                {zelle.instructions && <div><dt>Instructions</dt><dd>{zelle.instructions}</dd></div>}
              </dl>
            : <p className="zelle-muted">No Zelle deposit instructions are set for your account yet. Contact support and staff will add them.</p>}
      <p className="zelle-disclosure"><ShieldCheck size={16} aria-hidden="true" /> Zelle is used through your own participating bank’s app. Veyra does not send or request Zelle payments. A deposit is credited to your account only after Veyra staff confirm receipt; submitting a request does not start a Zelle payment.</p>
    </section>
  </div>;
}
