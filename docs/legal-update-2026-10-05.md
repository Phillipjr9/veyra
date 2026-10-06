# Legal content update — 5 October 2026

## Delivered

Existing routes remain unchanged:

| Document | Route | Sections | Main-text words |
| --- | --- | ---: | ---: |
| Privacy Policy | `/#/legal/privacy` | 16 | 2,175 |
| Terms of Service | `/#/legal/terms` | 18 | 2,450 |
| Disclosures | `/#/legal/disclosures` | 15 | 1,959 |

The 6,584-word body total excludes navigation, the shared review notice, revision summary and contact instructions. The content replaces the prior short paragraphs and January 2026 revision label. The new date is a **revision date**, not a claim of renewed consent or legally effective adoption.

- Explicit public **Review draft · Current preview** notice; no invented jurisdiction, legal entity, partner bank, licence, insurance arrangement, regulator, arbitration clause or liability cap.
- Product-specific explanations of disabled Scout credits, preserved demonstration-derived history, actor attribution, UTC monthly gross-spend limits, owner/Bookkeeper distinctions, mixed payment paths and first-month attribution gaps.
- Internal confirmation versus external settlement, failed refreshes, duplicate-submit risk, schedules and invoice status, savings pockets, cashback funding and crypto custody/market-data limitations.
- Privacy coverage for identity fields, shared business visibility, authentication, local Scout history, browser token/device storage, optional providers, Google-hosted fonts, staff/support access and the absence of a comprehensive retention/erasure workflow.
- Contents navigation with desktop sidebar and collapsible mobile presentation, keyboard focus on section headings, related-document links, functioning support-form link and print/save controls.
- Shared footer no longer asserts unspecified FDIC-member partner institutions or a verified incorporated company name. Brand copyright remains Veyra.
- No changes to account creation, financial controls, provider configuration or authentication behavior.

## Source grounding

Content was checked against `server/src/teamSpending.ts`, the financial routes and state in `server/src/app.ts` / `state.ts`, identity form categories in `identity.ts`, security/session handling, configured integrations, `src/lib/api.ts`, `ScoutAIAssistant.tsx` / `scoutEngine.ts`, the support workflow, and the money-controls implementation notes. No jurisdiction-specific legal compliance determination was made.

The existing `src/lib/company.ts` has illustrative defaults, including a legal name, postal address and example-domain emails. These were **not** promoted to verified legal contact information. Other screens/templates using those defaults still require an operator-level content review.

## Required before final adoption / live launch

1. **Operator:** confirm full registered legal name, company registration details, service address and whether a trading name is used. Replace illustrative company defaults only with verified information.
2. **Jurisdictions:** confirm incorporation, actual operating locations, launch markets and eligible users. Do not infer these from the visitor's location or US-oriented fields. Counsel must determine governing law, courts, regional consumer/privacy notices, licensing and complaint routes.
3. **Financial model:** confirm the actual bank, card issuer, payment rails, custody and execution providers, ownership/safeguarding model and any legitimate insurance disclosures. No providers are established by these text edits.
4. **Privacy governance:** identify controller/processor roles, a monitored privacy contact, vendor inventory, hosting locations, international-transfer safeguards, lawful bases and applicable data-subject rights/response procedures.
5. **Retention and security:** establish and implement category-specific retention, deletion, backup handling, data-protection controls and incident procedures. The draft deliberately avoids an invented retention period, deletion SLA or security certification.
6. **Commercial terms:** confirm fees, subscriptions, cancellation/refunds, funded reward rules and support commitments. Existing promotional, pricing and support copy needs a broader claim-by-claim review before launch; this edit does not certify every marketing page.
7. **Consent/versioning:** determine required notice and acceptance mechanisms. The existing signup checkbox is not a server-side versioned legal-consent register; updating these pages does not add one or retroactively obtain assent.
8. **Professional review:** have qualified counsel review and approve the completed documents for the actual service. Remove the review-draft status only after the underlying facts and operational commitments are correct.

A generic legal page cannot cure missing live providers, absent licences, incomplete operational controls or misleading claims elsewhere. Current public text explicitly states its draft status and preview limitations.

## Verification

- Client/server typechecks and E2E typecheck passed.
- Production build passed.
- **71/71 browser tests passed across two runs:** 4 new legal tests, 16 homepage tests, 28 integration tests, 19 dashboard/mobile tests and 4 money-control tests.
- Live-preview screenshots checked at desktop and 320px; the mobile legal page measured 320px content width in a 320px viewport.
- Legal tests cover all three documents at 320, 390, 768 and 1440px, substantive text/section counts, no horizontal overflow, keyboard-accessible mobile contents, deep links and focus, related-policy links, support navigation and print visibility.
- An existing statement-print rule hid all body descendants. Legal print CSS explicitly restores visibility only within the legal document; statement rendering remains unchanged, and statement CSV/PDF regressions passed.

## Implementation files

- `src/content/legal.ts`: typed, versioned, long-form document content.
- `src/pages/Legal.tsx`: reader, navigation, review notice, links and print action.
- `src/styles/legal.css`: scoped responsive and print styles.
- `src/pages/Marketing.tsx`: old short content removed; existing LegalPage export retained.
- `src/components/Chrome.tsx`: consistent, qualified shared-footer disclosure.
- `tests/e2e/legal.spec.ts`: new content and browser regressions.

No pull, merge, branch switch or production deployment was performed.
