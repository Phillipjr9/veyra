import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { cryptoNotificationContent, type CryptoNotification } from "../../shared/cryptoNotifications.js";
import { buildCryptoEmail } from "../../src/emails/crypto.js";
import { mailConfig, sendMail } from "./mail.js";

/** After commit only. Stable event IDs deduplicate retries, refreshes and restarts.
 * Inbox is persisted; email uses the existing best-effort delivery adapter.
 * Never accept notification data or recipients from a public API caller.
 */
export function sendCryptoNotification(db: DatabaseSync, userId: string, data: CryptoNotification) {
  try {
    const owner = db.prepare("SELECT u.email,a.account_number FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=? AND u.role='user' AND u.team_owner_id IS NULL").get(userId) as {email: string; account_number: string} | undefined;
    if (!owner) return;
    const content = cryptoNotificationContent(data);
    const id = `crypto_${createHash("sha256").update(JSON.stringify([userId, data.activity, data.status, data.reference])).digest("hex")}`;
    const inserted = db.prepare("INSERT OR IGNORE INTO notifications(id,user_id,type,title,detail,read,created_at) VALUES(?,?,'crypto',?,?,0,?)").run(id, userId, content.title, content.detail, data.occurredAt);
    if (!inserted.changes) return;
    const cfg = mailConfig();
    const mail = buildCryptoEmail({ ...data, accountLast4: owner.account_number.slice(-4) }, cfg.appUrl);
    void sendMail({ to: owner.email, ...mail, tag: `crypto-${data.activity}-${data.status}` }, cfg).catch(() => console.error("Crypto email delivery failed; account activity remains recorded."));
  } catch { console.error("Crypto notification could not be recorded; account activity is unchanged."); }
}
