import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { BankAccountDetails, Txn } from "./store";

/** A real PDF of the recorded ledger entry, never a claim of bank/blockchain settlement. */
export async function downloadTransactionReceipt(txn: Txn, bank?: BankAccountDetails) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  doc.setFillColor(57, 35, 92); doc.rect(0, 0, 596, 110, "F");
  doc.setTextColor(255); doc.setFontSize(24); doc.text("VEYRA", 40, 48);
  doc.setFontSize(12); doc.text("Transaction receipt", 40, 77);
  doc.setTextColor(40); doc.setFontSize(22); doc.text(currency.format(txn.amount), 40, 148);
  const rows = [
    ["Status", txn.status || "Recorded"], ["Counterparty", txn.merchant],
    ["Reference", txn.reference || txn.id], ["Date", new Date(txn.date).toLocaleString("en-US")],
    ["Method", txn.method || "Not recorded"], ["Category", txn.category || "Uncategorized"],
    ...(bank ? [["Account holder", bank.holder], ["Bank", bank.bankName], ["Account type", bank.accountType], ["Account", `Ending ${bank.accountNumber.slice(-4)}`]] : []),
    ...(txn.note ? [["Memo", txn.note]] : []),
    ...(txn.reward > 0 ? [["Recorded rewards", currency.format(txn.reward)]] : []),
  ];
  autoTable(doc, { startY: 172, head: [["Details", "Recorded value"]], body: rows, margin: { left: 40, right: 40, bottom: 75 }, styles: { fontSize: 10, cellPadding: 9, overflow: "linebreak" }, headStyles: { fillColor: [88, 62, 123] }, columnStyles: { 0: { cellWidth: 130 } } });
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i); doc.setFontSize(9); doc.setTextColor(95);
    doc.text(["This receipt reflects Veyra's recorded transaction status.", "A pending entry is not proof of payment, bank settlement or blockchain confirmation."], 40, 795);
  }
  const name = (txn.reference || txn.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  await doc.save(`veyra-receipt-${name}.pdf`, { returnPromise: true });
}
