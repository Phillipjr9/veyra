/**
 * Veyra email design system.
 *
 * Mirrors the product design tokens in src/index.css (:root) so transactional
 * emails match the app exactly. Email clients require solid values and inline
 * styles (no CSS custom properties), so every token is duplicated here as hex.
 *
 * Typography follows the same pairing as the app:
 *   – Display/headings: Manrope
 *   – Body:             DM Sans
 * Fonts are linked in <head> (rendered by Apple Mail, iOS, Thunderbird and
 * other web-font-capable clients); everyone else falls back to the same
 * system stacks used on the website.
 *
 * The logo is a hosted PNG (ASSET_BASE + /images/email/logo-mark.png) rather
 * than inline SVG — Gmail and Outlook strip <svg> elements, so a raster mark
 * plus the styled "Veyra" wordmark is the only combination that renders
 * everywhere. The wordmark also covers clients that block remote images.
 */

/* ---------- Tokens (keep in sync with src/index.css) ---------- */
export const T = {
  ink: "#18171d",
  muted: "#716e78",
  bodyText: "#5f5c66",
  paper: "#f5f2eb",
  white: "#fffdf9",
  violet: "#7558dc",
  violetDark: "#443173",
  violetSoft: "#d9d0fb",
  violetTint: "#ece7fb",
  violetLilac: "#aa95ed",
  night: "#17131f",
  green: "#2f7a4c",
  greenTint: "#e3f3e9",
  red: "#9d4040",
  redTint: "#fbeded",
  amber: "#8a6420",
  amberTint: "#faf0dc",
  hairline: "#e7e2d8", // ≈ --line (12% ink) on the white card
  panelBg: "#f8f5ee", // paper-tinted detail panel
  panelLine: "#eae5da",
} as const;

export const FONT_DISPLAY = "'Manrope', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
export const FONT_BODY = "'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const FONTS_LINK =
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap";

/**
 * Absolute base URL for hosted email assets (logo images). Emails can't use
 * relative paths — point this at your production domain or CDN before sending.
 * The 2x logo lives at public/images/email/logo-mark.png; serve it from e.g.
 * https://veyra.com/images/email/logo-mark.png. The in-app studio rewrites
 * this base to a relative path so previews load assets from the app itself.
 */
export const ASSET_BASE = "https://veyra.com";
const LOGO_URL = `${ASSET_BASE}/images/email/logo-mark.png`;

/** Absolute base URL of the authenticated app — used for email CTA links. */
export const APP_BASE = "https://app.veyra.com";

/** Escapes user-supplied strings so injected names/merchants can't break markup. */
export const esc = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- Building blocks ---------- */

/** Uppercase violet eyebrow — mirrors .eyebrow / .kicker on the site. */
export const eyebrow = (text: string, color = T.violet): string =>
  `<div style="margin:0 0 12px;font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${color};">${esc(text)}</div>`;

/** Card heading — mirrors .section-heading h2 (Manrope 600, tight tracking). */
export const h1 = (text: string): string =>
  `<h1 style="margin:0 0 14px;font-family:${FONT_DISPLAY};font-size:27px;line-height:1.16;font-weight:600;letter-spacing:-.6px;color:${T.ink};">${esc(text)}</h1>`;

/** Body paragraph — mirrors .hero-copy > p / panel copy tones. */
export const p = (text: string, opts: { muted?: boolean; size?: number; align?: "left" | "center" } = {}): string =>
  `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:${opts.size ?? 15}px;line-height:1.65;font-weight:400;color:${opts.muted ? T.bodyText : T.ink};text-align:${opts.align ?? "left"};">${esc(text)}</p>`;

/** Large money figure — mirrors .animated-money (Manrope, tight tracking). */
export const amount = (text: string, tone: "in" | "out" | "neutral" = "neutral"): string => {
  const color = tone === "in" ? T.green : tone === "out" ? T.ink : T.ink;
  return `<div style="margin:22px 0 8px;font-family:${FONT_DISPLAY};font-size:37px;line-height:1;font-weight:600;letter-spacing:-1.4px;color:${color};font-variant-numeric:tabular-nums;">${esc(text)}</div>`;
};

export type PillTone = "green" | "violet" | "amber" | "red" | "ink";
const PILL_TONES: Record<PillTone, { bg: string; fg: string }> = {
  green: { bg: T.greenTint, fg: T.green },
  violet: { bg: T.violetTint, fg: T.violetDark },
  amber: { bg: T.amberTint, fg: T.amber },
  red: { bg: T.redTint, fg: T.red },
  ink: { bg: "#ecebe7", fg: T.ink },
};

/** Status pill — mirrors dashboard status chips (e.g. .perk-value, .dash pills). */
export const pill = (text: string, tone: PillTone = "violet"): string => {
  const t = PILL_TONES[tone];
  return `<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:${t.bg};color:${t.fg};font-family:${FONT_BODY};font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;">${esc(text)}</span>`;
};

/**
 * Key/value detail rows — the "all the details" block. Mirrors the dashboard's
 * detail-row pattern: muted label left, strong value right, hairline dividers,
 * on a paper-tinted rounded panel.
 */
export const details = (rows: Array<[string, string] | [string, string, { strong?: boolean; color?: string }]>): string => {
  const trs = rows
    .map(([label, value, opts], i) => {
      const border = i === rows.length - 1 ? "none" : `1px solid ${T.hairline}`;
      const strong = opts && "strong" in opts ? opts.strong !== false : true;
      const color = opts && "color" in opts && opts.color ? opts.color : T.ink;
      return `
      <tr>
        <td style="padding:11px 0;border-bottom:${border};font-family:${FONT_BODY};font-size:12.5px;line-height:1.4;font-weight:500;color:${T.muted};">${esc(label)}</td>
        <td align="right" style="padding:11px 0;border-bottom:${border};font-family:${FONT_BODY};font-size:13.5px;line-height:1.4;font-weight:${strong ? 600 : 400};color:${color};font-variant-numeric:tabular-nums;">${esc(value)}</td>
      </tr>`;
    })
    .join("");
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;background:${T.panelBg};border:1px solid ${T.panelLine};border-radius:12px;">
    <tr><td style="padding:4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}</table>
    </td></tr>
  </table>`;
};

/**
 * Primary button — mirrors .button (ink background, 12px radius, 600 weight).
 * Table-based so Outlook renders the full clickable area.
 */
export const btn = (
  label: string,
  href = "#",
  variant: "solid" | "light" | "danger" = "solid",
): string => {
  const styles =
    variant === "light"
      ? { bg: "#ffffff", fg: T.ink }
      : variant === "danger"
        ? { bg: T.ink, fg: "#ffffff" }
        : { bg: T.ink, fg: "#ffffff" };
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
    <tr>
      <td align="center" bgcolor="${styles.bg}" style="border-radius:12px;">
        <a href="${esc(href)}" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${styles.bg};font-family:${FONT_BODY};font-size:14px;font-weight:600;line-height:1;color:${styles.fg};text-decoration:none;white-space:nowrap;">${esc(label)}&nbsp;&nbsp;&#8594;</a>
      </td>
    </tr>
  </table>`;
};

/** Quiet secondary action under a button — mirrors .text-link. */
export const textLink = (label: string, href = "#"): string =>
  `<p style="margin:14px 0 4px;font-family:${FONT_BODY};font-size:13px;line-height:1.5;"><a href="${esc(href)}" style="color:${T.violetDark};font-weight:600;text-decoration:underline;">${esc(label)}</a></p>`;

/** Small footnote inside the card. */
export const note = (html: string): string =>
  `<p style="margin:18px 0 2px;padding:13px 16px;border-radius:11px;background:${T.panelBg};font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${T.muted};">${html}</p>`;

/** Thin progress bar — mirrors .kyc-progress-track (violet → lilac gradient). */export const progress = (pct: number, label?: string): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;">
  ${label ? `<tr><td colspan="2" style="padding-bottom:8px;font-family:${FONT_BODY};font-size:12px;font-weight:500;color:${T.muted};">${esc(label)}</td></tr>` : ""}
  <tr><td style="height:10px;border-radius:999px;background:#efeaf7;font-size:0;line-height:10px;">
    <div style="width:${Math.min(100, Math.max(0, pct))}%;height:10px;border-radius:999px;background-color:${T.violet};background-image:linear-gradient(90deg,${T.violet},${T.violetLilac});font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>
</table>`;

/* ---------- Document shell ---------- */

/**
 * Full-bleed 3D hero illustration rendered at the top of the card, directly
 * under the violet accent strip. Heroes live in public/images/email/ (hosted
 * PNG/JPG — Gmail and Outlook strip SVG) and give each feature family its own
 * visual reference while the blocks below stay identical everywhere.
 */
export interface EmailHero {
  src: string;
  alt: string;
}

/** Points at a hosted illustration in public/images/email/ (e.g. "hero-funding.jpg"). */
export const hero = (file: string, alt: string): EmailHero => ({
  src: `${ASSET_BASE}/images/email/${file}`,
  alt,
});

export interface EmailOptions {
  subject: string;
  preheader: string;
  /** Inner card content, built from the blocks above. */
  content: string;
  /** Extra footer links (e.g. unsubscribe for digests). */
  footerLinks?: string;
  /** Optional 3D hero illustration for the top of the card. */
  hero?: EmailHero;
}

const HEADER = `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
  <tr>
    <td style="padding:0 0 22px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="38" style="padding-right:11px;">
          <img src="${LOGO_URL}" width="26" height="26" alt="Veyra" style="display:block;width:26px;height:26px;border:0;outline:none;text-decoration:none;">
        </td>
        <td style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:700;letter-spacing:-1.3px;color:${T.ink};">Veyra</td>
      </tr></table>
    </td>
  </tr>
</table>`;

const FOOTER = (extraLinks: string | undefined) => `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
  <tr>
    <td align="center" style="padding:30px 24px 36px;font-family:${FONT_BODY};font-size:12px;line-height:1.7;color:${T.muted};">
      Questions? Our team is available 24/7 in the
      <a href="${APP_BASE}/support-desk" style="color:${T.violetDark};font-weight:600;text-decoration:none;">help center</a>
      or right from the app.
      <br>
      <a href="${APP_BASE}/settings" style="color:${T.violetDark};font-weight:600;text-decoration:none;">Manage notification settings</a>
      ${extraLinks ? `&nbsp;&nbsp;&#183;&nbsp;&nbsp;${extraLinks}` : ""}
      <br><br>
      You're receiving this email because you have a Veyra account.
      <br>
      Veyra Financial, Inc. &#183; 100 Market Street, Suite 400, San Francisco, CA
      <br>
      Veyra is a financial technology company, not a bank. Banking services would be provided by partner institutions, Members FDIC.
      <br>
      &#169; 2026 Veyra Financial, Inc.
    </td>
  </tr>
</table>`;

/**
 * Full HTML document for an email: hidden preheader, paper background, brand
 * header, white rounded card with a violet accent strip, and the legal footer.
 */
export function emailShell({ subject, preheader, content, footerLinks, hero: heroImg }: EmailOptions): string {
  // Self-delimiting so templates without a hero render byte-identical to before.
  const heroRow = heroImg
    ? `\n              <img src="${esc(heroImg.src)}" width="600" alt="${esc(heroImg.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">`
    : "";
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <meta name="theme-color" content="#f5f2eb">
  <title>${esc(subject)}</title>
  <link rel="stylesheet" href="${FONTS_LINK}">
</head>
<body style="margin:0;padding:0;background-color:${T.paper};">
  <!-- Preheader (hidden inbox preview text) -->
  <div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.paper};">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${T.paper};">
    <tr><td align="center" style="padding:34px 16px 0;">${HEADER}</td></tr>
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;">
          <tr>
            <td style="background-color:${T.white};border:1px solid ${T.hairline};border-radius:18px;overflow:hidden;">
              <!-- Brand accent strip -->
              <div style="height:5px;line-height:5px;font-size:0;background-color:${T.violet};background-image:linear-gradient(90deg,${T.violet},${T.violetLilac});">&nbsp;</div>${heroRow}
              <div style="padding:32px 36px 30px;">${content}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td align="center" style="padding:0 16px;">${FOOTER(footerLinks)}</td></tr>
  </table>
</body>
</html>`;
}
