# Restored Add Funds choices — October 6, 2026

## Agreed scope

The user selected **Restore methods; activate payments later**. This update provides a funding selector and per-member receiving instructions. It does not integrate a payment provider, send ACH trial deposits, initiate Zelle transfers, collect debit-card credentials or enable automatic settlement.

## Member experience

Open **Add funds** from the personal or business dashboard.

| Choice | Current behavior |
| --- | --- |
| Link a bank (ACH) | Explains account-holder/routing/account details, trial-deposit verification and separate transfer authorization. Bank fields are a disabled setup preview. Explicitly awaiting provider activation. |
| Debit card | Secure-linking preparation screen. No PAN/CVV fields or card tokenization. Explicitly awaiting provider activation. |
| Zelle | Shows only the member’s enabled, admin-configured recipient name, enrolled email/US phone and instructions. The member uses their own participating bank’s service and verifies the recipient independently. |
| Bank transfer | Manual receiving bank, routing/account and recipient instructions. This is not an ACH pull from a linked external bank. |
| Wire transfer | Manual incoming-wire instructions configured by the administrator. |
| Direct deposit | Manual receiving instructions to share with an employer/payroll provider after independent verification. No payroll enrollment is performed. |
| Check deposit | Configured check-delivery instructions only. No camera collection, OCR or clearance simulation. |
| Other funding | Appears when an additional method is configured for the member. |

Cards distinguish **Activation needed**, **Instructions available**, and **Not configured**. Unconfigured choices remain discoverable but cannot submit a funding request. No demo account number is silently substituted as a usable real-world destination.

After following manual instructions, the member can record an incoming transfer for review. Requests remain pending and do not increase balances until authorized staff independently confirm receipt. Existing idempotency, member scoping, amount limits and pending-request caps remain in force. Refresh updates instructions, request statuses and the account balance. Removed/disabled selected instructions are cleared from the current form.

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
