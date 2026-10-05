# Veyra integration verification — 5 October 2026

## Result

The merged application passed its combined local verification gate on the
production Vite bundle served by the real Express + SQLite API. This verifies
the member, business and staff application flows fit together; it is **not** a
bank, payment-rail, identity-provider or custody certification, and no hosted
production deployment was tested.

Run the same full gate with `npm run verify` (Node 22+, followed by the one-time
`npx playwright install --with-deps chromium`). It includes:

- `npm test`: 14 permission checks, 25 email-template checks, route coverage for
  all 90 API routes, a security/RBAC audit of 540 role/auth probes plus 21
  isolation and validation probes, and 347 API integration assertions.
- Frontend, backend and browser-suite TypeScript checks.
- A fresh production build (single-file bundle).
- 26 Chromium end-to-end checks against the built application and a disposable
  SQLite database. Quotes/history use a deterministic local feed. The suite
  covers public routes; member navigation at desktop, tablet and mobile widths;
  personal and business markets, charts and holdings; cash and crypto balance
  reconciliation; persisted budgets and invoices; complete signup → admin KYC
  review/approval → member dashboard; member and staff passkeys; account
  statements/CSV/PDF exports; all admin modules; stale sessions, blocked
  storage, old application records, and unavailable market data.
- A production-mode HTTP smoke test: root/SPA GET and HEAD, static assets, API
  health and authentication, production-hidden demo logins, digital-asset
  trading defaulting off, and startup refusing to run without `TOKEN_SECRET`.

## Integration issues found and fixed

- Made the markets route available inside the shared business shell, while
  retaining the personal dashboard's original chrome.
- Added the merged holdings and passkey panels to the business account/security
  pages, and linked the money-plan route for both member surfaces.
- Refreshes the checking-account snapshot after a digital-asset trade, so
  checking, transactions and holdings agree immediately.
- Maps optimistic cash-plan IDs to server IDs before immediate deletion.
- Preserves and safely renders the empty/missing documents field on new and
  older signup records in the admin KYC queue/review screen.
- Keeps applicants' status fresh while they wait: approval now returns them to
  the dashboard without making them sign out and back in.
- Sends passkey sign-in through the same role-aware route decision as password
  sign-in, including staff returning to the Super Admin console.
- Keeps chart selection synchronized with the market URL and prevents the
  business header from overflowing at tablet widths.
- Serves the production single-page app on GET and HEAD from one origin,
  including when the checkout path has a hidden parent directory.
- Makes the route-security audit's market API probes deterministic/offline.

The test runner waits for the client form to mount before populating its first
field; this avoids races between the static bundle's `load` event and React
hydration.

## Still required before handling real money

- Connect an approved sponsor bank and payment/card processor. Transfers,
  deposits, cards, checks, Zelle and invoices currently exercise Veyra's internal
  ledger/UI, not live payment rails or issued cards.
- Wire password-reset email delivery to an SMTP/transactional provider.
- Provision production OAuth/Firebase, reCAPTCHA and domain-bound WebAuthn
  configuration if those features are enabled.
- Verify the production market-price feed's live availability, quota and terms.
  Digital-asset trading is default-off in production; custody/trading requires
  applicable licenses, a qualified custody/exchange provider and legal review.

The browser/API harness deliberately does **not** enable third-party login, call
Google reCAPTCHA, send email, or use a real quote service. Those integrations
need their own configured, externally provisioned credentials and operational
checks. No live deployment was performed.
