import { useState } from "react";
import {
  Printer, Copy, Check, Send, X,
  ShieldCheck
} from "lucide-react";
import { money, shortDate, type Invoice } from "../lib/store";
import { useToast } from "./Toast";
import { VeyraMark } from "./VeyraMark";

export function InvoiceDetailModal({
  invoice,
  onClose,
  onMarkPaid,
  onSendReminder,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onMarkPaid: (inv: Invoice) => void;
  onSendReminder: (inv: Invoice) => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!invoice) return null;

  const paymentLink = `https://veyra.com/pay/inv_${invoice.id}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(paymentLink);
      setCopied(true);
      toast({
        tone: "success",
        title: "Client Payment Link Copied",
        description: paymentLink,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: "info", title: paymentLink });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal invoice-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="inv-modal-header-text">
            <h3>Invoice #{invoice.id}</h3>
            <span className={`status-pill ${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : "open"}`}>
              {invoice.status.toUpperCase()}
            </span>
          </div>
          <div className="modal-head-btns">
            <button type="button" className="ghost-btn sm" onClick={handlePrint}>
              <Printer size={14} /> Print / PDF
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Formal Paper Invoice Canvas */}
        <div className="invoice-paper-view">
          <div className="inv-paper-top">
            <div className="inv-paper-brand">
              <VeyraMark width={26} height={26} />
              <strong>VEYRA COMMERCIAL BILLING</strong>
            </div>
            <div className="inv-paper-num">
              <span>INVOICE</span>
              <strong>#{invoice.id}</strong>
            </div>
          </div>

          <div className="inv-paper-meta-grid">
            <div>
              <span className="inv-meta-label">Billed To:</span>
              <strong>{invoice.client}</strong>
              <small>{invoice.clientEmail}</small>
            </div>
            <div className="inv-meta-right">
              <div><span>Date Issued:</span> <b>{shortDate(invoice.createdAt || (invoice.due - 14 * 86400000))}</b></div>
              <div><span>Payment Due:</span> <b>{shortDate(invoice.due)}</b></div>
              <div><span>Status:</span> <b className={invoice.status === "paid" ? "in" : ""}>{invoice.status.toUpperCase()}</b></div>
            </div>
          </div>

          <div className="inv-paper-items">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="ta-r">Qty</th>
                  <th className="ta-r">Rate</th>
                  <th className="ta-r">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{invoice.description || "Professional Services & Deliverables"}</strong>
                    <small>Contractual milestone settlement</small>
                  </td>
                  <td className="ta-r">1</td>
                  <td className="ta-r">{money(invoice.amount)}</td>
                  <td className="ta-r"><strong>{money(invoice.amount)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="inv-paper-totals">
            <div className="inv-total-row"><span>Subtotal:</span> <span>{money(invoice.amount)}</span></div>
            <div className="inv-total-row"><span>Processing Fees:</span> <span className="free">$0.00</span></div>
            <div className="inv-total-row grand"><span>Total Due:</span> <strong>{money(invoice.amount)}</strong></div>
          </div>

          <div className="inv-paper-footer">
            <ShieldCheck size={16} className="text-green" />
            <span>
              Secure bank checkout powered by Veyra. Pay via Apple Pay, Credit Card, ACH, or Zelle®.
            </span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="invoice-modal-actions">
          <button type="button" className="ghost-btn" onClick={handleCopyLink}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Link Copied" : "Copy Payment Link"}
          </button>

          {invoice.status !== "paid" ? (
            <>
              {invoice.status === "overdue" && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onSendReminder(invoice)}
                >
                  <Send size={14} /> Send Email Reminder
                </button>
              )}
              <button
                type="button"
                className="solid-btn"
                onClick={() => {
                  onMarkPaid(invoice);
                  onClose();
                }}
              >
                <Check size={15} /> Mark Invoice as Paid
              </button>
            </>
          ) : (
            <span className="status-pill paid"><Check size={12} /> Settled & Deposited</span>
          )}
        </div>
      </div>
    </div>
  );
}
