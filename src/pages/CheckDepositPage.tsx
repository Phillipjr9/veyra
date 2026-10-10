import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, FileSignature, Lightbulb, RectangleHorizontal, ShieldCheck } from "lucide-react";
import { ApiError, apiPost } from "../lib/api";
import { money, useAcct } from "../lib/store";
import { StaffNote } from "../components/StaffNote";
import { validFundingAmount } from "../components/FundingDetails";
import { FundingAnimation } from "../components/FundingAnimation";
import { FlowReview, StageDots } from "../components/MoneyFlow";
import { VeyraMark } from "../components/VeyraMark";
import {
  CheckCaptureSlot, readCheckPhoto, snapshotVideo, stopStream, type CheckSide,
} from "../components/MobileCheckDeposit";
import "../styles/funding-hub.css";
import "../styles/check-deposit-page.css";

type Phase = "form" | "review" | "processing" | "receipt";
type Posted = { id: string; amount_cents: number; reference: string; status: string; created_at: number };
type Presentation = { finish: () => void };

/**
 * Mobile remote check deposit. Photograph the front and endorsed back, review,
 * then the same add-funds animation as a debit-card deposit. The account is
 * credited immediately. Images stay on this device; no OCR or bank clearance
 * is connected.
 */
export function CheckDepositPage() {
  const navigate = useNavigate();
  const { account, refreshAccount } = useAcct();
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [live, setLive] = useState<CheckSide | null>(null);
  const [needsFile, setNeedsFile] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [posted, setPosted] = useState<Posted | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keyRef = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const mounted = useRef(true);
  const pause = useRef<Presentation | null>(null);

  const stop = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setLive(null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopStream(streamRef.current);
      if (pause.current) { pause.current.finish(); pause.current = null; }
    };
  }, []);

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
    setPosted(null);
    setBusy(false);
    setPhase("form");
    submitting.current = false;
    keyRef.current = crypto.randomUUID();
  }

  function goReview(event: FormEvent) {
    event.preventDefault();
    if (!front || !back) { setError("Photograph the front and the endorsed back before continuing."); return; }
    if (!validFundingAmount(amount)) { setError("Enter $10–$100,000 with no more than two decimal places."); return; }
    stop();
    setError("");
    setPhase("review");
  }

  async function confirm() {
    if (submitting.current || busy || !validFundingAmount(amount) || !front || !back) return;
    submitting.current = true;
    let finishPresentation!: () => void;
    const shown = new Promise<void>(finish => { finishPresentation = finish; });
    const presentation: Presentation = { finish: finishPresentation };
    pause.current = presentation;
    setBusy(true);
    setError("");
    setPhase("processing");
    try {
      const result = await apiPost<{ request: Posted }>("/api/me/check-deposits", {
        amount,
        note,
        requestKey: keyRef.current,
        frontCaptured: true,
        backCaptured: true,
      });
      if (!mounted.current) return;
      if (result.request.status === "confirmed") {
        void refreshAccount().catch(() => {
          if (mounted.current) setError("Funds were added. Refresh your account to see the updated balance; do not submit another deposit.");
        });
      }
      await shown;
      if (!mounted.current) return;
      setPosted(result.request);
      setPhase("receipt");
    } catch (err) {
      if (mounted.current) { setError(err instanceof ApiError ? err.message : "Could not deposit this check. Try again."); setPhase("review"); }
    } finally {
      presentation.finish();
      if (pause.current === presentation) pause.current = null;
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const ready = Boolean(front && back && validFundingAmount(amount) && !busy);
  const dollars = Number(amount) || 0;
  const stage = phase === "receipt" ? "success" : phase;

  return (
    <div className="check-deposit-page">
      <header className="check-deposit-head">
        <span className="check-deposit-head-icon" aria-hidden="true"><Camera size={24} /></span>
        <div className="check-deposit-head-copy">
          <span className="check-deposit-eyebrow">Remote deposit capture</span>
          <h1>Mobile check deposit</h1>
          <p>Fit a personal check (8.25 × 3 in) in the frame — front, then the endorsed back. Funds are added as soon as you confirm.</p>
        </div>
      </header>

      {phase !== "form" && (
        <StageDots kind="deposit" stage={stage} completionLabel="Added" />
      )}

      {error && phase !== "processing" && <p className="flow-field-error" role="alert">{error}</p>}

      {(phase === "processing" || phase === "receipt") && (
        <div className="check-deposit-flow">
          <FundingAnimation
            phase={phase === "receipt" ? "receipt" : "processing"}
            amount={posted ? posted.amount_cents / 100 : dollars}
            source="Check deposit"
            immediate
            receipt={posted ? { status: posted.status, reference: posted.reference, ledgerOnly: true, createdAt: posted.created_at, fee: 0 } : undefined}
            onPresented={() => pause.current?.finish()}
            close={() => navigate("/app")}
            again={reset}
          />
        </div>
      )}

      {phase === "review" && (
        <div className="check-deposit-flow">
          <FlowReview
            title="Review deposit"
            description="Check the details before adding funds to your account."
            amount={dollars}
            confirmLabel={`Add ${money(dollars)}`}
            onBack={() => { setError(""); setPhase("form"); }}
            onConfirm={() => void confirm()}
            confirmDisabled={busy}
            track={{
              from: { label: "Check deposit", sub: "Front and endorsed back captured", icon: <Camera size={20} /> },
              to: { label: "Your Veyra account", sub: "Account entry", icon: <VeyraMark width={20} height={20} /> },
            }}
            rows={[
              { label: "Method", value: "Mobile check deposit" },
              { label: "To", value: "Your Veyra account" },
              ...(note ? [{ label: "Memo", value: note }] : []),
              { label: "Available", value: "Immediately after confirmation" },
              { label: "Fee", value: "$0.00 · Free", tone: "free" as const },
              { label: "Balance after", value: money((account?.balance ?? 0) + dollars) },
            ]}
          />
          <p className="funding-animation-note">This updates your account. <StaffNote>External check processing is not connected.</StaffNote></p>
        </div>
      )}

      {phase === "form" && (
        <form className="check-deposit-form" onSubmit={goReview} noValidate>
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
              $10–$100,000, matching the check. No fee. Added to your account when you confirm.
            </p>
            <label className="flow-label" htmlFor="check-note">Memo (optional)</label>
            <input id="check-note" className="check-field" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="A short note — no passwords or card details" />
            <StaffNote>This updates your account. External check processing is not connected.</StaffNote>
            <button className="solid-btn dash-submit" type="submit" disabled={!ready}>Review deposit</button>
          </section>
        </form>
      )}
    </div>
  );
}
