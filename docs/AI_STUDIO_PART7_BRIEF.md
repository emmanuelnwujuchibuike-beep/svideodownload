# FrenzSave AI — PART 7: Responsive, Performance & Production UX Perfection

> **Why this file exists.** The owner pasted this brief twice. The first copy was
> lost to a context compaction and nothing in the repo recorded it, so the work
> could not be audited against the owner's own words — only against a summary of
> them. It is checked in verbatim so that never happens again. **Do not edit the
> brief text below.** Record progress in the ledger, not by rewriting the ask.

Owner-supplied, 2026-10-04. Continues Parts 1–6. Part 6 delivered the premium,
light-first Glass UI; **Part 7 is not another visual redesign — it is the
production hardening pass.**

---

## STATUS LEDGER

`done` · `partial` · `open` · `n/a` — with the evidence, not an assertion.
Measurements are from an authenticated Playwright run against a **production
build** (`next build` + `next start`), 8 AI Studio routes × 6 widths.

> ⚠️ Two earlier audit runs were **discarded**: a concurrent rebuild replaced
> `.next` under the running server, so stylesheets 404'd and every geometry
> number came from an unstyled page. The probe now carries an integrity verdict
> per row (bad asset responses, MIME refusals, CSS-actually-applied) and a
> failing row contributes **no** findings. Any number below survived that gate.

| § | Area | Status | Evidence / note |
|---|---|---|---|
| 1 | Scan everything first | `done` | Repo + Parts 1–6 commits + live pages inspected before changes |
| 3 | Device matrix | `partial` | Measured 320/360/390/430/768/1280. **Not yet:** 375, 393, 412, 820, 1024, 1440, 1920 |
| 8 | Button reliability (double-tap) | `partial` | Double-submit guard verified in `use-video-generation.ts`; the historic dead-first-tap is a documented pre-hydration native form submit |
| 9 | Touch targets | `partial` | `language-selector` 26×44 → **44×44** (verified on build). Remaining: `Upgrade` 203×36, `Add a reference video` 168×32 |
| 23 | API request audit | `partial` | CSP tap found (below). `2× /api/streak` investigated → a GET + a POST, **by design, not a defect** |
| 25 | Capability caching | `open` | **Mine.** Peer confirms this is the remaining gap |
| 26 | User balance | `done` | `lib/ai/balance-cache.ts` + `lib/ai/entitlement-cache.ts` (2026-09-13); peer closed the complimentary pill via `lib/ai/free-access-cache.ts`. No polling loop |
| 28 | Double-submission protection | `done` | `idempotency-key.ts` + 7 tests; see below |
| 40 | Accessibility | `partial` | Account button had **no accessible name**, fixed. Header logo verified fine (`alt="Frenz"`) |
| 42 | Horizontal overflow | `done` | **No overflow at any width 320–1280.** Earlier "62px/22px" was the stale-server artifact — disproven, not merely retracted |
| 66 | Production build test | `done` | All measurement is against `next build` + `next start`, never dev |
| 72 | Automated testing | `done` | typecheck ✅ lint ✅ build ✅ **4691 tests passing** |
| 11,12,57 | **Glass performance** | `partial` | **Radius 24px → 8px** across the AI design system, pixel-diff verified indistinguishable (see THE GLASS BUDGET below). Guarded by `glass-cost.test.ts`. Still open: §57 fallback hierarchy for browsers without backdrop-filter |
| 4 | Orientation (landscape) | `open` | |
| 5 | Safe areas | `partial` | iOS 44px floor fixed + Android no longer inherits it (`e919280`) |
| 6,7 | Keyboard & focus | `open` | |
| 10 | Scroll performance | `open` | |
| 13,14 | Animation perf / reduced motion | `open` | |
| 15,16,17,18,19 | First render, lazy media, video, images, fonts | `open` | |
| 20,21,22 | Bundle, code splitting, feature-level loading | `open` | |
| 27,29,30 | Submission speed, uploads, client validation | `open` | |
| 31,32,33,34 | Error recovery, network resilience, leave-and-return, offline notification | `open` | |
| 35,36,37,38,39 | PWA, mobile Safari, Android Chrome, desktop Safari, fallbacks | `open` | |
| 41 | Large text 125/150/200% | `open` | |
| 43,44,45 | Layout shift, skeletons, skeleton cost | `open` | |
| 46,47,48 | Memory, media cleanup, listener audit | `partial` | **Audited 2026-10-05: no leaks found in `features/ai/**`.** Object URLs — every file that calls `createObjectURL` also revokes it, revokes >= creates (batch, workspace, lip-sync, ai-image-drop). Listeners — `addEventListener` == `removeEventListener` in all 13 files. Observers/timers — 3 files flagged by a grep for `clearInterval`, all FALSE POSITIVES: the `setInterval` hits are comments describing the OLD code and the files tear down with `clearTimeout`. Still open: §46 large blobs in React state, and runtime heap measurement across navigations |
| 24 | Quote request debouncing | `done` | **Already existed** — `QUOTE_DEBOUNCE_MS = 400` in `use-video-generation.ts`. Verify only, do not change |
| 49 | Polling | `done` | **Peer session, do not redo.** `active-generation.ts` (`3cacc99`): the AI video poll was `setInterval` 3s for the whole job and fired while hidden; now 5s→10s→15s with the timer *cancelled* on hide. ~40 → ~14 requests per 2-min generation. `features/admin/live/scheduler.ts` audited and already correct (one shared timer, tiered, backoff, hard stop on hidden, 11 cost-safety tests). `ai-job-alert.tsx` already correct |
| 50,51,52 | History, result page, download path | `open` | |
| 53,54,68 | Network observability, credential exposure, provider isolation | `open` | |
| 55,56 | SEO safety, PWA cache safety | `open` | |
| 58,59 | Responsive grid, long text | `open` | |
| 60,61 | State matrix, feature-unavailable state | `open` | |
| 62,63 | Billing UX, authentication regression | `open` | |
| 64 | Final performance targets (LCP/FCP/CLS/INP) | `open` | |
| 65 | Real-device testing | `blocked` | Needs the owner's physical iPhone/Android. LAN preview is `http://`, so **no service worker / PWA install** off-localhost |
| 73 | Final report | `open` | Produced once the above close |

### Landed under Part 7 so far — commit `62a0f61`

Each fix carries a test whose teeth were verified by regressing the
implementation and watching it fail, then restoring.

1. **CSP report-only was a per-pageview billing tap.** Its `script-src` omits
   `https:` by design while the ad loader runs third-party script, so it was
   violated *by design* on every ad-bearing page load. Measured **14 POSTs per
   page load, 547 per audit run**, every `blocked-uri` a Google/AdSense origin;
   each is one Vercel invocation + one Observability event. Now behind
   `CSP_REPORT_URI` (default off). **After: 547 → 0.** Enforcing policy
   untouched — removing a report-only header changes no enforcement.
2. **`recordStreakActivity` POSTed on every page open** for a once-a-day fact.
   Gated to once/day/device, failing **open** on every uncertain case.
3. **§28 — a false idempotency promise in the money path.** The client minted a
   fresh `clientRequestId` per submit under a comment promising a retry "reaches
   the SAME job rather than paying twice". The server half was already correct
   and *unreachable*: unique index on `(user_id, client_request_id)` (0141),
   conflict caught, existing job returned **uncharged**. The live risk is a lost
   reply (an origin 502 arrives as Cloudflare's HTML page), so a retry bought a
   second Kling video.
4. Two ISR treadmills (`/ai`, news sitemap) — `revalidate` 300 → event-driven.
5. §9 language tap target; §40 account-button accessible name; the fourth and
   last unguarded "faster processing" claim.

### Withdrawn, not fixed — they were never real

- 320/360 horizontal overflow, and 33 "tiny tap targets" — artifacts of an
  unstyled page served by a stale server.
- `2× /api/streak` — a GET and a POST. The probe counted by URL, not method.
- The 28×28 header logo "missing a label" — it carries `alt="Frenz"`; the
  geometry probe could not see `img alt`.

### Coordination

Peer session `svideodownload-eb` is working on the **PWA launch screen, Lip Sync
and ElevenLabs v4** — not this brief. Avoid
`features/ai/lip-sync/lip-sync-workspace.tsx`, `features/app-shell/boot-splash.tsx`,
`public/launch.html`, `public/splash/*` and `lib/ai/free-access-cache.ts`.

---

## THE GLASS BUDGET — applies to the NEXT design too

> Owner, 2026-10-05: *"a more premium glass ui image reference and prompt will
> be pasted soon, this performance should also take effect on it."*
>
> So this is written as a **budget the next design is built inside**, not as a
> patch to the current one. A redesign that re-breaks it is a regression even
> if it looks better.

**Measured on a production build, 390×844, authenticated** (`scripts/_p7-glass.tmp.mjs`):

| Page | Glass layers | Coverage | Nesting |
|---|---|---|---|
| `/ai/text-to-video` | 6 | 68% + 32% + 8% ≈ **108% of viewport** | none |
| `/ai/image-to-video` | 6 | 83% + 18% + 8% ≈ **109% of viewport** | none |
| `/ai`, `/ai/lip-sync` | 3 | ~0% (0×0 and 36×36) | none |

`/ai` additionally runs two `frenz-ai-drift` blobs at 43% and 52% of viewport
with `filter: blur(64px)`, 38.4s infinite. These animate **transform only** with
`will-change: transform`, so they rasterise once and move on the compositor —
the correct way to do it. **The video pages have no continuous animation at
all**, which is why the ambient wash was correctly ruled out as the overheating
cause earlier.

### The rules

1. **Blur radius ≤ 8px** on any AI design surface. Enforced by
   `features/ai/design/glass-cost.test.ts`, with teeth.
   Evidence — pixel-diffed against the 24px baseline, share of pixels
   differing by >8/255:
   `16px → 0.20%` · `12px → 0.27%` · `8px → 0.16%` (all noise) ·
   `4px → 1.9%` · `0px → 2.2%` (visibly different).
   The visible contribution **saturates at 8px**, because the fill is
   `bg-white/70` and what shows through is a low-frequency gradient. 24px was
   three times the kernel for nothing.
2. **Do not nest glass.** Current nesting depth is 0 everywhere. A glass layer
   over a glass layer re-blurs an already-blurred surface, so two small nested
   layers can cost more than one large flat one.
3. **Never animate `backdrop-filter`, `filter`, `width/height/top/left` or
   `box-shadow`.** A moving glass layer re-blurs every frame — that is what
   turns a static cost into a hot phone. Animate `transform`/`opacity` only,
   and promote with `will-change: transform`.
4. **Total on-screen glass coverage should not exceed ~1 viewport.** The video
   pages sit just over it today purely because the content card is the page; a
   new design adding decorative panels on top of that is the thing to refuse.
5. **Settle appearance disputes with the pixel diff, not the eye.**
   `scripts/_p7-glass-diff.tmp.mjs` sweeps radii and reports mean/max/%>8. Any
   request for a wider blur should come with a number from it.

### How to apply it to the new reference

When the premium glass reference lands: build it, then re-run
`_p7-glass.tmp.mjs` for the layer/coverage inventory and `_p7-glass-diff.tmp.mjs`
to find the smallest radius that is indistinguishable **for that design** — the
8px floor was derived from `bg-white/70` over the current wash, and a different
fill opacity or a busier backdrop moves it. Then set the cap in
`glass-cost.test.ts` to whatever the measurement supports, and write the number
down here. The method survives the redesign; the specific 8px may not.

---

# THE BRIEF (verbatim, owner-supplied)

You are continuing FrenzSave AI after Parts 1–6.

Part 6 transformed AI Studio into the new premium, professional, light-first Glass UI.

Part 7 is NOT another visual redesign.

This is the production hardening pass.

The objective is to make the new AI Studio feel:

* extremely responsive
* fast
* stable
* polished
* reliable
* smooth
* lightweight
* responsive across devices
* resistant to real-world network/device conditions

The final result must preserve the premium visual quality from Part 6 while ensuring the interface does not become slow, heavy, fragile, or unreliable.

## 1. SCAN EVERYTHING FIRST

Before modifying anything:

1. Scan the current repository.
2. Read Parts 1–6 implementation/commits.
3. Inspect the current AI Studio pages.
4. Inspect all AI Studio components.
5. Inspect shared UI components.
6. Inspect global CSS/design tokens.
7. Inspect image/video loading.
8. Inspect client-side data fetching.
9. Inspect API calls triggered by AI Studio.
10. Inspect generation submission flow.
11. Inspect quote/pricing requests.
12. Inspect polling/subscription mechanisms.
13. Inspect upload handling.
14. Inspect modals/sheets.
15. Inspect animation implementation.
16. Inspect mobile breakpoints.
17. Inspect PWA behavior.
18. Inspect service-worker interactions.
19. Inspect existing performance optimizations.

Do not begin by rewriting everything. Identify actual bottlenecks first.

## 2. CORE PRINCIPLE

The target is: Premium UI without premium-level performance cost.

Do not trade speed for visual effects, or reliability for animation, or accessibility for aesthetic appearance.

## 3. DEVICE MATRIX

Small mobile: 320px, 360px, 375px
Common mobile: 390px, 393px, 412px, 430px
Tablet: 768px, 820px, 1024px
Desktop: 1280px, 1440px, 1920px

Do not assume that a layout that works at 390px automatically works at 360px.

## 4. ORIENTATION

Test portrait and landscape, especially on mobile and tablet.

Check: upload components, generation controls, bottom sheets, preview areas, sticky controls, modals, navigation.

No important control should become inaccessible in landscape.

## 5. SAFE AREAS

Verify mobile safe-area handling: iPhone Dynamic Island, status bar, home indicator, bottom sheets, sticky Generate buttons, fullscreen media.

Do not let content hide behind system status areas, browser controls, or the home indicator. Use safe-area insets appropriately.

## 6. KEYBOARD BEHAVIOR

Test every text-input flow with the mobile keyboard open. Especially: Text-to-Video prompt, negative prompt, naming fields, voice-related inputs, search, settings.

Verify: keyboard does not cover the active field; Generate remains reachable; bottom sheets resize correctly; focus remains stable; keyboard dismissal works; page does not jump unexpectedly.

## 7. INPUT FOCUS BUGS

Audit for: accidental blur, immediate refocus, input losing text, keyboard opening unexpectedly, modal stealing focus, nested form state resets.

Do not add arbitrary delays to hide focus bugs. Fix the underlying component/state issue.

## 8. BUTTON RELIABILITY

Audit the previous issue where some buttons may require two taps. Every important action must work with one deliberate tap.

Test: Generate, Upload, Back, Close, Settings, dropdowns, tabs, feature cards, media controls, download, save, retry.

Investigate: overlays, pointer-events, event propagation, disabled states, hydration, focus layers, transparent elements, animation layers.

Do not solve double-tap problems by increasing debounce delays unnecessarily.

## 9. TOUCH TARGETS

Every touch target must be comfortable. Especially on mobile: Generate, Upload, Back, Close, dropdown, segmented controls, play/pause, fullscreen, download.

Avoid tiny icon-only controls.

## 10. SCROLL PERFORMANCE

Audit all scrollable AI Studio areas. Scrolling should remain smooth on low-memory Android, older iPhones, mobile Safari, Chrome Android.

Avoid: unnecessary scroll listeners, expensive layout calculations, large fixed blur layers, repeated React state updates during scrolling, huge DOM trees.

Use passive listeners where appropriate.

## 11. GLASS PERFORMANCE

This is critical.

Audit every `backdrop-filter`, `filter`, `blur`, `box-shadow`, `gradient`, `opacity`, `transform` used by the new Glass UI. Identify expensive combinations.

Do NOT remove the premium appearance unnecessarily. Instead optimize it.

Prefer: smaller blur regions, fewer nested glass surfaces, static background effects, compositor-friendly transforms, restrained shadows.

Avoid full-page continuous blur effects.

## 12. NO CONTINUOUS EXPENSIVE ANIMATION

Do not keep large elements continuously animating.

Avoid: infinite animated gradients, large blur animations, constant floating blobs, animated shadows, animated filters, unnecessary parallax.

If ambient animation exists, keep it subtle, low-frequency, GPU-friendly, optional, and disabled under reduced motion.

## 13. ANIMATION PERFORMANCE

Prefer animations based on `transform` and `opacity`.

Avoid animating `width`, `height`, `top`, `left`, `box-shadow`, `filter`, `backdrop-filter` unless there is a clear reason.

Keep transitions short and responsive. The UI should feel immediate.

## 14. REDUCED MOTION

Verify `prefers-reduced-motion` actually works. When enabled: stop decorative movement, simplify transitions, avoid parallax, avoid large scaling, keep essential state changes understandable.

## 15. FIRST RENDER

Optimize the first AI Studio render. Do not load everything immediately.

Initial render should prioritize: page shell, title, primary navigation, visible feature cards, critical controls.

Defer: offscreen media, non-visible tool previews, heavy secondary components, history, optional metadata.

## 16. LAZY LOAD MEDIA

Do not load every AI feature preview at once. Use lazy loading, responsive image sizes, thumbnails, poster images, appropriate compression.

Only load high-resolution media when needed.

## 17. VIDEO PREVIEW OPTIMIZATION

Video previews can become a major performance problem. Do not autoplay many videos simultaneously.

Prefer: poster → user interaction → video playback.

If autoplay is genuinely required: mute where appropriate, use short previews, limit simultaneous playback, pause offscreen videos. Use IntersectionObserver where appropriate.

## 18. IMAGE OPTIMIZATION

Audit all AI Studio images. Verify correct dimensions, modern formats where supported, no unnecessarily huge source image, responsive srcset, lazy loading, proper caching.

Do not load a 3000px image into a 300px card.

## 19. FONT PERFORMANCE

Audit fonts. Avoid loading unnecessary font weights. Only load the weights actually used. Avoid blocking the entire UI waiting for decorative fonts. The interface must remain readable while fonts load.

## 20. JAVASCRIPT BUNDLE

Inspect the AI Studio client bundle. Identify large dependencies, duplicate libraries, unused packages, heavy animation libraries, unnecessary UI libraries, large icon packages.

Do not automatically remove dependencies without checking repository-wide usage.

If a package is only used for one small effect and can be replaced with lightweight native/CSS behavior, consider removing it.

## 21. CODE SPLITTING

Lazy-load heavy AI-specific pages/components where appropriate.

AI Studio landing should not necessarily load the entire implementation of every generation form, every video preview, every history component, every advanced settings system, until required.

## 22. FEATURE-LEVEL LOADING

Opening one AI feature should not load every other feature's heavy code.

Opening Text-to-Video should not eagerly initialize Reference Video, Full Character, Lip Sync, Voice Cloning, or unrelated media components.

Keep feature boundaries meaningful.

## 23. API REQUEST AUDIT

Inspect every network request made by AI Studio. Identify duplicate requests, unnecessary requests, requests triggered repeatedly by rerenders, by hover, by focus, by navigation.

Particularly inspect: capability loading, pricing/quote loading, user balance, subscription status, history, job status.

Do not allow unnecessary request loops.

## 24. QUOTE REQUESTS

Pricing should update intelligently. Do not call the quote API on every keystroke unless absolutely necessary.

Typing `Hello world` should not produce a network quote request per character.

Use appropriate debouncing or update only when billable settings change.

## 25. CAPABILITY CACHING

The frontend should not repeatedly fetch identical capability information. Use appropriate caching/revalidation.

Capabilities should remain synchronized with the backend without generating unnecessary network traffic.

## 26. USER BALANCE

Do not repeatedly fetch the user's balance unnecessarily. After a successful charge: update local state appropriately, invalidate/revalidate authoritative data when needed.

Do not create polling loops simply to keep the balance display current.

## 27. GENERATION SUBMISSION

Generation submission must be fast. The UI should: tap Generate → immediate visual response → submit → receive job ID → show processing.

Do not wait for the final video. Do not hold the request open unnecessarily.

## 28. DOUBLE-SUBMISSION PROTECTION

Prevent accidental duplicate generation. After a successful submission: Generate → Generating…

The same action must not submit twice because the user tapped rapidly. But do not permanently disable the button if the request failed before submission.

Handle states correctly: idle, submitting, submitted, failed, completed.

## 29. UPLOAD PERFORMANCE

Audit uploads. For large media: show immediate feedback, show progress when available, avoid freezing the UI, validate before expensive upload, avoid duplicate uploads, support cancellation where already architecturally appropriate.

Do not upload the same file repeatedly because of React rerenders.

## 30. CLIENT-SIDE VALIDATION

Validate obvious errors before network submission: missing required input, unsupported file type, obvious file-size violation, missing reference, invalid duration.

But the server remains authoritative. Never treat frontend validation as security.

## 31. ERROR RECOVERY

Test: offline during submission, slow network, timeout, server error, Kling error, upload failure, quote failure, session expiration.

The UI must recover gracefully. Do not leave the user stuck on `Generating...` forever.

## 32. NETWORK RESILIENCE

Test on fast Wi-Fi, normal mobile network, slow 4G, unstable connection. Do not assume a perfect connection.

Long-running AI jobs must remain server-side. The UI should not depend on an uninterrupted connection for the job to finish.

## 33. LEAVE-AND-RETURN FLOW

Test: start generation → leave AI Studio → close/reopen page → return to AI Studio.

The user should be able to understand job status, completed result, failed result, without starting another generation.

Use the existing backend job state. Do not duplicate job state only in React memory.

## 34. OFFLINE NOTIFICATION FLOW

Verify the existing offline completion notification: Generate → close app/browser → Kling completes → push notification → tap notification → result page.

Do not replace the existing notification system.

## 35. PWA

Verify the redesigned AI Studio works correctly as a browser website and as an installed PWA.

Check: viewport, safe area, navigation, back behavior, media playback, push notification routing, standalone display mode.

## 36. MOBILE SAFARI

Explicitly test mobile Safari behavior: viewport height, 100vh, dynamic browser bars, keyboard, backdrop filters, fixed elements, bottom sheets, video fullscreen, file picker, safe areas.

Avoid relying blindly on 100vh. Use modern viewport units where appropriate.

## 37. ANDROID CHROME

Test Android Chrome: file picker, keyboard, media playback, scrolling, sticky controls, PWA mode, back navigation.

## 38. DESKTOP SAFARI

Verify the glass UI and media components on Safari desktop: backdrop-filter, video playback, file input, sticky layouts, CSS compatibility.

Provide graceful fallbacks where required.

## 39. BROWSER FALLBACKS

If a browser has limited glass support, do not let the interface become broken.

Fallback: glass → translucent solid surface → border → shadow.

The design must remain premium without requiring every browser to support every effect.

## 40. ACCESSIBILITY PERFORMANCE

Ensure accessibility does not regress. Check keyboard navigation, screen readers, focus, labels, contrast, reduced motion, zoom, text scaling.

Test at increased browser text size. No content should disappear because text becomes larger.

## 41. LARGE TEXT / ACCESSIBILITY ZOOM

Test 125%, 150%, 200%.

Verify buttons remain usable, cards do not overlap, text does not clip, modals remain accessible, Generate remains visible.

## 42. HORIZONTAL OVERFLOW

There must be no accidental horizontal scrolling. Test every major screen at 320px, 360px, 390px.

Look for oversized cards, fixed widths, long labels, code-like values, pricing, buttons, media.

Fix the root cause rather than hiding overflow globally. Do NOT blindly use `overflow-x: hidden;` to conceal layout bugs.

## 43. LAYOUT SHIFT

Audit CLS sources: images without dimensions, videos without reserved space, fonts, dynamic pricing, loading cards, modal insertion, asynchronous capability loading.

Reserve space appropriately. The page should not jump when content arrives.

## 44. LOADING SKELETONS

Skeletons should match the eventual layout. Do not use a generic full-screen spinner for everything.

Feature grid: card skeletons. Media: reserved media box. Settings: field skeleton.

## 45. SKELETON PERFORMANCE

Do not create dozens of animated skeletons. Keep them lightweight. Avoid expensive shimmer gradients across the entire page. A simple subtle pulse is sufficient.

## 46. MEMORY USAGE

Audit AI Studio memory usage, especially video previews, large images, modal stacks, history lists, cached media, React state containing large blobs.

Do not store large media files in React state if unnecessary. Use object URLs responsibly and revoke them when appropriate.

## 47. MEDIA CLEANUP

When leaving a feature: stop unnecessary video playback, release object URLs, remove listeners, cancel obsolete requests, clean timers, disconnect observers.

Avoid memory leaks.

## 48. EVENT LISTENER AUDIT

Check all window listeners, document listeners, resize observers, intersection observers, keyboard listeners, media listeners.

Every listener created by a component must be properly cleaned up.

## 49. POLLING

If AI job status uses polling anywhere: use appropriate intervals, stop polling when completed, stop polling when failed, stop polling when the page is hidden if appropriate, avoid multiple polling loops for the same job.

Prefer existing webhook/backend state architecture where possible. Do not create frontend polling that duplicates server responsibilities.

## 50. HISTORY

If AI Studio has recent creations/history, do not load an unlimited number of records.

Use pagination, cursor loading, virtualization where genuinely necessary. Lazy-load thumbnails. Do not download full videos for history cards.

## 51. RESULT PAGE PERFORMANCE

The completed result should open quickly. Prefer poster/thumbnail → metadata → video load on demand, rather than downloading unnecessary media immediately.

## 52. DOWNLOAD PERFORMANCE

Downloading a completed video should not accidentally route through a heavy frontend memory buffer if the existing architecture supports a direct/efficient download path.

Do not unnecessarily do server → browser memory → Blob → duplicate Blob → download for large videos.

Preserve the most efficient existing architecture.

## 53. NETWORK REQUEST OBSERVABILITY

During testing, inspect the network tab. Look for duplicate requests, unexpected provider calls, Replicate requests, fal.ai requests, repeated capability requests, repeated quote requests, unnecessary media requests.

For production video generation: there must be no browser-side direct calls to Replicate/fal/Kling credentials.

## 54. SECURITY REGRESSION

Verify the UI redesign does not expose the Kling API key, ElevenLabs API key, service-role credentials, internal worker credentials, or provider secrets.

Inspect built client output where appropriate.

## 55. SEO / PUBLIC PAGE SAFETY

AI Studio remains an authenticated product area according to the existing FrenzSave architecture.

Do not accidentally make private AI generation pages publicly indexable. Do not add unnecessary AI-heavy public landing content as part of this task. Preserve the existing SEO/AdSense strategy.

## 56. PWA CACHE SAFETY

Do not cache private AI results or sensitive user-specific data in an unsafe way. Review service-worker changes. Do not blindly cache authenticated API responses.

## 57. GLASS UI FALLBACK

Create a graceful fallback hierarchy: Full Glass → Reduced Glass → Translucent Surface → Solid Surface, depending on browser support, performance, and reduced-motion/preferences where relevant.

The UI should remain visually coherent.

## 58. RESPONSIVE GRID QA

Verify that cards never become too narrow, too tall, unreadable, uneven, or clipped.

Test feature descriptions of different lengths. The layout should remain stable if a feature name or description changes.

## 59. LONG TEXT QA

Test very long prompts, long feature names, long error messages, long pricing text, long filenames.

Nothing should break the layout. Text should wrap naturally.

## 60. EMPTY / ERROR / LOADING / SUCCESS MATRIX

Every major AI Studio screen must support: Empty, Loading, Ready, Submitting, Processing, Success, Error, Unavailable.

Do not design only the happy path.

## 61. FEATURE UNAVAILABLE STATE

If a Kling capability is unavailable, show a professional state such as:

> Currently unavailable
> This feature isn't available right now.
> Please try another AI tool.

Do not show `Provider: Replicate`. Do not offer a hidden provider fallback.

## 62. BILLING UX REGRESSION

Test: No balance, Low balance, Enough balance, Subscription active, Subscription exhausted, PAYG available, Generation failure, Generation success.

Verify the UI accurately communicates the funding source and cost.

Do not double-charge. Do not visually deduct credits before the backend confirms the transaction unless the existing architecture explicitly uses a reservation model.

## 63. AUTHENTICATION REGRESSION

Test logged out, logged in, expired session, newly authenticated, session restored.

AI Studio must respect the existing access rules. Do not accidentally expose authenticated generation functionality to anonymous users.

## 64. FINAL PERFORMANCE TARGETS

Do not invent artificial numbers that conflict with the existing FrenzSave architecture.

Instead measure: LCP, FCP, CLS, INP, JS bundle size, initial network payload, image payload, video payload, number of requests, memory behavior.

Compare against the pre-Part-6 baseline. The redesign should not introduce a meaningful regression. Where practical, improve the baseline.

## 65. REAL-DEVICE TESTING

Do not rely only on desktop browser resizing. Test on actual iPhone, Android phone, tablet if available.

Especially test touch, keyboard, upload, video, PWA, notification, scrolling, glass effects.

## 66. PRODUCTION BUILD TEST

Run the actual production build. Do not rely only on development mode.

Development rendering can hide bundle problems, hydration problems, performance issues, production CSS behavior, asset-loading problems.

## 67. BROWSER CONSOLE

Final AI Studio should not produce new React errors, hydration errors, unhandled promise rejections, failed resource warnings, repeated state-update warnings, or accessibility errors.

Existing unrelated warnings may be documented, but newly introduced errors must be fixed.

## 68. NETWORK CONSOLE

Final production flow must not show unexpected calls to Replicate, fal.ai, or unknown video providers.

Kling video calls must remain server-side through the established architecture. ElevenLabs existing direct features must remain server-side.

## 69. NO BACKEND REWRITE

Part 7 is not permission to rewrite the AI backend. Only make backend changes if required to fix a genuine frontend production issue.

Prefer fixing frontend rendering, request behavior, caching, loading, state management, media handling, rather than modifying stable backend systems unnecessarily.

## 70. NO DESIGN REGRESSION

Do not "optimize" the interface by removing the premium visual identity.

The final balance should be Premium + Glass + Native feeling + Fast + Lightweight + Accessible — not fast but visually plain.

## 71. FINAL USER FLOW TEST

Perform this complete flow:

Open Frenz AI → Choose Text-to-Video → Enter prompt → Choose settings → View accurate price → Tap Generate once → Immediate feedback → Job submitted → Leave page → Kling processes independently → Completion notification → Return to Frenz AI → Open result → Play video → Download/save

Repeat the relevant flow for: Image-to-Video, Reference Image, Reference Video, Full Character, Lip Sync, Text-to-Audio, Voice Cloning.

## 72. REQUIRED AUTOMATED TESTING

Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`.

Add/execute relevant tests for responsive behavior, component states, generation submission, duplicate submission protection, quote updates, capability loading, error recovery, media cleanup, provider isolation, authentication, billing states.

## 73. FINAL REPORT

At completion, provide:

- **A. Performance comparison** — before vs after where measurable: LCP, FCP, CLS, INP, bundle size, request count, media payload.
- **B. Responsive testing** — tested widths/devices.
- **C. Browser testing** — iOS Safari, Android Chrome, desktop Chrome, desktop Safari, other browsers tested.
- **D. Glass optimization** — how glass effects were kept premium without excessive rendering cost.
- **E. Media optimization** — image/video loading strategy.
- **F. Memory** — any memory-leak fixes.
- **G. Interaction fixes** — especially confirm whether the previous double-tap/button issues were identified and fixed.
- **H. Network** — confirm no unexpected provider calls.
- **I. Billing** — confirm no duplicate charges.
- **J. Notifications** — confirm offline completion notifications still work.
- **K. Remaining issues** — anything that could not be verified locally.

## 74. ABSOLUTE NON-NEGOTIABLES

1. Do not undo the Part 6 premium design.
2. Do not make the UI visually plain just to improve speed.
3. Do not allow the UI to become slow because of glass effects.
4. Do not introduce heavy unnecessary dependencies.
5. Do not load all AI media immediately.
6. Do not autoplay many videos simultaneously.
7. Do not create request loops.
8. Do not create duplicate quote requests.
9. Do not allow duplicate generation submissions.
10. Do not leave stale polling running.
11. Do not leak memory through media/object URLs/listeners.
12. Do not let the keyboard cover critical controls.
13. Do not allow horizontal overflow.
14. Do not allow layout shifts where avoidable.
15. Do not break mobile Safari.
16. Do not break Android Chrome.
17. Do not break PWA mode.
18. Do not break offline notifications.
19. Do not expose provider credentials.
20. Do not make browser-side video-provider requests.
21. Do not reintroduce Replicate.
22. Do not reintroduce fal.ai.
23. Do not introduce another video provider.
24. Do not modify stable backend architecture unnecessarily.
25. Do not break Kling's independent feature pipelines.
26. Do not break existing ElevenLabs Text-to-Audio.
27. Do not break existing ElevenLabs Voice Cloning.
28. Do not break PAYG.
29. Do not break subscriptions.
30. Do not double-charge users.
31. Do not hide unsupported capabilities.
32. Do not sacrifice accessibility.
33. Do not sacrifice performance.
34. Do not declare completion without production-build testing.

The final AI Studio should feel like a premium native creative application that happens to run on the web/PWA — visually sophisticated, extremely responsive, understandable, and reliable under real-world conditions.
