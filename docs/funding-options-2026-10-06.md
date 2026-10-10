# Restored Add Funds choices — October 6, 2026

## Agreed scope

The user selected **Restore methods; activate payments later**. This update provides a funding selector and per-member receiving instructions. It does not integrate a payment provider, send ACH trial deposits, initiate Zelle transfers, collect debit-card credentials or enable automatic settlement.

## Member experience

Open **Add funds** from the personal or business dashboard.

| Choice | Current behavior |
| --- | --- |
| Link a bank (ACH) | Pull from a linked external account (amount + authorization) once a provider is connected. Inbound ACH to the Veyra account shows routing and account details and does **not** take an amount. |
| Debit card | Amount + fee review. Secure-linking preparation until a card processor is connected. |
| Zelle | Not shown in Add funds. Send money only. |
| Bank transfer | Routing and account details to receive an ACH credit from another bank. **No amount field** — the sending bank originates the transfer. |
| Wire transfer | Incoming-wire details (beneficiary, routing, account). **No amount field** — wires are not initiated from Veyra. |
| Direct deposit | Routing and account details to share with payroll. **No amount field** — payroll sends the deposit. |
| Check deposit | Configured check-delivery instructions only. No camera collection, OCR, clearance, or amount. |
| Other funding | Appears when an additional method is configured for the member. Instructions only; no amount. |

Cards distinguish **Activation needed**, **Instructions available**, and **Not configured**. Unconfigured choices remain discoverable but cannot submit a funding request. No demo account number is silently substituted as a usable real-world destination.

Receive methods (direct deposit, wire, bank transfer, check) show account or delivery details only. Members do not type an amount there — money appears when the sender posts it. Amount entry is limited to debit card and a linked-bank ACH pull. Existing idempotency, member scoping, amount limits and pending-request caps remain in force for those amount methods. Refresh updates instructions, request statuses and the account balance. Removed/disabled selected instructions are cleared from the current form.

## Administrator controls

Use **Admin → Customers → Funding → Add funding method**. Select a method type, give it a label and instructions, and enable it for that member.

- Zelle adds a dedicated enrolled email/US-phone field and requires a recipient name when enabled. It does not accept routing/account details in place of the Zelle contact.
- Bank transfer, wire and direct deposit can show the configured receiving bank/routing/account details.
- ACH and debit-card entries may have reference instructions, but their checkbox cannot activate the missing integration. The server rejects new deposit requests for these kinds even if a client bypasses the disabled UI.
- External ACH account and debit-card numbers are not accepted in the structured fields of these inactive provider-dependent methods.
- Existing pending requests, including snapshots of the instructions used, remain available for authorized review.

## Persistence and safeguards

Migration 18 extends funding kinds and adds `recipient_contact`. It rebuilds both funding tables inside the existing migration transaction, preserving identifiers, requests, snapshots, review evidence, timestamps and foreign keys. It does not disable foreign-key enforcement or credit any funds.

The shared `shared/funding.ts` catalog defines the member/admin labels and identifies provider-dependent methods. Future activation requires a real server-side integration; merely changing the UI labels or toggling a method is not sufficient.

Before real activation, implement the chosen provider’s onboarding and eligibility checks, secure hosted/tokenized data collection, consent, ownership verification, rate/attempt limits, transfer authorization, idempotency, signed webhook verification, reconciliation, returns/reversals and operational monitoring. Provider credentials belong in server-side configuration, not chat, repository files, funding notes or client code. Zelle requires an appropriate receiving-bank arrangement rather than treating an arbitrary email address as an active payment integration.

## Verification

- Application and E2E TypeScript checks pass.
- Production build passes.
- Full `npm test` passes; the banking suite now has **66 checks**.
- Migration test reconstructs the old funding schema and confirms preservation of pending/confirmed/rejected records, disabled methods, IDs, snapshots and foreign-key validity, including reopening after migration.
- Banking and responsive browser checks: **25/25 passed**.
- Complete browser regression: **85/85 passed**, retries disabled.
- New browser coverage checks the seven default choices, disabled ACH fields/card collection, real admin Zelle/direct-deposit configuration, pending requests without balance changes, provider-inactive options even after admin configuration, and withdrawal of disabled instructions on refresh.
- Live preview inspected at desktop and 390px mobile width; no page runtime errors or horizontal overflow in the inspected funding screens. Automated layouts also cover 320px, 768px and 1440px widths.

Preview: Vite on port 5173, API on port 8787, browser API requests proxied through relative `/api` URLs. No real payment rail was activated and no external funds were moved during this work.
