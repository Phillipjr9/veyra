/**
 * "Verify your phone" card. Shown on the application page and at the top of the
 * approved dashboard until the member's number is proved.
 *
 * Renders nothing when phone verification isn't enforced on this server, so a
 * deployment without Firebase looks exactly as it did before.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import PhoneCodeStep from "./PhoneCodeStep";
import { fetchPhoneStatus, submitPhoneProof, type PhoneStatus } from "../lib/phoneAuth";
import { describeAuthError } from "../lib/api";
import { useAcct } from "../lib/store";

export default function PhoneVerifyCard({ variant = "card" }: { variant?: "card" | "inline" }) {
  const { refreshAccount } = useAcct();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [proofError, setProofError] = useState("");

  const load = useCallback(async () => {
    try {
      setStatus(await fetchPhoneStatus());
      setLoadError("");
    } catch (err) {
      setLoadError(describeAuthError(err, "load your phone status").message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loadError && !status) return null;
  if (!status || !status.enforced) return null;

  if (status.verified) {
    if (variant === "inline") return null;
    return (
      <section className="phone-verify-card phone-verify-card--done" aria-label="Phone verified">
        <CheckCircle2 size={18} aria-hidden="true" />
        <p>Phone verified: {status.maskedPhone}. You can move money from this account.</p>
      </section>
    );
  }

  if (!status.valid || !status.phone || !status.maskedPhone) {
    return (
      <section className="phone-verify-card" aria-label="Phone verification">
        <h3>Verify your phone</h3>
        <p>
          The phone number on your account can't receive texts, so we can't verify it yet.
          Contact support and we'll correct it. Then you can verify it here.
        </p>
      </section>
    );
  }

  const onProof = async (idToken: string) => {
    setProofError("");
    try {
      const next = await submitPhoneProof(idToken);
      setStatus(next);
      // The account snapshot carries no phone state, but a refresh keeps other
      // parts of the shell in step with the newly verified member.
      void refreshAccount();
    } catch (err) {
      setProofError(describeAuthError(err, "verify your phone").message);
      throw err;
    }
  };

  return (
    <section className="phone-verify-card" aria-label="Phone verification">
      <header className="phone-verify-card__head">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <h3>Verify your phone</h3>
          <p>
            Confirm {status.maskedPhone} with a text message. Deposits, transfers and trading
            stay locked until this is done.
          </p>
        </div>
      </header>
      <PhoneCodeStep
        phone={status.phone}
        maskedPhone={status.maskedPhone}
        containerId="phone-verify-recaptcha"
        submitLabel="Verify phone"
        onProof={onProof}
      />
      {proofError ? <p role="alert" className="form-error">{proofError}</p> : null}
      {loadError ? <p role="alert" className="form-error">{loadError}</p> : null}
    </section>
  );
}
