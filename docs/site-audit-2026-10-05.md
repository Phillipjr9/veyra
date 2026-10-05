# Veyra full-site audit — 5 October 2026

## How it was checked

- Automated browser crawl of every route: 29 public pages at desktop and
  mobile widths, all 20 member pages for the personal and business demo
  accounts, and all 14 Super Admin tabs. 113 page loads in total, checking for
  JavaScript errors, failed API calls, broken internal links, broken images and
  horizontal overflow. **Result: no broken links and no JS errors.**
- A button-by-button click probe of the member pages. Every flagged "dead"
  button turned out to work when checked by hand (the probe was reusing a page
  with a modal still open).
- Code review of forms, the support flow, email, statements and card ordering.
- `npm audit`, `npm outdated`.

## Found and fixed

| # | Problem | Fix |
|---|---|---|
| 1 | **No email was ever sent.** 25 templates existed, but password reset was a TODO, and signup, KYC decisions and support sent nothing. | `server/src/mail.ts`: Resend / Postmark / SendGrid over HTTP (no new dependency), off by default. Wired to password reset (one-click link), application received, KYC approved / more info / declined, and support confirmations and replies. |
| 2 | **The in-app Support Desk was fake:** hardcoded tickets and a scripted "David M." auto-reply 1.4 s after every message. Nothing reached staff. | Real tickets: `support_messages` table (migration v11) plus `support` cases in the Operations queue. Members open and reply to cases, staff reply from the case panel, and the customer gets in-app and email notifications. |
| 3 | **Public Support and Contact forms went nowhere** (`setSent(true)` only). | `POST /api/support/contact`: rate-limited, honeypot-protected, creates a case with a `VS-` reference and emails a confirmation. |
| 4 | Made-up claims: "Median response 1.8 mins", a 555 hotline number, "FDIC protected". | Replaced with honest copy. |
| 5 | **Statements printed Veyra's office address as the customer's address**, with a fake phone number. | Statements use the mailing address from the member's application. Company contact details are centralised in `src/lib/company.ts` (configurable with `VITE_*` variables). |
| 6 | Physical cards defaulted to shipping to Veyra's office. | Cards default to the member's own address. Replacements reuse the card's existing address. |
| 7 | The transfer receipt showed a random Scout figure generated in the browser, which differed from what the server booked. | The receipt switches to the server's booked result: real reference, rewards and Scout figure. |
| 8 | The Contact page and statements disagreed on the company address (100 vs 125 Market St). | Both use one source. |
| 9 | The login response omitted plan, phone and avatar, so the sidebar showed a blank plan until reload. | Login, passkey login and federated login return the full user. |

Tests: API integration 347 → 372 checks, route audit 591 probes, browser
end-to-end 26 → 27 (new: member → staff → member support round trip plus the
public form).

## Found, not changed (needs a decision)

- **Team invites can't be accepted.** `/invite/accept` calls signup without the
  identity application the server requires, so it always fails. A proper fix
  is real shared access: an invitee logs in to the owner's business with a
  role (Admin / Member / Bookkeeper). That changes the authorization model, so
  it should be decided deliberately.
- **`node_modules` is committed** (19,493 files, macOS binaries). Installing on
  Linux or CI rewrites it. Recommend `.gitignore` + `git rm -r --cached node_modules`.
- **`npm audit`: 4 high** advisories, all `@grpc/grpc-js` under
  `firebase` → Firestore. The app only uses `firebase/auth` and never loads
  Firestore, so they can't be exploited from the site. They clear with an npm
  `overrides` entry once `node_modules` is no longer committed.
- **Scout savings are random credits on the server** (`/api/me/transfers`
  credits 3–10% back on 65% of payments). That's fine as a demo, but it creates
  money from nothing in production. It should be tied to a real funded
  program or turned off.
- Major-version upgrades available (Vite 8, TypeScript 7, plugin-react 6); minor
  updates for React 19.3, Tailwind 4.3 and lucide. Hold until `node_modules` is
  untracked.
- Landing-page testimonial avatars are hotlinked from Pexels. They fall back to
  initials if blocked, but should be self-hosted for production.
