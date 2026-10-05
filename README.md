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
  build-emails.ts      Email export
public/images/email/    Hosted logo PNG for emails (Gmail/Outlook-safe)
server/
  src/
    index.ts            Bootstrap: .env loader, production guards
    app.ts              createApp() — REST routes + middleware
    db.ts               SQLite (WAL, FK on): migrations, audit triggers, tx helper
    security.ts         scrypt hashing, HS256 tokens, rate limiter, TOKEN_SECRET
    recaptcha.ts        reCAPTCHA v3 / Enterprise verifier for the anonymous routes
    federated.ts        Firebase ID token verification + Google account linking
    rbac.ts             Server-authoritative permission matrix (DB overrides)
    audit.ts            logAdminAction — the only write path to audit_log
    seed.ts             Production bootstrap: settings, role grants, env admin
    state.ts            buildMemberState — Account snapshot (integer cents → Account JSON)
  scripts/test-api.ts   235-check integration suite (boots the real server)
  scripts/audit-routes.ts  80 routes × 6 identities gate/isolation audit
  tsconfig.json         NodeNext strict typecheck
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
npm run test:api          # 235-check integration suite (fresh DB, ephemeral port)
npm run check:routes      # fails if a server route has no caller in the app
npm run audit:routes      # gate/isolation audit of every route × every role
npm run typecheck:server  # strict NodeNext typecheck
```

### What it enforces

| Concern | Implementation |
|---|---|
| Passwords | scrypt (`s2$salt$hash`), never plaintext or reversible |
| Sessions | HS256 bearer tokens (12 h) with a `sessions` table — logout and admin revocation kill them instantly |
| Login abuse | In-memory rate limit: 8 attempts / 60 s per IP (login and password-reset requests) |
| Bot defence | reCAPTCHA v3 / Enterprise on sign in, sign up and password recovery — action-bound, score-thresholded, off until configured (see **reCAPTCHA** below) |
| Federated sign-in | Firebase ID tokens verified against Google's JWKS (RS256, alg pinned, full claim set). Links to existing members only — never auto-provisions, and excludes staff by default |
| RBAC | 17 permissions × 5 roles, resolved **fresh from the DB on every request** (role changes take effect immediately, no re-login) |
| Money | Integer cents everywhere; every mutation inside `BEGIN IMMEDIATE` |
| Audit trail | `audit_log` is append-only **by database trigger** — `UPDATE`/`DELETE` raise `ABORT` |
| Financial limits | $250 k transfer cap, $100 k deposit cap, $10 M admin adjustment cap |
| Account states | `restricted` members can deposit but not transfer; `payment_rails: halted` blocks all transfers with 503 |
| Overdrafts | Rejected — balances can never go negative |
| Card controls | Freeze, per-transaction and monthly limits, merchant/category locks and the online-payments switch are enforced server-side when a card spends |
| Export scoping | The ledger export opens with `reports.view` or `transactions.export`; the directory, balances and KYC exports stay behind `reports.view` |
| Secrets | `TOKEN_SECRET` env required in production (refuses to boot on the dev fallback) |
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

- **Auth** — `POST /api/auth/login · register · federated · logout`, `GET /api/auth/me · /api/auth/config` (public reCAPTCHA + Google settings), `GET /api/health`
- **Member** — `GET /api/me/state` (full account snapshot) `· account · kyc · notifications`, `POST /api/me/deposits · transfers · kyc/submit · disputes · reset`, plus
  cards (issue/patch/freeze-all/replace/shipping), invoices (create/paid/remind), team,
  savings pockets (create/move/delete), payees, scheduled payments (create/toggle/pay),
  rewards redemption, Scout savings, perks, preferences, profile, sessions, notifications
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
pass-through, so development, CI and the 235-check suite run without a Google
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

### Federated sign-in (Google, via Firebase)

Firebase is an identity **provider** here, never the authority. The browser
runs the Google flow and receives a Firebase ID token; `POST /api/auth/federated`
verifies it, maps it onto an **existing** member, and mints Veyra's own session.
Everything downstream is untouched — the `sessions` table still revokes
instantly, RBAC is still read fresh from the database on every request, and the
audit trail still records what staff did. Only the credential check moves.

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
| Member already has a different Google account | Refused (409) — one identity per member per provider. |
| Staff / Super Admin | Refused (403) unless `FEDERATED_ALLOW_STAFF=1`. |

No auto-provisioning is deliberate: opening a bank account requires the full
application (legal identity, tax ID, address, government ID — see
`identity.ts`). Clicking "Continue with Google" cannot conjure one. The sign-up
screen says so rather than offering a button that can't work.

Staff exclusion is also deliberate: the console can move $10M per adjustment,
so letting a third-party IdP unlock it widens the blast radius to whoever holds
that Google account. Flip it on only if your operators are on managed Workspace
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
card model, so every member feature is server-backed). `server/src/state.ts`
builds each member's Account snapshot straight from these tables.

## Scripts

```bash
npm run dev            # frontend dev server
npm run server         # Express + SQLite API (port 8787)
npm run build          # production build → dist/index.html (single file)
npm run build:emails   # export email templates → emails/*.html
npm run typecheck:server  # strict typecheck of server/
npm test               # permissions (14) + emails (25) + route coverage (1) + route audit (1) + API integration (235) = 276 checks
```

> **Production notes:** the frontend is API-only (no offline mode). Password
> reset tokens are minted and stored hashed, but delivering the reset email
> requires wiring an SMTP provider to the marked TODO in
> `server/src/app.ts`. Card issuing and payment rails are internal-ledger
> operations until a sponsor bank / processor is integrated.
