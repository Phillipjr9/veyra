# Add funds: method dropdown and review parity — October 7, 2026

## What changed

- **Method picker** (`src/components/FundingMethodPicker.tsx`, `src/styles/funding-hub.css`)
  - Replaces the native `<select>` with a custom listbox. Each method shows its
    own icon (Zelle uses the Zelle logo) and a short hint, e.g. "Zelle® · instant,
    no fee" or "Debit card · 1.5% fee".
  - Options are grouped into **Ready now** and **Needs setup**. Methods that are
    not usable yet stay visible, with a "Setup needed" badge.
  - The list expands in place rather than floating, because the details form
    scrolls and an overlay would be clipped.
  - Keyboard: arrow keys, Home/End, Enter or Space to choose, Escape to close.
  - A one-line summary under the picker shows the selected method's status and fee.
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
- Playwright helpers `chooseFundingMethod` / `openFundingMethods` drive the picker.
- `funding-animation.spec.ts` and `account-interface.spec.ts` (after `npm run build`):
  5 passed, 4 failed. The same 4 fail on the unmodified base commit (they expect a
  configured "Debit card" method that the seeded demo member does not have).
- `dist/index.html` was rebuilt so the same-origin app on port 8787 shows this UI.
