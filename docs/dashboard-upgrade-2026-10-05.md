# Authenticated dashboard upgrade — 2026-10-05

## Scope

Upgraded the **routed** personal, business and admin workspaces, preserving the existing authentication, permissions, banking actions and routes. No backend/schema changes or new runtime dependencies. The completed marketing homepage is unchanged by this dashboard work.

Active integrations:
- Personal: `src/pages/dashboards/ClassicDashboard.tsx`
- Business chrome: `src/pages/dashboards/BusinessDashboard.tsx`
- Business overview: `src/pages/Dashboard.tsx`
- Admin: `src/pages/SuperAdmin.tsx` (owns its own chrome; does not use the alternate AdminShell)

## Experience

- Distinct ink/lavender personal and forest business navigation, lighter information panels and refined hierarchy.
- Personal shortcuts to real savings, markets, planning and security pages.
- Shared cash-flow explorer with 7/30/90-day windows, area/bar controls, actual incoming/outgoing/net totals, pending exclusions, honest empty states and an expandable keyboard-accessible data table.
- Admin platform controls, successful-snapshot timestamp and a native mobile module selector. Its options use the same permission-filtered list as the retained desktop tabs; switching modules also resets the role-matrix draft consistently with the tabs.
- Business mobile navigation now locks background scrolling, closes on Escape and restores opener focus. Both member drawers close when returning to desktop width.
- Corrected the business net label from a future-looking forecast to **Last 30 days · net**. Pending and future records are excluded from that summary. Card limits are labelled as combined limits rather than available spending capacity.

## Data semantics

`src/lib/dashboardAnalytics.ts` aggregates integer cents from the supplied ledger. Each 7 / 30 / 90-day range is one UTC calendar day per bucket, from the first day's midnight through the current instant. Pending, future-dated and invalid records do not contribute to totals. No synthetic transactions or trends are introduced. Transfers can appear in activity; the table explicitly states that net movement is not profit.

The charts respect reduced-motion preferences. Their tooltip uses a stable in-chart position so stale offsets after resizing cannot create invisible horizontal overflow.

## Responsive handling

Scoped styles live in `src/styles/dashboard-advanced.css`, imported before the existing final mobile stylesheet.

- Navigation breakpoints agree with the existing shell's 1100px off-canvas breakpoint.
- Headers collapse controls before they collide at tablet/phone widths.
- Personal available/reward balances and the admin aggregate balance receive full-width mobile rows; financial values are not ellipsized.
- Mobile cash-flow totals are labelled rows rather than cramped three-column figures.
- The balance mini-chart follows its metadata in normal document flow.
- Scheduled-payment names, amounts, status and actions have explicit non-overlapping mobile rows.
- Admin profile actions wrap; dense data tables scroll within their own labelled regions instead of widening the page.
- No body-level overflow hiding was added to conceal layout defects.

## Verification

- `npm run typecheck` — passed (client and server).
- `npm run typecheck:e2e` — passed.
- `npm run build` — passed.
- `npm test` — passed, including new analytics assertions and the existing permissions, email, route/API coverage and 434 API checks.
- **15 dashboard browser tests passed** against the real disposable authenticated test server.
- **28 existing integration browser tests passed**, covering navigation, planning, trades, passkeys, statements, signup/approval, invoices, admin modules/export, auth recovery, support and team invitations.
- The **16 homepage browser tests** also passed during the regression run.
- Source `git diff --check` passed (generated `dist` excluded).

Dashboard tests cover ten widths: **320, 360, 390, 600, 768, 1024, 1100, 1101, 1200 and 1440px**. Assertions check document/body overflow, actual panel bounds, sibling intersections, balance metadata/chart separation, navigation, notifications, deposit dialogs, all 14 admin modules, banking pages at 320px, real ledger totals, shortcuts and empty/pending-only states. Additional large-value cases verify a $1,250,000.25 member balance and a $12,345,678 admin balance on narrow phones.

Axe automated WCAG 2 A/AA scans of each overview reported **zero violations at 1440, 768, 390 and 320px** after contrast and labelling fixes. This is an automated overview check, not a claim of complete application accessibility certification. Desktop/phone screenshots and chart screenshots were also inspected; scratch QA artifacts are outside the repository.

The existing passkey test's logout locator was scoped to the navigation, distinguishing it from same-named per-session revoke buttons. One combined run encountered a team-invite timing failure; both the isolated rerun and the subsequent complete integration run passed without changing that workflow.

## Re-run

```sh
npm run test:dashboard
npm run typecheck
npm run typecheck:e2e
npm run build
npx playwright test tests/e2e/dashboard-responsive.spec.ts tests/e2e/integration.spec.ts
```

Playwright supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` where a preinstalled Chromium is needed. Its existing configuration uses a disposable database and offline pricing fixtures; layout stress cases intercept responses only within their individual test pages.
