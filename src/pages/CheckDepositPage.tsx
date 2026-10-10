import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Camera, Check, FileSignature, Lightbulb, RectangleHorizontal, ShieldCheck } from "lucide-react";
import { ApiError, apiPost } from "../lib/api";
import { money, useAcct } from "../lib/store";
import { StaffNote } from "../components/StaffNote";
import { validFundingAmount } from "../components/FundingDetails";
import {
  CheckCaptureSlot, readCheckPhoto, snapshotVideo, stopStream, type CheckSide,
} from "../components/MobileCheckDeposit";
import "../styles/check-deposit-page.css";

type Receipt = { amount: string; reference: string; status: string };

/**
 * Mobile remote check deposit. The member photographs the front and the
 * endorsed back, then enters the written amount. Images stay on this device;
 * the server records a pending request only. No OCR, no bank clearance, no
 * instant credit.
 */
export function CheckDepositPage() {
  const { refreshAccount } = useAcct();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [live, setLive] = useState<CheckSide | null>(null);
  const [needsFile, setNeedsFile] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keyRef = useRef(crypto.randomUUID());

  const stop = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setLive(null);
  };

  useEffect(() => () => stopStream(streamRef.current), []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || !live) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [live]);

  async function openCamera(side: CheckSide) {
    setError("");
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setNeedsFile(true);
      setError("Camera is not available here. Use Take or choose a photo.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setLive(side);
      setNeedsFile(false);
    } catch {
      setNeedsFile(true);
      setError("Camera permission was not granted. Use Take or choose a photo, or enable the camera and try again.");
    }
  }

  function capture() {
    try {
      const video = videoRef.current;
      if (!video || !live) return;
      const url = snapshotVideo(video);
      if (live === "front") setFront(url); else setBack(url);
      stop();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not capture that photo.");
    }
  }

  async function onFile(side: CheckSide, file: File) {
    try {
      const url = await readCheckPhoto(file);
      stop();
      if (side === "front") setFront(url); else setBack(url);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo.");
    }
  }

  function retake(side: CheckSide) {
    if (side === "front") setFront(""); else setBack("");
    setError("");
    void openCamera(side);
  }

  function reset() {
    stop();
    setFront("");
    setBack("");
    setAmount("");
    setNote("");
    setError("");
    setReceipt(null);
    setBusy(false);
    keyRef.current = crypto.randomUUID();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!front || !back) { setError("Photograph the front and the endorsed back before submitting."); return; }
    if (!validFundingAmount(amount)) { setError("Enter $10–$100,000 with no more than two decimal places."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<{ request: { reference: string; status: string } }>("/api/me/check-deposits", {
        amount,
        note,
        requestKey: keyRef.current,
        frontCaptured: true,
        backCaptured: true,
      });
      setReceipt({ amount, reference: result.request.reference, status: result.request.status });
      try { await refreshAccount(); } catch { /* receipt is already recorded */ }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit this check. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(front && back && validFundingAmount(amount) && !busy);

  return (
    <div className="check-deposit-page">
      <header className="check-deposit-head">
        <span className="check-deposit-head-icon" aria-hidden="true"><Camera size={24} /></span>
        <div className="check-deposit-head-copy">
          <span className="check-deposit-eyebrow">Remote deposit</span>
          <h1>Mobile check deposit</h1>
          <p>Photograph the front and the endorsed back, then enter the amount written on the check. Funds are not available until staff confirm receipt.</p>
        </div>
      </header>

      {receipt ? (
        <section className="check-deposit-card check-deposit-receipt" aria-live="polite">
          <h2><Check size={18} /> Submitted for review</h2>
          <p>No funds have been credited. Staff confirm the check before anything is available. Typical hold is 1–7 business days after confirmation.</p>
          <dl className="check-deposit-rows">
            <div><dt>Amount</dt><dd>{money(Number(receipt.amount))}</dd></div>
            <div><dt>Reference</dt><dd>{receipt.reference}</dd></div>
            <div><dt>Status</dt><dd>{receipt.status === "pending" ? "Pending review · not credited" : receipt.status}</dd></div>
          </dl>
          <div className="check-deposit-actions">
            <button type="button" className="solid-btn" onClick={reset}>Deposit another check</button>
            <Link to="/app/transfers" className="ghost-btn">Back to transfers</Link>
          </div>
        </section>
      ) : (
        <form className="check-deposit-form" onSubmit={submit} noValidate>
          <section className="check-deposit-card">
            <h2>How to photograph the check</h2>
            <ol className="check-deposit-steps">
              <li><FileSignature size={16} /><span><strong>Endorse the back.</strong> Sign exactly as the payee is written.</span></li>
              <li><RectangleHorizontal size={16} /><span><strong>Flatten it</strong> on a dark, contrasting surface. Unfold corners.</span></li>
              <li><Lightbulb size={16} /><span><strong>Use even lighting.</strong> Avoid glare, shadows and a flash bounce.</span></li>
              <li><Camera size={16} /><span><strong>Fit the whole check</strong> in the frame, including the MICR numbers along the bottom.</span></li>
            </ol>
            <p className="check-deposit-hints"><ShieldCheck size={16} /> Images stay on this device. Veyra records that both sides were captured, not the photos themselves. No OCR or bank clearance is connected.</p>
          </section>

          <section className="check-deposit-card">
            <h2>Front and endorsed back</h2>
            <p className="check-deposit-sub">Both sides are required. Retake either photo if the check is cropped, blurry or washed out.</p>
            <div className="check-photos-grid">
              <CheckCaptureSlot
                side="front" photo={front} live={live === "front"} needsFile={needsFile} videoRef={videoRef}
                onOpenCamera={() => void openCamera("front")} onCapture={capture} onCancel={stop}
                onRetake={() => retake("front")} onFile={file => void onFile("front", file)}
              />
              <CheckCaptureSlot
                side="back" photo={back} live={live === "back"} needsFile={needsFile} videoRef={videoRef}
                onOpenCamera={() => void openCamera("back")} onCapture={capture} onCancel={stop}
                onRetake={() => retake("back")} onFile={file => void onFile("back", file)}
              />
            </div>
          </section>

          <section className="check-deposit-card">
            <h2>Amount on the check</h2>
            <p className="check-deposit-sub">Enter the legal amount written on the check. Do not round up.</p>
            <label className="flow-label" htmlFor="check-amount">Amount (USD)</label>
            <div className={`flow-amount-field ${amount && !validFundingAmount(amount) ? "is-invalid" : ""}`}>
              <span aria-hidden="true">$</span>
              <input
                id="check-amount" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
                aria-invalid={Boolean(amount) && !validFundingAmount(amount)}
                aria-describedby="check-amount-hint"
              />
            </div>
            <p id="check-amount-hint" className={amount && !validFundingAmount(amount) ? "flow-field-error" : "flow-field-note"}>
              $10–$100,000, matching the check. No fee. Not credited until staff confirm.
            </p>
            <label className="flow-label" htmlFor="check-note">Memo (optional)</label>
            <input id="check-note" className="check-field" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="A short note — no passwords or card details" />
            <StaffNote>Check collection is not connected. This records a pending request for staff review.</StaffNote>
            {error && <p className="flow-field-error" role="alert">{error}</p>}
            <button className="solid-btn dash-submit" type="submit" disabled={!ready}>
              {busy ? "Submitting…" : "Submit check for review"}
            </button>
          </section>
        </form>
      )}
    </div>
  );
}
