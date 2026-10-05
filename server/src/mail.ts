/**
 * Transactional email delivery.
 *
 * Messages are rendered with the same building blocks as the email studio
 * (src/emails/design.ts) but with real account data, then handed to an HTTP
 * email API. No SDK or SMTP dependency: each provider is one `fetch` call.
 *
 *   MAIL_PROVIDER   resend | postmark | sendgrid | log   (unset = off)
 *   MAIL_API_KEY    API key / server token for the provider
 *   MAIL_FROM       Verified sender, e.g. "Veyra <no-reply@yourdomain.com>"
 *   APP_URL         Public origin of the app, used for links in emails
 *                   (e.g. https://app.yourdomain.com). No trailing slash.
 *
 * Delivery never blocks or fails the API request that triggered it: sends run
 * in the background and failures are logged. `log` prints the message to the
 * server console instead of sending (useful in development).
 */
import { emailShell, eyebrow, h1, p, btn, details, note } from "../../src/emails/design.js";

export type MailProvider = "resend" | "postmark" | "sendgrid" | "log" | "off";

export interface OutgoingMail { to: string; subject: string; html: string; text: string; tag: string }

export interface MailConfig { provider: MailProvider; apiKey: string; from: string; appUrl: string }

export function mailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const raw = String(env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  const provider: MailProvider = (["resend", "postmark", "sendgrid", "log"] as const).includes(raw as never)
    ? (raw as MailProvider) : "off";
  return {
    provider,
    apiKey: String(env.MAIL_API_KEY ?? "").trim(),
    from: String(env.MAIL_FROM ?? "Veyra <no-reply@veyra.dev>").trim(),
    appUrl: String(env.APP_URL ?? "http://localhost:5173").trim().replace(/\/+$/, ""),
  };
}

/** True when emails actually leave the server (not off, not console-only). */
export const mailDelivers = (cfg = mailConfig()) =>
  cfg.provider !== "off" && cfg.provider !== "log" && Boolean(cfg.apiKey);

export function describeMail(cfg = mailConfig()): string {
  if (cfg.provider === "off") return "Email: off (set MAIL_PROVIDER + MAIL_API_KEY + MAIL_FROM to send)";
  if (cfg.provider === "log") return "Email: log only (messages printed to this console)";
  if (!cfg.apiKey) return `Email: ${cfg.provider} selected but MAIL_API_KEY is missing — nothing will be sent`;
  return `Email: ${cfg.provider} · from ${cfg.from} · links to ${cfg.appUrl}`;
}

/** Splits "Name <addr>" into its parts (Postmark/Resend take the string; SendGrid wants an object). */
function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from };
}

async function deliver(cfg: MailConfig, mail: OutgoingMail): Promise<void> {
  if (cfg.provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, tags: [{ name: "type", value: mail.tag }] }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } else if (cfg.provider === "postmark") {
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": cfg.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ From: cfg.from, To: mail.to, Subject: mail.subject, HtmlBody: mail.html, TextBody: mail.text, Tag: mail.tag, MessageStream: "outbound" }),
    });
    if (!r.ok) throw new Error(`Postmark ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } else if (cfg.provider === "sendgrid") {
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to }] }], from: parseFrom(cfg.from), subject: mail.subject,
        content: [{ type: "text/plain", value: mail.text }, { type: "text/html", value: mail.html }], categories: [mail.tag],
      }),
    });
    if (!r.ok) throw new Error(`SendGrid ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

/** Last messages handed to the mailer — inspected by the API test suite. */
export const recentMail: OutgoingMail[] = [];

/** Queues a message. Never throws; resolves once the attempt has finished. */
export function sendMail(mail: OutgoingMail, cfg = mailConfig()): Promise<void> {
  recentMail.push(mail);
  if (recentMail.length > 50) recentMail.shift();
  if (cfg.provider === "off") return Promise.resolve();
  if (cfg.provider === "log" || !cfg.apiKey) {
    if (cfg.provider === "log") console.log(`[mail] → ${mail.to} · ${mail.subject}\n${mail.text}\n`);
    return Promise.resolve();
  }
  return deliver(cfg, mail).catch(err => {
    console.error(`[mail] failed to send "${mail.tag}" to ${mail.to}: ${err instanceof Error ? err.message : err}`);
  });
}

/* ---------------------------------------------------------------- messages */

const firstName = (name: string) => (name.trim().split(/\s+/)[0] || "there");
const when = () => new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const build = (to: string, tag: string, subject: string, preheader: string, content: string, text: string): OutgoingMail =>
  ({ to, tag, subject, text, html: emailShell({ subject, preheader, content }) });

export function passwordResetMail(to: string, name: string, token: string, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/forgot-password?token=${encodeURIComponent(token)}`;
  return build(to, "password-reset", "Reset your Veyra password", "This link expires in 30 minutes and can be used once.", `
    ${eyebrow("Account access")}
    ${h1("Reset your password")}
    ${p(`Hi ${firstName(name)} — we received a request to reset the password for your Veyra account. Choose a new password using the button below.`)}
    ${btn("Choose a new password", link)}
    ${details([["Requested", when()], ["Link expires", "In 30 minutes"]])}
    ${p(`Or paste this code on the reset screen: ${token}`, { muted: true, size: 12 })}
    ${note("Didn't request this? You can safely ignore this email — your password won't change. The link can only be used once.")}
  `, `Hi ${firstName(name)},\n\nReset your Veyra password: ${link}\n\nOr paste this code on the reset screen: ${token}\n\nThe link expires in 30 minutes and can be used once. If you didn't request this, ignore this email.`);
}

export function applicationReceivedMail(to: string, name: string, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/application`;
  return build(to, "welcome", "We've received your Veyra application", "Most applications are reviewed within 1–2 business days.", `
    ${eyebrow("Welcome to Veyra")}
    ${h1("Your application is in review")}
    ${p(`Thanks, ${firstName(name)}. A specialist is reviewing your details now — most applications are decided within 1–2 business days. We'll email you as soon as there's news.`)}
    ${btn("Check application status", link)}
    ${note("You never need to send your password or ID by email. Veyra will only ask for documents inside the app.")}
  `, `Thanks, ${firstName(name)}.\n\nWe've received your Veyra application and a specialist is reviewing it. Most are decided within 1–2 business days.\n\nCheck status: ${link}`);
}

export function kycDecisionMail(
  to: string, name: string, decision: "approved" | "needs_attention" | "rejected", reason: string, cfg = mailConfig(),
): OutgoingMail {
  const n = firstName(name);
  if (decision === "approved") {
    const link = `${cfg.appUrl}/#/app`;
    return build(to, "kyc-approved", "Your Veyra account is approved", "Your dashboard is unlocked — sign in to get started.", `
      ${eyebrow("Application approved")}
      ${h1("You're all set")}
      ${p(`Good news, ${n} — your Veyra account has been approved and your dashboard is now unlocked.`)}
      ${btn("Open my dashboard", link)}
    `, `Good news, ${firstName(name)} — your Veyra account is approved.\n\nOpen your dashboard: ${link}`);
  }
  const link = `${cfg.appUrl}/#/application`;
  if (decision === "needs_attention") {
    return build(to, "kyc-action", "We need a little more from you", "Action needed on your Veyra application.", `
      ${eyebrow("Action needed")}
      ${h1("We need a little more information")}
      ${p(`Hi ${n} — our review team needs a few more details before we can open your account.`)}
      ${details([["Reviewer note", reason]])}
      ${btn("Update my application", link)}
    `, `Hi ${firstName(name)},\n\nWe need a little more information to finish reviewing your application.\n\nReviewer note: ${reason}\n\nUpdate it here: ${link}`);
  }
  return build(to, "kyc-changes", "About your Veyra application", "An update on your Veyra application.", `
    ${eyebrow("Application update")}
    ${h1("We couldn't approve your application")}
    ${p(`Hi ${n} — after reviewing your application we're unable to open an account at this time.`)}
    ${details([["Reason", reason]])}
    ${p("If you think this is a mistake, reply to this email or contact support and we'll take another look.", { muted: true })}
    ${btn("View application", link, "light")}
  `, `Hi ${firstName(name)},\n\nWe're unable to open an account at this time.\n\nReason: ${reason}\n\nView your application: ${link}`);
}

/** Confirms a support request was received and gives the customer its reference. */
export function supportReceivedMail(to: string, name: string, reference: string, subject: string, member: boolean, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/app/support-desk`;
  return build(to, "support-received", `We've got your message [${reference}]`, "A specialist will reply soon — usually within one business day.", `
    ${eyebrow("Support")}
    ${h1("We've received your message")}
    ${p(`Thanks, ${firstName(name)}. Your request is in our support queue and a specialist will reply soon — usually within one business day.`)}
    ${details([["Reference", reference], ["Subject", subject]])}
    ${member ? btn("View the conversation", link) : p("We'll reply to this email address.", { muted: true })}
  `, `Thanks, ${firstName(name)}.\n\nWe've received your message (reference ${reference}: ${subject}). A specialist will reply soon.${member ? `\n\nView the conversation: ${link}` : ""}`);
}

/** A staff reply on a support conversation. */
export function supportReplyMail(to: string, name: string, reference: string, subject: string, reply: string, member: boolean, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/app/support-desk`;
  return build(to, "support-reply", `Re: ${subject} [${reference}]`, reply.slice(0, 120), `
    ${eyebrow(`Support · ${reference}`)}
    ${h1("You have a reply from Veyra support")}
    ${p(`Hi ${firstName(name)},`)}
    ${p(reply)}
    ${member ? btn("Reply in the app", link) : p("Reply via the support form on our website and include your reference.", { muted: true })}
    ${note("Veyra will never ask for your password, full card number or one-time codes over email.")}
  `, `Hi ${firstName(name)},\n\n${reply}\n\n— Veyra support (${reference})${member ? `\n\nReply in the app: ${link}` : ""}`);
}

/** Alerts the team's shared inbox (SUPPORT_INBOX) about a new ticket. */
export function supportInboxMail(to: string, reference: string, subject: string, from: string, body: string, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/app/superadmin`;
  return build(to, "support-inbox", `[${reference}] ${subject}`, `New support request from ${from}`, `
    ${eyebrow("New support request")}
    ${h1(subject)}
    ${details([["Reference", reference], ["From", from]])}
    ${p(body)}
    ${btn("Open the operations queue", link)}
  `, `New support request ${reference} from ${from}\n\n${subject}\n\n${body}\n\nOperations queue: ${link}`);
}

/** Invitation for a teammate to join a business on Veyra. */
export function teamInviteMail(to: string, name: string, inviter: string, business: string, role: string, token: string, cfg = mailConfig()): OutgoingMail {
  const link = `${cfg.appUrl}/#/invite/accept?token=${encodeURIComponent(token)}`;
  return build(to, "team-invite", `${inviter} invited you to ${business} on Veyra`, `Join as ${role}. This invitation expires in 7 days.`, `
    ${eyebrow("Team invitation")}
    ${h1(`Join ${business} on Veyra`)}
    ${p(`Hi ${firstName(name)} — ${inviter} has invited you to ${business}'s Veyra business account as ${role === "Admin" ? "an" : "a"} ${role}.`)}
    ${details([["Business", business], ["Your role", role], ["Invited by", inviter], ["Expires", "In 7 days"]])}
    ${btn("Accept invitation", link)}
    ${note("You'll choose your own password — you never need the account owner's. If you weren't expecting this, you can ignore it.")}
  `, `Hi ${firstName(name)},\n\n${inviter} invited you to ${business} on Veyra as ${role}.\n\nAccept: ${link}\n\nThis invitation expires in 7 days.`);
}
