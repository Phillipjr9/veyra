import type { DatabaseSync } from "node:sqlite";
import { buildZelleEmail, type ZelleMailData } from "../../src/emails/zelle.js";
import { mailConfig, sendMail } from "./mail.js";

/** Call only after the ledger/request transaction commits, and only for new
 * events. Uses the existing best-effort mailer; no provider configuration means
 * no email is delivered. Never send to an arbitrary counterparty address. */
export function sendZelleNotification(db: DatabaseSync, userId: string, data: Omit<ZelleMailData,"accountLast4">) {
  const owner = db.prepare("SELECT u.email,a.account_number FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=? AND u.role='user' AND u.team_owner_id IS NULL").get(userId) as {email:string;account_number:string}|undefined;
  if (!owner) return;
  const cfg = mailConfig();
  const message = buildZelleEmail({...data,accountLast4:owner.account_number.slice(-4)},cfg.appUrl);
  void sendMail({to:owner.email,subject:message.subject,html:message.html,text:message.text,tag:`zelle-${data.event.replace(/_/g,'-')}`},cfg);
}
