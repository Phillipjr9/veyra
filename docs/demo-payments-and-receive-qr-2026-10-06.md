# Demo payments and receive QR — October 6, 2026

> **Superseded by the user’s correction:** the separate payment playground has been removed. See [Immediate account funding](immediate-account-funding-2026-10-06.md) for the current behaviour. The remainder of this document records the previous design, not the current workflow.

## What this release exercises

An explicitly labelled payment playground, available from **Transfers / Send & receive**, **Add funds**, and the existing money-flow funding entrypoints. It has its own persisted synthetic balance, activity, receipts and simulated email inbox. It does not call the real mailer, contact a payment processor, or write demo operations into the main account ledger.

- ACH: link the supplied synthetic checking account, verify trial amounts **0.12** and **0.34**, submit a deposit, then simulate approval or rejection.
- Debit card: link the supplied **4242** fixture, submit, then simulate approval or rejection. No PAN, expiry, CVV or real bank credentials are collected.
- Zelle-style incoming funding, bank transfer, wire, direct deposit, mobile check and other funding: submit a synthetic receipt, inspect its pending state, then approve/reject it. Check capture is represented by a sample check; real check images are not collected.
- Outgoing Zelle-style payments: look up a registered recipient using the email or phone saved on their signup profile, review the resolved person and amount, then confirm or simulate decline.
- Outgoing ACH, wire and bill demonstrations: a fixed synthetic vendor, recipient review and success/decline outcomes. These do not settle actual saved bills or invoices.
- Pending and declined events never change the demo balance. Completed transfers between registered users debit/credit their demo wallets atomically. Business senders must select a category; personal senders may omit it.
- Activity and the simulated inbox show the latest 100 records. Text receipts clearly say **DEMO / NO REAL MONEY**. Messages are stored in the application's simulated inbox, not delivered to email addresses.

This is a payment/funding sandbox, not a replacement for every application subsystem. Existing admin tools, identity review, saved invoices/bills, card controls, crypto, savings, rewards, and reporting retain their prior behaviour. No new live processor integration is implied for any of them. Testing those older internal-ledger tools is separate from this isolated wallet.

## Trying it locally

```sh
npm ci
npm run server:demo
# Separate terminal:
npm run dev -- --host 0.0.0.0
```

Sign in with an approved account-owner login. The existing development login picker offers Personal and Business sample accounts. Open **Send & receive / Transfers** and start the demo wallet. It receives **$2,500** of synthetic starter funds once; the first incoming demo payment also initializes a recipient's wallet and its starter funds. Reloading does not reset it or grant another opening balance.

The personal and business demo logins can send to each other's displayed signup contacts. **Receive** has an Email/Phone selector, copy identifier, copy/share payment link, and downloadable QR image. Phone receiving is unavailable if the saved number is absent, cannot be normalized, or is shared by multiple account owners; email remains the preferred alternative. US ten-digit numbers normalize to +1; international numbers must carry an explicit +country code.

**New deposit** in Activity creates a fresh request key, allowing an intentional second deposit for the same amount. Retrying the same submission retains its key. Approving a completed request again returns the existing result rather than crediting twice.

## QR and identity boundaries

The QR is generated locally by `qrcode`, with a quiet zone and error correction. It encodes a URL on the browser's **current origin**:

`/#/app/transfers?to=<encoded saved signup contact>`

It is a **Veyra demo payment URL, not an official Zelle network QR**, and it cannot receive from a real bank's Zelle application. It contains the selected contact, so sharing it also shares that contact. There are no authentication tokens, SSNs, bank account numbers or payment credentials in the QR.

Login preserves the destination query. A centralized authenticated redirect handles password, MFA, social and passkey completion so a second late redirect cannot discard the recipient. Scanning does not authorize a payment: the payer still signs in, enters an amount, resolves the recipient on the server and explicitly confirms the displayed review.

Aliases are drawn from saved signup/profile fields. This is not verification of ownership of an email/phone, real Zelle enrollment, or affiliation with the Zelle network. Live enrollment and identity verification must be implemented through an authorized integration later.

## Isolation and server controls

- Activation: `DEMO_PAYMENTS_ENABLED=1`, only in development/test (an unspecified NODE_ENV is treated as development). `NODE_ENV=production` forces it off, even if the flag is set. `.env.example` defaults it off; `npm run server:demo` explicitly enables it for local development without overriding production NODE_ENV.
- Migration 20 adds only `demo_wallets`, `demo_payment_events`, `demo_payment_previews`, and `demo_payment_inbox`, plus their owner indexes. Existing balances and transactions are not migrated or replaced.
- Endpoints: authenticated `GET /api/me/demo-payments` and approved-user `POST /api/me/demo-payments/action`. Actions are owner-scoped. Staff and teammate logins cannot operate demo wallets; restrictions and approval are checked server-side. Ineligible owners get a disabled demo workspace rather than a fallback main-ledger form.
- While the sandbox is active, legacy `/api/me/transfers` and `/api/me/deposits` reject writes and direct the caller to the isolated demo workspace. This is not a blanket sandbox of unrelated legacy money endpoints.
- Money uses integer cents. Limits: $0.01–$10,000 per operation, $1,000,000 per wallet, 20 pending deposits per owner, and 100 action requests/minute per owner.
- Funding request keys are unique per owner and bound to the normalized method/amount. Reviews are server-issued, owner-bound and expire after 10 minutes. Confirmation uses the stored amount/method/recipient, not client-supplied replacements. Final outcomes cannot be flipped.
- Email matching is case-insensitive. Phone matching is normalized and refuses ambiguous matches. Only registered, approved, active account owners may receive. Self-payments are refused. Recipient identity, name, alias and eligibility are rechecked at confirmation.
- SQLite immediate transactions cover paired wallet movement, events and inbox notifications. A recipient-capacity failure rolls back the sender debit. Repeated confirmation returns the existing event without duplicate movement or notifications.
- A successful mutation is not relabelled a failure if a subsequent UI refresh fails. A failed mode check does not silently expose the legacy payment form.
- The sandbox module has no imports of provider clients, the real mailer or main-ledger mutation helpers. Real card/bank credential fields in demo requests are rejected.

## Processor handoff later

Disabling the flag does **not** connect or enable live rails; it returns to the existing guarded/manual experience. Do not copy demo balances, events, fake bank links or synthetic card fixtures into production money records.

A future integration still needs an authorized provider, tokenized bank/card capture, verified enrollment/aliases where supported, explicit debit consent, signed webhook verification, durable idempotency across requests and callbacks, settlement/return/dispute handling, reconciliation, verified notification delivery and production security/compliance review. Current demo approval buttons are intentionally manual simulation controls and must not become production settlement controls.

## Verification

- Full `npm test` passes, including **99 demo API assertions** alongside the existing suites.
- Typechecks for client/server and browser tests pass; production bundle builds.
- Route audit/coverage accounts for **119 routes**.
- Existing browser regression suite: **88 passed**, demo-specific tests skipped when the flag is off.
- Explicit demo browser suite: **5 passed**, covering funding, verification errors, pending/approval/rejection, persistence, receipts, inbox, QR decoding with `jsqr`, phone/email selection, login deep links, paired payments, business categories, decline handling, API-unavailable recovery and mobile modal access.
- Responsive checks at **320, 390, 768 and 1440px** include document/dialog overflow and demo button label height.
- Live desktop/mobile inspection found no page runtime errors or horizontal overflow. Visual inspection caught a shared fixed-height button rule; demo buttons now grow for multi-line labels instead of clipping.

No pull, merge, branch switch, commit or push was performed for this request.
