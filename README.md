# Veyra

A production banking product front-to-back: marketing site, personal & business
dashboards, cards, transfers, invoicing, Scout AI savings, statements, a Super
Admin console, a 25-template transactional email system — on a real Express +
SQLite backend — built on one design system.

Every login, account, transaction and admin action is server-authoritative:
scrypt password hashing, revocable sessions, server-enforced RBAC, atomic
financial operations in integer cents, and an append-only audit trail enforced
by database triggers. There is no demo mode, no seeded data and no offline
fallback — signups start with a real, empty account.

> Veyra is a financial technology product, not a bank. Card issuing and payment
> rails still require a sponsor bank / processor integration.

## Stack

- **React 19 + TypeScript + Vite 7** (single-file production build via `vite-plugin-singlefile`)
- **Tailwind CSS 4** (preflight only) + hand-written semantic CSS design system
- **Motion** (animation), **Recharts** (charts), **lucide-react** (icons)
- **react-router-dom v7** (HashRouter)
- **Backend:** Express 5 + `node:sqlite` (`server/`) — scrypt auth, server-enforced
  RBAC, atomic financial ops, append-only audit trail (see **Backend** below)

## Getting started

```bash
npm install
cp .env.example .env    # set TOKEN_SECRET + ADMIN_EMAIL / ADMIN_PASSWORD
npm run server          # API → http://localhost:8787
npm run dev             # frontend → http://localhost:5173 (in a second terminal)
```

The frontend requires the backend (`/api` is proxied in dev). The first Super
Admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on boot; members create
accounts through the signup flow and start with a real, empty account ($0
balance, no cards, no history).


### Demo accounts (one-click sign-in)

Start `npm run server` — it seeds the demo accounts on boot — and the login page
shows a **Demo accounts** panel that signs you straight into each of the three
dashboards, no typing:

| Button | Account | What it opens |
|---|---|---|
| Personal | `demo.personal@veyra.dev` / `veyra-demo-2026` | Personal dashboard (goals, cash back, card) |
| Business | `demo.business@veyra.dev` / `veyra-demo-2026` | Business dashboard (treasury, invoices, team) |
| Super Admin | `admin@veyra.dev` / `veyra-admin-2026` | Admin console (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`) |

The **dev server seeds these accounts on boot**: `server/veyra.db` is gitignored
and disposable, so a fresh database would otherwise leave you with no way in. It
creates the two members through the public API (so every number the dashboards
show comes from the backend), gives each one history for its dashboard, and
falls back to the panel's admin credentials when `ADMIN_EMAIL`/`ADMIN_PASSWORD`
aren't set. Set `DEMO_SEED=0` to opt out. `npm run demo:seed` does the same
against a running API at any time — re-running is safe, an account with activity
is left alone, and it warns if the admin password no longer matches the panel.

If a stored session goes stale (expired token, or a browser that blocks web
storage), the app clears it and returns to the login page with a notice instead
of a dead-end error screen.

The panel is **dev-only**: it renders when `import.meta.env.DEV` is true (any
`npm run dev` session) or when a build is opened with `?demo=1`. Production
builds without that flag never ship the credentials. Before a real launch,
change `ADMIN_PASSWORD` and delete the `DEMO_ACCOUNTS` block in
`src/pages/Auth.tsx`.

## Super Admin control center

`/app/superadmin` — permission-gated modules (RBAC in `src/lib/permissions.ts`):

**Dashboard** (live platform KPIs + recent activity) · **Customers** (deposits/withdrawals
with before→after preview, KYC requests, restrict/restore) · **Accounts** (balances, cards,
status) · **Transactions** (platform-wide ledger with deposits / withdrawals / pending
filters) · **KYC** (request + review queue) · **Risk & Fraud** (disputes arbitration +
derived risk signals) · **Staff** (promote/revoke on the existing auth system) ·
**Roles & Permissions** (editable permission matrix) · **Reports** (CSV exports) ·
**Notifications** (member broadcasts) · **Audit Logs** (append-only, filterable) ·
**Banking Settings** (params + emergency halt, confirmed & logged) · **Admin Profile**.

Every mutating action checks permissions via `assertCan()`, writes an audit entry
(admin, action, target, before/after) and notifies the affected member. Account
restriction blocks the member's outgoing sends at the store layer.

## Three dashboards, three designs

Members and staff do different jobs with different urgency, so the three
authenticated surfaces are deliberately different applications rather than one
layout with swapped labels:

| | Personal | Business | Admin console |
|---|---|---|---|
| Navigation | Horizontal pill nav + phone-style bottom tabs | Dark icon rail + company header band | Near-black module rail + status bar |
| Canvas | Warm paper (`#fbf7f1`), 24px radii | Cool grey (`#eef0f4`), hairline rules, 8px radii | Near-black (`#0b0e14`), monospace data |
| Home | One oversized balance hero, quick-action tiles, goal rings, cash-back strip, activity feed | KPI strip (available/30d in/out/net + runway), receivables & payables tables, card programme, team & approvals, ledger | Module dashboard: totals, gateway health, live activity, audit feed |
| Numbers | Display face, large and friendly | Monospace, tabular, grid-aligned | Monospace, dense |

They share behaviour, not looks: the same account snapshot, the same money
moves, the same command palette and notification menu (see
`src/pages/dashboards/parts.tsx`). Route coverage, the account snapshot and the
member pages are identical across personal and business — only the chrome and
the home view change. The console keeps its own permission-gated modules and
runs outside the member shell entirely.

## Design system

Defined once in `src/index.css` (`:root` tokens) and reused everywhere:

| Token | Value | Use |
|---|---|---|
| `--display` | Manrope | Headings, numbers, logo wordmark |
| `--body` | DM Sans | Body copy, UI labels |
| `--paper` | `#f5f2eb` | Page background |
| `--violet` | `#7558dc` | Primary accent |
| `--ink` | `#18171d` | Text, primary buttons |

Shared component styles live in `src/styles/*.css` (`dashboard`, `admin`,
`statements`, `scout`, `flow`, `emails`). When adding features, reuse these
classes and tokens — don't introduce new fonts or one-off colors.

## Project structure

```
src/
  App.tsx               Routes (marketing / auth / app)
  Landing.tsx           Marketing home page
  lib/
    auth.tsx            Users, sessions, password digests (localStorage)
    store.tsx           Account state: money, cards, invoices, KYC, team…
    scoutEngine.ts      Scout AI insight generation
  pages/
    Dashboard.tsx       Member data layer + shared authenticated pages
    dashboards/
      PersonalDashboard.tsx  Personal chrome + "everyday money" overview
      BusinessDashboard.tsx  Business chrome + treasury overview
      AdminShell.tsx         Control-room chrome for the admin console
      parts.tsx              Shared behaviour: notification menu, sparkline, ring
    Marketing.tsx       Public marketing pages
    Auth.tsx            Sign in / sign up / forgot password / invite accept
    SuperAdmin.tsx      Admin console (users, ledger, KYC requests)
    StatementsPage.tsx  Official statements + PDF export
    SupportCenter.tsx   24/7 support desk
    EmailTemplates.tsx  In-app email template studio (#/email-templates)
  components/           Chrome, MoneyFlow, CommandPalette, modals, toasts…
  emails/
    design.ts           Email design system (tokens → inline-style HTML)
    templates.ts        24 transactional templates
  styles/               Shared CSS per area (personal.css, business.css, admin.css…)
emails/                 Exported standalone HTML (build:emails)
scripts/
  test-permissions.ts  RBAC mirror unit tests (14 checks)
  check-emails.mjs     Email template validation (25 checks)
  check-api-coverage.mjs  Route coverage: every server route has a caller (1 check)
  e2e-server.ts       Disposable real-API browser-test host + local price feed
  build-emails.ts      Email export
playwright.config.ts   Production-bundle Chromium integration gate
tests/e2e/             Browser flows for member / business / admin integration
tsconfig.playwright.json  Strict E2E harness typecheck
public/images/email/    Hosted logo PNG for emails (Gmail/Outlook-safe)
server/
  src/
    index.ts            Bootstrap: .env loader, production guards
    app.ts              createApp() — REST routes + middleware
    db.ts               SQLite (WAL, FK on): migrations, audit triggers, tx helper
    security.ts         scrypt hashing, HS256 tokens, rate limiter, TOKEN_SECRET
    recaptcha.ts        reCAPTCHA v3 / Enterprise verifier for the anonymous routes
    federated.ts        Firebase ID token verification + provider registry + account linking
    webauthn.ts         Passkeys: CBOR/COSE decode, origin binding, signature verification
    rbac.ts             Server-authoritative permission matrix (DB overrides)
    audit.ts            logAdminAction — the only write path to audit_log
    seed.ts             Production bootstrap: settings, role grants, env admin
    state.ts            buildMemberState — Account snapshot (integer cents → Account JSON)
  scripts/test-api.ts   HTTP integration suite (boots the real server)
  scripts/price-fixture.ts Offline market quotes/history for audit and browser tests
  scripts/audit-routes.ts  104 routes × 6 identities gate/isolation audit (+22 isolation/validation probes)
  tsconfig.json         NodeNext strict typecheck
```

## Stripe banking rails

Veyra uses **Stripe Connect + Treasury + Issuing** for its provider-backed account, ACH/wire, and card-issuing foundation. It is a fintech product experience, not a claim that Veyra itself is a bank. Stripe capability approval and its banking-partner requirements remain prerequisites to live money movement.

The backend has a server-only Stripe adapter, hosted onboarding, financial-account feature requests, signed/idempotent webhooks, provider-status reconciliation, and live Issuing card creation/freezing. Live cards retain only opaque provider IDs, expiry and last four digits — never PAN, CVV, PIN, external-bank credentials, webhook raw bodies, or Connect client secrets. Existing visual surfaces preserve their design and display onboarding/pending/active/restricted states in **Accounts → External accounts**.

Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and a canonical `APP_URL`; see `.env.example` and [the Stripe rail runbook](docs/stripe-rails-2026-10-06.md). In production, an unconfigured or incomplete provider connection fails closed instead of falling back to a simulated card or transfer rail.

```bash
npm run test:stripe-rails
```

## Email system

- `src/emails/design.ts` mirrors the app tokens as email-safe inline HTML
  (Manrope/DM Sans via web fonts + system fallbacks, hosted PNG logo).
- `src/emails/templates.ts` covers every notification the product generates:
  security, transfers, cards, invoicing, Scout and account lifecycle.
- Preview in-app at `#/email-templates` (desktop/mobile toggle, copy HTML) or
  open `email-showcase.html` for all 24 rendered in one page.

```bash
npm run build:emails   # export templates to emails/*.html
```

Before wiring a sending provider (SendGrid/Postmail/Mailgun), set `ASSET_BASE`
and `APP_BASE` in `src/emails/design.ts` to your real domains.

## KYC / identity verification flow

1. Admin requests verification: **SuperAdmin → Users → Request KYC** (choose
   documents + reason shown to the member).
2. The member sees a non-dismissible alert banner atop every dashboard page
   (who requested, why, which documents) with a **Verify identity** CTA.
3. The member completes a 3-step wizard (details → documents → review & submit)
   at `/app/kyc` (also reachable via ⌘K and Security Center). The submission
   (details + uploaded documents) is stored on the account.
4. The submission lands in **SuperAdmin → KYC Queue**: review the full
   submission, then **Approve** (limits unlock, member notified) or
   **Request changes** (member's banner shows the admin's note).
5. Status is visible to the admin in the user directory (`peekKycForUser`).

State lives in `KycRecord` (`src/lib/store.tsx`); `requestKycForUser()` writes
the request cross-account with an in-app notification.

## Backend

A real Express 5 + SQLite API lives in `server/` — the same permission matrix
as `src/lib/permissions.ts`, enforced server-side on every admin route.

```bash
npm run server            # http://localhost:8787 (seed runs automatically)
npm run test:api          # 434 runtime assertions (fresh DB, ephemeral port)
npm run check:routes      # fails if a server route has no caller in the app
npm run audit:routes      # gate/isolation audit of every route × every role
npm run typecheck:server  # strict NodeNext typecheck
```

### What it enforces

| Concern | Implementation |
|---|---|
| Passwords | scrypt (`s2$salt$hash`), never plaintext or reversible |
| Sessions | HS256 bearer tokens (12 h) with a `sessions` table — logout, per-device revocation, “sign out others” and admin revocation invalidate credentials immediately; a password change revokes the login's other sessions |
| Two-step sign-in | RFC 6238 authenticator secrets encrypted with AES-256-GCM; enrollment is password-and-code-confirmed and issues ten one-time recovery codes (SHA-256 hashes stored). Codes work once at sign-in or to disable MFA; regeneration requires the password and current authenticator code. Login challenges expire after five minutes. Applies to password sign-ins; passkeys and federated sign-in carry their own second factor |
| Device identity | Persistent `X-Veyra-Device` id groups browser sessions and alerts; it is metadata only, never an authentication or MFA bypass |
| Login abuse | In-memory limits: failed-credential budget per account and per IP, authenticator challenge attempts (5 per challenge, rate-limited per account), password-reset requests |
| Bot defence | reCAPTCHA v3 / Enterprise on sign in, sign up and password recovery — action-bound, score-thresholded, off until configured (see **reCAPTCHA** below) |
| Federated sign-in | Google, Apple and Microsoft. Firebase ID tokens verified against Google's JWKS (RS256, alg pinned, full claim set); the provider is read from the signed token, never the request. Links to existing members only — never auto-provisions, and excludes staff by default |
| RBAC | 17 permissions × 5 roles, resolved **fresh from the DB on every request** (role changes take effect immediately, no re-login) |
| Money | Integer cents everywhere; every mutation inside `BEGIN IMMEDIATE` |
| Audit trail | `audit_log` is append-only **by database trigger** — `UPDATE`/`DELETE` raise `ABORT` |
| Financial limits | $250 k transfer cap, $100 k deposit cap, $10 M admin adjustment cap |
| Account states | `restricted` members can deposit but not transfer; `payment_rails: halted` blocks all transfers with 503 |
| Overdrafts | Rejected — balances can never go negative |
| Card controls | Freeze, per-transaction and monthly limits, merchant/category locks and the online-payments switch are enforced server-side when a card spends |
| Export scoping | The ledger export opens with `reports.view` or `transactions.export`; the directory, balances and KYC exports stay behind `reports.view` |
| Secrets | `TOKEN_SECRET` env required in production (refuses to boot on the dev fallback); keep it stable because it also keys encrypted authenticator secrets |
| Password reset | Single-use SHA-256-hashed tokens, 30-minute expiry, reset revokes all sessions |
| Bootstrap | First Super Admin created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` — no seeded accounts in production |

### Route coverage

`npm run check:routes` diffs the routes declared in `server/src/app.ts` against
every call site in the app (`src/lib/*`, `src/pages/*`, `src/components/*`,
including lookup tables and `fetch` downloads) and fails on either kind of
drift: a server route nobody calls, or a client call with no route behind it.
Reads that already ship inside the `GET /api/me/state` / `GET /api/admin/state`
snapshots are the only allowlisted exceptions, spelled out in the script.

### Route security audit

`npm run audit:routes` boots the real server on a throwaway database and probes
**every route with six identities** — no token, a member, and each staff role —
then checks the responses against an **independent baseline policy** written in
the script:

- a route the baseline marks private must answer 401 without a token
- a route requiring permission `P` must answer 403 for every role whose live
  grant list (from `GET /api/admin/roles`) lacks `P`, and must not answer 403
  for a role that has it
- member surface must not answer 403 to a member
- a route missing from the baseline fails the audit, so new surface must be
  classified deliberately

Because the expectations live outside the code under test, the audit catches a
gate that was *deleted* or a permission typo — the failure modes that a
same-source check (and most unit tests) cannot see. It also verifies
cross-member isolation: another member's card, invoice, pocket, payee,
scheduled payment and session ids must all answer 404/403, and their state must
be untouched afterwards.

Every member mutation is optimistic in the UI and replayed against the API, then
reconciled with the refreshed snapshot: the server is authoritative, so a
rejected action (insufficient funds, halted rails, restricted account) rolls the
optimistic state back and surfaces the server's error. A mutation that could not
be *sent* is surfaced too: with no session token, or with the API known to be
unreachable, the action is refused and the member is told it was not saved —
there is no offline replay queue, so it would be lost on refresh. (An unresolved
health probe is not treated as offline; the request itself is the better probe,
and its failure travels the normal error path.) Requests are serialised through
one queue so the optimistic state and the server can't interleave, and the
path/body of a queued call is resolved when it runs rather than when it is
created.

Records created client-side get a local id until the create response returns
the server's id (`adoptId`/`resolveId` in `src/lib/store.tsx`), so a follow-up
action taken in the same breath — pay this invoice, move money out of this
pocket, dispute the payment you just scheduled — still hits the row the server
actually stored. Deposits, transfers and scheduled payments adopt the ledger
row's id from the response for the same reason.

Console CSV exports are generated server-side from the database (full ledger,
not the console's window) via `GET /api/admin/reports/:kind.csv` and
`GET /api/admin/audit/export.csv`, downloaded with the session token. The
accounts and KYC files carry the columns the console shows — the accounts file
includes cards, frozen cards, transaction and pending-transaction counts, KYC
standing, status and last activity, and the KYC file adds the review queue's
submission columns (submitted date, legal name, document, file count, source of
funds) to the status columns.

### API surface (summary)

- **Auth** — `POST /api/auth/login · login/verify · register · federated · logout`, `GET /api/auth/me · /api/auth/config` (public reCAPTCHA + federated settings), `POST /api/auth/passkey/challenge · passkey/login`, `GET /api/health`
- **Member** — `GET /api/me/state` (full account snapshot) `· account · kyc · notifications`, `POST /api/me/deposits · transfers · kyc/submit · disputes · reset`, plus
  cards (issue/patch/freeze-all/replace/shipping), invoices (create/paid/remind), team,
  savings pockets (create/move/delete), payees, scheduled payments (create/toggle/pay),
  rewards redemption, Scout savings, perks, preferences, profile, sessions, notifications,
  digital asset holdings (`GET /api/me/holdings`, `POST /api/me/holdings/trade`,
  `GET /api/me/holdings/:asset/candles`, `GET /api/me/markets`),
  authenticator setup/confirm/disable, one-time recovery codes (enrollment, password+TOTP regeneration, sign-in and recovery-based disable), live session trust and revocation
- **Admin** — `GET /api/admin/state` (console aggregate: users, accounts, ledger, disputes,
  KYC queue, audit, role matrix, settings) `· overview · members · staff · roles · audit`,
  member detail/adjust/status, KYC request/queue/decision, risk dispute queue + advance,
  role matrix get/put/reset, broadcasts, CSV reports (customers/accounts/transactions/kyc/audit),
  settings (incl. emergency halt)

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TOKEN_SECRET` | dev fallback | HMAC key for bearer tokens — **required in production** |
| `ADMIN_EMAIL` | — | First Super Admin email (created on boot) |
| `ADMIN_PASSWORD` | — | First Super Admin password (min 8 chars) |
| `ADMIN_NAME` | `System Admin` | Optional display name |
| `PORT` | `8787` | API port |
| `DB_PATH` | `server/veyra.db` | SQLite file (git-ignored) |
| `CORS_ORIGIN` | `*` | Allow a specific browser origin |
| `RECAPTCHA_*` | off | Bot defence on the anonymous auth routes — see below |

Variables can live in a `.env` file (loaded automatically — see `.env.example`).

### reCAPTCHA

Sign in, sign up and password recovery are the only routes a script can reach
without a session, and each one costs real work (scrypt, five inserts, a token
mint). The in-memory budgets in `security.ts` throttle one address; reCAPTCHA
is what answers a distributed run from many.

**It is off until configured** — no site key means every check is a
pass-through, so development, CI and the 347-assertion suite run without a Google
round-trip. Pick one provider:

| Provider | Variables | Endpoint |
|---|---|---|
| Classic v3 | `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` | `siteverify` |
| Enterprise | `RECAPTCHA_SITE_KEY` + `RECAPTCHA_PROJECT_ID` + `RECAPTCHA_API_KEY` | `createAssessment` |

Enterprise is what Firebase App Check sits on, so starting there doesn't have
to be redone if App Check is adopted later. Tuning:

| Variable | Default | Purpose |
|---|---|---|
| `RECAPTCHA_MIN_SCORE` | `0.5` | Reject below this (1.0 = human, 0.0 = bot) |
| `RECAPTCHA_FAIL_CLOSED` | unset | `1` rejects requests when the verifier is unreachable |
| `RECAPTCHA_HOSTNAMES` | any | Comma-separated hostname allowlist |
| `RECAPTCHA_TIMEOUT_MS` | `4000` | Verification timeout |
| `RECAPTCHA_VERIFY_URL` | provider default | Override (tests, egress proxy) |

**Two kinds of failure, treated differently.** A *decision* (score below the
threshold, wrong action, expired or replayed token, missing token) is always
enforced — that is the feature. An *infrastructure* failure (Google
unreachable, timeout, 5xx, a rejected secret) is governed by
`RECAPTCHA_FAIL_CLOSED`, and **fails open by default**: an outage at Google, or
one bad env var, would otherwise lock every customer out of their money, which
is a worse incident than the bots it stops. Both are logged (throttled to once
a minute per cause) so an outage is visible rather than silent.

Replay is Google's job — tokens are single-use and expire after ~2 minutes, so
there is no local nonce cache. Tokens are bound to an action
(`login` / `register` / `forgot_password`), so one minted on a cheap public
form cannot be replayed against sign-in.

The browser reads `GET /api/auth/config` for the site key and whether the gate
is live, rather than a build-time `VITE_` variable: enabling reCAPTCHA needs no
frontend rebuild, and a cached bundle can never disagree with the server about
whether tokens are required. If the script is blocked (ad blocker, strict
extension, corporate proxy) the client sends no token and the **server**
decides — `src/lib/recaptcha.ts` never pre-emptively blocks the member.

### Passkeys (WebAuthn)

The only sign-in method here with no third party in the trust path, and the
strongest one Veyra offers. The authenticator generates a key pair, keeps the
private half, and signs a server-issued challenge with it. There is no shared
secret — a full dump of the `passkeys` table lets an attacker *verify*
signatures, not produce them.

**Why it resists phishing**, which no password or OTP does: the browser will
only release a credential to the origin that created it, and the origin it was
asked by is inside what gets signed. A lookalike domain therefore cannot
collect anything usable — it cannot even ask the right question. The member
does not have to notice the URL is wrong, which is the whole problem with
every credential that can be typed.

**Verified server-side** in `webauthn.ts`, with `node:crypto` and no
dependency: the challenge (server-issued, single-use, 5-minute TTL), the
origin against an allowlist, the RP ID hash, the user-presence and
user-verification flags, and the ECDSA/RSA/EdDSA signature over
`authenticatorData || sha256(clientDataJSON)`. Attestation is deliberately not
verified — we ask for `attestation: "none"` and ignore `attStmt`, because
attestation answers "which authenticator model is this?", and Veyra wants
members using the device already in their hand.

| Rule | Behaviour |
|---|---|
| User verification | **Required**, at registration and at sign-in. A passkey is then two factors in one gesture: the device, plus the biometric or PIN that unlocked it. |
| Registration | Needs a live session. A passkey is added to an account and **never opens one** — same rule as the federated providers. |
| Challenge ownership | The challenge carries the user id it was issued to; a registration redeemed on a different session is refused (403). |
| Credential reuse | Credential ID is the primary key, so one credential unlocks exactly one Veyra account. |
| Sign-in | Discoverable (resident) credentials, no email asked for, `allowCredentials` empty — so neither route can answer "does this account exist?" |
| Signature counter | Checked, but advisory. Synced passkeys report 0 forever, so a regression notifies the member rather than locking them out. |
| Removal | Scoped to `(id, user_id)`; another member's credential reads as 404. |

Configure `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` for your domain — the
defaults are localhost dev values and **passkeys will not work in production
until you set them**. The RP ID is a bare domain (no scheme, no port) and must
equal the site's domain or a parent of it.

> A passkey is bound to `rpId`. Changing it invalidates every passkey already
> registered, so pick the broadest domain you will ever serve from (`veyra.com`
> rather than `app.veyra.com`) before members start enrolling.

### Federated sign-in (Google, Apple, Microsoft — via Firebase)

Firebase is an identity **provider** here, never the authority. The browser
runs the provider's flow and receives a Firebase ID token; `POST /api/auth/federated`
verifies it, maps it onto an **existing** member, and mints Veyra's own session.
Everything downstream is untouched — the `sessions` table still revokes
instantly, RBAC is still read fresh from the database on every request, and the
audit trail still records what staff did. Only the credential check moves.

**Which providers.** `FEDERATED_PROVIDERS` is a comma list of `google`,
`apple`, `microsoft` and defaults to `google` alone. Every extra provider is
another door into an account, so each one is opened deliberately — and must
also be enabled in the Firebase console. One token shape serves all three:
Firebase has already completed the provider handshake, so the only difference
reaching Veyra is the `firebase.sign_in_provider` claim. **That claim is read
from the signed token, never from the request body** — otherwise a caller
could present a Google token while naming Apple and claim the wrong identity
row. A `sign_in_provider` this build doesn't know, or one not in
`FEDERATED_PROVIDERS`, is refused with 403.

Off unless `FIREBASE_PROJECT_ID` is set. All of `FIREBASE_PROJECT_ID`,
`FIREBASE_API_KEY` and `FIREBASE_AUTH_DOMAIN` are public values (the Firebase
web config ships in the page) — **no service-account key is required**, because
ID tokens are verified against Google's published JWKS with `node:crypto`
rather than `firebase-admin`.

**Verification.** A Firebase ID token is an RS256 JWT. Every claim Google
documents is checked: `alg` (pinned to RS256, so `alg: none` and HS256
confusion both die before a key is consulted), `kid` against the cached JWKS,
the signature, `exp`, `iat`, `auth_time`, `aud`, `iss` and `sub`. Keys are
cached for 6 h, refetched on an unknown `kid`, and that refetch is throttled so
a bad `kid` can't be used to hammer Google.

**Linking policy** — the part that matters:

| Rule | Behaviour |
|---|---|
| Unverified email | Refused (403). An unverified address must never claim an account. |
| Known `(provider, subject)` | Signs in as the linked member. Matching is by subject — stable — not email. |
| Unknown subject, verified email matches a member | Links once, and the member is notified. |
| Unknown subject, no matching member | **Refused (404). Never auto-provisions.** |
| Member already has a different account with that provider | Refused (409) — one identity per member per provider. A member may hold Google *and* Apple *and* Microsoft at once. |
| Apple "Hide My Email" relay address | Refused (409) with its own message. A `@privaterelay.appleid.com` address can never match a member, so a bare "no account" would send the member hunting for a problem that isn't there; the error tells them to use "Share My Email" instead. |
| Staff / Super Admin | Refused (403) unless `FEDERATED_ALLOW_STAFF=1`. |

No auto-provisioning is deliberate: opening a bank account requires the full
application (legal identity, tax ID, address, government ID — see
`identity.ts`). Clicking "Continue with Apple" cannot conjure one. The sign-up
screen says so rather than offering a button that can't work.

Staff exclusion is also deliberate: the console can move $10M per adjustment,
so letting a third-party IdP unlock it widens the blast radius to whoever holds
that provider account. Flip it on only if your operators are on managed Workspace
identities.

**Client cost.** `firebase` is loaded through a dynamic `import()`, so it stays
out of the initial parse. Note that `vite-plugin-singlefile` inlines dynamic
chunks, so in the production build it is paid upfront regardless: **+47 kB
gzipped** (736 → 783 kB). If that matters more than the convenience, swap the
import in `src/lib/federated.ts` for the gstatic ESM CDN build and it drops to
zero for deployments that never enable it.

> The v3 badge is left visible, which is how Google's terms are satisfied by
> default. To hide it you must instead display the attribution text ("This site
> is protected by reCAPTCHA and the Google
> [Privacy Policy](https://policies.google.com/privacy) and
> [Terms of Service](https://policies.google.com/terms) apply.") — add it to
> `AuthShell` in `src/pages/Auth.tsx` alongside `.grecaptcha-badge { visibility: hidden; }`.

The database schema is created by versioned migrations in `server/src/db.ts`
(v1: `users`, `accounts`, `transactions`, `cards`, `kyc_records`, `disputes`,
`notifications`, `audit_log`, `sessions`, `role_permissions`, `settings`;
v2 adds `invoices`, `team_members`, `savings_pockets`, `payees`,
`scheduled_payments`, `perks`, `security_sessions`, `preferences` and the full
card model, so every member feature is server-backed; v9 adds authenticator-backed MFA and revocable device sessions, and v10 adds hashed one-time recovery codes). `server/src/state.ts`
builds each member's Account snapshot straight from these tables.

## Digital assets (crypto)

The **Crypto** workspace (`/app/assets`) separates Veyra's built-in account
holdings from a connected external wallet. Approved account owners can review
and confirm internal **buy, sell and swap** orders. **Send** reserves holdings
as a cancellable pending request; it does not broadcast a blockchain transaction.
The existing asset catalog and **Markets** (`/app/markets`) remain available.

Ethereum browser wallets (EIP-6963/EIP-1193), Phantom Solana and UniSat Bitcoin
can share public addresses. Wallet balances and receiving QR codes belong to
those external wallets, not the Veyra account ledger. Connections do not sign
transactions or prove ownership for Veyra authentication. No private keys or
recovery phrases are requested. Unsupported/unavailable balances stay unknown.

**Custody, external execution, bridging and cash on/off-ramps are not connected.**
An internal order receipt is not proof that coins exist in custody or that an
external market executed a trade. Existing account balances and reservations
must not be treated as backed assets or automatically submitted to a future
custody provider. Digital assets are not FDIC insured and can lose value.

`CRYPTO_TRADING_ENABLED` remains on by default in development and off by default
in production. Enabling it only enables the internal ledger functionality.
Any future live offering needs identified providers, independently verified
asset backing, reconciliation, security and operational controls, and qualified
legal review for the operator, services and jurisdictions involved. No license,
bank status, insurance arrangement or exemption is established by this code.

See [the hybrid crypto implementation and integration guide](docs/crypto-workspace-2026-10-06.md)
for API contracts, owner/team boundaries, exact arithmetic, lost-response
recovery, wallet coverage, optional `SOLANA_RPC_URL`, migration 22 and required
provider work. The legacy `/api/me/holdings/trade` API remains for compatibility;
the UI uses `/api/me/crypto/quote` and `/api/me/crypto/confirm` instead.

### Why holdings are a parallel structure

An internal USD account record, a crypto quantity and a balance read from an
external wallet measure different things. A quantity's estimated value changes
with its market quote; none of these displays alone establishes a backed bank
deposit or custody inventory. They remain separate in the schema, API and UI.
Holdings never roll into "Total across Veyra", and connected-wallet balances
never roll into the Veyra account holdings total.

### Base units are TEXT, not INTEGER

`holdings.units` stores an integer count of the asset's smallest unit as a
**string**, and arithmetic happens in JS with `bigint`. This is forced, not
stylistic: SQLite INTEGER is 64-bit and 1 ETH is 10¹⁸ wei, so an INTEGER column
**overflows above approximately 9.22 ETH**. The consequence is that SQL cannot `SUM()` these
columns — aggregate in the application. Non-negativity is enforced with
`CHECK (units NOT LIKE '-%')` plus app-layer checks.

Buys are denominated in dollars and sells in units of the asset. That matches
how people think about each direction, and it lets a member sell a position to
exactly zero instead of leaving rounding dust behind.

### The price feed fails soft

`server/src/prices.ts` fetches CoinGecko on demand with a 300s cache and a
4s timeout. Three rules, because a price feed is the least trustworthy part of
the system:

1. **A missing price is `null`, never `0`.** A zero is a number, and a number
   gets multiplied by a balance to produce a confident, wrong valuation. The UI
   renders "Price unavailable" and flags the total as incomplete.
2. **A stale price is labelled**, with the time it was fetched.
3. **Trading refuses stale or missing quotes.** Reviewed account quotes also
   expire within 60 seconds, bounded by the source price freshness window.
   A displayed historical value does not authorize a new order.

A feed that answers but carries nothing usable counts as a failure: the last
good quotes survive rather than being replaced by nothing.

#### Authenticated CoinGecko market data

Provision `COINGECKO_API_KEY` in the **API server's environment secrets**, not
in the browser or a `VITE_` variable. For local development, the API loads the
Git-ignored root `.env`; never commit real keys or paste them into chat. Rotate
any key already shared in a message or URL.

- Set `COINGECKO_API_PLAN=demo` for the free API key, or `pro` for a paid key.
- Leave `CRYPTO_PRICES_URL` and `CRYPTO_OHLC_URL` blank for CoinGecko. The server
  chooses the matching HTTPS origin for **both** markets and candlestick history,
  and sends the key in `x-cg-demo-api-key` or `x-cg-pro-api-key` headers.
- Keep `PREVIEW_CRYPTO_DATA=0` when using actual market data; restart the API
  after configuring the secrets. Merely configuring a key is not evidence of a
  successful feed connection. Open Markets and check its fetched timestamp.
- The key never goes into a request URL or client bundle. Custom URL overrides
  receive no CoinGecko credentials; authenticated redirects are not followed.
  Startup diagnostics show the host and authentication mode, never the key.
- No key preserves unauthenticated requests, subject to provider availability.
  Authentication, quota and network failures preserve last-known timestamps;
  missing/stale prices cannot authorize new trades. Provider response bodies and
  raw transport errors are not logged.

This is periodically refreshed market data, **not a streaming exchange feed**.
The existing 5-minute market cache is unchanged; chart calls also consume quota.
Check the provider's current plan allowance before reducing the cache interval.
Data access does not connect bank rails, custody, or external trade execution.
Run `npm run test:market-feed` for isolated authentication and failure-path tests.

Run `npm run check:market-feed` **on the API host** to verify the actual feed.
It loads local `.env` if present (host environment values take precedence), makes
one markets request and one Bitcoin chart request, validates their data, and
exits nonzero if either fails. It never touches balances or uses generated data.
It reports only safe status/error codes, not keys, URLs or provider error bodies.
This consumes two provider requests; do not use it as a frequent health poll.

- `ECONNRESET` before an HTTP response means the connection was reset; it is not
  evidence that the API key is invalid. Check outbound HTTPS access to
  `api.coingecko.com:443` (or `pro-api.coingecko.com:443` for a Pro plan) with the
  hosting provider. An app cannot fix an upstream network policy.
- HTTP `401`/`403`: check the key, matching plan/origin and provider access rules.
- HTTP `429`: check rate limits and quota; do not solve this with rapid retries.
- Certificate errors: configure the host's trusted CA chain; never disable TLS
  verification or expose the key through browser-side requests.

Startup says **key configured, connection not verified** until an actual request
is checked; it does not imply that the provider has accepted the credential.
Runtime secrets must be provisioned separately on every host or replacement
sandbox. A Git-ignored `.env` is not deployed by a Git push, and sandbox resets
may remove it. The real-market check is intentionally separate from offline tests.


Tests never touch the network — they point `CRYPTO_PRICES_URL` and
`CRYPTO_OHLC_URL` at a local stub, so the real fetch, cache, timeout and
staleness logic all still run. For local work without egress,
`node scripts/dev-prices.mjs` serves both shapes with prices that drift and
deterministic candles.

### The markets page

`/app/markets` lists every coin the feed quotes — price, 1H/24H/7D change,
market cap, 24h volume, a 7-day sparkline and the member's own position —
sortable on any numeric column, searchable, and with the candlestick chart
expanding inline under a row rather than on a separate screen.

The modelling follows a custodian like BitGo rather than an exchange: a
*curated* list that sits inside custody, not an infinite listing. So the table
draws a hard line between **quoted** and **tradeable**. Every row shows a
price; only assets in the local `crypto_assets` registry carry `tradeable:
true`. A coin appearing on CoinGecko is not consent to custody it — decimals,
and therefore every unit conversion the ledger depends on, exist only for the
assets we seeded. Untradeable rows render as reference data with no Buy
control and no candle history.

This also means the markets page costs **no extra upstream calls**. The spot
feed moved from `/simple/price` to `/coins/markets`, which returns price,
changes, cap, volume and a sparkline for up to 100 coins in one request — the
same call that values the holdings now populates the whole table. Sparklines
are downsampled from 168 hourly points to 32 before they leave the server, so
100 rows cost ~3,200 numbers instead of 16,800.

Rows the feed cannot price are **dropped, not zeroed**, and a dead feed yields
an empty table rather than a page of $0.00 coins.

### Price history and the API quota

Each asset row opens a candlestick chart over 24H / 7D / 30D / 90D, drawn by
hand in SVG (`src/components/CandleChart.tsx`) — recharts is a dependency but
has no candlestick primitive, and a custom Bar shape fighting the library's
scales for wick placement is more code than the SVG. OHLC comes from
`/coins/{id}/ohlc` via `GET /api/me/holdings/:asset/candles?range=`, cached per
(asset, range) with a TTL matched to candle width (5min / 30min / 1h / 6h) and
fetched only when a chart is actually opened.

**Watch the quota.** CoinGecko's free Demo tier allows 10,000 calls/month:

| Spot TTL | Calls/day | Calls/month | Against a 10,000 cap |
|---|---|---|---|
| 60s | 1,440 | 43,200 | exhausted in ~7 days |
| 300s *(default)* | 288 | 8,640 | 86% — little room for charts |
| 600s | 144 | 4,320 | 43% |

At the 300s default, spot alone uses 86% of the free allowance — unchanged by
the markets page, which rides the same call — so **a production deployment
serving real traffic needs the paid Basic plan**
(~$35/month, 100k credits). Development and demo use fit comfortably in the
free tier.

A missing series is a **503 with `crypto_no_history`**, never an empty array.
An empty series draws a flat line, and a flat line claims the asset did not
move — which is a different statement from "we have no data".

### Exact money arithmetic

`server/src/money.ts` replaced `Math.round(value * 100)` in `dollarsToCents`.
That expression disagrees with correct half-up rounding on **1,147 of 200,000**
three-decimal amounts (**0.57%**), always a cent **low**, because those values
land just under the midpoint once a binary float gets hold of them:

```
Math.round(1.005 * 100) === 100   // should be 101
Math.round(0.145 * 100) ===  14   // should be  15
Math.round(2.135 * 100) === 213   // should be 214
```

The replacement parses the decimal string digit by digit into a `bigint` and
never enters float math. It is exact on all 200,000 values, and **identical to
the old behaviour on every two-decimal amount** — the rejection contract
(objects, arrays, booleans, `"12abc"`, empty strings) is unchanged.

## Transactional email & support

**Email delivery** (`server/src/mail.ts`) sends real messages through an HTTP
email API — Resend, Postmark or SendGrid — with no SDK dependency. It is off
until configured:

| Variable | Purpose |
|---|---|
| `MAIL_PROVIDER` | `resend`, `postmark`, `sendgrid`, or `log` (print to console) |
| `MAIL_API_KEY` | Provider API key / server token |
| `MAIL_FROM` | Verified sender, e.g. `Veyra <no-reply@yourdomain.com>` |
| `APP_URL` | Public app origin used for links in emails |
| `SUPPORT_INBOX` | Optional team inbox alerted about each new support request |

Emails sent: password reset (with a one-click link that opens the reset screen
with the code filled in), application received, application approved / more
information needed / declined, support-request confirmation, and support
replies. Sending never blocks or fails the API call that triggered it. Without
a provider, development still shows the reset code on screen; production never
returns it.

**Customer support** is real end to end. Members open and reply to cases from
**Support Desk** (`/app/support-desk`); visitors use the public **Support** and
**Contact** forms (rate-limited, with a honeypot field). Every request becomes a
`support` case in the Super Admin **Operations** queue with its own reference
(`VS-XXXXXXXX`). Staff reply from the case panel — the customer sees the reply in
the app, gets a notification and an email, and replying again reopens the case.
Internal notes stay internal.

## Whole-app verification

Use Node **22 or newer** (the server uses `node:sqlite`). Install the browser once,
then run the combined gate:

```sh
npm ci
npx playwright install --with-deps chromium
npm run verify              # tests + frontend/server/E2E typechecks + build + browser integration
```

`npm run test:e2e` runs the browser gate independently. It exercises the **built**
app served by the real Express API, not a Vite mock or a client-only demo. Its
SQLite database and accounts are disposable; quotes/history come from a local
fixture. External sign-in providers and reCAPTCHA are disabled only in this
fixture; provider verification and security controls have separate API tests.
Browser WebAuthn ceremonies use a virtual authenticator.

The browser suite covers both member designs, shared Markets/Holdings/Passkeys
and money plans, signup → admin approval → dashboard, cash/crypto reconciliation,
plan/invoice persistence, member and staff passkey sign-in, CSV/PDF exports,
admin navigation, expired sessions, blocked storage, and unavailable market
history. Navigation is checked at desktop, tablet, and phone widths.

The test server defaults to port `8877` (`E2E_PORT` overrides it). Failure traces
and screenshots go to `/tmp/veyra-e2e-results` (`E2E_ARTIFACT_DIR` overrides it).
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium executable.
The standard Playwright install above is recommended outside restricted sandboxes.

See [the integration verification report](docs/integration-verification-2026-10-05.md)
for tested scope, fixes, and the remaining **real-money production** requirements.
Passing this gate is application-integration evidence, not bank, payment-rail,
identity-provider, or blockchain-custody certification.

## Scripts

```bash
npm run dev            # frontend dev server
npm run server         # Express + SQLite API (port 8787)
npm run build          # production build → dist/index.html (single file)
npm run build:emails   # export email templates → emails/*.html
npm run typecheck:server  # strict typecheck of server/
npm test               # permissions (14) + emails (25) + route coverage (1) + route audit (1) + API integration (434 runtime assertions); the audit exercises 624 HTTP security probes (+22 isolation/validation probes)
node scripts/dev-prices.mjs  # offline crypto price feed (see Digital assets)
```

> **Production notes:** the frontend is API-only (no offline mode). Email
> delivery is built in (`server/src/mail.ts`) but off until you set
> `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM` and `APP_URL` — see
> [Transactional email & support](#transactional-email--support). Card issuing
> and payment rails are internal-ledger operations until a sponsor bank /
> processor is integrated.

### Development login shortcuts

The development login page displays verified built-in Personal, Business and
Super Admin fixture credentials under **Quick access**. **Use account** fills
the normal form; **Sign in** still performs ordinary password authentication,
including any enrolled MFA. No authentication or role checks are bypassed.

`npm run server` defaults `PREVIEW_LOGIN_SHORTCUTS=1` outside production. Set it
to `0` to hide the panel. The API always returns no shortcuts in production,
even if the flag is set. Only existing, active fixture accounts whose stored
password hashes still match the fixed development passwords are advertised.
Changed passwords, roles or account types hide that entry; configured operator
passwords and other users' credentials are never exposed. Configuration is
served with `Cache-Control: no-store`, and failed config loads hide the panel.

Checks: `npm run test:preview-access` and `npm run test:e2e:preview-access`.

### Crypto testing preview

Run `npm run dev:preview` for the website and API with **sample—not live—crypto
prices**. To restart only its API, use `PORT=8787 npm run server:preview`.
The ordinary `npm run server` command does **not** enable sample prices.

This mode uses the isolated, gitignored `server/preview-crypto.db`. Both Personal
and Business quick-access accounts start with 0.01 BTC, 0.25 ETH, 5 SOL, 500 USDC
and 250 USDT (a $3,000 sample valuation). There are 24 priced markets with
synthetic statistics, sparklines and candle history in the API fixture only.
The customer UI now suppresses generated valuations, markets and charts and
shows unavailable prices instead. Quantities remain visible and pending
withdrawal requests still work. Use ordinary `npm run server` with the configured
market feed for customer-facing buy/sell/swap; browser regression suites use a
separate offline upstream fixture. Connected wallet balances are never fabricated.

Startup records one idempotent $3,000 test funding credit per fixture owner and
uses real internal buy orders to establish the portfolio. Persisted quote IDs
make retries/restarts safe; later trades and cancellations are not reset.
Seeding is restricted to the known, password-verified fixture owners. Fresh
signups do not receive this portfolio automatically. This is not external money,
custody, a price feed for real trading, or blockchain execution.

Production refuses this flag and the preview database. Do not copy preview data
into production. Tests: `npm run test:preview-crypto` and
`npm run test:e2e:preview-crypto` (with Playwright Chromium installed).


### Crypto activity and funding refinement (6 October 2026)

- Distinct Buy/Sell/Swap presentations share Send's processing components, with
  real response gating, reduced-motion support and idempotent order recovery.
- Crypto inbox/email builders cover six activities × five statuses. Current
  trades and withdrawal reservations/failures/cancellations emit owner-scoped,
  deduplicated notifications. Email needs `MAIL_PROVIDER`, `MAIL_API_KEY`,
  `MAIL_FROM` and a public `APP_URL`; unsupported external events are not invented.
- All 24 catalog assets have unique self-hosted marks and a shared icon registry.
- Funding reads owner-scoped verified `external_accounts`. New bank linking is
  provider-gated. At `/app/external-accounts`, owners can instead save an account
  reference for staff review. Approval enables internal account entries only,
  not a live bank connection or ACH authorization. No bank passwords or full
  external account numbers are collected.
- Direct Deposit reads admin-configured details for that owner, not startup
  defaults. Individual and bulk bank-detail edits mark the receiving information
  configured. Existing audited edits are backfilled by migration 23.
- Recent deposits are shown on the Personal and Business dashboards only.

Verification and integration boundaries: `docs/crypto-funding-polish-2026-10-06.md`.


### External account-reference review

The external-account page now offers a complete internal-reference workflow:
**Accounts → External accounts → Submit account for review**. Only the bank name,
display name, Checking/Savings type and final four digits are accepted. The
request stays pending and cannot fund an account until reviewed. Network retries
reuse a request identifier; matching repeats cannot create duplicate records.

Authorized staff open **Members → Funding → External account references**, record
an independent ownership-review note, and approve or decline. Approval appears
as **Staff-approved reference**, never as a provider-verified bank link. The owner
can refresh the page and select **Continue to Add funds**. Reference submission
and approval do not credit/debit money.

Migration 24 distinguishes `verification_kind='staff_reference'` from provider
records. Any future live ACH adapter MUST require an actual provider connection
and payment authorization, not merely a locally approved reference. The legacy
`provider_reference` column contains a non-secret staff attestation identifier
for staff-reviewed records; it is not a provider access token.

43 crypto/funding checks and a browser owner-submit → staff-review → funding
scenario cover ownership isolation, self-approval rejection, credential-field
rejection, pending/declined gating and lost-response retries.
