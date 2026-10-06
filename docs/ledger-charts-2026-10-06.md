# Ledger-driven charts — October 6, 2026

> UI scope corrected by the subsequent user request. The additional breakdowns and Scout explorer described below were removed. See `account-interface-correction-2026-10-06.md` for the current interface.

## What changed

- Personal, business, admin and Scout cash-flow charts use one shared analytics contract. Scout's reconstructed balance and illustrative forecast were removed rather than presented as recorded financial history.
- Every explorer offers 7/30/90-day filters, area/bar views, incoming/outgoing/net KPIs, and direction-specific breakdowns. Incoming is grouped by payment channel; outgoing by transaction category. A top-five-plus-other grouping reconciles to the displayed direction total.
- Personal top-category bars follow the explorer's selected range. The small balance-card activity bars show only recent cleared, nonfuture movements and explicitly identify their smaller scope.
- Admin channel volume follows the same selected period, retains all rails, and has a real empty state instead of a fabricated 100% slice. Six-calendar-month operational totals are separately labeled.
- Business cash-cover metrics and personal net movement use the complete ledger summaries. Money Plan's month-to-date amounts and budget bars use complete UTC calendar-month totals/category spend, not the truncated feed.
- Pending/failed statuses remain intact in account normalization and are correctly labeled in transaction tables/receipts. Filtered transaction-strip totals only include cleared, nonfuture entries, with cents-based arithmetic. Custom transaction categories are preserved rather than silently renamed Operations.
- Market-price/holding charts, reward-rate illustrations, savings targets and configured limits retain their own appropriate semantics; they are not relabeled as cash flow.

## Data and accounting contract

`shared/ledgerAnalytics.ts` is the pure analytics implementation. `src/lib/dashboardAnalytics.ts` re-exports it for client callers/tests. `server/src/ledgerAnalytics.ts` reads the ledger for both protected snapshots:

- `/api/me/state`: `account.analytics`, scoped to the authenticated account owner.
- `/api/admin/state`: `analytics`, under the existing dashboard permission.

Both snapshots still cap their detailed transaction feeds at 400. Analytics have **no row-count cap**: the server reads the fields required for all transactions in the supported six-calendar-month horizon, then returns bucket/category/channel summaries. All 7/30/90-day windows and the prior 30-day comparison are within that horizon. Transaction screens explicitly describe the recent-feed limit; recurring-spend hints likewise disclose their feed scope.

Rolling windows are `(asOf - days, asOf]`, including the current partial bucket. Calendar-month boundaries, chart labels, tooltip ranges and update stamps use UTC. Amounts aggregate as integer cents before converting to displayed dollars. Only `cleared` records with valid finite dates/amounts and nonzero rounded cents contribute. Pending records are counted separately within the selected window; failed/unknown statuses and future records never become cleared cash flow.

Account transfers, refunds, rewards redemptions and savings-pocket movements follow their recorded ledger signs. This is gross movement, not income classification, profit, available balance or external settlement. Platform paired transfers appear on both sides; the chart's data disclosure explains that distinction. Percentage rounding can differ slightly from 100% at one decimal, but no channel or monetary volume is discarded.

## Freshness and safety

Member snapshots refresh every 15 seconds while visible, and on focus/visibility restoration. Confirmed account mutations retain their immediate refresh. Background reads serialize with the existing mutation queue; sequence and session-token checks prevent an old response from overwriting a newer snapshot or another session. Chart period/style choices survive refreshes. Failed background reads retain the last good snapshot and its as-of timestamp instead of displaying invented zeros.

Admin overview charts also refresh every 15 seconds while visible and on focus. Automatic console refresh is restricted to the overview so settings/role drafts are not periodically reset. Failed overview refreshes retain existing charts with an error/stale-snapshot indication.

No changes to payment settlement, Add funds methods, QR payloads, provider activation or financial writes. Funding/transfers remain mock/demo where enabled; live rails were not enabled.

## Verification

- `npm run typecheck`, `npm run typecheck:e2e`, production build and full `npm test` passed.
- Shared analytics checks cover exact cents, 7/30/90 boundaries, UTC calendar rollover, status exclusions, time aging, eight payment channels, breakdown reconciliation and empty states.
- Real SQLite/API regression seeds more than 450 transactions while feed responses remain capped at 400, verifies complete member/platform totals, account isolation, permission checks and a pending-to-cleared transition.
- **34 browser tests passed**: 19 dashboard/responsive, six new ledger-chart checks, five immediate-funding and four receive-hub checks. Includes incoming payment from another session through the actual polling timer, funding/outgoing updates without reload, preserved filters, failed reads, a delayed-response race, Scout consistency, failed/pending/future presentation, all admin rails and empty states.
- **17 additional browser regressions passed** for banking controls, admin member tools, authentication and money controls: **51 targeted browser checks total**.
- Phone/tablet/desktop checks cover widths from 320 to 1440px. Live personal/business/admin inspection reported no page errors or horizontal overflow. Preview host and API proxy returned HTTP 200.

Commands:

```sh
npm run test:dashboard
npm run test:e2e:charts
npm run test:e2e:demo
```

This environment used `/tmp/chromium` with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `LD_LIBRARY_PATH=/tmp/al2023/lib`. Test databases and browser artifacts are disposable, outside the repository. Logs: `/home/user/charts-browser-final.log`, `/home/user/charts-regressions.log`, `/home/user/charts-tests-final.log`.

No branch switching, pull, merge, commit or push was performed.
