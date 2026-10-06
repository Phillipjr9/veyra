# Signup and sign-in update — 5 October 2026

## Delivered

- Reorganized the signup application into numbered, labelled panels: applicant details, address, identity, employment/funds, business details, beneficial owner and security. Personal accounts omit the business-only panels. Existing input IDs, server validation, account-review requirements and registration submission contract are preserved.
- Retained the original dimensional auth artwork; added a responsive desktop sidebar, full-width mobile panels, accessible account-type selection and readable input sizing. Auth entrance animation respects reduced-motion preferences.
- Removed signup's misleading provider/passkey actions: neither can open a new account without the required application. The form explains that these methods can be set up after approval.
- Removed unsupported savings and encryption promises from the auth presentation. The preview notice instructs evaluators not to enter real government identifiers.

## SSNs

`SsnField` is shared by the applicant and beneficial-owner SSN inputs.

- Only ASCII digits enter the formatted value; formatting adds the two dashes (`123-45-6789`).
- Maximum nine digits; leading zeroes are preserved for server validation rather than converted to a number.
- Numeric mobile keyboard, default password masking and independently labelled show/hide buttons with pressed state.
- Paste sanitization, middle-of-value editing, selection replacement and deletion through a separator are supported.
- Nine-digit format is required by the form; the existing server still validates actual SSN rules. UI formatting is not a replacement for server validation.
- No local/session storage was added for application identifiers. Fields are empty and hidden again after a reload.
- The eye toggle provides visual privacy only. It does not encrypt the stored identifier or change the existing server-side data-handling model.

## Login alternatives

- Email/password is the primary form, rather than appearing below the demo accounts and provider buttons.
- Explicit authenticator-app and recovery-code choices explain that the password must be verified first. Existing enrolled accounts still receive a server-issued challenge before a session is created.
- The challenge page separates numeric six-digit TOTP entry from alphanumeric single-use recovery entry. Paste normalization handles grouped codes. Invalid codes surface the server error; recovery codes cannot be reused.
- Compatible TOTP apps include Google Authenticator, Microsoft Authenticator and Authy. These are authenticator-app examples, not separately provisioned OAuth integrations. No SMS or email-OTP login was added.
- Passkey sign-in remains intact. Demo access remains available inside an expandable panel.
- Google, Apple and Microsoft options are displayed with availability status. Only server-advertised providers are enabled; unavailable providers cannot initiate a popup or a session. Configuration lookup failure leaves password/passkey options available without pretending OAuth is connected.
- Existing Firebase credential verification, verified-email/account-linking rules and staff restrictions remain unchanged. No new authentication bypass or backend endpoint was introduced.

## Activating social sign-in

The development preview currently reports federated sign-in **off**. Real social authentication cannot be enabled by UI changes alone.

1. Use an operator-owned Firebase Authentication project and enable each desired provider in its console. Apple and Microsoft also require their own developer/application configuration and provider credentials.
2. Configure the server environment with the verified project's `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` (web configuration) and `FIREBASE_AUTH_DOMAIN`.
3. Deliberately set `FEDERATED_PROVIDERS=google,apple,microsoft` only for providers actually configured. Leave staff access disabled unless its separate security policy has been reviewed.
4. Authorize the actual website hostname and the provider/Firebase redirect URI in the relevant consoles. The Arena preview hostname is not localhost; authorize the exact preview hostname for testing and the production hostname separately.
5. Restart the API and reload the page to refresh its cached public auth configuration. Verify `/api/auth/config` advertises only intended providers.
6. Test successful sign-in, account matching, cancellation, denied consent, unverified addresses and applicable staff restrictions with real operator-controlled test accounts. Do not substitute a mock token or an example project for production configuration.

Keep provider secrets in the deployment's secret/environment configuration, not in source files, chat or Git. No external provider account was provisioned in this task, and no credentials were requested.

## Verification

- `npm test` passed, including 435 API integration checks, 44 money-control checks and the existing route/permissions checks. Existing federated and TOTP backend verification remains covered by that suite.
- Client/server and E2E typechecks passed; production build passed.
- 32/32 auth and integration browser tests passed, including real personal/business signup and approval, member/admin passkeys, session revocation and restricted browser storage.
- The 4 new auth tests passed again after final UI changes. They cover applicant/owner SSN formatting, masking, paste, caret behavior, incomplete-value rejection, responsive layouts, provider gating/config failure, a real enrolled TOTP login, invalid-code refusal, real recovery login and replay rejection.
- Provider availability tests mock only public configuration to test enabled/disabled UI states; they are **not** a live Google/Apple/Microsoft OAuth certification.
- 4 legal tests passed. Homepage suite: one existing canvas-pause image comparison failed in the combined run; the complete 16-test homepage suite then passed unchanged on rerun. No homepage code or assertion was modified to obtain that pass.
- Signup tested at 320, 390, 768, 1024 and 1440px; login and verification tested on narrow phones. No horizontal page overflow or escaped controls in those checks.

Sandbox tooling was restored with `npm ci`. Browser binaries/libraries were installed outside the repository after the normal Playwright download failed; these are not application dependencies. Live website and API previews were started separately. No pull, merge, branch switch or production deployment was performed.
