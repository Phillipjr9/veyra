# Email notifications for new features — 6 October 2026

## Scope

Every notification-worthy feature that lacked an email template now has one,
built with the same design system as the existing templates
(`src/emails/design.ts` blocks: eyebrow, h1, amount, pill, details, button,
note) and each feature family carrying its own 3D hero illustration.

23 new templates were added (58 → 81). Two new studio categories were
introduced: **Funding** and **Support**.

## New templates

| ID | Event | Hero |
| --- | --- | --- |
| `funding-request-pending` | Funding request recorded, awaiting staff review | hero-funding |
| `funding-request-confirmed` | Staff confirmed receipt, ledger credited | hero-funding |
| `funding-request-rejected` | Request declined, not credited (+ reason) | hero-funding |
| `external-account-submitted` | Bank-link request recorded, pending review | hero-bank-link |
| `external-account-approved` | External account approved as reference | hero-bank-link |
| `external-account-rejected` | Link request declined (+ reason) | hero-bank-link |
| `check-deposit-received` | Check details recorded, pending review | hero-check-deposit |
| `check-deposit-cleared` | Check confirmed, funds available | hero-check-deposit |
| `direct-deposit-setup` | Receiving details to give an employer | hero-direct-deposit |
| `password-changed` | Password change confirmation | hero-security |
| `two-factor-enabled` / `two-factor-disabled` | 2FA switches | hero-security |
| `passkey-added` / `passkey-removed` | Passkey updates | hero-passkey |
| `bill-scheduled` | Autopay scheduled confirmation | hero-bills |
| `bill-failed` | Scheduled payment failed (+ reason) | hero-bills |
| `savings-pocket-created` | Pocket opened, earning 4.25% APY | hero-savings |
| `savings-transfer` | Instant move into a pocket | hero-savings |
| `team-limit-reached` | Teammate hit their monthly cap | hero-team |
| `team-member-removed` | Teammate access revoked, cards frozen | hero-team |
| `application-received` | Application in review (1–2 days) | hero-support |
| `support-received` / `support-reply` | Ticket received / staff reply | hero-support |

## Implementation

- `src/emails/design.ts`: `emailShell` accepts an optional `hero`
  (`hero(file, alt)` helper). Heroes render full-bleed at the top of the
  card under the violet accent strip; existing templates are unchanged.
- `src/emails/funding.ts`, `src/emails/access.ts`, `src/emails/lifecycle.ts`:
  data-driven builders following the `crypto.ts` / `zelle.ts` pattern. Each
  returns `{ subject, preheader, html, text }` so the backend can swap the
  sample values for real data and send. All user-supplied strings are
  HTML-escaped by the design blocks.
- `src/emails/templates.ts`: studio previews with sample data dated
  Oct 6, 2026; new `funding` and `support` categories.
- `public/images/email/hero-*.jpg`: ten 3D illustrations in the product
  style (clay + brushed titanium, cream ground, violet accents), resized to
  1200px / ~25–45KB each for inbox-friendly weight. Mirrored to the tracked
  `dist/images/email/` output. The studio preview rewrites `ASSET_BASE` to
  relative paths so heroes load in-app; production sends use the hosted
  absolute URLs.
- `scripts/check-emails.mjs`: the dead-link guard now also accepts
  `external-accounts` and `application`, both real routes in `src/App.tsx`.
- `src/pages/EmailTemplates.tsx`: colors and ordering for the new
  categories.

Funding wording stays honest about the implementation: requests are
*recorded* first and only *staff-confirmed* receipt credits the internal
ledger. Nothing implies live bank connections, trial deposits, card charges
or check-image processing.

## Deliberately not changed

No new automatic sends were wired into API endpoints in this update. The
existing suites assert exact mail behavior (e.g. non-Zelle transfers send
no notification, failed operations send nothing), so triggers should be
added per-endpoint with matching tests as a follow-up. The builders are
ready for that: mirror `server/src/zelleNotifications.ts` (owner-only
recipient, last-four digits only, send after commit).

`email-showcase.html` was left untouched — it is already a stale snapshot
that predates the crypto and Zelle templates.

## Verification

- `npm run build:emails`: 81 templates exported to `emails/`.
- `node scripts/check-emails.mjs`: all 81 valid (structure, logo, footer,
  links, incl. new hero images and new routes).
- `npm run typecheck` (app + server): passes.
- Full `npm test`: passes.
- Live Vite preview: `/email-templates` returns 200 and hero assets serve
  correctly.
