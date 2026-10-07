import { emailShell, eyebrow, h1, p, pill, details, btn, note, hero, type PillTone } from "./design.js";

export type AccessEvent =
  | "password_changed"
  | "two_factor_enabled" | "two_factor_disabled"
  | "passkey_added" | "passkey_removed";

export type AccessMailData = {
  event: AccessEvent;
  occurredAt: number;
  deviceLabel?: string;
  browser?: string;
  location?: string;
  /** Display name of the passkey for add/remove events. */
  passkeyName?: string;
};

const whenUTC = (at: number): string =>
  `${new Date(at).toLocaleString("en-US", { timeZone: "UTC" })} UTC`;

/**
 * Account-access confirmations: password changes, two-factor switches and
 * passkey updates. Every message names the device and time so the owner can
 * spot activity that wasn't theirs. Used by both real transactional delivery
 * and the email preview studio.
 */
export function buildAccessEmail(data: AccessMailData, appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  const link = `${base}/security`;
  const device = data.deviceLabel || "An unrecognized device";
  const safety =
    "If this wasn't you, sign in right away, review your sessions and contact support. We'll never ask for your password or one-time codes by email or phone.";

  let title = "";
  let description = "";
  let status = "";
  let tone: PillTone = "green";
  let linkLabel = "Review security settings";
  let heroFile = "hero-security.jpg";
  let heroAlt = "3D illustration of a glass shield with a padlock";
  const rows: Array<[string, string]> = [];

  switch (data.event) {
    case "password_changed":
      title = "Your password was changed";
      description = `The password for your Veyra account was just changed from ${device}. If this was you, you're all set — your other sessions stay signed in.`;
      status = "Updated";
      rows.push(["Changed", whenUTC(data.occurredAt)]);
      linkLabel = "Review account activity";
      break;
    case "two_factor_enabled":
      title = "Two-factor authentication is on";
      description = "Two-factor authentication was enabled on your account. Every new sign-in will now ask for a one-time code after your password — keep your recovery codes somewhere safe.";
      status = "Protected · 2FA on";
      rows.push(["Enabled", whenUTC(data.occurredAt)], ["Method", "Authenticator app"]);
      break;
    case "two_factor_disabled":
      title = "Two-factor authentication was turned off";
      description = "Two-factor authentication was disabled on your account, so new sign-ins only need your password. If you didn't do this, re-enable it now and review your sessions.";
      status = "Action recommended";
      tone = "red";
      linkLabel = "Turn it back on";
      rows.push(["Disabled", whenUTC(data.occurredAt)]);
      break;
    case "passkey_added":
      heroFile = "hero-passkey.jpg";
      heroAlt = "3D illustration of a titanium key above a glowing fingerprint";
      title = "New passkey added";
      description = `A new passkey${data.passkeyName ? ` (“${data.passkeyName}”)` : ""} was added to your account. You can now sign in with Face ID, Touch ID or your device PIN — no password needed.`;
      status = "Active";
      rows.push(["Passkey", data.passkeyName || "New passkey"], ["Added", whenUTC(data.occurredAt)]);
      break;
    case "passkey_removed":
      heroFile = "hero-passkey.jpg";
      heroAlt = "3D illustration of a titanium key above a glowing fingerprint";
      title = "Passkey removed";
      description = `The passkey${data.passkeyName ? ` (“${data.passkeyName}”)` : ""} was removed from your account and can no longer sign in. Your password and other sign-in methods still work.`;
      status = "Removed";
      tone = "ink";
      rows.push(["Passkey", data.passkeyName || "Removed passkey"], ["Removed", whenUTC(data.occurredAt)]);
      break;
  }

  if (data.deviceLabel) rows.push(["Device", data.deviceLabel]);
  if (data.browser) rows.push(["Browser", data.browser]);
  if (data.location) rows.push(["Location", data.location]);

  const subject = `Veyra · ${title}`;

  return {
    subject,
    preheader: status,
    text: `${title}\n\n${description}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nReview security: ${link}\n\n${safety}`,
    html: emailShell({
      subject, preheader: status, hero: hero(heroFile, heroAlt),
      content: `${eyebrow("Security")}${h1(title)}${p(description)}${pill(status, tone)}${details(rows)}${btn(linkLabel, link)}${note(safety)}`,
    }),
  };
}
