# Veyra — where the site stands, and what is left (10 October 2026)

A whole-app audit run on `arena/fdf680d4-veyra` (branched from `main` @
`dde78fd`, the merge of PR #13). It answers three questions: **where did we
stop**, **what is still broken**, and **what is missing**.

## 1. Where we stopped

The last merged work is **PR #13 — “Veyra transfers, Zelle page, funding and
crypto polish”** (merged 8 Oct). `main` is that merge; this branch started
clean on top of it, so **no work had been done in this session's branch before
this audit**.

Two branches are still open against `main` and represent the queued work:

| PR | Title | State | What it needs |
|---|---|---|---|
| [#14](https://github.com/Phillipjr9/veyra/pull/14) | Phone verification for sign-in and money movement | **MERGEABLE** (clean) | A real Firebase project to browser-test; a product decision on whether passkey and federated sign-in should also prompt for a text (today they don't, but money routes are still gated, so those members can't move money) |
| [#12](https://github.com/Phillipjr9/veyra/pull/12) | Card linking, transaction fees, compact A4 statements | **CONFLICTING** (dirty) | Rebase onto `main` — it touches `server/src/app.ts`, `server/src/db.ts` and `shared/fees.ts`, all of which moved in PR #13 — then run the browser suite (its e2e specs were typechecked but never executed) |

There is no issue tracker backlog: **the repo has zero open issues**, so the
list below is the backlog.

## 2. How this audit was checked

| Check | Result |
|---|---|
| `npm test` (16 server suites + permissions + emails + route coverage + route audit) | **passes** — 436 API assertions, 136 routes covered, 136 × 6 gate/isolation probes, 81 email templates, 136-route coverage check clean |
| `npm run typecheck` (client + server), `npm run typecheck:e2e` | clean |
| `npm run build` | clean — 3.46 MB single-file bundle |
| Route render pass — 30 public routes, 20 member routes, 14 Super Admin modules, all three demo accounts, against the live API | **0 runtime errors**, no dead internal links, no missing images |
| Accessibility/markup scan over every route | clean except 4 heading-level skips (§4, P2) |
| Production boot (`NODE_ENV=production`) | refuses without `TOKEN_SECRET`, `TOTP_ENCRYPTION_KEY`, `APP_URL` (HTTPS) and `WEBAUTHN_ORIGINS`; with them set it serves the SPA on `/` and deep paths, returns `previewLogins: []`, and staff login works |
| Browser suite (`playwright`) | **not run** — Chromium cannot be downloaded in this sandbox (CDN blocked). Everything below that is visual (layout, responsive widths, animation) is therefore unverified here, and `tests/e2e/*` still needs one clean run before launch |

Note: the sandbox has no outbound access to CoinGecko, so the Markets and
digital-asset screens were exercised in their **feed-down** state. They degrade
honestly ("Market data is unavailable right now. Nothing below is current.").

## 3. Fixed in this pass

**Unsubstantiated deposit-insurance and partner-bank claims.** The site's own
footer and legal pages say no sponsor bank, payment rail or deposit-insurance
arrangement exists — several screens said the opposite, including documents a
member can download and hand to a third party.

| Surface | Was | Now |
|---|---|---|
| `src/pages/StatementsPage.tsx` (print + PDF) | “FDIC Insured up to $250,000 per depositor”, “Banking services provided by partner institutions, Members FDIC. Funds are held in omnibus custodial accounts at our sponsor banks.”, `OFFICIAL BANK STATEMENT`, “Northfield Bank, Member FDIC” | “Not a bank · no deposit insurance”, internal-ledger wording, `ACCOUNT STATEMENT`, Veyra's own legal name and address |
| `src/pages/StatementsPage.tsx` eyebrow / `src/components/CommandPalette.tsx` | “FDIC-Insured Partner Custody · Official Certified Records”, “Printable certified FDIC vector PDF & CSV” | “Internal ledger records · printable PDF and CSV”, “Printable statement PDF and CSV export” |
| `src/Landing.tsx:401` | “FDIC insurance eligibility\*” — with an asterisk that is never explained anywhere on the page | “Append-only audit trail” |
| `src/pages/Marketing.tsx:129` (`/security`) | “Partner bank protection — Deposits are held at partner banks with FDIC insurance eligibility” | “Built for a partner-bank model — … No deposit-insurance arrangement is in place yet, and nothing here is a deposit account.” |
| `src/pages/Dashboard.tsx` + `ClassicDashboard.tsx` (Disputes eyebrow) | “…· FDIC-Compliant” | “Transaction protection · card and transfer arbitration” |
| `src/emails/design.ts` footer, `src/emails/templates.ts` | “Banking services would be provided by partner institutions, Members FDIC”; “Bank partner: Northfield Bank, Member FDIC” | “No sponsor bank, payment rail or deposit-insurance arrangement is established by this release”; “Connected when live banking rails go live” |

**Also fixed**

- **Per-route page metadata.** One HTML document serves every screen, so every
  tab, bookmark and shared link was titled “Veyra | Everyday Banking & Digital
  Assets”. Added `src/lib/pageMeta.ts` (route → title/description map, applied
  from `Shell`) which writes `document.title`, the meta description and the
  OG/Twitter tags on navigation; unknown paths get the not-found copy rather
  than the home page's.
- **Stale committed build.** `dist/index.html` predated PR #13 — it contained
  no `veyra-transfers` / “Veyra to Veyra” code, so a production deploy from a
  clean checkout (Express serves `dist/`) would have shipped a site without
  Veyra-to-Veyra transfers. Rebuilt.
- **Broken npm scripts.** `test:e2e:demo` and `test:e2e:account` pointed at
  `tests/e2e/receive-hub.spec.ts`, deleted in PR #13 — both commands failed
  outright. They now run `tests/e2e/zelle-page.spec.ts` (the replacement).
- **Email/app address drift.** Email footers said “100 Market Street” while
  `src/lib/company.ts` says “125 Market Street, Suite 400” — and
  `scripts/check-emails.mjs` *pinned* the stale string, so it could not be
  fixed without editing the check. Both updated; the 81 emails regenerated.
- **Empty-search copy.** Markets printed `No markets match “”.` with empty
  quotes when the feed was down; it now distinguishes “no search match”,
  “no filters match” and “no markets to show right now”.
- **Docs drift.** README said 24/25 email templates (81), 132 routes (136),
  434 API assertions (436), and described auth as “password digests
  (localStorage)”; it also told you to delete a `DEMO_ACCOUNTS` block in
  `src/pages/Auth.tsx` that no longer exists (shortcuts come from
  `GET /api/auth/config` and are empty in production).
  `docs/receive-hub-design-2026-10-06.md` is marked superseded — the UI it
  describes was replaced by `/app/zelle`.

## 4. Still to fix

### P0 — fix before anyone outside the team uses it

1. **Fabricated marketing statistics.** `src/Landing.tsx:452` (“$6,000+
   Average amount saved by Veyra members per year”) and
   `src/pages/Marketing.tsx:245` (“2021 Founded”, “$6,000+ Avg. member savings
   / yr”, “12k+ Businesses served”). No source, no methodology, and the same
   kind of claim the 5 Oct audit already removed elsewhere. Replace with real
   figures or drop them — I left the numbers alone because only you know the
   true ones.
2. **Placeholder domains and contact details.**
   `ASSET_BASE = "https://veyra.com"` and `APP_BASE = "https://app.veyra.com"`
   (`src/emails/design.ts:58,62`) control the logo URL and every link in all 81
   emails; `index.html` still carries `og:url` / `og:image` / `twitter:image`
   pointing at `veyra.com`; `src/lib/company.ts` falls back to
   `support@veyra.example` / `sales@veyra.example`; the invoice modal shows
   `https://veyra.com/pay/inv_…` (`src/components/InvoiceDetailModal.tsx:26`),
   a payment link that resolves to nothing.
3. **Stop shipping `dist/` as a source of truth.** The stale-bundle bug above
   is the symptom; a 3.4 MB minified artefact in Git is the cause. Gitignore
   `dist/` and build during deploy (or add a CI step that fails when the
   committed bundle does not match a fresh build).
4. **Run the browser suite once, end to end.** `npm run verify` has not been
   executed here (no Chromium). 19 spec files / 121 test declarations exist,
   several skipped without env flags; `npm run test:e2e` plus the flagged
   suites (`test:e2e:demo`, `test:e2e:account`, `test:e2e:crypto`,
   `test:e2e:funding-animation`, `test:e2e:preview-crypto`,
   `test:e2e:preview-access`) should all be green before launch.

### P1 — wrong or weak today

5. **`email-showcase.html` is stale and unmaintained**: it renders 25 of the 81
   templates and `npm run build:emails` never regenerates it. Either generate
   it from `emailTemplates` in `build-emails.ts` or delete it (the in-app
   studio at `#/email-templates` already previews all 81).
6. **Zelle QR can sit in a permanent “Preparing your code…” state**
   (`src/pages/ZellePage.tsx:110`): if generation fails after an identifier
   exists, the placeholder never becomes an error. Add a failed state.
7. **No `robots.txt` or `sitemap.xml`** in `public/`. (Low SEO value for a hash
   router until the app moves to real paths, but they are expected files.)
8. **PWA manifest has one SVG icon** (`public/site.webmanifest`) — no 192/512
   PNG, so Android install prompts and splash icons degrade.
9. **Asset directory is noisy on a new account**: `/app/assets` lists all 24
   catalog assets with `0 BTC`, “Price unavailable” and Buy/Sell/Send controls.
   Prefer owned assets plus a short “available to trade” group.
10. **Hotlinked testimonial avatars**: six `images.pexels.com` URLs in
    `src/Landing.tsx:141-146` (flagged in the 5 Oct audit, still open). They
    fall back to initials, but self-host them for privacy and uptime.
11. **Careers content is fictional**: four roles with generic
    responsibilities, no salary range, and “Apply” routes to the contact form
    (`src/pages/Marketing.tsx:446-467`). Fine as a demo; replace before launch.

### P2 — hygiene

12. Heading-level skips: `h1 → h3` on `/pricing`, `/security`, `/about`, `h2 →
    h4` on `/about`, and one skip on `/app/statements`.
13. Dependencies are behind: TypeScript 5.9 → 7.0, Vite 7.3.6 → 8.3.4,
    `@vitejs/plugin-react` 5 → 6, motion 13 → 14, firebase 12 → 13,
    lucide-react 1.52 → 1.55, express 5.2.1 → 5.3.0, `@playwright/test`
    1.63 → 1.64. `npm audit` reports 3 high (`braces`, via
    `vite-plugin-singlefile`) — build-time only, no upstream fix.
14. **No CI at all** (no `.github/`): `npm run verify` is documented as the gate
    but nothing runs it on push. Add a workflow that installs, typechecks,
    tests and builds.
15. **No deployment configuration** (no Dockerfile / Procfile / health-check
    route beyond `/api/health`); rate limits are in-memory, so they reset on
    restart and are per-instance.
16. Statements heading still reads “Statements & Reports” while the command
    palette calls it “Official Bank Statements” — worth aligning.

## 5. What is missing (deliberately not built)

Documented and disclosed, not bugs — list them on the launch checklist:

- **Real money**: no sponsor bank or processor. Deposits, transfers, Zelle,
  cards, checks and invoices are internal-ledger operations (Stripe Treasury /
  Issuing adapter exists and is off until `STRIPE_SECRET_KEY` is set).
- **Custody and mainnet execution**: not connected. Trades are internal
  records; no bridging, no on/off-ramp.
- **Plan billing**: plan selection is recorded, subscription collection and
  plan limits are not enforced (disclosed on `/pricing` via `PLAN_NOTICE`).
- **Email delivery**: built, off until `MAIL_PROVIDER` + `MAIL_API_KEY` +
  `MAIL_FROM` + `APP_URL` are set.
- **Bot defence / federated sign-in / passkeys / market data key**: off until
  `RECAPTCHA_*`, `FIREBASE_PROJECT_ID`, `WEBAUTHN_*`, `COINGECKO_API_KEY` are
  configured.
- **Per-account member monthly limits** are enforced (`server/src/teamSpending.ts`);
  **Scout savings credits** are correctly refused (HTTP 410) — both items from
  the 5 Oct audit are now closed.

## 6. Suggested order of work

1. Replace the fabricated statistics and the `veyra.com` / `veyra.example`
   placeholders (P0-1, P0-2) — small edits, biggest credibility risk.
2. Rebase PR #12 onto `main`, then merge #14 and #12 in that order (both touch
   the same server files).
3. Add CI (P2-14) and stop committing `dist/` (P0-3); rebuild during deploy.
4. One full `npm run verify` with Chromium installed, including the flagged
   e2e suites (P0-4).
5. Work down P1 (5–11), then P2.
