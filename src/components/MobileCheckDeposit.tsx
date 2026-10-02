import { useState } from "react";
import {
  Camera, Check, X, ShieldCheck,
  RefreshCw
} from "lucide-react";
import { useAcct, money } from "../lib/store";
import { useToast } from "./Toast";

export function MobileCheckDepositModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { account, user, depositCheck } = useAcct();
  const toast = useToast();

  const [step, setStep] = useState<"capture" | "processing" | "success">("capture");
  const [issuer, setIssuer] = useState("");
  const [amount, setAmount] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [frontCaptured, setFrontCaptured] = useState(false);
  const [backCaptured, setBackCaptured] = useState(false);
  const [depositedRecord, setDepositedRecord] = useState<{ amount: number; issuer: string; checkNum: string } | null>(null);

  if (!open || !account) return null;

  const handleSimulateCapture = (side: "front" | "back") => {
    if (side === "front") setFrontCaptured(true);
    else setBackCaptured(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      toast({ tone: "error", title: "Enter a valid check amount" });
      return;
    }
    if (!frontCaptured || !backCaptured) {
      toast({ tone: "error", title: "Capture required", description: "Please snap both the front and endorsed back of the check." });
      return;
    }

    setStep("processing");

    setTimeout(() => {
      const chkNum = checkNumber.trim() || String(Math.floor(1000 + Math.random() * 9000));
      const chkIssuer = issuer.trim() || "Client / Employer";
      
      depositCheck(chkNum, chkIssuer, val, memo.trim() || undefined);
      setDepositedRecord({ amount: val, issuer: chkIssuer, checkNum: chkNum });
      setStep("success");

      toast({
        tone: "success",
        title: "Check Deposited & Available",
        description: `+$${val.toLocaleString()} from ${chkIssuer} credited to checking.`,
      });
    }, 1800);
  };

  const handleReset = () => {
    setStep("capture");
    setIssuer("");
    setAmount("");
    setCheckNumber("");
    setMemo("");
    setFrontCaptured(false);
    setBackCaptured(false);
    setDepositedRecord(null);
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal check-deposit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="check-modal-title">
            <span className="check-icon-chip"><Camera size={16} /></span>
            <div>
              <h3>Mobile Check Deposit</h3>
              <p>Deposit payroll, client, or treasury checks with instant OCR clearance</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {step === "capture" && (
          <form className="dash-form check-deposit-form" onSubmit={handleSubmit}>
            {/* Camera Capture Slots */}
            <div className="check-photos-grid">
              {/* Front Slot */}
              <div
                className={`check-slot ${frontCaptured ? "captured" : ""}`}
                onClick={() => handleSimulateCapture("front")}
              >
                {frontCaptured ? (
                  <div className="check-photo-preview front">
                    <div className="check-sim-watermark">
                      <span>{issuer || "PAY TO THE ORDER OF"}</span>
                      <strong>{user?.name}</strong>
                      <b>{amount ? money(parseFloat(amount) || 0) : "$0.00"}</b>
                    </div>
                    <span className="check-captured-tag"><Check size={12} /> Front Captured</span>
                  </div>
                ) : (
                  <div className="check-slot-empty">
                    <Camera size={24} />
                    <strong>Snap Front of Check</strong>
                    <small>Align all 4 corners in frame</small>
                  </div>
                )}
              </div>

              {/* Back Slot */}
              <div
                className={`check-slot ${backCaptured ? "captured" : ""}`}
                onClick={() => handleSimulateCapture("back")}
              >
                {backCaptured ? (
                  <div className="check-photo-preview back">
                    <div className="check-sim-endorsement">
                      <p>✓ ENDORSED FOR MOBILE DEPOSIT AT VEYRA BANK ONLY</p>
                      <code>{account.bankDetails.accountNumber}</code>
                    </div>
                    <span className="check-captured-tag"><Check size={12} /> Endorsement Verified</span>
                  </div>
                ) : (
                  <div className="check-slot-empty">
                    <Camera size={24} />
                    <strong>Snap Back of Check</strong>
                    <small>Sign & write "For Mobile Deposit at Veyra"</small>
                  </div>
                )}
              </div>
            </div>

            {/* Check Metadata Inputs */}
            <div className="field-row">
              <div>
                <label htmlFor="chk-issuer">Payer / Issuer on Check</label>
                <input
                  id="chk-issuer"
                  required
                  placeholder="e.g. Acme Payroll Corp, Apple Inc."
                  value={issuer}
                  onChange={e => setIssuer(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="chk-num">Check Number (Top Right)</label>
                <input
                  id="chk-num"
                  required
                  placeholder="e.g. 1042"
                  value={checkNumber}
                  onChange={e => setCheckNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="field-row">
              <div>
                <label htmlFor="chk-amount">Check Amount ($ USD)</label>
                <div className="amount-input">
                  <span>$</span>
                  <input
                    id="chk-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="chk-memo">Deposit Memo</label>
                <input
                  id="chk-memo"
                  placeholder="e.g. March consulting pay, Tax refund"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                />
              </div>
            </div>

            <div className="check-deposit-hints">
              <ShieldCheck size={16} className="text-green" />
              <span>
                Funds credit immediately to Checking •••• {account.bankDetails.accountNumber.slice(-4)}. Hold the physical check for 7 days before voiding.
              </span>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="solid-btn"
                disabled={!frontCaptured || !backCaptured || !amount}
              >
                Deposit {amount ? money(parseFloat(amount) || 0) : "Check"} Now
              </button>
            </div>
          </form>
        )}

        {step === "processing" && (
          <div className="check-processing-state">
            <RefreshCw size={36} className="spin text-violet" />
            <h3>Processing Optical MICR & Endorsement</h3>
            <p>Scanning routing glyphs and checking funds with partner clearinghouse…</p>
          </div>
        )}

        {step === "success" && depositedRecord && (
          <div className="check-success-state">
            <div className="check-success-icon"><Check size={28} /></div>
            <h3>Check Deposit Complete</h3>
            <strong className="check-success-val">+{money(depositedRecord.amount)}</strong>
            <p>
              Check #{depositedRecord.checkNum} from {depositedRecord.issuer} cleared and is now available in your checking account.
            </p>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={handleReset}>
                Deposit Another Check
              </button>
              <button type="button" className="solid-btn" onClick={onClose}>
                View in Checking Ledger
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
