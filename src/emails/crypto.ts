import { cryptoNotificationContent, type CryptoNotification } from "../../shared/cryptoNotifications.js";
import { emailShell, eyebrow, h1, p, pill, details, btn, note } from "./design.js";

export function buildCryptoEmail(data: CryptoNotification & { accountLast4?: string }, appUrl: string) {
  const content = cryptoNotificationContent(data);
  const subject = `Veyra · ${content.title} · ${content.amount}`;
  const link = `${appUrl.replace(/\/+$/, "")}/#/app/assets`;
  const rows: Array<[string, string]> = [
    ["Activity", data.activity], ["Status", data.status], ["Amount", content.amount],
    ["Account", data.accountLast4 ? `•••• ${data.accountLast4}` : "Your Veyra account"],
    ["Reference", data.reference], ["Date (UTC)", new Date(data.occurredAt).toISOString()],
    ...(data.network ? [["Network", data.network] as [string, string]] : []),
    ...(data.transactionHash ? [["Transaction hash", data.transactionHash] as [string, string]] : []),
    ...(data.confirmations !== undefined ? [["Confirmations", String(data.confirmations)] as [string, string]] : []),
  ];
  const html = emailShell({ subject, preheader: content.detail, content: `${eyebrow("Crypto activity")}${h1(content.title)}${p(content.outcome)}${pill(data.status, data.status === "failed" ? "red" : data.status === "pending" ? "amber" : "violet")}${details(rows)}${p(content.scope)}${btn("View crypto activity", link)}${note("Don’t recognize this activity? Open Veyra and contact support. Never share your password, recovery phrase or private keys.")}` });
  return { subject, html, text: `${content.title}\n\n${content.detail}\n${rows.map(([key,value]) => `${key}: ${value}`).join("\n")}\n\nView activity: ${link}\nNever share your password, recovery phrase or private keys.` };
}
