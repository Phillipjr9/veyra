# Banking, pricing, funding and digital-assets update

## Scope and operation

### Consistent pricing

`shared/catalog.ts` supplies the plan names and monthly amounts used by public pricing, signup and settings: personal Everyday ($0) / Plus ($9); business Starter ($0) / Pro ($99). Public descriptions now reflect available features. Selecting a plan records the choice; subscription collection and plan-specific limits are not implemented. Annual discounts and savings guarantees are not advertised.

Digital-asset catalog, holdings and trade previews use the server's canonical quotes. Buy/sell submissions include the expected quote; the server rejects changed prices instead of silently executing at another rate. Missing prices are not zero; stale or unavailable quotes prevent trading. Owned quantities remain visible when prices cannot be fetched.

### Account details

In **Admin → Customers → Account details**, an authorized administrator can edit routing number, account number, bank name, Checking/Savings and Personal/Business designation. A change reason is required. Changes are validated and audited. Active business teammates prevent conversion to a personal workspace. These fields do not connect or verify an external bank, nor change identity-verification approval.

### PDF receipts and transfer categories

Transaction drawers now download a generated PDF rather than an HTML page labelled as a receipt. Both dashboard drawer variants use the shared receipt implementation. Transfer category is optional for personal accounts and required for business accounts, including server-side enforcement.

### Per-member funding controls

In **Admin → Customers → Funding**, configure up to 12 methods for the selected member: bank, wire, card, check or other. Each can have a label, recipient/bank details, instructions and enabled state. These are per-member instructions, not processor integrations. Do not enter payment-card numbers, CVVs, private credentials or provider API keys in these fields.

Members open **Add funds**, select an enabled method and submit a $10–$100,000 request with an optional reference. This records a pending request only. Staff with balance-adjustment permission review the request and provide confirmation evidence or a rejection reason. Confirming credits the internal ledger once; retries cannot double-credit. Members can use **Refresh funding status** to update both the request status and account balance without logging out. There is a 20-pending-request cap.

Check deposit entrypoints show configured check instructions only. They do not simulate camera capture, OCR, collection or clearance. Demo accounts have clearly marked demonstration-only funding instructions; do not transfer real funds to those examples.

### Digital assets and pending sends

The shared supported catalog contains 24 assets. The catalog is separate from holdings; holdings show only assets with owned or reserved quantities, not every available asset. Available and pending/reserved amounts are distinguished.

**Send crypto** validates supported network, destination format and exact asset precision. Submitting plays the sending animation and ends at **Pending**. Units are reserved atomically, remain in portfolio totals, and cannot be reused for another spend. Members can inspect pending requests and cancel them to restore the reservation exactly once. Retry identifiers and a 20-pending-request cap protect against duplicate requests.

There is no blockchain broadcast, transaction hash, on-chain fee estimate or custody-provider integration. Address-format validation is not proof that a recipient controls an address. The current withdrawal workflow provides pending requests and cancellation, not an external settlement engine.

## Responsive and accessibility checks

- Forms and dialogs support narrow screens, labelled inputs, keyboard focus containment and Escape-to-close while idle.
- Saving account details disables the editable form until the response arrives.
- Long audit summaries wrap; before/after snapshots expand under **View changes**, without stretching the admin dashboard on mobile.
- Public pricing uses two cards on wide screens and a single column on narrow screens.
- Existing moderate dashboard balance typography is retained.

## Verification

- Application typecheck, E2E typecheck and production build pass.
- `npm test` passes, including the new 43-check banking suite alongside API, money-control and authorization/audit coverage.
- Four dedicated browser scenarios pass: shared plan pricing; admin account/funding edits and member funding-status/balance refresh; downloaded PDF and personal/business category rules; 24-asset catalog, owned-only holdings and pending crypto/cancellation.
- Banking plus dashboard responsiveness regression: 23/23 passed.
- Final complete browser regression: **83/83 passed**, with retries disabled (`/home/user/banking-full-browser-delivery.log`). An earlier run passed 82/83 with an intermittent existing homepage canvas-pause assertion; the unchanged homepage rerun passed 16/16 and the subsequent complete run passed all 83. No homepage code or assertion was changed to mask the earlier failure.
- Live Vite/API preview checked at desktop and 390px mobile width. Account/funding dialogs opened against the real preview API with no page runtime errors and zero horizontal overflow.

Tests run against a disposable database and deterministic test quote server. Their passing quote/trade scenarios do not establish connectivity to a real market provider.

## Runtime limitations and deployment

At verification time the preview API returned all 24 assets but `quoteStatus: unavailable` and no priced assets. A direct HTTPS request to the configured CoinGecko host also failed its TLS connection from this environment. The UI deliberately shows unavailable prices and refuses unpriced trades. Restore outbound provider connectivity or configure an approved CoinGecko-compatible `CRYPTO_PRICES_URL` before relying on live quotes; do not substitute test fixtures or historical constants into the production feed.

Funding instructions do not charge cards or connect bank rails. Staff confirmation must follow actual external receipt/settlement evidence. Crypto submission does not send on-chain funds. Payment, banking and custody integrations require separate activation and operational/compliance review. Existing Google address autocomplete remains inactive without its provider configuration.

No pull, merge, deployment, branch switch or commit was performed for this update. Work remains on the session branch `arena/7e309785-veyra`.
