import type { DatabaseSync } from "node:sqlite";
import { buildFundingEmail, type FundingMailData } from "../../src/emails/funding.js";
import { mailConfig, sendMail } from "./mail.js";

/** Call only after the funding request transaction commits, and only for new
 * events. Uses the existing best-effort mailer; no provider configuration means
 * no email is delivered. */
export function sendFundingNotification(db: DatabaseSync, userId: string, data: Omit<FundingMailData, "accountLast4">) {
  const owner = db.prepare("SELECT u.email,a.account_number FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=? AND u.role='user' AND u.team_owner_id IS NULL").get(userId) as { email: string; account_number: string } | undefined;
  if (!owner) return;
  const cfg = mailConfig();
  const message = buildFundingEmail({ ...data, accountLast4: owner.account_number.slice(-4) }, cfg.appUrl);
  void sendMail({ to: owner.email, subject: message.subject, html: message.html, text: message.text, tag: `funding-${data.event.replace(/_/g, "-")}` }, cfg);
}
