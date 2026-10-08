# Advertising Platform — Part 5 brief (owner, 2026-10-08)

Saved verbatim so it survives sessions. Ledger at the end.

---

You are continuing the Frenzsave Advertising Platform implementation.

Parts 1–4 already exist:
1. Ads Engine + Database Foundation
2. Advertiser Application + Campaign Creation
3. Bachs + Paystack Payment Integration
4. Landing + Download + Public Advertise Experience

DO NOT rebuild those systems.

Your task is PART 5:
FRENZSAVE AD SERVING + ROTATION + DELIVERY ENGINE.

## 0. FIRST: AUDIT BEFORE CHANGING ANYTHING

Before writing code:

- Inspect the existing Ads Engine/database.
- Inspect campaign, creative, placement, duration, pricing and validation models.
- Inspect payment verification and campaign activation.
- Inspect Landing, Download, Feed, Reels, Stories, AI pages, AI Reels and Download Result.
- Inspect existing media/storage architecture.
- Inspect Supabase Storage usage.
- Inspect existing analytics/event infrastructure.
- Inspect authentication and anonymous-user handling.
- Inspect existing caching utilities.
- Inspect existing API/server functions.
- Inspect existing ad components if any.
- Inspect service worker/PWA behavior.
- Inspect existing performance optimizations.

Create an internal implementation plan based on the actual codebase.

Reuse existing infrastructure wherever possible.

DO NOT create duplicate:
- ad databases
- payment systems
- campaign systems
- analytics systems
- storage systems
- authentication systems
- user/session systems
- configuration systems

## 1. CORE ARCHITECTURE

Build the ad serving system as a lightweight client-delivery layer backed primarily by Supabase.

The architecture should be:

Admin configuration → Supabase → Eligible Ad Selection → Lightweight Cached Ad Payload → Browser Ad Renderer → Client-side Rotation → Batched Analytics

Do NOT create a permanent ad server just to rotate ads.

Do NOT make the browser request a new ad every 5 seconds.

Do NOT send every rotation through Vercel/Railway.

Do NOT use a server-side timer for ad rotation.

The browser should receive a small eligible-ad pool and rotate locally.

## 2. CENTRAL ELIGIBILITY ENGINE

Create/reuse a single authoritative eligibility function:

getEligibleAds({ placement, format, page, userContext })

This must be the central mechanism for determining which advertisements may be displayed.

Eligibility must verify:

- campaign is active
- payment is verified
- campaign passed automated validation
- campaign is within start/end time
- campaign has not expired
- campaign has not been paused
- campaign has not been removed
- creative is valid
- creative is approved/validated
- format is enabled
- placement is enabled
- campaign has permission for that placement
- applicable targeting rules
- frequency caps
- applicable geographic/user targeting
- campaign-level restrictions
- global advertising disable switch

Never trust client-provided campaign status.

The client may request: "give me ads for AI_REELS" but the server/database configuration determines what is actually eligible.

## 3. REQUIRED AD FORMATS

Support the existing Frenzsave formats:

TOP_BANNER, CONTENT_BANNER, DOWNLOAD_RESULT_BANNER, INTERSTITIAL, DOWNLOAD_COMPLETED_INTERSTITIAL, REWARD_VIDEO

Do not hard-code pricing.

Do not hard-code campaign duration.

Do not hard-code promotion rules.

Those belong to the Admin-controlled Ads configuration from Parts 1–3.

## 4. REQUIRED PLACEMENTS

Support these placements:

- Global Top Banner
- Feed
- Reels
- AI Pages
- AI Reels
- Stories
- Download
- Download Result
- Interstitial
- Download Completed
- AI Video Save Reward

The placement/format combinations must come from Admin configuration.

Do not assume every format is valid everywhere.

For example:

TOP_BANNER → global header area
CONTENT_BANNER → configured content locations
DOWNLOAD_RESULT_BANNER → Download Result page
INTERSTITIAL → configured interstitial events
DOWNLOAD_COMPLETED_INTERSTITIAL → after completed download
REWARD_VIDEO → AI video save flow

## 5. TOP BANNER

Implement the existing Frenzsave top advertising placement exactly as specified:

- height: 32px
- directly below the header
- available across Frenzsave pages where Admin enables it
- includes AI pages
- lightweight
- asynchronous
- must not block page rendering

Default rotation pool: 10 eligible ad slots.

Rotation interval: 5 seconds.

IMPORTANT:

The 5-second interval is ONLY creative rotation.

It is NOT a campaign duration.

It is NOT a database polling interval.

It is NOT a server request interval.

It is NOT a payment duration.

Example:

Browser receives: [ ad1, ad2, ad3, ... ad10 ]

Then locally:

0s → ad1
5s → ad2
10s → ad3
15s → ad4

etc.

No network request should occur simply because the 5-second timer fired.

## 6. TOP BANNER PERFORMANCE

The top banner must never:

- block LCP
- block AI page loading
- block Download page interaction
- delay navigation
- create layout instability
- download all large creatives immediately
- initialize heavy advertising JavaScript before needed

The banner container must have reserved dimensions.

Load the ad system asynchronously after the main page becomes usable.

Prefer:

- small metadata payload
- cached eligibility
- CDN/Supabase Storage media
- lazy image loading where appropriate
- preloading only the next creative when useful

Do not preload 10 large videos/images.

For image ads, only fetch what is necessary.

For video ads, do not download the entire campaign pool.

## 7. 320×200 CONTENT BANNER

Support the 320×200 banner placement:

- below the configured placeholder card
- lightweight
- responsive
- no layout shift
- async loading
- Admin-controlled eligibility

The system must support the 320×200 creative dimensions without forcing desktop users into a broken mobile layout.

Use the existing Frenzsave responsive design system.

Do not redesign the surrounding page.

## 8. DOWNLOAD RESULT BANNER

Support: 320×200 advertising placement on Download Result.

The advertisement should load only when the Download Result UI actually exists.

Do not initialize this ad on the initial Download page if it is not needed.

The download result itself must remain the primary interaction.

The ad must never interfere with:

- downloaded file availability
- save buttons
- result information
- navigation
- retry
- AI suggestions

## 9. INTERSTITIAL ENGINE

Implement: INTERSTITIAL with a default pool of up to 10 eligible ads.

Important:

Never show the exact same advertisement consecutively when another eligible advertisement exists.

Example:

ad1 → ad2 → ad7 → ad3 — Allowed.

ad1 → ad1 — Not allowed when other eligible ads exist.

Maintain lightweight client-side state: lastDisplayedAdId and preferably: recentlyDisplayedAdIds

Use this to reduce repetition.

Do not store excessive session history.

## 10. DOWNLOAD-COMPLETED INTERSTITIAL

Implement: DOWNLOAD_COMPLETED_INTERSTITIAL with the same 10-slot rotation principle.

It must appear only after the download completion event occurs.

Do not show it merely because the Download page opened.

Do not interfere with the actual download process.

The download should complete successfully before this advertising event is triggered.

Never allow the advertisement to prevent the user from receiving their completed download.

No consecutive duplicate advertisement when alternatives exist.

## 11. AI VIDEO SAVE REWARD VIDEO

Implement: REWARD_VIDEO for the AI video save flow.

There should be up to 10 eligible reward-video creatives.

Each save interaction can select the next eligible advertisement according to the configured rotation strategy.

The default behavior should rotate through the available pool instead of repeatedly showing the same advertisement.

IMPORTANT:

The reward-video creative has its own media-duration restriction.

Default maximum: 15 seconds.

Admin must be able to change this.

The serving engine must NEVER assume 15 seconds permanently.

Use the Admin-configured value.

Before serving a reward-video creative, verify: creative duration <= configured maximum

If it fails validation: do not serve it.

Do not allow the client to bypass the restriction.

## 12. REWARD VIDEO SEMANTICS

Do not invent a separate rewards system for advertisers.

The advertisement itself is simply the paid ad placement.

If the existing Frenzsave product has a user reward/unlock action associated with the AI video save flow, keep that existing product logic separate from advertiser campaign accounting.

The ad system must not grant AI credits simply because an advertiser's video was displayed unless such behavior is explicitly configured by the existing product.

Keep: advertiser campaign billing separate from Frenzsave user rewards/credits.

## 13. ROTATION ENGINE

Create one reusable rotation utility.

Example conceptual API:

createAdRotation({ ads, strategy, interval, avoidConsecutiveDuplicates })

Possible strategies: sequential, weighted, randomized, campaign-priority

But do not add unnecessary complexity if the current Ads Engine does not require it.

Default behavior should be predictable and lightweight.

For 10 ads: ad1 → ad2 → ad3 → ... → ad10 → ad1 or another deterministic/randomized strategy configured by the system.

The important rules are:

- no unnecessary server requests
- no immediate duplicate
- no broken/expired creative
- respect eligibility
- respect frequency caps

## 14. AD POOL CACHING

The eligible ad pool should be cached.

Use a short-lived cache appropriate to the placement.

Example conceptual behavior:

fetch eligible ads → cache result → render → rotate locally → refresh only when cache expires or page/context materially changes

Do NOT request ads every 5 seconds.

Do NOT request ads every time the user scrolls.

Do NOT request ads every time React/Vue/etc. re-renders.

Do NOT request ads every time a component mounts unnecessarily.

Prevent duplicate fetches caused by: Strict Mode, navigation transitions, component remounts, tab changes, modal opening, PWA lifecycle, React state updates

Use a shared ad-serving state/cache where appropriate.

## 15. SUPABASE-FIRST DELIVERY

Supabase should be the primary source for: active campaign state, eligible creative metadata, placement configuration, campaign targeting, campaign dates, ad status, creative validation state, frequency settings, analytics storage, advertiser campaign information

Do not route normal ad media through Railway.

Do not route large images/videos through Vercel functions.

Use Supabase Storage/CDN or the existing Frenzsave media infrastructure.

The browser should retrieve media directly from the appropriate CDN/storage URL where secure and appropriate.

## 16. MEDIA DELIVERY

Optimize media aggressively.

For images: use appropriate dimensions; use modern formats where supported; avoid unnecessarily huge files; provide thumbnails/posters where useful; lazy-load non-visible media

For videos: use optimized encoding; provide poster/thumbnail; avoid loading multiple videos simultaneously; preload only when justified; stop/pause videos when no longer visible; release media resources when no longer needed

Never download 10 full videos merely because 10 ads exist in the rotation pool.

The metadata pool can contain 10 ads while actual media loading remains lazy.

## 17. FEED / REELS / AI REELS

Ads must work correctly with the existing: Feed, Reels, AI Reels

Do not build a second feed system.

Reuse existing feed/video infrastructure.

Ads should integrate naturally without damaging the existing scrolling experience.

For video-heavy pages: only the visible/active video should play; ads should not create multiple simultaneous video decoders; pause/unload when offscreen; avoid excessive memory usage; avoid unnecessary media prefetching

Ads must not make AI Reels feel slower than normal Reels.

## 18. STORIES

Support advertising in Stories where enabled.

Use the existing Stories infrastructure.

Do not create a separate story renderer.

Respect existing: story timing, swipe/tap navigation, media loading, mute/sound behavior, lifecycle, cleanup

Ads must be treated as another configured story placement, not as a separate social product.

## 19. AI PAGES

Ads must blend with Frenz AI.

Do NOT make the AI interface look like a cheap advertising website.

Use the existing AI visual system: premium, minimal, clean, modern, white/light gray, blue/indigo/purple, restrained gradients, polished typography, subtle motion

Ads should remain visually distinct enough to be identified as advertising without destroying the AI product aesthetic.

Never allow an advertisement to dominate the AI generation interface.

## 20. ANONYMOUS + SIGNED-IN USERS

The ad system must support both: Anonymous users and Authenticated users.

Anonymous users can receive eligible public advertisements.

Signed-in users may receive advertisements based on their configured eligibility/targeting.

Never expose private user information to advertisers.

Do not send raw personal information to the client simply to perform targeting.

Use safe server-side eligibility decisions.

## 21. FREQUENCY CAPPING

Support frequency caps where configured.

Examples: maximum impressions per user/session; maximum impressions per campaign; maximum repeat frequency; cooldown period

Do not build complicated tracking if Admin has not configured a cap.

Use lightweight identifiers/state.

Avoid excessive database writes for every display.

Where possible: maintain lightweight client/session state; batch events; aggregate analytics; periodically sync meaningful events

## 22. IMPRESSION TRACKING

Implement reliable impression tracking without creating a database request for every visual frame or every 5-second rotation.

An impression should only be recorded when the advertisement meaningfully qualifies as displayed according to the configured impression rule.

For example: element becomes visible; minimum visibility threshold reached; minimum display duration reached

Use the simplest reliable rule consistent with the product.

Do not count: hidden ads; unloaded ads; failed creatives; offscreen ads; aborted renders

Batch impression events.

Example: browser collects: [ impression1, impression2, impression3 ] then sends them together.

Do not create: 1 request per impression.

## 23. CLICK TRACKING

Track advertisement clicks.

The click should contain enough information to identify: campaign; creative; placement; session/user context where allowed; timestamp

Do not expose internal/private advertiser information unnecessarily.

Destination URLs must already have passed the validation rules from Parts 1–3.

Never allow arbitrary client-provided destination URLs to bypass the validated campaign destination.

## 24. ANALYTICS BATCHING

Use batched analytics.

Events may include: impression, click, view, completion, skip, close, reward-video-start, reward-video-complete, interstitial-shown, creative-error

Only implement events that are actually needed.

Do not track useless events such as: every animation frame; every timer tick; every component render; every scroll pixel

Analytics must never become the main source of Vercel/Railway cost.

## 25. AD CREATIVE ERROR HANDLING

If an image/video fails:

1. mark the creative as failed for the current session
2. do not repeatedly retry it
3. move to the next eligible ad
4. continue the rotation
5. optionally queue an aggregated error event

Never show a broken image/video repeatedly.

Do not let one advertiser's broken creative break the entire ad system.

## 26. EMPTY INVENTORY

If no eligible ads exist:

DO NOT: repeatedly retry; poll continuously; display broken placeholders; create errors; block page content

Simply render nothing or the configured non-ad fallback.

The rest of Frenzsave must work perfectly with zero active advertisements.

This is extremely important.

## 27. GLOBAL ADS DISABLE

Support the emergency global advertising switch from the Ads Admin system.

If disabled: do not initialize unnecessary ad logic; do not request ad inventory; do not load advertising media; do not send unnecessary ad analytics

This should be checked through cached configuration.

## 28. PAGE LIFECYCLE

Ad components must correctly handle: route changes; component unmount; PWA background/foreground; browser tab visibility; iOS Safari; Android Chrome; desktop browsers

Clean up: timers; intervals; observers; event listeners; video elements; object URLs; pending requests; aborted fetches

Never leave a 5-second timer running after the ad component disappears.

Never leave videos playing in the background.

## 29. MOBILE/PWA OPTIMIZATION

Frenzsave is heavily mobile-oriented.

Optimize specifically for: iPhone Safari/PWA; Android Chrome; low-memory devices; slow Nigerian mobile networks; intermittent connections

Avoid: huge JS bundles; huge ad media; unnecessary preload; autoplay-heavy advertising; large DOM trees; aggressive polling; long blocking JavaScript

Ads must remain secondary to the core product.

## 30. VERCEL / RAILWAY COST PROTECTION

This is NON-NEGOTIABLE.

The advertising system must NOT unnecessarily consume:

Vercel: Fast Origin; Function invocations; server execution; bandwidth; observability events

Railway: memory; CPU; network; background process time

Avoid: request every 5 seconds; server-side rotation; persistent ad server; unnecessary API proxies; proxying large media; unnecessary realtime; per-impression server function calls; per-click server function calls if not necessary; loading all 10 videos; repeated eligibility queries; duplicate analytics writes

Prefer: Supabase + Storage/CDN + browser-side rotation + batched analytics + cached configuration.

## 31. SUPABASE REALTIME

Do NOT use Supabase Realtime for normal ad rotation.

Realtime should only be used if there is a genuine requirement for immediate admin-driven changes.

Even then, consider: short cache expiry; version/config number; manual refresh; visibility-based refresh

Do not maintain unnecessary Realtime subscriptions on every page.

## 32. TARGETING

If Part 1 supports targeting, integrate it into the central eligibility engine.

Possible targeting: placement; page; format; country/region; campaign dates; audience rules; device category; authenticated/anonymous state

But do not overbuild targeting.

Never expose sensitive personal information to advertisers.

Never trust client-provided country/device information when the server can determine it safely.

## 33. CAMPAIGN PRIORITY / FAIRNESS

Prevent one campaign from monopolizing all available impressions if multiple eligible campaigns exist.

Respect the campaign serving strategy configured by the Ads Engine.

Possible mechanisms: rotation; weighted rotation; campaign priority; even distribution

Do not hard-code a complex algorithm unless required.

The serving engine should remain predictable and inexpensive.

## 34. CAMPAIGN EXPIRATION

At serving time always verify: current time >= campaign start AND current time < campaign end

Expired campaigns must immediately stop being served.

Do not rely solely on a frontend countdown.

Do not continue serving an expired campaign because it remains in browser cache.

Cached inventory must contain enough information to reject expired campaigns locally where safe, while server eligibility remains authoritative.

## 35. SECURITY

Never allow the browser to decide: campaign is active; payment is successful; campaign is approved; campaign has valid duration; advertiser owns campaign; creative passed validation; campaign can be served

Never trust: campaign IDs supplied by the client.

The client should only consume safe serving data.

Apply appropriate Supabase RLS.

Keep advertiser-private information private.

Do not expose: payment details; internal validation information; private advertiser notes; admin data; internal fraud scores

## 36. ADS SHOULD NOT AFFECT CORE PRODUCT

If the ad system fails: Frenzsave must still work.

If: Supabase ad query fails; creative fails; analytics fails; tracking fails; one ad campaign is malformed; cache fails

then: Download still works. AI still works. Reels still works. Wallet still works. Payments still work.

Never make core product functionality depend on ad analytics succeeding.

Analytics should be fire-and-forget/best effort where appropriate.

## 37. ACCESSIBILITY

Advertising must be accessible.

Include: appropriate alt text; keyboard navigation where applicable; clear close controls; accessible labels; no seizure-inducing animation; no impossible-to-dismiss interstitial; reasonable focus management

Respect reduced-motion preferences.

Do not create inaccessible ad overlays.

## 38. INTERSTITIAL UX

Interstitials must feel premium and controlled.

They should: load asynchronously; have a clear close/dismiss behavior where configured; not trap users; not repeatedly appear immediately; respect frequency limits; avoid showing consecutively in a frustrating loop

Do not show an interstitial immediately on every navigation.

Use the configured trigger from the Ads system.

## 39. REWARD VIDEO UX

For the AI video save flow:

The user should understand what is happening.

Example conceptual state: "Watch a short ad to save your video"

Then: Preparing ad → Playing → Completed → Continue save

Handle: skip; close; failed playback; network failure; video completion; user leaving the page

Do not falsely report completion.

If the product requires video completion before unlocking save, enforce completion server/client-side according to the existing save flow.

Do not create a second credit system.

## 40. PERFORMANCE TARGETS

Target: LCP <= 1.6s where realistically achievable.

Also optimize: INP; CLS; TTFB; JS execution; memory; network requests; media decode; CPU; battery usage

Advertising must not materially degrade the existing Frenzsave performance.

Measure: WITH ads disabled versus WITH ads enabled.

The difference should be documented.

## 41. TESTING

Test at minimum:

TOP_BANNER — 10 ads; 5-second local rotation; no network request every 5 seconds
CONTENT_BANNER — correct placement; correct dimensions; lazy loading
DOWNLOAD_RESULT_BANNER — appears only on result; does not interfere with download
INTERSTITIAL — no consecutive duplicate; frequency cap; empty inventory
DOWNLOAD_COMPLETED_INTERSTITIAL — only after successful download; no duplicate
REWARD_VIDEO — 10-ad pool; rotation; duration validation; default 15-second maximum; Admin-configured maximum; failed creative fallback

Campaign states: active; paused; expired; blocked; removed

Payment: unpaid campaign never appears

Validation: invalid creative never appears

Expiration: expired campaign disappears

Global disable: all ads stop loading

Anonymous: public ads work

Authenticated: targeting works where configured

Failure: ad system failure does not break Frenzsave

## 42. PERFORMANCE TESTING

Test: iPhone Safari; iOS PWA; Android Chrome; desktop Chrome; slow 3G/4G; fast connection; low-memory device; Feed; Reels; AI Reels; AI pages; Download; Download Result

Measure: initial JS added by ads; additional network requests; media bytes; memory usage; CPU; LCP; INP; CLS; navigation time

Check specifically that: 5-second rotation does NOT generate repeated network requests.

## 43. DATABASE / QUERY PERFORMANCE

Review all ad eligibility queries.

Ensure appropriate indexes exist for commonly filtered fields such as: status; start_at; end_at; placement; format; validation status; campaign status; creative status

Do not repeatedly query large historical analytics tables when serving ads.

Serving queries should only touch the minimum required active configuration.

Never load entire campaign history to determine current ads.

## 44. OBSERVABILITY

Add useful operational visibility without excessive event volume.

Track aggregate metrics such as: eligible ads; served ads; creative failures; clicks; impressions; reward video completions; empty inventory; serving latency; cache hit/miss; serving errors

Do not log every rotation tick.

Do not log sensitive advertiser/user information.

## 45. ADMIN COMPATIBILITY

The serving engine must respect Admin changes without frontend deployment.

If Admin changes: ad format availability; placement availability; duration; campaign state; reward video max duration; targeting; frequency limits; global ad status

the serving layer should eventually reflect the change through the configured cache/refresh mechanism.

Do not require a new Vercel deployment for normal advertising configuration.

## 46. DO NOT BREAK EXISTING FRENZSAVE DESIGN

This is an integration task, not a visual rewrite.

Preserve the existing: Frenzsave brand; Frenz AI visual language; Download UI; Reels UI; Feed UI; AI pages; navigation; wallet; authentication; payment system

Ads should feel native to Frenzsave.

Especially on AI pages: DO NOT introduce cheap-looking ad widgets.

Use the existing design system.

## 47. FINAL IMPLEMENTATION AUDIT

Before finishing:

Review the entire implementation and answer:

1. Does the browser request ads every 5 seconds?
2. Does rotation happen client-side?
3. Are large videos unnecessarily proxied through Vercel/Railway?
4. Are Supabase queries indexed?
5. Are active campaigns the only campaigns served?
6. Can unpaid campaigns appear?
7. Can expired campaigns appear?
8. Can blocked creatives appear?
9. Can the same interstitial appear consecutively?
10. Can one broken creative break the ad system?
11. Does empty inventory work cleanly?
12. Does global disable stop unnecessary loading?
13. Are analytics batched?
14. Is Realtime avoided unless necessary?
15. Are timers and observers cleaned up?
16. Are videos paused/unloaded when not needed?
17. Does the system work for anonymous users?
18. Does it work for signed-in users?
19. Does it work on iOS PWA?
20. Does it work on Android?
21. Does it preserve the Frenz AI experience?
22. Does it avoid unnecessary Railway/Vercel cost?
23. Does it respect Admin-controlled configuration?
24. Does it preserve the existing payment/campaign architecture?
25. Does an ad failure leave the core product fully functional?

Then provide: files changed; database changes; APIs/functions added; components added; caching strategy; serving strategy; analytics strategy; performance impact; security considerations; tests performed; remaining risks; anything that should be handled in Part 6

IMPORTANT:

Do not stop at creating components.

Verify the complete serving flow from:

ACTIVE CAMPAIGN → ELIGIBLE CREATIVE → AD POOL → CACHE → CLIENT ROTATION → MEDIA DELIVERY → IMPRESSION → CLICK/COMPLETION → BATCHED ANALYTICS

The final implementation must be production-ready, lightweight, secure, scalable and consistent with the existing Frenzsave architecture.

---

## Ledger

| Item | State |
|---|---|
| Brief received | 2026-10-08 (owner: "Make sure you don't leave any behind") |
| §0 audit | not started |
