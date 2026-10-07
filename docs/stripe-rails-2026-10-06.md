# Stripe Connect, Treasury & Issuing rails — 6 October 2026

## Decision

Veyra uses **Stripe Connect + Treasury + Issuing** as its banking-rail provider. Veyra remains the product, account-experience, RBAC, and local product-ledger layer; Stripe is the provider for connected-account onboarding, financial accounts, financial addresses, ACH/wire features, and Issuing cards.

This is intentionally **not** a claim that Veyra is a bank. Treasury and Issuing availability, program eligibility, capabilities, KYC/KYB requirements, and financial-account feature activation are controlled by Stripe and its banking partners.

## What this increment delivers

- A server-only Stripe adapter (`server/src/stripe.ts`) using Stripe's HTTPS API directly; no provider secret is bundled into Vite.
- One opaque Stripe connected-account and financial-account mapping per Veyra account.
- Hosted Stripe Connect onboarding. Identity documents, external-bank credentials, and onboarding secrets do not pass through Veyra forms or database storage.
- Financial-account feature requests for card issuing, ABA receiving details, inbound ACH, outbound ACH/wire payments, and outbound ACH/wire transfers.
- Signed `/api/webhooks/stripe` handling with Stripe timestamp tolerance, HMAC verification, retry-safe event-id journaling, a payload hash (not raw event retention), and provider-status reconciliation.
- Treasury-transaction settlement reduction keyed by Stripe's provider transaction ID: `open` is a pending local ledger entry, `posted` atomically clears it and moves the projected balance once, and `void` fails an unsettled entry. No browser callback or generic outbound-payment success can change a live balance.
- Live Stripe Issuing virtual/physical card creation once `card_issuing` is active. Veyra stores only the opaque Stripe card/cardholder IDs, status, last four digits, and expiry. It never writes a PAN, CVV, PIN, bank credential, or Connect client secret.
- Provider-side freeze/unfreeze. Veyra refuses to route a live Issuing card through its local simulated-transfer path.
- A status panel in **Accounts → External accounts** that uses the existing premium card system and displays onboarding, pending, active, and restricted feature states.
- Production startup validation for rail secrets, webhook signing, HTTPS origin controls, preview switches, CORS, WebAuthn origins, token/TOTP encryption keys, and proxy/IP handling.

## Required Stripe setup

1. Request/enable Stripe **Connect**, **Treasury**, **Issuing**, and US bank-account ACH capabilities for the platform.
2. Create separate test, staging, and production Stripe environments/accounts.
3. Configure a restricted server-side `STRIPE_SECRET_KEY` and, if embedding Stripe financial-account/card components, `STRIPE_PUBLISHABLE_KEY`.
4. Create a Stripe webhook endpoint at:

   ```text
   https://app.example.com/api/webhooks/stripe
   ```

5. Subscribe at minimum to:

   ```text
   account.updated
   treasury.financial_account.created
   treasury.financial_account.closed
   treasury.financial_account.features_status_updated
   treasury.transaction.created
   treasury.transaction.updated
   treasury.received_credit.created
   treasury.received_credit.succeeded
   treasury.received_credit.available
   treasury.received_credit.failed
   treasury.received_credit.returned
   treasury.outbound_payment.created
   treasury.outbound_payment.posted
   treasury.outbound_payment.failed
   treasury.outbound_payment.canceled
   treasury.outbound_payment.returned
   treasury.outbound_transfer.created
   treasury.outbound_transfer.posted
   treasury.outbound_transfer.failed
   treasury.outbound_transfer.canceled
   treasury.outbound_transfer.returned
   issuing_card.created
   issuing_card.updated
   issuing_authorization.created
   issuing_authorization.updated
   issuing_transaction.created
   ```

6. Put the endpoint signing secret in `STRIPE_WEBHOOK_SECRET`; do not use an endpoint secret from another environment.
7. Set canonical HTTPS deployment variables:

   ```dotenv
   NODE_ENV=production
   APP_URL=https://app.example.com
   CORS_ORIGIN=
   WEBAUTHN_RP_ID=example.com
   WEBAUTHN_ORIGINS=https://app.example.com
   TRUST_PROXY=1
   ```

8. Configure the WAF/CDN to allow Stripe's webhook delivery path without a browser challenge while retaining Stripe signature verification at the application layer. Rate-limit anonymous application routes at the edge; do **not** rate-limit verified Stripe delivery using a brittle IP-only policy.

## Member flow

1. An approved account owner opens **External accounts**.
2. They choose **Start secure verification**; Veyra creates/reuses a Stripe connected account and redirects to the one-time Stripe-hosted onboarding URL.
3. After Stripe verification, they return to the same Veyra view and choose **Activate financial account**.
4. Stripe activates requested features asynchronously. Veyra learns the final state from a signed webhook and exposes it as `active`, `pending`, or `restricted` in the current UI shell.
5. When `card_issuing` is active, card issuance creates a Stripe Issuing card. Card number, CVV, and PIN are never added to Veyra storage.

## Reconciliation rule

Provider webhooks, not a browser success response, are the authority for settlement. For a mapped financial account, `treasury.transaction` is the only event that updates Veyra's account projection:

- a unique `stripe_settlements` row links the provider transaction to exactly one Veyra transaction;
- `open` creates a **pending** ledger row and does not alter balance;
- `posted` atomically changes the row to **cleared** and applies its signed USD cents exactly once; a direct `posted` event is also supported;
- `void` changes only an unsettled row to **failed**; a later `posted`, a changed amount/currency/account, an impossible debit, or a post-settlement reversal is rejected with a 5xx so Stripe retries and operations can investigate;
- a repeated successful delivery is acknowledged without applying the balance again. A failed event is deliberately eligible for a same-payload retry instead of being incorrectly deduplicated forever.

The existing **External accounts** panel shows recent provider settlement state (pending, settled, or voided) without displaying sensitive provider data. Stripe's full transaction/export history remains the operations source of record.

Before enabling customer ACH/wire initiation in production, the operations team must still complete these release controls:

- reconcile each provider transaction against the daily Stripe financial-account transaction export and investigate every unmatched settlement;
- route failed/returned/reversal conditions into an operator-visible exception workflow (reversals must remain distinct provider transactions);
- enable the Stripe Connect financial-account component (or an equivalently reviewed native flow) for external account collection and money movement;
- run Stripe test-clock/sandbox cases for ACH pending, return, reversal, duplicate delivery, out-of-order delivery, and partial provider outage before enabling live outbound payments.

Until those controls are complete, Veyra intentionally refuses to represent a local transfer as a live Stripe payment. This is a safety property, not a missing loading state.

## Secret rotation

- Rotate `TOKEN_SECRET` by deploying the new key as `TOKEN_SECRET` and the former one in `TOKEN_SECRET_PREVIOUS`, then remove the former key after at least 12 hours plus a deployment buffer.
- Set `TOTP_ENCRYPTION_KEY` separately. Use `TOTP_ENCRYPTION_KEY_PREVIOUS` only for the short decrypt-and-migrate grace period.
- Rotate `STRIPE_WEBHOOK_SECRET` through Stripe's endpoint-secret rotation process. Keep both endpoint secrets accepted only if the webhook verifier is explicitly extended to do so; this adapter deliberately accepts one current secret to avoid accidental indefinite trust.
- Rotate Stripe API keys in the host secret manager, deploy, verify health/onboarding/card issuance in test mode, then revoke the old restricted key.

## Verification

```bash
npm run test:stripe-rails
npm run audit:routes
npm run typecheck
```

The adapter test verifies webhook HMAC/timestamp rejection, duplicate delivery, production environment controls, test-mode card issuance, provider-side freezing, and that live cards retain only opaque provider identifiers and masked card data.
