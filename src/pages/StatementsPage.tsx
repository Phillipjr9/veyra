import { useState, useRef, useMemo, useEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  FileText, Download, Printer, ShieldCheck, Eye
} from "lucide-react";
import { useAcct, money, shortDate, type Txn } from "../lib/store";
import { useToast } from "../components/Toast";
import { apiGet } from "../lib/api";
import { COMPANY, companyAddress } from "../lib/company";

type MailingProfile = Record<string, string | undefined>;
/** The member's mailing address from their application (business address for business accounts). */
function mailingLines(profile: MailingProfile | null, business: boolean): string[] {
  if (!profile) return [];
  const k = (personal: string, biz: string) => (business && profile[biz] ? profile[biz] : profile[personal]) || "";
  const line1 = k("addressLine1", "bizAddressLine1");
  if (!line1) return [];
  const line2 = k("addressLine2", "bizAddressLine2");
  const cityLine = [k("city", "bizCity"), [k("state", "bizState"), k("postalCode", "bizPostalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line1, line2, cityLine].filter(Boolean);
}
import { VeyraMark } from "../components/VeyraMark";

export function StatementsPage() {
  const { account, user, exportCSV } = useAcct();
  const toast = useToast();
  const [mailingProfile, setMailingProfile] = useState<MailingProfile | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<{ profile: MailingProfile | null }>("/api/me/profile")
      .then(({ profile }) => { if (live) setMailingProfile(profile); })
      .catch(() => { /* the statement still renders without an address */ });
    return () => { live = false; };
  }, []);

  const [selectedMonth, setSelectedMonth] = useState<string>("current");
  const [statementModal, setStatementModal] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => window.innerWidth <= 768 ? "cards" : "table");
  const printRef = useRef<HTMLDivElement>(null);

  if (!account || !user) return null;

  // Group transactions by calendar month and sort transactions by date descending
  const monthlyGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; periodStart: number; periodEnd: number; txns: Txn[] }>();
    const now = Date.now();
    const currDate = new Date(now);
    const currKey = `${currDate.getFullYear()}-${String(currDate.getMonth() + 1).padStart(2, "0")}`;

    // Ensure months with transactions are gathered
    account.transactions.forEach(t => {
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();
      const existing = map.get(key);
      if (existing) {
        existing.txns.push(t);
      } else {
        map.set(key, {
          key,
          label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          periodStart: start,
          periodEnd: end,
          txns: [t],
        });
      }
    });

    // If current month wasn't in transactions, still ensure it exists
    if (!map.has(currKey)) {
      const currStart = new Date(currDate.getFullYear(), currDate.getMonth(), 1).getTime();
      map.set(currKey, {
        key: currKey,
        label: currDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        periodStart: currStart,
        periodEnd: now,
        txns: [],
      });
    }

    // Sort months descending (most recent first) and sort transactions within each month descending
    const sorted = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    sorted.forEach(([, data]) => {
      data.txns.sort((a, b) => b.date - a.date);
    });

    return sorted;
  }, [account.transactions]);

  // If selectedMonth is "current" or not found, select the most recent month that actually has transactions (or first month)
  const defaultMonthKey = useMemo(() => {
    const monthWithTxns = monthlyGroups.find(([, data]) => data.txns.length > 0);
    return monthWithTxns ? monthWithTxns[0] : monthlyGroups[0]?.[0] || "current";
  }, [monthlyGroups]);

  const activeStatement = useMemo(() => {
    const targetKey = selectedMonth === "current" ? defaultMonthKey : selectedMonth;
    const found = monthlyGroups.find(m => m[0] === targetKey);
    return found ? found[1] : monthlyGroups[0]?.[1];
  }, [monthlyGroups, selectedMonth, defaultMonthKey]);

  // Financial reconciliation for statement
  const stmtTxns = activeStatement?.txns || [];
  const depositsTotal = stmtTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const withdrawalsTotal = stmtTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const feesTotal = stmtTxns.reduce((s, t) => s + (t.fee ?? 0), 0);
  const rewardsEarnedTotal = stmtTxns.reduce((s, t) => s + (t.reward || 0), 0);
  const scoutSavedTotal = stmtTxns.reduce((s, t) => s + (t.scout || 0), 0);

  // Starting balance calculation. The cash effect of every ledger row is
  // amount - fee, so fees are added back when reconstructing the opening balance.
  const endingBalance = account.balance;
  const startingBalance = Math.max(0, endingBalance - depositsTotal + withdrawalsTotal + feesTotal);

  // Reconcile balances chronologically, then display the selected statement order.
  const runningBalances = useMemo(() => {
    let running = startingBalance;
    const values = new Map<string, number>();
    [...stmtTxns].sort((a, b) => a.date - b.date).forEach(txn => {
      running += txn.amount - (txn.fee ?? 0);
      values.set(txn.id, running);
    });
    return values;
  }, [stmtTxns, startingBalance]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (!activeStatement) return;
    // A4 portrait: the whole statement is designed to print on one page width
    // with a compact, audit-ready type scale instead of a landscape letter sheet.
    const document = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const margin = 32;
    const right = pageWidth - margin;

    document.setFillColor(33, 24, 45);
    document.rect(0, 0, pageWidth, 58, "F");
    document.setTextColor(255, 255, 255);
    document.setFont("helvetica", "bold");
    document.setFontSize(18);
    document.text("VEYRA", margin, 28);
    document.setFontSize(7);
    document.setFont("helvetica", "normal");
    document.text("Internal ledger record · not a bank statement", margin, 43);
    document.setFont("helvetica", "bold");
    document.setFontSize(10.5);
    document.text("ACCOUNT STATEMENT", right, 25, { align: "right" });
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text(activeStatement.label, right, 40, { align: "right" });

    document.setTextColor(24, 23, 29);
    document.setFontSize(7.5);
    document.setFont("helvetica", "bold");
    document.text("ACCOUNT HOLDER", margin, 82);
    document.setFont("helvetica", "normal");
    document.setFontSize(10);
    document.text(isPersonal ? user.name : (user.business || user.name), margin, 95);
    document.setFontSize(7.5);
    document.text(`Attn: ${user.name}`, margin, 107);
    document.text(`Phone: ${user.phone || "Not provided"}`, margin, 118);
    document.text(user.email, margin, 129);

    document.setFont("helvetica", "bold");
    document.text("ACCOUNT DETAILS", 300, 82);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text(`Account: XXXX XXXX ${account.bankDetails.accountNumber.slice(-4)}`, 300, 95);
    document.text(`Routing (ABA): ${account.bankDetails.routingNumber}`, 300, 107);
    document.text(`Type: ${account.bankDetails.accountType}`, 300, 118);
    document.text(`Statement ID: VYR-${activeStatement.key.replace("-", "")}-${account.bankDetails.accountNumber.slice(-4)}`, 300, 129);

    document.setFillColor(247, 244, 252);
    document.roundedRect(300, 142, pageWidth - 300 - margin, 72, 6, 6, "F");
    document.setFont("helvetica", "bold");
    document.setFontSize(7);
    document.text("ACCOUNT SUMMARY", 310, 156);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text(`Starting balance: ${money(startingBalance)}`, 310, 169);
    document.text(`Deposits / credits: +${money(depositsTotal)}`, 310, 181);
    document.text(`Withdrawals / debits: -${money(withdrawalsTotal)}`, 310, 193);
    document.text(`Transaction fees: -${money(feesTotal)}`, 310, 205);
    document.setFont("helvetica", "bold");
    document.text(`Ending balance: ${money(endingBalance)}`, right - 10, 205, { align: "right" });

    autoTable(document, {
      startY: 232,
      margin: { left: margin, right: margin, bottom: 34 },
      head: [["Date", "Reference", "Description / Payee", "Method", "Category", "Rewards", "Fee", "Amount", "Balance"]],
      body: stmtTxns.map(txn => [
        shortDate(txn.date),
        txn.reference || `REF-${txn.id.slice(0, 7).toUpperCase()}`,
        `${txn.merchant}${txn.note ? ` - ${txn.note}` : ""}`,
        txn.method || "Debit",
        txn.category,
        txn.reward > 0 ? `+${money(txn.reward)}` : "-",
        (txn.fee ?? 0) > 0 ? `-${money(txn.fee ?? 0)}` : "-",
        `${txn.amount > 0 ? "+" : "-"}${money(Math.abs(txn.amount))}`,
        money(runningBalances.get(txn.id) ?? startingBalance),
      ]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 6.4, cellPadding: 3.2, lineColor: [232, 228, 238], lineWidth: .35, textColor: [35, 32, 40] },
      headStyles: { fillColor: [66, 49, 101], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.2 },
      columnStyles: {
        0: { cellWidth: 38 }, 1: { cellWidth: 56 }, 2: { cellWidth: 142 }, 3: { cellWidth: 42 },
        4: { cellWidth: 52 }, 5: { cellWidth: 38, halign: "right" }, 6: { cellWidth: 36, halign: "right" },
        7: { cellWidth: 52, halign: "right" }, 8: { cellWidth: 52, halign: "right" },
      },
      didDrawPage: data => {
        document.setFontSize(6.2);
        document.setTextColor(105, 100, 112);
        document.text("Veyra is a financial technology product, not a bank. This statement reports Veyra's internal ledger. No sponsor bank or deposit-insurance arrangement is in place.", margin, pageHeight - 18);
        document.text(`Page ${data.pageNumber}`, right, pageHeight - 18, { align: "right" });
      },
    });

    if (!stmtTxns.length) {
      document.setFontSize(8);
      document.text("No transaction activity was recorded during this statement period.", margin, 250);
    }

    document.save(`Veyra-Statement-${activeStatement.key}.pdf`);
    toast({ tone: "success", title: "Statement PDF downloaded", description: `${activeStatement.label} includes ${stmtTxns.length} transactions.` });
  };

  const handleDownloadFullCSV = () => {
    exportCSV();
    toast({
      tone: "success",
      title: "Ledger Export Complete",
      description: "Downloaded complete CSV formatted for QuickBooks and CPA audit.",
    });
  };

  const isPersonal = user.accountType === "personal";

  return (
    <div className="app-page statements-suite-page">
      <header className="app-head">
        <div>
          <span className="app-eyebrow">Internal ledger records · printable PDF and CSV</span>
          <h1>Statements & Reports</h1>
          <p className="panel-sub">
            Generate, inspect, print and download official monthly bank statements with complete institutional verification.
          </p>
        </div>
        <div className="app-head-actions">
          <button type="button" className="ghost-btn" onClick={handleDownloadFullCSV}>
            <Download size={14} /> Full Ledger (CSV)
          </button>
          <button type="button" className="solid-btn" onClick={handleDownloadPDF}>
            <Download size={14} /> Download Statement PDF
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setStatementModal(true);
            }}
          >
            <Eye size={14} /> Preview
          </button>
        </div>
      </header>

      {/* Top Selector Strip */}
      <div className="statement-period-selector-strip">
        <label htmlFor="stmt-month-select">Statement Period:</label>
        <select
          id="stmt-month-select"
          value={selectedMonth === "current" ? defaultMonthKey : selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {monthlyGroups.map(([key, data]) => (
            <option key={key} value={key}>
              {data.label} ({data.txns.length} transactions)
            </option>
          ))}
        </select>
        <button
          type="button"
          className="solid-btn sm"
          onClick={() => setStatementModal(true)}
        >
          <FileText size={14} /> Inspect Statement
        </button>
        <button
          type="button"
          className="ghost-btn sm"
          onClick={handleDownloadPDF}
        >
          <Download size={14} /> Download PDF
        </button>
      </div>

      {/* Embedded Official Statement Card (Interactive Canvas) */}
      <div className="panel statement-document-paper" ref={printRef}>
        {/* Bank & Header Band */}
        <div className="stmt-doc-header">
          <div className="stmt-bank-brand">
            <div className="stmt-logo-group">
              <VeyraMark width={28} height={28} />
              <span className="stmt-logo-text">veyra</span>
            </div>
            <p className="stmt-partner-bank">
              Veyra internal ledger record<br />
              {COMPANY.legalName}<br />
              {companyAddress}
            </p>
          </div>

          <div className="stmt-account-meta">
            <span className="stmt-badge-official">ACCOUNT STATEMENT</span>
            <div className="stmt-meta-line"><span>Statement Period:</span> <strong>{activeStatement?.label}</strong></div>
            <div className="stmt-meta-line"><span>Account Number:</span> <code>•••• •••• {account.bankDetails.accountNumber.slice(-4)}</code></div>
            <div className="stmt-meta-line"><span>Routing (ABA):</span> <code>{account.bankDetails.routingNumber}</code></div>
            <div className="stmt-meta-line"><span>Account Type:</span> <strong>{account.bankDetails.accountType}</strong></div>
          </div>
        </div>

        <div className="stmt-divider-thick" />

        {/* Customer / Holder Box */}
        <div className="stmt-customer-details-grid">
          <div className="stmt-customer-box">
            <span className="stmt-sec-title">Account Holder</span>
            <strong className="stmt-customer-name">{isPersonal ? user.name : (user.business || user.name)}</strong>
            <p className="stmt-customer-addr">
              Attn: {user.name}<br />
              {mailingLines(mailingProfile, !isPersonal).map(line => <span key={line}>{line}<br /></span>)}
              {user.phone ? <>Phone: {user.phone}</> : null}
            </p>
          </div>

          <div className="stmt-summary-box">
            <span className="stmt-sec-title">Account Summary</span>
            <div className="stmt-sum-row"><span>Starting Balance</span> <b>{money(startingBalance)}</b></div>
            <div className="stmt-sum-row"><span>Total Deposits & Credits (+{stmtTxns.filter(t => t.amount > 0).length})</span> <b className="in">+{money(depositsTotal)}</b></div>
            <div className="stmt-sum-row"><span>Total Withdrawals & Debits (−{stmtTxns.filter(t => t.amount < 0).length})</span> <b>−{money(withdrawalsTotal)}</b></div>
            <div className="stmt-sum-row"><span>Transaction Fees ({stmtTxns.filter(t => (t.fee ?? 0) > 0).length})</span> <b>−{money(feesTotal)}</b></div>
            <div className="stmt-sum-row highlight"><span>Ending Reconciled Balance</span> <strong>{money(endingBalance)}</strong></div>
            <div className="stmt-sum-row rewards"><span>Cash Back Rewards Earned</span> <b className="violet-text">+{money(rewardsEarnedTotal)}</b></div>
            {scoutSavedTotal > 0 && (
              <div className="stmt-sum-row scout"><span>Scout AI™ Negotiated Savings</span> <b className="violet-text">+{money(scoutSavedTotal)}</b></div>
            )}
          </div>
        </div>

        {/* Transaction Ledger Table with Mobile-Optimized Responsive Views */}
        <div className="stmt-table-container">
          <div className="stmt-table-title">
            <div>
              <h3>Transaction Activity</h3>
              <span>{stmtTxns.length} recorded line items for {activeStatement?.label}</span>
            </div>
            <div className="stmt-view-toggle">
              <button
                type="button"
                className={`stmt-toggle-btn ${viewMode === "table" ? "active" : ""}`}
                onClick={() => setViewMode("table")}
              >
                Table
              </button>
              <button
                type="button"
                className={`stmt-toggle-btn ${viewMode === "cards" ? "active" : ""}`}
                onClick={() => setViewMode("cards")}
              >
                Cards (Mobile)
              </button>
            </div>
          </div>

          {/* Standard Responsive Table View (with horizontal scroll wrapper) */}
          <div className={`stmt-table-responsive-wrapper ${viewMode === "cards" ? "statement-view-hidden" : ""}`}>
            <table className="stmt-pdf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference #</th>
                  <th>Description / Payee</th>
                  <th>Method</th>
                  <th>Category</th>
                  <th className="ta-r">Rewards</th>
                  <th className="ta-r">Fee</th>
                  <th className="ta-r">Amount</th>
                  <th className="ta-r">Balance</th>
                </tr>
              </thead>
              <tbody>
              {stmtTxns.map(t => {
                  return (
                    <tr key={t.id}>
                      <td className="stmt-col-date">{shortDate(t.date)}</td>
                      <td className="stmt-col-ref"><code>{t.reference || `REF-${t.id.slice(0, 7).toUpperCase()}`}</code></td>
                      <td className="stmt-col-desc">
                        <strong className="stmt-merchant-name">{t.merchant}</strong>
                        {t.note && <small className="stmt-note-sub"> · {t.note}</small>}
                      </td>
                      <td className="stmt-col-method"><span className="stmt-method-pill">{t.method || "Debit"}</span></td>
                      <td className="stmt-col-cat"><span className="stmt-cat-pill">{t.category}</span></td>
                      <td className="ta-r in stmt-col-rewards">{t.reward > 0 ? `+${money(t.reward)}` : "—"}</td>
                      <td className="ta-r stmt-col-fee">{(t.fee ?? 0) > 0 ? `−${money(t.fee ?? 0)}` : "—"}</td>
                      <td className={`ta-r stmt-col-amount ${t.amount > 0 ? "in" : ""}`}>
                        <strong>{t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}</strong>
                      </td>
                    <td className="ta-r stmt-col-bal">{money(runningBalances.get(t.id) ?? startingBalance)}</td>
                    </tr>
                  );
                })}

                {!stmtTxns.length && (
                  <tr>
                    <td colSpan={9} className="stmt-empty-td">
                      No transactions recorded during this calendar period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View (Perfect alignment on 320px–640px devices) */}
          <div className={`stmt-mobile-cards-list ${viewMode === "table" ? "statement-view-hidden" : ""}`}>
            {stmtTxns.map(t => (
              <div key={t.id} className="stmt-mobile-txn-card">
                <div className="stmt-m-card-top">
                  <div className="stmt-m-meta">
                    <span className="stmt-m-date">{shortDate(t.date)}</span>
                    <span className="stmt-m-ref">{t.reference || `REF-${t.id.slice(0, 7).toUpperCase()}`}</span>
                  </div>
                  <strong className={`stmt-m-amount ${t.amount > 0 ? "in" : ""}`}>
                    {t.amount > 0 ? "+" : "−"}{money(Math.abs(t.amount))}
                  </strong>
                </div>

                <div className="stmt-m-card-mid">
                  <strong className="stmt-m-merchant">{t.merchant}</strong>
                  {t.note && <p className="stmt-m-note">{t.note}</p>}
                </div>

                <div className="stmt-m-card-bottom">
                  <div className="stmt-m-badges">
                    <span className="stmt-method-pill">{t.method || "Debit"}</span>
                    <span className="stmt-cat-pill">{t.category}</span>
                  </div>
                  <div className="stmt-m-bal">
                    {t.reward > 0 && <span className="in">+{money(t.reward)} back</span>}
                    {(t.fee ?? 0) > 0 && <span>Fee −{money(t.fee ?? 0)}</span>}
                    <small>Bal: {money(runningBalances.get(t.id) ?? startingBalance)}</small>
                  </div>
                </div>
              </div>
            ))}

            {!stmtTxns.length && (
              <div className="stmt-empty-mobile">
                <p>No transactions recorded during this calendar period.</p>
              </div>
            )}
          </div>
        </div>

        {/* Legal & Regulatory Disclosures Footer */}
        <div className="stmt-legal-disclaimer">
          <div className="stmt-fdic-seal">
            <ShieldCheck size={24} />
            <div>
              <strong>Not a bank · no deposit insurance</strong>
              <p>
                Veyra is a financial technology product, not a bank. This statement reports Veyra's internal ledger for your account. No sponsor bank, payment rail, custodial account or deposit-insurance arrangement is established by this release.
              </p>
            </div>
          </div>
          <p className="stmt-fine-print">
            IN CASE OF ERRORS OR INQUIRIES ABOUT YOUR ELECTRONIC TRANSFERS: {`Message us from the Support Desk in the Veyra app, email ${COMPANY.supportEmail}${COMPANY.supportPhone ? `, call ${COMPANY.supportPhone}` : ""}, or write to Veyra Support, ${companyAddress}`} as soon as you can if you think your statement is wrong or if you need more information about a transfer. We must hear from you no later than 60 days after we sent the FIRST statement on which the problem appeared.
          </p>
        </div>
      </div>

      {/* Modal View with Print & Download Action */}
      {statementModal && (
        <div className="modal-scrim" onClick={() => setStatementModal(false)}>
          <div className="modal stmt-modal-window" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>Official Statement — {activeStatement?.label}</h3>
                <p>Ready for CPA review, tax reconciliation, and financial auditing</p>
              </div>
              <div className="modal-head-btns">
                <button type="button" className="ghost-btn sm" onClick={handlePrint}>
                  <Printer size={14} /> Print / Save PDF
                </button>
                <button type="button" className="icon-btn" onClick={() => setStatementModal(false)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="stmt-modal-preview">
              <p className="stmt-print-hint">
                💡 Tip: Use your browser's Print dialog to save this statement as a professional vector PDF.
              </p>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setStatementModal(false)}>
                Close Preview
              </button>
              <button type="button" className="solid-btn" onClick={handlePrint}>
                <Printer size={14} /> Print Statement Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
