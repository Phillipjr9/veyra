# Crypto sending: shared money-flow animation

6 October 2026

## What changed

Crypto withdrawals now use the same `FlowProcessing` component as Send money
and Add funds, within the shared compact modal and progress header. This replaces
the old static 65% track and 200 ms reduced-motion shortcut.

Crypto-specific polish includes an existing 3D asset image with a floating orbit,
a network badge, a purple progress track, staggered preparation steps, and a full
wrapping destination-address card. The final request record uses a warm clock
badge, exact quantity, status/reference/network rows and a downloadable request
record. It does not use the transfer-success checkmark or confetti.

The details, review, processing and recorded stages fit narrow mobile layouts;
buttons stack and long addresses/quantities wrap rather than overflow. Reduced
motion removes spatial animation, particles and CSS rotation while retaining a
visible account-update sequence. The four shared steps take 780 ms each in normal
motion (plus a 520 ms wrap-up), or 600 ms each in reduced motion (plus 120 ms).

## Financial behavior preserved

- The withdrawal POST is immediate after confirmation, not delayed by animation.
- Processing ends only after both the real response and the shared presentation.
- A held response says “Waiting for request confirmation…”, not blockchain
  confirmation. Steps describe preparing the view, not fabricated signing,
  custody or network activity.
- The final state remains **Pending · not broadcast**. Units are reserved, not
  sent. No transaction hash, network fee quote or on-chain success is invented.
- Exact quantities remain strings, including all eighteen ETH decimal places.
  Shared `FlowProcessing` supports an explicit string display instead of dollar
  formatting; existing fiat callers retain their numeric USD formatting.
- Duplicate confirmation is guarded. Lost-response retries keep the same key.
  Changed address/quantity gets a new key, as before.
- Rejected requests return to review. Failure to refresh after an acknowledged
  request cannot reopen submission or claim the request failed.
- Unmount resolves the local presentation wait; shared step timers clean up on
  unmount/retry. No stale response can update an unmounted dialog.
- A replay of a cancelled request is shown as cancelled, not newly reserved.
- Existing withdrawal-history cancellation still releases reserved units.

No backend, wallet permissions, custody, signing or broadcasting changes. No
public deployment or Git push.

## Files

- `src/components/CryptoSend.tsx`: shared modal/processing, polished request
  record, download, lifecycle and retry safeguards.
- `src/components/MoneyFlow.tsx`: optional center icon, waiting title, exact
  string amount and completion label; defaults preserve outgoing/funding flows.
- `src/styles/crypto-send.css`: scoped crypto styling and motion/mobile rules.
- `tests/e2e/crypto-send-animation.spec.ts`: four real-server browser scenarios.
- `npm run test:e2e:crypto-send`: focused build and browser test entry point.

## Verification

Full `npm test`, client/server typechecks, E2E typecheck and production build
passed. **16 distinct browser checks passed**: four new crypto-animation tests,
seven Add funds regressions, four outgoing-money/control regressions and the
existing crypto withdrawal/cancellation integration test.

New checks cover measurable particle movement, duplicate confirmation, real
reservation before the displayed response, slow responses, mobile widths
320/390/768/1440, request-record download, cancellation, reduced motion, exact
18-decimal ETH, rejection/retry, lost responses and cancelled replays. Desktop
and mobile processing screenshots and the pending request record were visually
inspected. Artifacts and logs are kept outside the checkout.

## Visual refinement after follow-up

The same shared Send money sequence now has a visibly travelling asset coin
(with a soft trail and raised edge) rather than only generic dots. The hero coin
has a circular progress ring synchronized with the actual presentation steps;
the current step is highlighted. A scoped shared-layout transition carries the
hero coin into the pending request record. Raised track styling adds depth.
These are optional shared-component features enabled only for crypto; fiat
animations retain their existing defaults. The destination remains a withdrawal
request, never a claim of delivery to the external wallet.

Reduced motion removes the travelling coin and spatial transitions; progress
still updates quietly. New browser assertions measure the coin's movement and
ring's changing stroke, in addition to the existing particles and lifecycle
checks. All 16 browser scenarios, full npm tests, both typecheck commands and
production build passed again after this refinement. The active-step screenshot
was visually inspected. Changes remain workspace/preview-only.
