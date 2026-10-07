# Add funds: method dropdown and review parity — October 7, 2026

## What changed

- **Method dropdown** (`src/components/FundingDetails.tsx`, `src/styles/funding-hub.css`)
  - Options are grouped into **Ready now** and **Needs setup** instead of one flat list.
    Option labels are unchanged, so existing selections by label keep working.
  - A one-line summary under the dropdown shows the selected method's status
    (Ready / Setup needed), when it is available, and its fee.
  - The native `<select>` stays as the control, so keyboard use, screen readers
    and mobile pickers behave as before.
  - The form body scrolls in a plain container rather than the `<fieldset>`, so
    the Cancel / Review buttons no longer overlap fields on short phone screens.
- **Review parity with Send money** (`src/components/FundingDialog.tsx`): the
  review now ends with a **Balance after** row, as Send money's review does.
  The figure is the current balance plus the amount, minus the deposit fee.

## Unchanged

- Details → Review → Processing → Receipt flow, the shared modal, idempotency
  keys, the server API and all ledger behaviour.

## Verification

- `tsc --noEmit` (client) passes.
- Browser check at 1440×900 and 390×844: no overlap; summary and grouping render.
- `funding-animation.spec.ts` and `account-interface.spec.ts`: 5 passed, 4 failed.
  The same 4 fail on the unmodified base commit (they expect a configured
  "Debit card" method that the seeded demo member does not have).
