# Account interface and Ledger Intelligence correction

## Requested scope

Keep the familiar Add funds experience, operating on the ordinary account balance, without alternate-mode branding. Limit the chart work to the existing LEDGER INTELLIGENCE section rather than adding more dashboard charts.

## Delivered

- Preserved the original eight funding choices and the existing Add funds modal. Confirmed additions update the ordinary account balance and transaction history immediately, without a separate wallet or approval stage.
- Removed the extra mode banner and customer-facing mode terminology from funding, transfers, review/processing/receipt text, QR sharing/downloads, receiving headers, login and relevant explanatory content.
- New deposits/payments use ordinary `VYR-` references and method labels. Earlier account identifiers, financial records and opaque storage IDs remain intact; no historical balances or account identities were erased or renamed.
- Removed the one-click credential shortcuts and their unauthenticated credential-list API. Standard password, social-provider, passkey, verification and recovery flows remain.
- Retained accurate, concise information that external payment processing is not connected. Removed mode branding, not the distinction between account entries and external settlement. Substantive legal protections were retained and not shortened.
- Removed the newly added incoming/outgoing breakdown panels from Ledger Intelligence. The existing area/bar chart, 7/30/90-day controls, totals and accessible table remain. The latest interval is labeled with its end date, so today's activity no longer appears under the start date of a multi-day bucket.
- Removed the extra explorer introduced on Scout and restored its prior chart layout. No new chart panels were introduced for this correction.
- Kept the existing chart's complete server-calculated summaries, exact-cent aggregation, status/date filtering, mutation refresh and 15-second visible-page refresh. Larger ledgers are not truncated to the activity feed's 400-record limit.

## Configuration and compatibility

The normal development entrypoint (`npm run server`) enables account-ledger operations when no explicit switch is set. `.env` or exported `ACCOUNT_LEDGER_ENABLED=0` disables them; `=1` enables them for development/test. The legacy switch remains a compatibility fallback. Production still refuses unfunded instant-credit operations regardless of these switches.

Funding replies now advertise `immediateFunding`; the current Add funds form sends `accountEntry: true`. The older wire fields remain accepted for existing clients and stored receipts. This change does not enable a bank/card/Zelle provider, collect external card credentials, or convert account entries into real settlement.

## Verification

- Client/server and browser-test type checks passed; production build passed.
- Full `npm test` passed, including 91 immediate-funding/payment API checks. Added canonical-switch, canonical-request, normal-label/reference, precedence and idempotency checks.
- 36 funding/chart/receive/responsive browser checks passed. Two new checks exercise all eight funding methods through the actual UI for personal and business accounts: eight cleared entries, $114 total, immediate updates to the single existing Ledger Intelligence chart, preserved chart controls and persisted balance.
- The new checks also verify no alternate-mode wording in the fresh customer funding/transfer/receive interface, no credential shortcuts, and HTTP 404 from the retired credential-list endpoint.
- 21 authentication, legal, banking, money-control and administrator regression checks passed: 57 targeted browser checks total.
- Live inspection: eight available funding choices, one existing cash-flow chart, no added breakdowns, no page errors or horizontal overflow. Preview host/API proxy returned HTTP 200.

Logs: `/home/user/account-interface-browser-tests.log`, `/home/user/account-interface-regressions.log`, `/home/user/account-interface-tests-final.log`.

Reproduce the account-interface tests with `npm run test:e2e:account`. Browser binaries and disposable databases are outside the repository. No branch switch, pull, merge, commit or push was performed.
