/**
 * Mobile check deposit.
 *
 * Two things make this a phone flow rather than a form:
 *
 *  1. The camera is real. Tapping a slot opens the device camera
 *     (`getUserMedia`, rear lens preferred) into a live viewfinder, and the
 *     shutter captures the actual frame. When the camera is unavailable —
 *     desktop, a blocked permission, an insecure origin — the slot falls back
 *     to the native camera app through `<input capture="environment">`, so a
 *     phone can always photograph the check.
 *  2. It moves like Add funds: the same spring-in sheet, stages that slide,
 *     an orbit/progress/track while the check clears, then confetti, a drawn
 *     check mark and figures that count up on arrival.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle, AlertTriangle, Camera, Check, Image as ImageIcon, Lock, RefreshCw, ShieldCheck, X,
} from "lucide-react";
import { downloadFile, longDate, money, useAcct, type MoveResult } from "../lib/store";
import { ease, useCountUp } from "./common";
import { AnimatedCheck, Confetti, CONFETTI_GREEN, FlowTrack, type Track } from "./MoneyFlow";
import { VeyraMark } from "./VeyraMark";
import { lockScroll } from "../lib/scrollLock";

type Side = "front" | "back";
type Stage = "capture" | "processing" | "success";

const STEPS = [
  "Securing your check images",
  "Reading the MICR line and amount",
  "Verifying the endorsement",
  "Crediting your checking account",
] as const;

const SIDE_COPY: Record<Side, { title: string; hint: string; done: string }> = {
  front: { title: "Front of check", hint: "Lay it flat and fit all four corners", done: "Front captured" },
  back: { title: "Back of check", hint: "Signed, and marked “For mobile deposit at Veyra”", done: "Endorsement captured" },
};

/* ============================================================
   Image plumbing
   ============================================================ */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * A modern phone camera produces 8–12 MP. Keeping the raw data URL would mean
 * megabytes held in memory per side (and a janky sheet on the phone that just
 * took the photo), so every image is drawn through a canvas once, at a width
 * that is still far more than the MICR line needs.
 */
function shrink(dataUrl: string, maxWidth = 1400): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
      if (scale === 1 && dataUrl.length < 400_000) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ============================================================
   Progress dots (same language as the money flow)
   ============================================================ */

function CheckStageDots({ stage }: { stage: Stage }) {
  const order: Stage[] = ["capture", "processing", "success"];
  const labels: Record<Stage, string> = { capture: "Capture", processing: "Clearing", success: "Done" };
  const idx = order.indexOf(stage);
  return (
    <ol className="flow-steps" aria-label="Progress">
      {order.map((s, i) => (
        <li key={s} className={`flow-step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}`} aria-current={i === idx ? "step" : undefined}>
          {i === idx && <motion.span layoutId="check-step-pill" className="flow-step-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span className="flow-step-dot">{i < idx ? <Check size={10} strokeWidth={3.4} /> : i + 1}</span>
          <span className="flow-step-label">{labels[s]}</span>
        </li>
      ))}
    </ol>
  );
}

/* ============================================================
   One side of the check: viewfinder, shutter, fallback picker
   ============================================================ */

function CheckSlot({
  side, value, active, onActivate, onCapture, onClear,
}: {
  side: Side;
  value: string | null;
  /** True while this slot owns the camera (only one viewfinder at a time). */
  active: boolean;
  onActivate: () => void;
  onCapture: (image: string) => void;
  onClear: () => void;
}) {
  const copy = SIDE_COPY[side];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "unavailable">("idle");
  const [reason, setReason] = useState("");
  // A permission prompt can outlive the tap that opened it: runId makes the
  // late answer a no-op if the user moved to the other side meanwhile.
  const runId = useRef(0);

  const stopStream = useCallback(() => {
    runId.current += 1;
    setStream(prev => {
      prev?.getTracks().forEach(track => track.stop());
      return null;
    });
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus(s => (s === "live" || s === "starting" ? "idle" : s));
  }, []);

  // The <video> only exists once the stream is in state, so attach it there.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    const playing = video.play();
    if (playing) playing.catch(() => { /* autoplay guard — the frame is still there */ });
    return () => { video.srcObject = null; };
  }, [stream]);

  // Never leave the camera light on: release it when the slot is no longer the
  // active one and when this side unmounts.
  useEffect(() => () => {
    runId.current += 1;
    setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
  }, []);
  useEffect(() => {
    if (active) return;
    stopStream();
  }, [active, stopStream]);

  async function openCamera() {
    onActivate();
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setReason("This browser can't open a camera stream here — use your camera app instead.");
      setStatus("unavailable");
      return;
    }
    runId.current += 1;
    const mine = runId.current;
    setStatus("starting");
    setReason("");
    try {
      const next = await media.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      if (runId.current !== mine) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      setStream(next);
      setStatus("live");
    } catch (err) {
      if (runId.current !== mine) return;
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setReason(denied ? "Camera permission is blocked — allow it, or use your camera app below." : "No camera answered — use your camera app below.");
      setStatus("unavailable");
    }
  }

  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const width = Math.min(1600, video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((video.videoHeight || width) * (width / video.videoWidth));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const shot = await shrink(canvas.toDataURL("image/jpeg", 0.9));
    onCapture(shot);
    stopStream();
  }

  async function pickFromDevice(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const shot = await shrink(await readFileAsDataUrl(file));
      onCapture(shot);
      setStatus("idle");
    } catch (err) {
      setReason(err instanceof Error ? err.message : "That image could not be read.");
      setStatus("unavailable");
    }
  }

  if (value) {
    return (
      <motion.div className={`check-slot captured side-${side}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}>
        <img className="check-shot" src={value} alt={`${copy.title} as captured`} />
        <span className="check-captured-tag"><Check size={12} /> {copy.done}</span>
        <button type="button" className="check-retake" onClick={onClear}>
          <RefreshCw size={12} /> Retake
        </button>
      </motion.div>
    );
  }

  if (active && status === "live") {
    return (
      <div className={`check-slot is-live side-${side}`}>
        <video ref={videoRef} className="check-viewfinder" playsInline muted autoPlay />
        <div className="check-scan-frame" aria-hidden="true">
          <span /><span /><span /><span />
          <motion.i className="check-scan-line" initial={{ top: "8%" }} animate={{ top: ["8%", "88%", "8%"] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }} />
        </div>
        <div className="check-cam-controls">
          <button type="button" className="check-cam-shutter" onClick={snap} aria-label={`Capture ${copy.title}`}>
            <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} />
          </button>
          <button type="button" className="check-cam-cancel" onClick={onClear}><X size={13} /> Cancel</button>
        </div>
      </div>
    );
  }

  if (active && status === "starting") {
    return (
      <div className={`check-slot is-live side-${side}`}>
        <div className="check-slot-empty">
          <RefreshCw size={24} className="spin" />
          <strong>Opening the camera…</strong>
          <small>Point it at the {copy.title.toLowerCase()}</small>
        </div>
      </div>
    );
  }

  const unavailable = active && status === "unavailable";
  return (
    <div className={`check-slot ${unavailable ? "needs-file" : ""} side-${side}`}>
      {unavailable ? (
        <div className="check-slot-empty">
          <AlertTriangle size={22} className="check-warn" />
          <strong>Camera not available</strong>
          <small>{reason}</small>
          {/* The native camera app: this is the path that always works on a phone. */}
          <label className="check-file-btn">
            <Camera size={14} /> Take photo
            <input type="file" accept="image/*" capture="environment" onChange={pickFromDevice} />
          </label>
          <label className="check-file-link">
            <ImageIcon size={12} /> Choose an existing photo
            <input type="file" accept="image/*" onChange={pickFromDevice} />
          </label>
        </div>
      ) : (
        <button type="button" className="check-slot-empty as-button" onClick={openCamera} aria-label={`Open the camera for the ${copy.title.toLowerCase()}`}>
          <Camera size={24} />
          <strong>Snap {copy.title}</strong>
          <small>{copy.hint}</small>
          <span className="check-slot-cta">Open camera</span>
        </button>
      )}
    </div>
  );
}

/* ============================================================
   Stages
   ============================================================ */

function ProcessingStage({ issuer, checkNumber, amount, acct, onDone }: {
  issuer: string; checkNumber: string; amount: number; acct: string; onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  const stepMs = reduce ? 200 : 780;
  useEffect(() => {
    if (index >= STEPS.length) {
      const t = window.setTimeout(() => doneRef.current(), reduce ? 120 : 520);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setIndex(i => i + 1), stepMs);
    return () => window.clearTimeout(t);
  }, [index, stepMs, reduce]);

  const progress = Math.min(1, index / STEPS.length);
  const finished = index >= STEPS.length;
  const track: Track = {
    from: {
      label: issuer || "Your check",
      sub: checkNumber ? `Check #${checkNumber}` : "Mobile deposit",
      icon: <Camera size={18} />,
    },
    to: { label: "Veyra Checking", sub: `•••• ${acct}`, icon: <VeyraMark width={20} height={20} /> },
  };

  return (
    <div className="flow-pane flow-processing" aria-live="polite">
      <div className="flow-processing-head">
        <span className={`flow-orbit ${finished ? "is-done" : ""}`}><i /><Camera size={20} /></span>
        <h2 className="flow-title" id="check-title">{finished ? "Wrapping up…" : "Depositing your check"}</h2>
        <p className="flow-sub"><b>{money(amount)}</b> · {Math.round(progress * 100)}% complete</p>
      </div>
      <FlowTrack from={track.from} to={track.to} state={finished ? "done" : "moving"} progress={progress} />
      <div className="flow-progress"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: progress }} transition={{ duration: 0.5, ease }} /></div>
      <ul className="flow-steplist">
        {STEPS.map((label, i) => {
          const state = i < index ? "done" : i === index ? "active" : "pending";
          return (
            <motion.li key={label} className={state} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
              <span className="flow-step-icon">
                {state === "done" ? (
                  <motion.span className="flow-step-check" initial={{ scale: 0, rotate: -60 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
                    <Check size={12} strokeWidth={3.2} />
                  </motion.span>
                ) : state === "active" ? <span className="flow-step-spin" /> : null}
              </span>
              <span>{label}</span>
            </motion.li>
          );
        })}
      </ul>
      <p className="flow-secure"><ShieldCheck size={14} /> Bank-grade encryption in transit and at rest</p>
    </div>
  );
}

function SuccessStage({ result, issuer, checkNumber, acct, onAgain, onClose }: {
  result: MoveResult; issuer: string; checkNumber: string; acct: string; onAgain: () => void; onClose: () => void;
}) {
  const amount = useCountUp(result.amount, { from: 0, duration: 900 });
  const newBalance = useCountUp(result.balanceAfter, { from: result.balanceBefore, duration: 1500 });
  const rows = [
    { label: "Reference", value: result.reference },
    { label: "Date", value: longDate(result.date) },
    { label: "From", value: issuer },
    { label: "Check", value: `#${checkNumber}` },
    { label: "Method", value: "Mobile check deposit" },
    { label: "Available", value: "Now" },
    { label: "Fee", value: "$0.00", tone: "free" as const },
  ];
  const download = () =>
    downloadFile(`veyra-check-deposit-${result.reference}.txt`, [
      "VEYRA — MOBILE CHECK DEPOSIT RECEIPT",
      "========================================",
      `Reference:      ${result.reference}`,
      `Date:           ${longDate(result.date)}`,
      `Amount:         ${money(result.amount)}`,
      `From:           ${issuer}`,
      `Check number:   #${checkNumber}`,
      `Account:        Checking •••• ${acct}`,
      `New balance:    ${money(result.balanceAfter)}`,
      "",
      "Keep the paper check for 7 days, then destroy it.",
    ].join("\n"));

  return (
    <div className="flow-pane flow-success">
      <Confetti palette={CONFETTI_GREEN} />
      <AnimatedCheck tone="green" />
      <motion.h2 className="flow-title" id="check-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        Check deposited
      </motion.h2>
      <motion.strong className="flow-amount is-in" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4, type: "spring", stiffness: 260, damping: 20 }}>
        +{money(amount)}
      </motion.strong>
      <motion.p className="flow-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
        Now available in Checking •••• {acct}
      </motion.p>
      <div className="receipt">
        {rows.map((r, i) => (
          <motion.div key={r.label} className={`receipt-row ${r.tone ?? ""}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.55 + i * 0.06 }}>
            <span>{r.label}</span><b>{r.value}</b>
          </motion.div>
        ))}
        <motion.div className="receipt-total" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + rows.length * 0.06 }}>
          <span>New balance</span><b>{money(newBalance)}</b>
        </motion.div>
      </div>
      <div className="flow-actions three">
        <button type="button" className="ghost-btn" onClick={download}><Lock size={15} /> Receipt</button>
        <button type="button" className="ghost-btn" onClick={onAgain}>Deposit another</button>
        <button type="button" className="solid-btn" onClick={onClose} autoFocus>Done</button>
      </div>
    </div>
  );
}

/* ============================================================
   The sheet
   ============================================================ */

export function MobileCheckDepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, depositCheck } = useAcct();

  const [stage, setStage] = useState<Stage>("capture");
  const [issuer, setIssuer] = useState("");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState<Side | null>(null);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [error, setError] = useState("");
  const captured = useRef<{ issuer: string; checkNumber: string; amount: number } | null>(null);

  const acct = account?.bankDetails.accountNumber.slice(-4) ?? "0000";
  const value = parseFloat(amount) || 0;

  const reset = useCallback(() => {
    setStage("capture");
    setIssuer(""); setAmount(""); setCheckNumber(""); setMemo("");
    setFront(null); setBack(null); setActiveSide(null); setResult(null);
    setError("");
    captured.current = null;
  }, []);

  // Same manners as the money flow: Escape closes (never mid-processing), the
  // page behind stays put, and closing resets so the next open is a fresh form.
  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    return unlock;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stage !== "processing") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, onClose]);
  useEffect(() => { if (!open) reset(); }, [open, reset]);

  const finish = useCallback(() => {
    const shot = captured.current;
    if (!shot) return;
    const chkNum = shot.checkNumber || String(Math.floor(1000 + Math.random() * 9000));
    const chkIssuer = shot.issuer || "Client / Employer";
    try {
      const r = depositCheck(chkNum, chkIssuer, shot.amount, memo.trim() || undefined);
      setResult(r);
      setStage("success");
    } catch (err) {
      // Back to the form with the reason in the sheet, where the retry button is
      // — a bottom-anchored toast would sit on top of it on a phone.
      setError(err instanceof Error ? err.message : "The deposit could not be completed. Please try again.");
      setStage("capture");
    }
  }, [depositCheck, memo]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value || value <= 0) {
      setError("Enter the amount written on the front of the check.");
      return;
    }
    if (!front || !back) {
      setError(!front && !back ? "Capture both sides of the check." : `Capture the ${front ? "endorsed back" : "front"} of the check.`);
      return;
    }
    setError("");
    captured.current = { issuer: issuer.trim(), checkNumber: checkNumber.trim(), amount: value };
    setStage("processing");
  };

  if (!account) return null;

  let content: ReactNode = null;
  if (stage === "capture") {
    content = (
      <form className="flow-pane check-deposit-form" onSubmit={submit}>
        <h2 className="flow-title" id="check-title">Mobile check deposit</h2>
        <p className="flow-sub">
          Photograph both sides and the funds land in Checking •••• {acct}. Keep the paper check for 7 days.
        </p>

        <div className="check-photos-grid">
          <CheckSlot side="front" value={front} active={activeSide === "front"}
            onActivate={() => setActiveSide("front")} onCapture={v => { setFront(v); setError(""); }} onClear={() => { setFront(null); setActiveSide(null); }} />
          <CheckSlot side="back" value={back} active={activeSide === "back"}
            onActivate={() => setActiveSide("back")} onCapture={v => { setBack(v); setError(""); }} onClear={() => { setBack(null); setActiveSide(null); }} />
        </div>

        <label className="flow-label" htmlFor="chk-issuer">Payer on the check</label>
        <input className="check-field" id="chk-issuer" required placeholder="e.g. Acme Payroll Corp" value={issuer} onChange={e => { setIssuer(e.target.value); setError(""); }} />

        <label className="flow-label" htmlFor="chk-amount">Amount written on the check</label>
        <div className={`flow-amount-field ${error && (!value || value <= 0) ? "is-invalid" : ""}`}>
          <span>$</span>
          <input id="chk-amount" type="number" inputMode="decimal" min="1" step="0.01" required placeholder="0.00" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }} />
        </div>

        <div className="check-fields">
          <div>
            <label className="flow-label" htmlFor="chk-num">Check number</label>
            <input className="check-field" id="chk-num" required inputMode="numeric" placeholder="Top right, e.g. 1042" value={checkNumber} onChange={e => { setCheckNumber(e.target.value); setError(""); }} />
          </div>
          <div>
            <label className="flow-label" htmlFor="chk-memo">Memo (optional)</label>
            <input className="check-field" id="chk-memo" placeholder="e.g. March consulting pay" value={memo} onChange={e => { setMemo(e.target.value); setError(""); }} />
          </div>
        </div>

        {error && (
          <p className="flow-field-error" id="chk-error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
          </p>
        )}

        <div className="check-deposit-hints">
          <ShieldCheck size={16} className="text-green" />
          <span>
            Images stay on this device until you submit. Funds credit on approval — a hold may apply to large or new-account checks.
          </span>
        </div>

        <div className="flow-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="solid-btn" disabled={!front || !back || !value}>
            <Lock size={14} /> Deposit {value ? money(value) : "check"}
          </button>
        </div>
      </form>
    );
  } else if (stage === "processing") {
    const shot = captured.current;
    content = (
      <ProcessingStage
        issuer={shot?.issuer ?? ""}
        checkNumber={shot?.checkNumber ?? ""}
        amount={shot?.amount ?? value}
        acct={acct}
        onDone={finish}
      />
    );
  } else if (stage === "success" && result) {
    const shot = captured.current;
    content = (
      <SuccessStage
        result={result}
        issuer={shot?.issuer || "Client / Employer"}
        checkNumber={shot?.checkNumber || "—"}
        acct={acct}
        onAgain={reset}
        onClose={onClose}
      />
    );
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="check-scrim"
          className="flow-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onMouseDown={e => { if (e.target === e.currentTarget && stage !== "processing") onClose(); }}
        >
          <motion.div
            className="flow-modal kind-deposit check-deposit-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile check deposit"
            initial={{ opacity: 0, y: 48, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="flow-head">
              <CheckStageDots stage={stage} />
              <button type="button" className="flow-close" onClick={onClose} aria-label="Close" disabled={stage === "processing"}><X size={16} /></button>
            </div>
            <div className="flow-body">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={stage}
                  className="flow-stage"
                  initial={{ opacity: 0, x: 32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -32 }}
                  transition={{ duration: 0.28, ease }}
                >
                  {content}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
