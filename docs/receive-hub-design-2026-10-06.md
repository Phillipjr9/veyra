# Receive Hub design — October 6, 2026

## Scope

Redesigned the existing **Transfers → Receive Zelle® QR** dialog without changing funding, account balances, transfer endpoints, approval rules or the restored Add funds flow. No separate wallet or payment playground was reintroduced.

## Interface

- Split desktop layout: layered lavender receive card alongside saved-contact selection and sharing controls.
- Veyra identity, account-holder name/initials, real high-resolution QR, selected signup contact and explicit demo labelling.
- Email and phone selection cards with visible selection state; missing, ambiguous or unusable phone aliases remain disabled with an explanation.
- Share link, copy identifier, copy payment link and PNG download. Native sharing falls back to clipboard when unavailable; failed sharing/copy exposes a selectable manual link.
- Expandable payment-link disclosure, three-step receiving explanation and clear no-real-money / not-official-Zelle-QR notice.
- Responsive single-column layout, sticky close/header, scroll containment, wrapping for long contacts, reduced-motion support and keyboard focus restoration.
- QR color/quiet zone remain unobstructed. The selected alias is matched to its encoded image URL before rendering or downloading, so an old QR cannot be offered during regeneration.

## Files

> **Superseded 8 October 2026 (PR #13).** This receive UI was replaced by the
> dedicated Zelle page: `src/pages/ZellePage.tsx` (+ `src/styles/zelle-page.css`), routed at
> `/app/zelle`. `ReceiveHub.tsx`, `ZelleHubModal.tsx` and `receive-hub.css` no longer exist,
> and `tests/e2e/receive-hub.spec.ts` was deleted and superseded by `tests/e2e/zelle-page.spec.ts`
> (the `test:e2e:demo` / `test:e2e:account` scripts now run that file). The description below is
> kept as the design record for the flow; the Zelle page carries the same QR, share and
> disclosure behaviour.


`src/components/ReceiveHub.tsx`, `src/components/ZelleHubModal.tsx`, `src/styles/receive-hub.css` contain the new receive UI. `DemoPayments.tsx` now only contains the existing shared mode notice; its stylesheet no longer carries retired playground styling. `bankingDialog.ts` excludes descendants of closed details from focus trapping (except the direct summary), avoiding an invisible focus endpoint.

## Checks

- Client/server and browser-test typechecks pass; production build passes.
- Full `npm test` passes, including the existing 86 immediate-funding/payment API assertions.
- **9 receive/funding browser tests passed**, including decoding email and phone QR images, decoding the downloaded PNG, full signed-out receive-link flow, normal-account payment delivery, clipboard/native-share fallback, failure states, keyboard trapping/restoration and unavailable receiving.
- **13 additional banking, admin-member and money-control browser regressions passed.**
- Widths 320, 390, 768 and 1440px checked, including long names/contacts, visible buttons, dialog bounds and horizontal overflow.
- Live desktop/mobile inspection showed no page runtime errors or horizontal overflow.

`npm run test:e2e:demo` now runs both the payment and receive-hub suites. Demo receiving remains a current-origin Veyra payment link, not a live Zelle network code or proof of real enrollment.
