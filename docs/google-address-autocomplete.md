# Google address autocomplete

Implemented 5 October 2026. **Implemented, but not activated in this workspace:** no Google Maps API key is configured. The address fields remain ordinary manual-entry fields until the operator enables the provider. No live Google request was used to certify this integration; provider tests use explicit synthetic fixtures.

## What changed

- Applicant/home and business street fields share an accessible address component.
- With the provider configured, typing at least three characters starts a debounced Google Places API (New) search. Suggestions currently cover **US addresses only**, matching the existing state/ZIP application validation. This change does not add international onboarding.
- Selecting a suggestion requests structured address components and fills street, city, state, ZIP and country. Existing apartment/suite entries are retained; a returned unit is used only when that field is empty. Every field remains editable.
- Keyboard arrows, Enter, Escape, Tab and touch selection are supported. Suggestions remain in the document flow rather than overlapping adjacent fields. Tested at 320, 390, 768 and 1440px widths.
- Manual entry remains available when disabled, empty, rate-limited or unavailable. “Enter address manually” stops new searches for the field. It can be selected before typing; a request already sent cannot be recalled from Google.
- Old queries are cancelled/ignored. Editing or leaving the street field cancels pending details, and changes to related address fields invalidate an in-flight selection. The two address fields have independent search sessions.
- The compact result list uses the unmodified text attribution **Google Maps** with the prescribed typography, contrast and non-translation behavior. Any place-details provider attribution is retained and displayed. Do not remove attribution. Review Google's current branding rules before production publication; use its official logo assets if expanding the attribution interface.
- Public Privacy Policy and Terms drafts now explain this optional provider, link to Google's terms/privacy, and describe selected application-address use separately from transient predictions. These documents still require the operator's legal review.

## Activate safely

1. Use an operator-owned Google Cloud project with billing enabled. Enable **Places API (New)**. Existing Google/Firebase sign-in configuration is unrelated and does not enable address lookup.
2. Create a **server-side** API key, restrict its API access to Places API, and restrict it to the deployment's stable egress IP addresses where supported. Browser referrer restrictions are not appropriate for this server-to-server integration. If the hosting platform has dynamic outbound IPs, arrange stable egress or assess the supported server credential/restriction model before production.
3. Configure Google Cloud request quotas, billing monitoring and alerts. An alert alone is not a spending cap. Review the currently applicable Google Maps Platform pricing, regional terms and end-user-address storage conditions.
4. Store the key in the API server's secret environment as `GOOGLE_MAPS_API_KEY`. A local developer may use an ignored `.env` file. **Never prefix it with `VITE_`, put it in a client bundle or commit it. Do not paste the key into chat.** `.env.example` contains only an empty placeholder.
5. Restart the API server and reload the signup page. `/api/auth/config` exposes only `addresses.enabled` and the supported region list, not the key. This indicates configuration presence, not a successful provider health check. No frontend rebuild is needed for key activation.
6. Perform a real smoke test with a public, nonsensitive US address. Check both home/business selection, city/state/ZIP, apartment preservation, keyboard/touch interaction and manual fallback. Confirm Cloud metrics show the expected Autocomplete and Place Details requests and that key restrictions are effective. No real government identifier is needed for this address test.

To disable suggestions, remove/empty `GOOGLE_MAPS_API_KEY`, restart the API and reload the page. Existing submitted addresses are unaffected.

## Server and data handling

The browser posts to same-origin endpoints, so the preview and production browser do not need to know an API hostname or Google key:

- `POST /api/address/autocomplete`: `{ input, sessionToken }`
- `POST /api/address/details`: `{ placeId, sessionToken }`

`server/src/addresses.ts` calls only the fixed `places.googleapis.com/v1` host. Queries are 3–160 characters; sessions must be UUID v4; place IDs are validated. Query predictions are excluded. An autocomplete session is bound to the connection IP and returned place IDs, and details can only select one of those IDs. Sessions expire after three minutes; selecting consumes a session, including outstanding search requests. The browser rotates sessions after selection and on the next search after a session is two minutes old. No arbitrary upstream URL or field mask comes from the browser.

The upstream key is sent in a header. Autocomplete requests ask only for prediction IDs/text; details ask only for `addressComponents,attributions`. Calls have a five-second deadline, refuse redirects, and return sanitized errors. Query strings, prediction lists and raw Google errors are not logged or cached by this code. The server's normal API `Cache-Control: no-store` applies. Address lookup sends the address query/session, not the other signup fields. The selected address stays in the React form until the user submits the normal application; lookup alone does not write an application or ledger record.

Abuse controls:

- 40 accepted-format lookup attempts per connection IP per minute, shared across the two endpoints.
- 600 lookup attempts per running server process per hour; failing provider requests count too. Instance exhaustion deliberately degrades to manual entry.
- Bounded in-memory IP budgets and session maps (up to 1,000 entries each); expired entries are pruned on subsequent traffic. Only returned place IDs, IP/session identifiers and budget metadata are kept, not prediction text.
- Cross-site browser requests identified by `Sec-Fetch-Site` are refused. This is defense in depth, not authentication: non-browser clients can omit/forge that header.
- Express currently does **not** trust arbitrary forwarded IP headers. Requests behind one reverse proxy can share a conservative connection budget. Do not enable blanket `trust proxy`; configure only known trusted proxy hops if adding it.

These are single-process development protections, not a distributed production abuse service. Restarts reset memory and multiple processes have independent limits. A live multi-instance deployment needs a shared rate-limit/session store or appropriate routing, edge abuse controls, and provider-side quotas. Validate anonymous signup exposure and logging at the hosting/proxy layer too.

Autocomplete is a typing aid, **not** identity verification, proof of residence or guaranteed postal deliverability. Missing components remain empty rather than being guessed from county/display text. Submitted addresses still pass existing application validation and approval. No authentication, SSN, financial-control or admin-approval bypass was introduced.

## Verification

- `npm run typecheck` and `npm run typecheck:e2e` passed.
- `npm run build` passed.
- `npm test` passed: the existing permission/email/money/API checks, 106-route coverage/audit, 435 API integration checks, and the new provider-proxy suite.
- `npm run test:addresses`: **27 checks**, real local HTTP endpoints with a mocked Google upstream. Includes absent configuration, input/session validation, payload/key separation, session binding/expiry/replay/races, normalization, provider attribution, sanitized failures and both rate budgets.
- Full Playwright regression: **79 tests passed**, including four address tests plus existing auth, signup/approval, legal, dashboard, homepage, financial controls and passkeys.
- Address browser tests use clearly synthetic route fixtures, not a fallback address database in production. They cover independent home/business autofill, existing units, keyboard/touch selection, unavailable provider, manual opt-out, no matches, Escape/Tab, late details and mobile widths.
- Actual Vite/API preview: configuration reported suggestions off, manual address entry worked, no page runtime errors or horizontal overflow were observed. An enabled-state screenshot was inspected separately with a visible **UI TEST FIXTURE — NOT LIVE GOOGLE RESULTS** banner.

Live Google billing, project restrictions and actual provider responses remain an operator activation test, not something established by the fixtures.

## Official references

- [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Places policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Maps terms](https://maps.google.com/help/terms_maps/)
- [Google Privacy Policy](https://policies.google.com/privacy)
