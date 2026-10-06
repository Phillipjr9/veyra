import { useDemoPayments } from "../lib/demoPayments";
import "../styles/demo-payments.css";

export function DemoModeNotice() {
  const { data, error, refresh } = useDemoPayments();
  if (data && !data.enabled && !error) return <p className="demo-notice">{data.reason}</p>;
  if (!data || error) return <div className="demo-notice" role={error ? 'alert' : 'status'}>{error || 'Checking payment mode…'}{error && <button className="ghost-btn" onClick={() => void refresh().catch(() => {})}>Retry</button>}</div>;
  return null;
}

