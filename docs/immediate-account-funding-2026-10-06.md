# Immediate account funding — October 6, 2026

## User correction

The separate “Payment playground” and its opt-in wallet have been removed from the UI. The original Add funds method grid and ordinary Transfers page are restored for both personal and business accounts.

With `DEMO_PAYMENTS_ENABLED=1` in development/test (`npm run server:demo`):

1. Open **Add funds**.
2. Select one of the existing methods: ACH, debit card, Zelle, bank transfer, wire, direct deposit, check, or other.
3. Enter $10–$100,000 and choose **Add funds now**.
4. The server immediately credits the **normal account balance**, inserts a cleared transaction and records a confirmed funding request. The dashboard refreshes without closing the dialog. There is no staff approval, trial-deposit verification or separate demo wallet.

All method fixtures are clearly labelled demo. No external payment happens, no bank/card credentials are collected, and no real email is sent. The demo source records are internally disabled so they cannot become active live methods just by turning the flag off. A $10,000,000 normal-account balance cap applies to mock credits.

## Safety and consistency

- Deposits require an active, approved account-owner login and an explicit `demo: true` request. Staff, teammate and restricted/unapproved logins cannot self-credit.
- Amounts use exact integer cents; invalid precision, out-of-range values, unknown source IDs and credential fields are rejected.
- One SQLite transaction covers account credit, funding request and transaction history. Per-owner UUID request keys make retries idempotent; reusing a key with changed details fails.
- Client-side submission locking prevents parallel clicks, and a successful deposit disables its form. A lost response can be retried with the same key. Success is retained when refreshing the dashboard fails; the user is told to refresh, not deposit again.
- Main-account balances are intentionally changed in this version. Use a **test database only**. Never promote mock-funded accounts/database contents into live production balances.
- Disabling the flag restores the existing manual funding workflow: pending requests require staff review, and ACH/card provider operations remain inactive. `NODE_ENV=production` always disables mock credits regardless of the flag.
- Old separate-wallet balances/events are left untouched for historical integrity; they are not imported, credited or displayed as account funds. Starter-fund and separate-wallet mutation actions are retired.

## Receive QR and sending

The rebuilt receive QR is retained. It still encodes a current-origin Veyra demo URL containing the selected saved signup email/phone, not an official Zelle network QR. The destination survives sign-in and pre-fills the restored Transfers form.

Mock payments now use the existing review/processing/success dialog and the **same normal account balance** that Add funds credits. The server resolves Zelle-style email/phone recipients before showing review, rejects self/ambiguous/ineligible recipients, and atomically debits/credits their account ledgers on confirmation. Other methods record a demo outgoing entry to the chosen payee, not external settlement. No demo rewards are invented.

Migration 21 stores account-payment reviews separately from obsolete wallet reviews, preventing an old wallet review token from debiting a normal account. Reviews are actor-bound, expire after ten minutes, and recheck recipient eligibility/identity and available balance. Confirmation replays return the committed result. Recipient-capacity failure rolls back the sender debit. Mock transfer entries and receipts carry DEMO references; no real mailer or processor is called.

## Verification

- Client/server typechecks, browser-test typecheck, production build and complete `npm test` passed.
- **86 immediate funding/payment API checks** cover all eight methods, immediate normal-account credits, idempotent retries, exact ledger entries, role/approval gates, limits, production-off protection, recipient lookup, atomic paired payment and review replay/expiry.
- **Five browser scenarios** passed: personal/business restored funding, QR deep links and sending, lost-response retry without double credit, and successful funding despite a failed account refresh.
- Full existing browser regression: **88 passed** on the final run (five demo-specific scenarios run separately).
- Funding/QR responsiveness checked at 320, 390, 768 and 1440px.

No pull, merge, branch switch, commit or push performed.
