/**
 * The text-message step: send a code to one number, then check it.
 *
 * Used twice: as the second step of sign-in (Auth.tsx) and on the verify card
 * (PhoneVerifyCard.tsx). It knows nothing about either. It hands the Firebase ID
 * token to `onProof`, and whoever mounted it decides what that proof is for.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { sendPhoneCode } from "../lib/phoneAuth";

type Props = {
  /** E.164 number, e.g. +15551234567. The text goes here. */
  phone: string;
  /** Shown to the member, e.g. "+1 •••• 4567". */
  maskedPhone: string;
  /** Unique per mounted instance: reCAPTCHA renders into this element. */
  containerId: string;
  /** Receives the Firebase ID token once the code checks out. */
  onProof: (idToken: string) => Promise<void>;
  /** Button label for the final step, e.g. "Verify and sign in". */
  submitLabel: string;
  /** Called when the member wants to leave this step. Omit to hide the link. */
  onBack?: () => void;
  backLabel?: string;
};

type Stage = "idle" | "sending" | "sent" | "checking";

export default function PhoneCodeStep({ phone, maskedPhone, containerId, onProof, submitLabel, onBack, backLabel }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const handle = useRef<{ confirm: (code: string) => Promise<string>; dispose: () => void } | null>(null);

  // Release the reCAPTCHA widget when the step goes away.
  useEffect(() => () => { handle.current?.dispose(); handle.current = null; }, []);

  async function send() {
    setError(""); setStage("sending");
    try {
      handle.current?.dispose();
      handle.current = await sendPhoneCode(phone, containerId);
      setCode("");
      setStage("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send that code. Try again.");
      setStage("idle");
    }
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.current || stage === "checking") return;
    setError(""); setStage("checking");
    try {
      const idToken = await handle.current.confirm(code);
      await onProof(idToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
      setStage("sent");
    }
  }

  return (
    <div className="phone-code-step">
      {/* The invisible reCAPTCHA widget renders here. It is never visible itself. */}
      <div id={containerId} />
      {stage === "idle" || stage === "sending" ? (
        <>
          <div className="auth-code-prompt">
            <MessageSquare size={16} aria-hidden="true" />
            <div>
              <strong>We'll text a six-digit code</strong>
              <small>To {maskedPhone}. Message and data rates may apply.</small>
            </div>
          </div>
          <button className="auth-submit" type="button" disabled={stage === "sending"} onClick={() => void send()}>
            {stage === "sending" ? <Loader2 className="spin" size={16} /> : null}
            {stage === "sending" ? "Sending…" : "Text me a code"}
          </button>
        </>
      ) : (
        <form onSubmit={check}>
          <div className="auth-code-prompt">
            <MessageSquare size={16} aria-hidden="true" />
            <div>
              <strong>Enter the code</strong>
              <small>We sent it to {maskedPhone}.</small>
            </div>
          </div>
          <label htmlFor={`${containerId}-code`}>Text message code</label>
          <input id={`${containerId}-code`} type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} required autoFocus pattern="[0-9]{6}" placeholder="123456" value={code}
            disabled={stage === "checking"}
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <button className="auth-submit" type="submit" disabled={stage === "checking" || code.length !== 6}>
            {stage === "checking" ? <Loader2 className="spin" size={16} /> : null}
            {stage === "checking" ? "Checking…" : submitLabel}
          </button>
          <button className="auth-code-back" type="button" disabled={stage === "checking"} onClick={() => void send()}>
            Send a new code
          </button>
        </form>
      )}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {onBack ? (
        <button type="button" className="auth-code-back" disabled={stage === "checking" || stage === "sending"} onClick={onBack}>
          {backLabel ?? "Back"}
        </button>
      ) : null}
    </div>
  );
}
