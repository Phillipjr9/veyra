# Add funds: the full Send money flow

Updated 6 October 2026.

## Current behavior

The user requested the exact Send money interaction for Add funds, not just a
similar animation. Ordinary account funding now follows:

1. **Details** — compact method selector, amount, quick amounts and optional
   memo. All eight existing funding methods remain available. The wide catalog
   and instruction cards no longer appear in ordinary account funding.
2. **Review** — the actual shared `FlowReview` used by Send money, showing the
   amount, source-to-account track, method, memo, availability and fee. Edit
   returns to the populated form. Close, Cancel and Escape do not submit money.
3. **Confirm** — an explicit “Add $…” button submits the existing account-entry
   request immediately, with its idempotency key and duplicate-click guard.
4. **Processing** — the same `FlowProcessing` as Send money: moving track,
   progress bar, four steps and orbit. Incoming steps describe preparing the
   account view, not invented external bank/card activity. Normal motion uses
   four 780 ms steps plus 520 ms wrap-up. Reduced motion uses four 600 ms steps
   plus 120 ms wrap-up so the screen remains visible without spatial animation.
5. **Receipt** — the same `FlowReceipt` as Send money, with animated check,
   confetti (ordinary motion), count-up, actual server reference/status/date,
   downloadable receipt, Add more and Done.

All stages use the compact money-flow modal. Recent deposits are still available
in a collapsed details section. The amount remains moderate in size and actions
stack on narrow mobile screens. Incoming entries do not debit an external bank
or card, and the UI continues to state that those integrations are not connected.

## Safety and compatibility

- Details and review never POST a deposit. Client validation requires a plain
  decimal amount from $10 to $100,000 with at most two decimal places; server
  validation remains authoritative.
- Credit is immediate after confirmation. Animation does not postpone the POST
  or ledger update, and does not create staff approval for ordinary funding.
- Success requires both the actual server response and completion of the visual
  presentation. Slow responses remain “Waiting for confirmation…”.
- Refusal restores editable details. A lost response can be retried with the
  same key, unless the member changes the request. Duplicate clicks credit once.
- Confirmed deposits survive account-refresh failures and retain refresh
  recovery on the receipt without encouraging another deposit.
- Existing manual/request-only funding mode retains instructions, provider
  activation restrictions and status refresh. Pending requests do not celebrate
  or claim that funds were credited.
- Existing Ledger Intelligence charts and all outgoing payment behavior remain.
- No backend financial behavior changed. No Git push or public deployment.

## Main files

- `src/components/FundingDetails.tsx`: short details form and validation.
- `src/components/FundingDialog.tsx`: details/review/processing/receipt state,
  shared modal, explicit confirmation and existing API/idempotency behavior.
- `src/components/MoneyFlow.tsx`: shared `FlowReview`, `FlowProcessing` and
  `FlowReceipt` consumed by outgoing payments and incoming funding.
- `src/components/FundingAnimation.tsx`: incoming presentation copy and real
  receipt data, using the shared components rather than separate visuals.
- `src/styles/funding-hub.css`: compact form, moderate amounts and mobile rules.
- `tests/e2e/funding-helpers.ts`: review then confirm helper for browser suites.

## Verification

Full `npm test`, client/server typechecks, E2E typecheck and production build
passed. **26 distinct browser checks passed** across separate disposable-server
batches: seven funding-flow checks, two eight-method personal/business checks,
five payment regressions, four outgoing payment/control checks, six ledger-chart
checks and two manual funding checks. Authentication rate limits were unchanged.

Coverage includes no POST before confirmation, edit/cancel preserving details,
invalid/over-limit amounts, every funding method, immediate ledger credit behind
an animated presentation, actual particle movement, held server responses,
reduced motion, duplicate clicks, lost-response retry, refusal/retry, refresh
failure recovery, receipt download, and overview/quick-jump entry points.
Details, review, processing and receipt widths were checked at 320, 390, 768 and
1440 pixels. Details/review and processing/receipt screenshots were inspected.
