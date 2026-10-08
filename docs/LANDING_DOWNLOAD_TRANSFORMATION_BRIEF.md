# Landing + Download Transformation brief (owner, 2026-10-08 — "Part 4a / 3b")

Saved verbatim so it survives sessions. Status ledger at the end.

---

FRENZSAVE LANDING + DOWNLOAD EXPERIENCE TRANSFORMATION
PUBLIC DISCOVERY • ANONYMOUS AD APPLICATION • FRENZ AI • ADS • ALL NEW FEATURES
PREMIUM UI/UX • PERFORMANCE • SEO • NO CLUTTER

You are continuing work on the existing Frenzsave platform.

The existing Frenzsave landing/Download page already has its own established design and identity.

DO NOT completely replace the existing product identity.

Instead:

AUDIT → UPGRADE → POLISH → RESTRUCTURE → TRANSFORM

the existing Landing + Download experience so it can naturally introduce the expanding Frenzsave ecosystem.

## 1. PRIMARY GOAL

The public Landing/Download experience must now make it immediately clear that Frenzsave is more than a downloader.

Users should be able to discover:

1. Frenz Download
2. Frenz AI
3. AI creation tools
4. AI Reels
5. Reels / Feed
6. Wallpapers
7. Advertising / Promote
8. Other currently enabled Frenzsave features

WITHOUT making the page feel crowded.

The experience should feel like: One premium platform with multiple powerful products.

NOT: A page containing dozens of unrelated feature cards.

## 2. FIRST — AUDIT THE EXISTING PAGE

Before changing anything, inspect the existing: landing page, Download page, navigation, hero, header, mobile navigation, feature cards, AI entry points, Wallpapers entry point, Feed/Reels entry points, profile, existing CTA, sticky install banner, responsive behavior, SEO content, existing anonymous-user experience, existing signed-in experience.

Identify: duplicated content, unnecessary sections, visual clutter, weak hierarchy, redundant CTAs, oversized components, excessive gradients, unnecessary animations, slow-loading assets, repeated API calls, unnecessary authenticated requests, dead links, inconsistent UI, mobile layout issues.

Do not blindly rewrite the page.

## 3. NEW PRODUCT ARCHITECTURE

The Landing/Download page should communicate four major areas:

DOWNLOAD · AI · DISCOVER · PROMOTE

Example high-level structure:

Hero → Quick product actions → Frenz AI showcase → Discover / social features → Promote on Frenzsave → Secondary features → Trust / platform information → Footer

The exact visual arrangement should follow the existing Frenzsave design system.

## 4. HERO SECTION

Preserve the existing Frenzsave hero concept: "Save. Discover. Explore." but upgrade its presentation to reflect the larger ecosystem.

The hero must remain primarily focused on downloading content.

Do NOT turn the hero into an advertising marketplace.

Keep: URL input, Paste, Save, supported platform information, Fast / Secure / Private messaging.

However, add a subtle secondary discovery path to Frenz AI.

Example:

Save. Discover. Create.

Download your favorite content and explore powerful AI creation tools.

Primary: [ Paste link / Save ]
Secondary: [ Explore Frenz AI ]

Do not overcrowd the hero with multiple large buttons.

## 5. QUICK ACTIONS

Immediately below the main Download interaction, provide a compact set of high-value shortcuts.

Example: Download, Frenz AI, Reels, Wallpapers, Promote

Use compact premium cards/icons.

Do NOT create 10–15 large cards.

Only expose the most important destinations.

The remaining features can be discovered deeper in the page.

## 6. FRENZ AI DISCOVERY

Frenz AI must be clearly visible to anonymous and signed-in users.

Create a premium AI showcase section.

Example:

Frenz AI

Create more with AI.

Generate and transform: Image, Video, Audio, Voice, Lip Sync, Characters and other currently enabled AI features.

Primary CTA: [ Explore Frenz AI ]
Secondary: [ View AI Features ]

Use the existing Frenz AI visual language.

Do NOT make this section look like the Downloader UI.

It should retain the premium fintech/AI identity already established for Frenz AI.

## 7. AI SHOWCASE

Where appropriate, use the existing AI showcase cards.

The showcase should: auto-slide, support manual interaction, use lightweight media, lazy-load non-visible items, pause when not visible, avoid loading every video simultaneously, use posters/thumbnails where possible.

Only the active showcase media should play.

Do not make the landing page heavy.

## 8. AI REELS DISCOVERY

Introduce AI Reels as part of the ecosystem.

Example:

AI Reels

Watch what creators are making with Frenz AI.

[ Explore AI Reels ]

Use the existing Reels infrastructure.

Do not create a separate social system.

If a lightweight preview is used: load only visible content, autoplay only the active video, muted autoplay where appropriate, pause offscreen, clean transitions, no unnecessary preloading.

## 9. ADVERTISING / PROMOTE DISCOVERY

IMPORTANT:

Both anonymous and signed-in users must have a visible place to discover advertising on Frenzsave.

This should NOT be hidden inside the authenticated dashboard.

Introduce a polished: "Promote on Frenzsave" or: "Advertise on Frenzsave" section.

Example:

Reach people across Frenzsave.

Promote your brand, product, service or content across: Feed, Reels, AI, Stories, Download and other available placements.

CTA: [ Advertise on Frenzsave ]

This CTA must be available to: Anonymous users, Signed-in users

## 10. ANONYMOUS AD APPLICATION

Anonymous users must be able to discover and begin the advertising application.

When an anonymous user clicks: Advertise on Frenzsave — they should be taken to the public Advertising page.

The public page should explain: available formats, placements, campaign durations, general pricing where appropriate, how advertising works, advertising rules, automated validation, payment, campaign activation.

Then: [ Start Advertising ]

If authentication is required before campaign creation: do NOT simply throw the user into a login screen without context.

Instead: Continue to Advertise → authenticate/create account → return user to their advertising application

Preserve the user's intended flow.

## 11. SIGNED-IN AD APPLICATION

Signed-in users should also have: Advertise / Promote available from: Landing page, Download page, Profile/business area where appropriate, Ads page.

Clicking it should open the existing advertiser application from Part 2.

Do not create a second application flow.

## 12. PUBLIC ADVERTISING LANDING PAGE

Create/reuse a public: /advertise or equivalent route.

This page is accessible without authentication.

Its purpose is discovery and conversion.

Suggested structure:

Hero — "Put your brand in front of Frenzsave users."

Then: Available placements, Formats, How it works, Pricing/duration, Creative requirements, Advertising rules, FAQ

CTA: [ Start Advertising ]

Do not require login merely to view the information.

## 13. AD FORMAT DISPLAY

Only show formats currently enabled by Admin.

Examples: Banner, Interstitial, Reward Video

Never hard-code the list.

If Admin disables a format: it disappears from public advertising discovery.

If Admin adds a format: it can automatically appear.

## 14. PLACEMENT DISPLAY

Only show currently available placements.

Examples: Feed, Reels, AI Pages, AI Reels, Stories, Download, Download Result, Interstitial, Download Completed, AI Video Save Reward

The public page should explain placements simply.

Avoid exposing internal database terminology.

Use human-readable names.

## 15. PRICING DISCOVERY

If public pricing is enabled: display current Admin-configured prices.

Never hard-code prices.

Example: Starting from: $X — or: 7 days $X, 30 days $X

Promotional bonuses should be shown only while active.

Example: 30 days +5 bonus days

Do not show expired promotions.

The actual checkout price remains server-authoritative.

## 16. PROMOTION DISCOVERY

If Admin enables a promotion: show it naturally.

Example: Launch offer — Book 30 days, Get +5 bonus days

Do not use aggressive sales UI.

If promotion expires: remove it automatically.

## 17. ADVERTISING CTA PLACEMENT

The advertising CTA should appear in several appropriate places without feeling repetitive.

Recommended:

Header/menu: Advertise
Main landing: Promote on Frenzsave
Footer: Advertise on Frenzsave
Download page: small Promote CTA

Do NOT place huge "Advertise Now" buttons everywhere.

## 18. HEADER / NAVIGATION

Upgrade the existing header carefully.

The main navigation should remain simple.

Possible structure: Frenzsave logo — Download, AI, Explore, Advertise — Then: Sign in or Profile

Do not expose every individual AI tool in the main navigation.

Use: AI as the gateway to Frenz AI.

## 19. MOBILE NAVIGATION

Do not overload mobile navigation.

Keep the most important actions.

Example: Home, Download, AI, Explore, Profile

Advertising can be accessible through: menu, Explore, Profile/business tools, landing CTA

Do not force a sixth/seventh permanent navigation item unless the existing product architecture clearly benefits from it.

## 20. DOWNLOAD PAGE

The Download page remains a functional download experience first.

Do NOT transform it into a marketing page.

Keep: URL input, Paste, Save, supported platforms, multiple links, AI entry, Wallpapers entry

But upgrade the surrounding discovery architecture.

The user should naturally discover: Frenz AI, Reels, Wallpapers, Advertise — without interrupting the primary download task.

## 21. DOWNLOAD PAGE SECONDARY DISCOVERY

After the main Download action: use compact discovery cards.

Example:

Create with Frenz AI — Turn your ideas into image, video and audio. [ Explore AI ]

and:

Promote on Frenzsave — Put your brand in front of the Frenzsave audience. [ Advertise ]

These should not dominate the page.

## 22. FEATURE HIERARCHY

Do NOT display every feature at equal visual weight.

Use hierarchy:

PRIMARY: Download, Frenz AI
SECONDARY: Reels, AI Reels, Wallpapers
BUSINESS: Advertise on Frenzsave
TERTIARY: Other enabled platform features

This prevents feature overload.

## 23. DO NOT CREATE A FEATURE WALL

Avoid: 12 giant cards, 10 colorful icons, large gradients everywhere, long descriptions, multiple competing CTAs

Instead use: section hierarchy, compact cards, tabs, horizontal scrolling where appropriate, visual showcases, short descriptions

The page should feel premium and intentional.

## 24. EXISTING FRENZ AI UI/UX

The new Landing/Download experience must connect visually with the existing Frenz AI UI.

Use: typography, spacing, buttons, cards, borders, gradients, shadows, animations, dark mode, light mode — from the existing design system.

Do not create another design system.

## 25. LIGHTWEIGHT DESIGN

The landing page must remain extremely lightweight.

Do not load all: AI videos, Reels, advertising creatives, wallpapers, feature images — at initial page load.

Use: lazy loading, intersection observers, responsive images, poster images, modern formats, code splitting, route-level loading, media cleanup

## 26. AI MEDIA PERFORMANCE

For showcase videos: Only the visible/active video should play.

Use: poster, preload="metadata" where appropriate, lazy loading, pause when offscreen

Avoid loading multiple full-resolution videos simultaneously.

## 27. AD DISCOVERY PERFORMANCE

The public advertising section must NOT load the actual ad-serving engine just to display the "Advertise" CTA.

Do not initialize: ad rotation, impression tracking, campaign serving, reward ads — on the public landing page unless an actual advertisement placement is being rendered.

The Advertise CTA is simply navigation.

## 28. SEO

The public Landing and Advertising pages should remain indexable where appropriate.

Create useful semantic content for: Frenzsave, Frenz AI, AI video, AI image, AI audio, video downloader, content discovery, advertising on Frenzsave

Do not generate thin doorway pages for every feature.

Avoid duplicate SEO pages.

Use: proper title, meta description, canonical URL, Open Graph metadata, structured data where appropriate, semantic headings

## 29. ANONYMOUS USER EXPERIENCE

Anonymous users should be able to understand Frenzsave without logging in.

They should be able to: Download, Explore Frenz AI, Explore public Reels/Feed where available, Explore AI Reels, Explore Wallpapers, View Advertising information, Start an advertising application

Authentication should only be required where account ownership or payment requires it.

## 30. SIGNED-IN USER EXPERIENCE

Signed-in users should see the same public ecosystem but with personalized functionality where appropriate.

Do not create a completely different homepage.

Enhance it with: Profile, history, saved content, AI balance where appropriate, advertiser dashboard access if applicable

Do not expose sensitive account data publicly.

## 31. STICKY INSTALL / GET FRENZ BANNER

Preserve the existing Get Frenz/install experience.

However, ensure it does not cover: Download CTA, Advertise CTA, AI CTA, mobile navigation, payment buttons

Respect safe-area insets.

Avoid showing the banner too aggressively.

## 32. FOOTER

Upgrade the footer into a compact ecosystem navigation.

Suggested groups:

Product — Download, Frenz AI, Reels, Wallpapers
Business — Advertise, Advertising Rules
Company — About, Support, Contact
Legal — Privacy, Terms

Do not create unnecessary footer links.

Only expose routes that actually exist.

## 33. ADVERTISING RULES

Public advertising information should link to the current Advertising Rules.

Rules should be easy to find before users apply.

Do not bury them only inside checkout.

## 34. ANALYTICS

Track important discovery events efficiently:

landing_view, download_started, ai_clicked, reels_clicked, ai_reels_clicked, wallpapers_clicked, advertise_clicked, advertise_application_started, advertise_application_completed

Do not send analytics on every animation or scroll movement.

Batch where practical.

## 35. NO UNNECESSARY SERVER WORK

The landing page must not create expensive server activity.

Avoid: per-second requests, unnecessary Realtime, repeated Supabase queries, loading full user profiles for anonymous users, loading advertiser campaigns just to show an Advertise CTA, loading all AI configuration if only the AI landing card is needed

Use cached public configuration where appropriate.

## 36. PUBLIC CONFIGURATION

Where sections/features are Admin-configurable, use lightweight public configuration.

Example: AI enabled, Advertising enabled, AI Reels enabled, Wallpapers enabled

If a feature is disabled: remove/hide its discovery CTA gracefully.

Do not break layout.

## 37. PERFORMANCE TARGETS

Maintain Frenzsave performance goals.

Target where realistic: LCP ≤ 1.6 seconds, Excellent INP, Low CLS, Fast navigation, Low JS execution, Low memory, Minimal network requests

The new landing experience MUST NOT cause a significant performance regression.

## 38. RESPONSIVE DESIGN

Design intentionally for: iPhone, Android, tablet, desktop

Do not simply scale the desktop layout down.

Mobile should feel native and premium.

## 39. DARK MODE

Follow existing Frenz AI/Frenzsave dark mode.

Do not create another dark palette.

Check: cards, hero, inputs, AI showcase, advertising section, buttons, footer, navigation, modals — for proper contrast.

## 40. ANIMATION

Use subtle premium motion.

Allowed: fade, slide, scale, horizontal carousel, small hover states, soft transitions

Avoid: large particle effects, continuous expensive animations, heavy blur, full-page animations, autoplaying multiple videos

Respect prefers-reduced-motion.

## 41. FINAL LANDING PAGE STRUCTURE

Aim for a structure approximately like:

HEADER

HERO — Save. Discover. Create. — [ URL INPUT ] [ Save ]

Quick actions — Download | AI | Reels | Wallpapers

FRENZ AI SHOWCASE — Create with Frenz AI. Image • Video • Audio • Voice • More — [ Explore Frenz AI ]

AI REELS — See what creators are making. — [ Explore AI Reels ]

DISCOVER — Reels, Feed, Wallpapers

PROMOTE ON FRENZSAVE — Reach the Frenzsave audience. Feed • Reels • AI • Stories • Download — [ Advertise on Frenzsave ]

TRUST / PLATFORM SECTION — Fast, Secure, Private

FOOTER

Keep this conceptual structure flexible.

Do NOT force every section to be large.

## 42. DOWNLOAD PAGE STRUCTURE

Keep the Download page primarily functional:

HEADER

Download — URL input, Paste, Save

Supported platforms

Save multiple links

Then compact discovery:

Frenz AI [ Explore AI ]
Wallpapers [ Explore Wallpapers ]
Promote [ Advertise on Frenzsave ]

Do not duplicate the entire Landing page inside Download.

## 43. ADVERTISING PAGE STRUCTURE

Public /advertise:

HEADER

Hero: Advertise on Frenzsave — "Reach users across Download, Reels, Feed, AI and more."

Available formats, Available placements, How it works, Pricing, Creative requirements, Advertising rules, FAQ

CTA: [ Start Advertising ]

If user is anonymous: Start Advertising → authentication → return to application

If signed in: Start Advertising → existing Part 2 application

## 44. CONTINUITY AFTER LOGIN

If an anonymous user clicks: Advertise — and then signs up/logs in: return them directly to: Advertiser Application

Do NOT send them to the generic homepage.

Preserve their intended action.

## 45. ACCESSIBILITY

Maintain: semantic HTML, proper heading hierarchy, keyboard navigation, visible focus, screen-reader labels, accessible buttons, contrast, reduced motion, touch targets

Do not sacrifice accessibility for visual design.

## 46. FINAL DESIGN AUDIT

After implementation inspect: Landing, Download, Advertise, Frenz AI entry, AI showcase, AI Reels CTA, mobile navigation, footer

Check: Does the page feel cluttered? Are there too many cards? Are there too many CTAs? Is Download still the primary action? Is Frenz AI obvious? Is Advertise easy to find? Can an anonymous user discover advertising? Can a signed-in user quickly apply? Does everything feel like one Frenz product? Does it visually connect with Frenz AI?

If not, refine the hierarchy.

## 47. FINAL PERFORMANCE AUDIT

Measure/inspect: LCP, INP, CLS, JS bundle, route bundle, network requests, image weight, video loading, Supabase calls, Realtime subscriptions, memory, animation performance

Remove unnecessary work.

## 48. IMPORTANT PRODUCT PRINCIPLE

Frenzsave is becoming an ecosystem.

The Landing/Download experience must communicate: DOWNLOAD, CREATE, DISCOVER, PROMOTE

But it must do so through hierarchy rather than clutter.

The user should understand the ecosystem within seconds.

## 49. NON-NEGOTIABLE RULES

1. Preserve Frenzsave's existing identity.
2. Do not completely rewrite the existing Download experience unnecessarily.
3. Upgrade rather than duplicate.
4. Frenz AI must be clearly discoverable.
5. Advertising must be clearly discoverable.
6. Anonymous users must be able to discover and start the advertising application.
7. Signed-in users must be able to access the same application.
8. Anonymous users must be returned to the advertising application after authentication.
9. Do not create a second advertiser application.
10. Do not create a second AI experience.
11. Do not create a second Reels system.
12. Reuse existing infrastructure.
13. Do not make the landing page a feature wall.
14. Do not overload navigation.
15. Download remains the primary functional action.
16. Frenz AI remains a major product destination.
17. Advertising is a major business destination but must not dominate the consumer experience.
18. Only display Admin-enabled features, formats, placements and promotions.
19. Never hard-code advertising prices into the frontend.
20. Keep the public experience lightweight.
21. Do not initialize the ad-serving engine merely because the Advertise CTA is visible.
22. Do not load all AI/Reels media at once.
23. Preserve LCP and navigation performance.
24. Follow existing Frenz AI UI/UX.
25. Keep the experience premium, clean, mature and native-app-like.
26. Test anonymous and authenticated experiences separately.
27. Test mobile and desktop.
28. Test light and dark mode.
29. Audit before modifying.
30. Do not sacrifice existing functionality while upgrading the experience.

END LANDING + DOWNLOAD TRANSFORMATION

---

## Status ledger

### §2 Audit (2026-10-08, production build, 390 px)

- Landing = 10,859 px (~13 phone screens), 273 requests / ~4.9 MB on load — most of it third-party ads/analytics, not our code.
- The hero IS the Download page's top section (`DownloadPageCore`, shared with /downloads by owner decision 2026-08-16) — upgrades land on both.
- A guest saw ~1.5 screens of nothing: four stat tiles reading "0" / "—" (members are redirected to /home at the edge, so the landing is anonymous by construction).
- The platform list appeared THREE times (hero chips, "Save from 11 Platforms" grid, SEO link list).
- "One Platform. Unlimited Possibilities." restated the ecosystem without real doors.
- Missing entirely: a Frenz AI section, AI Reels, Reels/Feed discovery, a Promote/Advertise section (only a footer link).
- Seven ad slots between sections (kept — revenue; not changed unasked).

### Phase 1 — shipped

| § | What |
|---|---|
| 4 | H1 "Save. Discover. Create." + subtitle naming AI (shared hero, so /downloads too; shorter than "Explore.", one line at 320 px) |
| 5 | Shortcut row under the paste box tiles: Reels · AI Reels · Feed · Promote (the two big tiles above are Frenz AI and Wallpapers — never the same door twice) |
| 6–8 | Frenz AI panel: live tools from `SHOWCASE_TARGETS`, Explore Frenz AI + Watch AI Reels (`/reels?tab=ai` now deep-links the AI tab) |
| 9, 13–16, 27, 35–36 | Promote band: hidden when ads are off; enabled placements by human name (5 + "and more"); a promotion only while live; data from `getPublicAdSummary()` at page regeneration — no ad engine, no per-visitor request |
| 22 | Discover: Reels · Feed · Wallpapers (keeps `#products` for the header link) |
| 2/23 | Removed: ProductGrid, PlatformShowcase (files kept); empty stat tiles hidden on the landing only |
| 21/42 | /downloads: small "Promote on Frenzsave" row |
| 28 | FAQ: "What is Frenz AI?", "Can I advertise on Frenzsave?" (FAQPage JSON-LD) |
| 32 | Footer: Frenz AI, Reels, Wallpapers; new Business column (Advertise, Advertising Rules) |
| 37 | Landing stays static (`○ /`): 2.81 → 2.98 kB route JS, 216 → 217 kB first load |

### Phase 2 — shipped (local commits, 2026-10-08)

| § | What |
|---|---|
| 12/43, 10/44 | /advertise: "Start Advertising", live placements + pricing from the catalog, creative minimums, FAQ (FAQPage JSON-LD), sign-in note before upload; choices kept across sign-in |
| 18 | Header: "Products" → **Frenz AI** (/ai), **Advertise** after Pricing; 49 catalogues; one row at 1024/1280 px. Menu: Frenz AI under Discover, new Business group |
| 34 | Discovery events (ai/reels/ai_reels/wallpapers/advertise clicks, application started/completed) through the batched `track` — one passive listener on `[data-track]` |
| 31 | Install card: offset now `5rem + safe-area-inset-bottom`; off `/advertise/create` and `/advertise/payment`. It mounts only in the (app) shell, so it never sits over the landing or /advertise CTAs; engagement gate + decline cap unchanged (not aggressive) |
| owner | Shortcut tray and Fast/Secure/Private pill removed; Promote card on landing + /downloads; credits strip on top of /downloads, small Earn button on the landing headline row; /quests explains what credits are for; every advertising button is tap-once with a pending look |

### §46/47 audit (2026-10-08, local production build, cold cache, no throttling)

| Page | Width | LCP | CLS | Requests | Own JS (wire) | Overflow-x |
|---|---|---|---|---|---|---|
| / | 390 | 0.79 s | 0.003 | 120 | 552 KB | 0 |
| / | 1280 | 0.86 s | 0.003 | 136 | 576 KB | 0 |
| /advertise | 390 | 0.38 s | 0.002 | 102 | 488 KB | 0 |
| /advertise | 1280 | 0.39 s | 0.002 | 119 | 525 KB | 0 |

- Landing stays static (`○ /`); first-load JS ≈ 217 kB. The rest of "own JS" is Next's idle-time viewport prefetch of the doors the page shows (/ai, /features, …) — not render-blocking, and it makes those taps instant.
- /downloads redirects guests to sign-in, so this guest run measured the sign-in screen; the signed-in page was not measured here (needs a session).
- Production adds third-party ad/analytics requests (§2 audit: 273 requests) — the ad slots were kept by owner decision.
