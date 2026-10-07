import { MotionConfig, useReducedMotion } from "motion/react";
import { ArrowDownLeft, Clock3, X } from "lucide-react";
import { FlowProcessing, FlowReceipt } from "./MoneyFlow";
import { VeyraMark } from "./VeyraMark";
import { downloadFile, longDate, money } from "../lib/store";

// These describe the presentation, not simulated bank/card processing.
const ACCOUNT_STEPS = ["Preparing deposit details", "Displaying the funding method", "Preparing your account view", "Preparing the receipt"];

/** The same processing and receipt components used by Send money. */
export function FundingAnimation({ phase, amount, source, immediate, receipt, close, again, onPresented }: {
  phase: "processing" | "receipt";
  amount: number;
  source: string;
  immediate: boolean;
  receipt?: { status: string; reference: string; ledgerOnly: boolean; createdAt: number; fee?: number };
  close: () => void;
  again: () => void;
  onPresented: () => void;
}) {
  const reduce = useReducedMotion() !== false;
  const processing = phase === "processing";
  const confirmed = !processing && receipt?.status === "confirmed";
  const rejected = !processing && receipt?.status === "rejected";
  const note = immediate ? "This is an account update, not an external bank or card transfer." : "This records a request, not a bank or card transfer confirmation.";
  const rows = [
    { label: "Reference", value: receipt?.reference ?? "" },
    { label: "Date", value: receipt ? longDate(receipt.createdAt) : "" },
    { label: "From", value: source },
    { label: "To", value: "Your Veyra account" },
    { label: "Status", value: receipt?.status ?? "" },
    { label: "Available", value: "Now" },
    ...(receipt?.ledgerOnly ? [{ label: "Fee", value: (receipt.fee ?? 0) > 0 ? money(receipt.fee ?? 0) : "$0.00", tone: (receipt.fee ?? 0) > 0 ? undefined : "free" as const }] : []),
  ];
  const download = () => downloadFile(`veyra-receipt-${receipt?.reference}.txt`, [
    "VEYRA — DEPOSIT RECEIPT", `Amount: ${money(amount)}`,
    ...rows.map(row => `${row.label}: ${row.value}`), "", note,
  ].join("\n"));

  return <MotionConfig reducedMotion={reduce ? "always" : "never"}>
    <section className={`funding-animation ${processing ? "is-processing" : confirmed ? "is-confirmed" : "is-recorded"}`} data-motion={reduce ? "reduced" : "full"}>
      {processing ? <>
        <div role="status">
          <FlowProcessing title={immediate ? "Adding funds…" : "Recording your request…"} amount={amount}
            steps={ACCOUNT_STEPS} onDone={onPresented} minimumStepMs={600} awaitingConfirmation note={note}
            track={{ from: { label: source, sub: "Selected funding method", icon: <ArrowDownLeft size={20} /> },
              to: { label: immediate ? "Your Veyra account" : "Request history", sub: immediate ? "Account entry" : "Receipt review required", icon: <VeyraMark width={20} height={20} /> } }} />
        </div>
        {reduce && <p className="funding-animation-motion-note">Reduced motion is enabled. Showing a simplified account update.</p>}
      </> : confirmed ? <>
        <div role="status">
          <FlowReceipt isDeposit value={amount} title="Funds added" subtitle={receipt?.ledgerOnly ? "Funds added to your account immediately." : "Receipt confirmed by staff."}
            rows={rows} download={download} onAgain={again} onClose={close} againLabel={immediate ? "Add more funds" : "All funding methods"} />
        </div>
        <p className="funding-animation-note">{note}</p>
      </> : <div className="flow-pane flow-success">
        <div role="status">
          {rejected ? <X size={32} /> : <Clock3 size={32} />}
          <h2 className="flow-title">{rejected ? "No funds added" : "Request recorded"}</h2>
          <strong className="flow-amount">{money(amount)}</strong>
          <p className="flow-sub">{rejected ? "No funds were credited for this request." : "No funds are credited until confirmed."}</p>
          <p className="funding-animation-reference">{receipt?.reference} · {receipt?.status}</p>
        </div>
        <p className="funding-animation-note">{note}</p>
        <div className="flow-actions"><button type="button" className="ghost-btn" onClick={again}>All funding methods</button><button type="button" className="solid-btn" onClick={close}>Done</button></div>
      </div>}
    </section>
  </MotionConfig>;
}
