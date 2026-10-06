import { createPortal } from "react-dom";
import { FundingDialog } from "./BankingControls";

/** No check-collection provider is connected. Route this entry point to the
 * member's configured manual instructions rather than simulating OCR/clearance
 * or collecting check photos that never leave the browser. */
export function MobileCheckDepositModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? createPortal(<FundingDialog close={onClose} kind="check" />, document.body) : null;
}
