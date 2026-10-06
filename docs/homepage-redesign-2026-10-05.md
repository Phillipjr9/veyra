# Veyra homepage — banking + digital assets

## Review and direction

The previous homepage led with AI rewards, business spending, sample account activity, and a cash-back calculator. It did not surface the existing BTC, ETH, SOL, and USDC experience in the primary story.

The redesigned homepage leads with **“Your money. Your Bitcoin. One secure home.”** It uses an original warm-ivory, muted-violet, and dark-ink visual system while retaining Veyra’s existing wordmark and routing. BitGo’s public homepage and the requested security/shield direction informed the institutional presentation, product hierarchy, and security emphasis. No BitGo artwork, logos, proprietary animation files, or copy were reused.

## Implementation

- `src/components/CryptoHome.tsx`: homepage-specific hero, product cards, four-asset explorer, interactive security panels, FAQs, and CTA.
- `src/styles/crypto-home.css`: scoped homepage styling and responsive layouts.
- `public/images/veyra-digital-vault.webp`: original AI-generated shield artwork, compressed to approximately 100 KB. It combines with CSS lighting, floating motion, and pointer-driven perspective to form the hero visual. This is a 3D-rendered image with composited motion, not a real-time WebGL model; no new graphics runtime is needed.
- `src/Landing.tsx`: delegates the homepage to the new component. Existing named exports remain available to other marketing pages.
- `src/components/Chrome.tsx`: homepage-specific navigation/copy, plus reliable mobile-menu dismissal on links and Escape.
- `src/components/common.tsx`: anchor scrolling respects reduced motion and repeated navigation to the same anchor.
- `src/App.tsx`: scopes homepage chrome and adds a keyboard skip link.
- `index.html`: updated title, search description, and social metadata. Existing deployment-domain placeholders still need confirmation before launch.
- `tests/e2e/homepage.spec.ts`: responsive layout, rendered assets, non-clipped hero text, keyboard asset tabs, mobile navigation and anchors, FAQs, security controls, motion preferences, signup/login links, and skip-link focus.

## Motion and accessibility

- Hero floats gently, responds to mouse position, and includes a soft light sweep.
- Animation stops when the hero leaves view and can be paused manually.
- OS reduced-motion changes are subscribed to live; reduced motion disables animation and pointer tilt.
- Tab navigation supports Left/Right, Home, and End; security panels expose their expanded state; native FAQ details support keyboard interaction.
- Responsive layouts cover 320, 390, 768, 1024, and 1440 px.
- The new hero asset uses explicit dimensions and high fetch priority; secondary asset illustrations load lazily.
- No new production dependencies were added.

## Product boundaries

The existing backend asset registry and trading interlock were reviewed. This change does **not** enable production trading, integrate a custodian, add blockchain settlement, or change account eligibility rules. Homepage copy qualifies trading by eligibility, regional availability, and activation. It does not claim Veyra is a chartered bank, imply crypto is FDIC insured, show invented market prices, or claim unverified third-party custody/insurance relationships. Stablecoin issuer/depegging risks are explained.

## Verification

- Production build and frontend/backend TypeScript checks.
- E2E TypeScript check.
- New homepage browser tests and existing public marketing/auth/legal route smoke tests.
- `npm test`: permissions, 25 email templates, 104-route coverage/audit, and 434 API integration checks passed.
- Automated axe WCAG 2 A/AA checks found no violations in tested desktop, tablet, and mobile homepage states, including expanded FAQ/security content and the USDC tab. This is an automated check, not a full accessibility certification.

Browser validation used Chromium supplied outside the repository because the default Playwright browser CDN was inaccessible in this environment. No browser packages, screenshots, temporary databases, or test artifacts were added to the source tree. The repository already tracks `dist/`; its production snapshot was regenerated to match the source changes.

## Live-motion refinement

The follow-up preserves the approved composition and artwork, adding a progressive motion layer rather than replacing the visual identity:

- `src/components/home/OrbitalField.tsx`: real-time Canvas 2D orbital particles, projected elliptical paths, luminous trails, and damped cursor response. This is decorative motion, not a live blockchain, trading, or security feed.
- `src/components/home/SecurityOrbit.tsx`: original animated SVG light paths and orbiting nodes around the dimensional security shield. Selecting a security panel also changes the shield’s layer spacing and emblem.
- `src/components/home/HomeMotion.tsx`: shared OS preference, tab visibility, and user pause state. The hero pause button and the fixed page-wide motion control stay synchronized.
- `src/styles/home-motion.css`: reflective card sheen, floating crypto imagery, Scout illustration motion, asset arrival effects, subtle headline lighting, pointer lighting, CTA depth, and button highlights.
- Product and security scenes suspend their CSS loops offscreen. The particle renderer uses at most 44 constellation points, caps device pixel ratio, targets at most 30 draws per second, cancels its frame loop while inactive, and cleans up its resize observer when unmounted.
- Canvas failure leaves the original shield artwork and all navigation/content intact. No new runtime packages or media assets were needed.
- No tabs or informational panels auto-advance. Pausing never leaves newly selected content invisible mid-animation.

Verification after the refinement: all 16 homepage browser tests passed, including actual changing Canvas pixels, frozen paused frames, pointer response, offscreen suspension, simulated visibility notifications, reduced motion, Canvas-unavailable fallback, and content usability while paused. TypeScript and production builds passed. Automated axe WCAG 2 A/AA checks found no violations in the tested 1440, 768, 390, and 320 px states.
