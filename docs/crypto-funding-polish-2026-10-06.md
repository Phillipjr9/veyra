# Crypto activity and funding refinement — 6 October 2026

## Delivered behavior

1. **Buy / Sell / Swap:** distinct accent colors, marks, moving tokens, source and
   destination accounts, and four preparation steps. Buy debits checking, sell
   credits checking, swap leaves checking unchanged. Shared `FlowProcessing`
   gates receipts on both presentation completion (3,640 ms normal / 2,520 ms
   reduced motion) and the actual confirmation response. Failure never produces
   a success receipt. Existing persisted quote recovery and same-order retry are
   preserved. The progress ring represents presentation preparation, not fake
   blockchain confirmations.
2. **Notifications:** `shared/cryptoNotifications.ts` and `src/emails/crypto.ts`
   define a common vocabulary for buy, sell, swap, deposit, withdrawal and
   transfer × pending, confirmed, completed, failed and cancelled. All 30 HTML
   templates are exported to `emails/` and the email gallery has a Crypto filter.
   Completed reviewed/legacy trades, definitive confirmation failures, pending
   withdrawal reservations, insufficient-unit failures and cancellations are
   wired to owner-only persisted inbox notifications and the best-effort mail
   adapter. Stable event IDs deduplicate retries and survive restarts. Unknown
   network outcomes are not marked failed/successful. Request-only events cannot
   claim external completion. Blockchain success templates require a hash and
   at least one confirmation. External deposits/transfers/confirmations have no
   connected event source yet; their templates are ready but not fabricated.
3. **Customer copy / prices:** removed test banners, sample valuation labels and
   environment badges. Ordinary runtime uses the configured price feed. If an
   explicit fixture API is started, the customer client suppresses generated
   valuations, charts and markets instead of mislabelling them as live. Existing
   owned quantities remain visible and send requests still work. The isolated
   fixture APIs remain available to automated tests only. Legal/provider limits
   and pending/not-broadcast wording remain visible.
4. **Icons:** all 24 catalog assets have distinct self-hosted artwork. Shared
   `shared/assetIcons.ts` is used across holdings, markets, trade reviews and
   animations, sending, wallet balances and the homepage. CC0 attribution and
   the three local vector interpretations are documented in `public/images/crypto`.
5. **Funding dropdown:** linked accounts and staff-approved references are
   selectable by bank/type/last four digits. No available records means a direct
   link to `/app/external-accounts`, also accessible from Accounts. Owners can
   submit a bank name, display name, type and last four digits for staff review.
   The request remains pending and cannot fund an account. Authorized staff
   independently check ownership and approve/decline in Members → Funding.
   Staff-approved records are labelled account references, NOT provider bank
   connections or ACH authorization. Migration 24 keeps that distinction explicit.
   Owner submissions cannot self-verify or include full bank numbers/credentials.
   Request keys, duplicate checks and atomic reviews prevent repeated writes.
   Pending/disconnected/foreign accounts cannot fund new requests. Completed
   credits still replay after the reference is disconnected. New bank linking
   and external debits still require a provider. A future payment adapter must
   check actual provider connection and authorization, not just reference status.
6. **Direct Deposit:** shows the signed-in owner's administrator-configured
   bank, routing, unique account number, holder and Checking/Savings type.
   Account number is masked by default with a reveal control. No startup bank
   defaults are passed off as configured receiving instructions. Individual and
   bulk account-detail edits mark configuration; migration 23 recognizes prior
   audited edits. An explicitly enabled per-user payroll funding method is the
   fallback when no account-detail configuration exists. Missing configuration
   shows an actionable support link and blocks an internal payroll credit.
7. **Recent deposits:** removed from Add Funds; appears only on Personal and
   Business Dashboard views, based on real cleared Funding ledger transactions.
   Receipt/status refresh remains available without restoring a history panel.
   Transaction history and recorded receipts are not deleted.

## Mobile / accessibility

- Verified 320, 390, 768 and 1440 px widths, normal/reduced motion, long bank names,
  asset quantities, keyboard/focus handling and provider-unavailable states.
- Funding fields scroll independently of the persistent Review/Cancel actions.
- Shared SVG progress-ring styles prevent an unstyled solid fill in trade flows.
- No overlapping support button or horizontal page/dialog overflow.

## Integration boundaries

These changes do **not** connect custody, external trading, a bank-linking
provider, ACH/card debits, payroll rails or blockchain broadcasting. Internal
account entries remain explicitly labelled. Email delivery needs configured
`MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM` and public `APP_URL`; inbox messages
persist without email configuration. Never copy disposable fixture balances or
credentials into a production deployment.

Runtime verified through the website's same-origin `/api` proxy: generated prices
are disabled, five existing fixture quantities are retained, linked accounts
are empty and Direct Deposit is unconfigured for those fixture owners. The
configured CoinGecko feed could not be reached from this sandbox during final
verification, so prices correctly show unavailable rather than generated values.

## Verification

- Full `npm test`, including **43 crypto/funding checks**, passed.
- Client/server and E2E TypeScript checks passed; production build passed.
- Browser suites: 6 crypto/funding scenarios, 13 crypto-workspace scenarios,
  7 funding-animation scenarios, 5 legacy funding/payment scenarios, 2 account
  interface scenarios, 4 crypto-send animation scenarios, 6 banking/admin
  scenarios and 2 generated-price suppression scenarios passed.
- New coverage checks minimum presentation duration, slow response gating,
  failed confirmation, unique successfully loaded icons, owner-specific payroll
  information, linked/unlinked bank states and Dashboard-only deposit history.
- The first combined browser run exhausted signup rate limits; reran against
  separate disposable servers without weakening security limits.
- Source diff whitespace check passes (excluding the repository's tracked,
  generated `dist/index.html`, whose vendor bundle includes trailing whitespace).

Commands: `npm run test:crypto-funding`, `npm run test:e2e:crypto-funding`.
Browser runs require Playwright Chromium; this sandbox used the temporary
Sparticuz Chromium fallback with its temporary shared libraries, not a new app
or lockfile dependency.


## Follow-up verification

The repeated seven-item review found that the external-account page had only an
activation notice. That dead end is now an explicit owner request / staff review
workflow, without claiming to connect banks. All 19 targeted browser scenarios
(6 crypto/funding, 7 funding animation, 6 banking/admin) passed in this follow-up,
along with the full API/unit suite and all 127 route-security checks. Funding
modals are also keyed and gated by signed-in user identity, preventing cached
receiving details from remaining open across account changes.
