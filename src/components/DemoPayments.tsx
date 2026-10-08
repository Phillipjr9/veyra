import { useAuth } from "../lib/auth";
import { useDemoPayments } from "../lib/demoPayments";
import { isStaffUser } from "./StaffNote";
import "../styles/demo-payments.css";

/**
 * Payment-mode status. Members only ever see a real failure, with a retry. The
 * "checking" and "not enabled" lines are operational, so administrators get them.
 */
export function DemoModeNotice() {
  const { data, error, refresh } = useDemoPayments();
  const { user } = useAuth();
  if (error) return <div className="demo-notice" role="alert">{error}<button className="ghost-btn" onClick={() => void refresh().catch(() => {})}>Retry</button></div>;
  if (!isStaffUser(user)) return null;
  if (data && !data.enabled) return <p className="demo-notice">{data.reason}</p>;
  if (!data) return <div className="demo-notice" role="status">Checking payment mode…</div>;
  return null;
}
