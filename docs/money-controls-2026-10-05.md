# Money-control hardening — 5 October 2026

## Scope

Disable unfunded Scout credits and enforce the existing business-teammate monthly limits on the server. Preserve the homepage, dashboard work, auth, roles, financial history and mobile layouts. These changes protect the **internal ledger**; they do not connect real payment rails or make the product ready to hold/transmit real funds.

## Scout

- Transfers always record zero new Scout savings, regardless of preferences. Random credit generation is removed.
- Authenticated, approved requests to `POST /api/me/scout/apply` return HTTP 410 with `code: scout_credit_disabled`, without modifying balances, rewards, savings, applied-opportunity IDs or transactions.
- The endpoint remains an explicit tombstone for old clients. The API-coverage check accounts for it separately and rejects new UI callers.
- Scout reviews are informational estimates. The UI no longer simulates provider negotiation or offers a button that creates credits. Existing-pocket allocation remains a transfer of the member's own funds.
- Historical records and balances are not deleted or silently reversed. Historical/demo-derived Scout entries are labeled accordingly, including the legacy personal dashboard.
- Ordinary cashback is unchanged and still needs a funded production operating model.

## Team spending policy

| Rule | Behavior |
| --- | --- |
| Window | UTC calendar month; inclusive month start, exclusive next month start |
| Identity | Actual authenticated teammate, never a client-supplied actor ID |
| Account scope | Shared business owner account |
| Covered debits | Transfers/card payments, executed scheduled bills and crypto buys combined |
| Amount counted | Gross negative, actor-attributed ledger amounts with cleared or pending status |
| Admin/Member | Enforced against their stored monthly limit; $0 allows no outgoing spending |
| Owner | Not subject to a teammate cap |
| Bookkeeper | Existing read-only permissions retained; invite limit must be $0 |
| Credits/sales | Do not replenish gross monthly allowance |
| Savings pockets | Moving existing funds between own pockets is excluded |
| Scheduled setup | Creating a schedule does not reserve allowance; manual execution charges the authenticated executor |
| Invite validation | Reject negative limits, limits above $250,000 and nonzero Bookkeeper limits |

The guard re-reads active membership and the stored cap **inside the same `BEGIN IMMEDIATE` transaction** as the debit and actor-stamped ledger insert. Crypto quote lookup may await first; the check still reads fresh membership after taking the write lock. Failure rolls back account/card spend, bill schedule advancement and holdings changes. The helper refuses use outside a transaction; future callers must retain the immediate-write-lock contract.

A cap refusal returns HTTP 403 and:

```json
{
  "error": "Monthly team spending limit exceeded…",
  "code": "team_monthly_limit",
  "limit": 50,
  "spent": 50,
  "remaining": 0,
  "resetsAt": 1793491200000
}
```

Money fields are dollars; `resetsAt` is the next UTC month boundary in epoch milliseconds. Revoked/invalid membership is rejected with `team_access`. Existing card and authorization gates remain in place.

### Migration and historical attribution

Migration 16 adds a partial spending index, not a balance or ledger rewrite. Its recorded application timestamp is exposed as `spendTrackingSince`, alongside `monthlySpent`, `monthlyRemaining` and `spendResetsAt` in team state. Owners have a null remaining allowance.

Old transactions without `performed_by` cannot reliably be assigned to a teammate. They are preserved and excluded from usage rather than guessed. The Team page explicitly warns about this. Any already-attributed current-month debits count; the migration timestamp is activation metadata, **not an additional date filter**. Existing installations may therefore have incomplete individual usage in their first enforced month. This is not retroactive enforcement.

Existing invite-time limit configuration is retained; this change does not add a limit-edit endpoint or approval workflow.

## Payment confirmation and UI

- Sends and manual bill payments await the API rather than optimistically debiting balances or advancing schedules.
- Held or declined requests cannot produce a success receipt.
- If the server confirms the payment but refreshing account state fails, the client preserves the successful outcome and tells the member not to resend.
- Queued confirmed mutations capture the submitting session token and reject execution if the session changed. They do not refresh a different session's state.
- Team rows show monthly cap, tracked usage, remaining allowance and the UTC reset rule, with full-width wrapping on mobile. Owners and Bookkeepers have distinct labels.
- This is not a general transport-level exactly-once guarantee. Provider idempotency and reconciliation remain production work; ambiguous network outcomes require checking transaction history.

## Verification

- `npm test`: passed, including **44 focused money-control checks**, **435 API integration checks**, dashboard analytics, permissions, email-template checks, API coverage and route audit.
- `npm run audit:routes`: all **104 routes** passed declared authorization gates and member/staff isolation checks.
- `npm run typecheck`, `npm run typecheck:e2e`, `npm run build`: passed.
- Full Playwright suite: **63/63 passed**, covering homepage, dashboards, auth, crypto ledger, statements, support, invites and the four new money-control scenarios. The dashboard/mobile and money-control suites were also rerun after final copy/build changes: **19/19 passed**.
- Focused browser scenarios: read-only Scout; delayed decline without success; confirmed debit with failed state refresh; real capped teammate transfer/bill with visible usage at 320px.
- Concurrent API test: exactly five of twenty simultaneous $10 requests succeed against a $50 allowance. Actor spoofing, different teammates, fresh sessions, card-specific declines, UTC boundaries and revoked membership are covered.
- Migration checks: simulated v15 upgrade preserves financial records, installs tracking metadata/index and does not reset activation on reopen. The pre-existing account boot sweep is completed before isolating the migration.
- Live development preview restarted and checked separately: the actual API now exposes usage and the 320px Team page displays it. Scout and Team pages had no horizontal page overflow or browser runtime errors in the preview smoke test.

The sandbox browser uses `LD_LIBRARY_PATH=/tmp/al2023/lib PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium npx playwright test`. Browser emulation is not a substitute for physical-device testing or an independent security review.

### Startup safeguard

Preview verification found an older API process still holding port 8787. Express 5 passes bind failures into the listen callback; the old bootstrap ignored that argument, logged readiness and could seed against the other process. Bootstrap now exits nonzero on bind failure and does not announce readiness or seed. A subprocess regression test covers this case. Website and API previews are now managed independently, and the stale listener was stopped.

## Still outside this change

Real bank/card/payment integrations; crypto custody, execution and settlement; funded cashback; licensing/compliance and jurisdiction decisions; production email/auth/provider setup; reconciliation and idempotency; recovery/monitoring/release operations; independent security review. No production deployment, pull, merge or branch switch was performed.
