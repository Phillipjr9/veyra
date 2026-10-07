import { ArrowDownLeft, ArrowRight, ArrowUpRight, PiggyBank } from "lucide-react";
import { Link } from "react-router-dom";
import { money, shortDate, type Txn } from "../lib/store";

const SAVINGS_NOTES = new Set(["Moved to savings pocket", "Moved from savings pocket"]);

export function SavingsActivityPanel({ transactions }: { transactions: Txn[] }) {
  const activity = transactions
    .filter(transaction => SAVINGS_NOTES.has(transaction.note ?? ""))
    .sort((a, b) => b.date - a.date)
    .slice(0, 5);

  return (
    <section className="savings-activity-panel" aria-labelledby="savings-activity-title">
      <div className="savings-activity-head">
        <div>
          <span className="savings-activity-kicker">SAVINGS</span>
          <h2 id="savings-activity-title">Recent pocket activity</h2>
          <p>Recent moves between checking and your savings pockets.</p>
        </div>
        <Link to="/app/transactions" className="ghost-btn sm">
          View all activity <ArrowRight size={14} />
        </Link>
      </div>

      {activity.length ? (
        <div className="savings-activity-list">
          {activity.map(transaction => {
            const toSavings = transaction.note === "Moved to savings pocket";
            return (
              <article className="savings-activity-row" key={transaction.id}>
                <span className={`savings-activity-icon ${toSavings ? "to-savings" : "to-checking"}`} aria-hidden="true">
                  {toSavings ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                </span>
                <div className="savings-activity-copy">
                  <strong>{transaction.merchant}</strong>
                  <small>{toSavings ? "Added to savings" : "Moved to checking"} · {shortDate(transaction.date)}</small>
                </div>
                <strong className={`savings-activity-amount ${toSavings ? "to-savings" : "to-checking"}`}>
                  {toSavings ? "−" : "+"}{money(Math.abs(transaction.amount))}
                </strong>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="savings-activity-empty">
          <span><PiggyBank size={18} /></span>
          <div>
            <strong>No savings moves yet</strong>
            <p>Transfers to or from your savings pockets will show up here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
