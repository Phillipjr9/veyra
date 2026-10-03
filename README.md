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

**Development demo data** — set `DEMO_SEED=1` (or `DEMO_SEED=1 npm run server`)
to additionally seed the demo identities with a full dataset for exploring and
testing. Production boots clean; the flag also warns if set with
`NODE_ENV=production`.

| Demo identity (DEMO_SEED=1 only) | Email | Password |
|---|---|---|
| Business member | `demo@veyra.com` | `veyra123` |
| Personal member | `personal@veyra.com` | `veyra123` |
| Super Admin | `admin@veyra.com` | `admin123` |
| Compliance officer | `compliance@veyra.com` | `veyra123` |
| Support agent | `support@veyra.com` | `veyra123` |

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
    Dashboard.tsx       App shell + every authenticated page
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
  styles/               Shared CSS per area
emails/                 Exported standalone HTML (build:emails)
scripts/
  test-permissions.ts  RBAC mirror unit tests (14 checks)
  check-emails.mjs     Email template validation (25 checks)
  build-emails.ts      Email export
public/images/email/    Hosted logo PNG for emails (Gmail/Outlook-safe)
server/
  src/
    index.ts            Bootstrap: .env loader, DEMO_SEED, production guards
    app.ts              createApp() — REST routes + middleware
    db.ts               SQLite (WAL, FK on): migrations, audit triggers, tx helper
    security.ts         scrypt hashing, HS256 tokens, rate limiter, TOKEN_SECRET
    rbac.ts             Server-authoritative permission matrix (DB overrides)
    audit.ts            logAdminAction — the only write path to audit_log
    seed.ts             Production bootstrap (env admin) + opt-in demo seed
  scripts/test-api.ts   69-check integration suite (boots the real server)
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
npm run test:api          # 105-check integration suite (fresh DB, ephemeral port)
npm run typecheck:server  # strict NodeNext typecheck
```

### What it enforces

| Concern | Implementation |
|---|---|
| Passwords | scrypt (`s2$salt$hash`), never plaintext or reversible |
| Sessions | HS256 bearer tokens (12 h) with a `sessions` table — logout and admin revocation kill them instantly |
| Login abuse | In-memory rate limit: 8 attempts / 60 s / email+IP |
| RBAC | 17 permissions × 5 roles, resolved **fresh from the DB on every request** (role changes take effect immediately, no re-login) |
| Money | Integer cents everywhere; every mutation inside `BEGIN IMMEDIATE` |
| Audit trail | `audit_log` is append-only **by database trigger** — `UPDATE`/`DELETE` raise `ABORT` |
| Financial limits | $250 k transfer cap, $100 k deposit cap, $10 M admin adjustment cap |
| Account states | `restricted` members can deposit but not transfer; `payment_rails: halted` blocks all transfers with 503 |
| Overdrafts | Rejected — balances can never go negative |
| Secrets | `TOKEN_SECRET` env required in production (refuses to boot on the dev fallback) |
| Password reset | Single-use SHA-256-hashed tokens, 30-minute expiry, reset revokes all sessions |
| Bootstrap | First Super Admin created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` — no seeded accounts in production |

### API surface (summary)

- **Auth** — `POST /api/auth/login · register · logout`, `GET /api/auth/me`, `GET /api/health`
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
| `DEMO_SEED` | off | `1` = seed demo identities (development only) |

Variables can live in a `.env` file (loaded automatically — see `.env.example`).

The database schema is created by versioned migrations in `server/src/db.ts`
(v1: `users`, `accounts`, `transactions`, `cards`, `kyc_records`, `disputes`,
`notifications`, `audit_log`, `sessions`, `role_permissions`, `settings`;
v2 adds `invoices`, `team_members`, `savings_pockets`, `payees`,
`scheduled_payments`, `perks`, `security_sessions`, `preferences` and the full
card model, so every member feature is server-backed). Demo members are seeded
with the exact dataset the standalone frontend generates (`server/src/state.ts`),
and every new signup starts with the same demo state.

## Scripts

```bash
npm run dev            # frontend dev server
npm run server         # Express + SQLite API (port 8787)
npm run build          # production build → dist/index.html (single file)
npm run build:emails   # export email templates → emails/*.html
npm run typecheck:server  # strict typecheck of server/
npm test               # permissions (14) + emails (25) + API integration (114) = 153 checks
```

> **Production notes:** the frontend is API-only (no offline mode). Password
> reset tokens are minted and stored hashed, but delivering the reset email
> requires wiring an SMTP provider to the marked TODO in
> `server/src/app.ts`. Card issuing and payment rails are internal-ledger
> operations until a sponsor bank / processor is integrated.
