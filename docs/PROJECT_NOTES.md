# Frenzsave — Project Notes & Decisions

A durable, human‑readable record of the project's key decisions, conventions and
system knowledge. Mirrored from the working knowledge base so it's readable on
GitHub.

> **No secrets here.** API keys and tokens (Supabase `service_role`, Cloudflare R2
> secret, Paystack/Resend/VAPID private keys, etc.) live **only** in the
> gitignored `.env.local` and must never be committed. This file records what
> things are and why — never their secret values.

_Last updated: 2026‑07‑14 (batch 63 — owner's next round: wallpaper still fails to save, typing STILL isn't showing despite batch 62's fix, the options sheet still looks novice, the disappearing-messages notice didn't seem to persist, the header's "…" still overflowed on the x-axis, and — mid-turn — a purple flash top/bottom while scrolling the list. The headline finding: **the real typing bug was never the router.refresh() regression batch 62 fixed — it was a completely separate, previously-undiagnosed one.** Caught by capturing raw WebSocket frames (not just Playwright text assertions, which had been giving a false pass/fail both ways): the `typing:<conversationId>` presence channel is `private: true`, and Realtime Authorization requires a real JWT on its OWN join frame for `auth.uid()` to resolve inside the RLS policy. `use-typing.ts` created and subscribed this channel synchronously on mount, racing ahead of the Supabase client's own async session bootstrap on a fresh page load — the join went out with no `access_token` field at all (confirmed byte-for-byte against sibling channel joins in the same capture, which all had one) and the server rejected it outright: `"Unauthorized: You do not have permissions to read from this Channel topic"`. Every other channel in the app is non-private, so none of them were ever exposed to this race — typing was the only reachable case. Fixed by awaiting `supabase.auth.getSession()` once before the `.subscribe()` call; re-verified via the same frame capture (access_token now present, join replies `ok`) and an end-to-end screenshot of the actual "X is typing…" pill rendering live. Second real finding: dark-mode text that has no explicit color class of its own (a bare `<h1>`, a row's name span) inherits `color` from `<body>` as an already-COMPUTED value, not a live reference to the CSS variable — so last round's `FORCE_LIGHT_VARS` object, which only overrode the custom properties, never reached anything relying on plain inheritance; fixed by having the override also set `color` explicitly, which every unclassed descendant then inherits correctly. The SAME gap, independently, was breaking the header's new dropdown menu (see below) and its Presence/Notification sub-popovers. Third: "the dotted menu… still opens on the x-axis" was never `ThreadOptionsSheet` (already y-axis, fixed correctly last round) — it's `InboxHeaderActions`'s own "…" toggle, which revealed 4 more tools INLINE via an `x: 12 → 0` slide, wide enough to overflow a narrow header; rebuilt as a real portaled dropdown that opens downward, with Search/Status/Sounds re-styled as vertical menu rows instead of bare icon circles. Fourth: the mobile list's `overflow-y-auto` scroller had no outer clipping wrapper, so an iOS rubber-band bounce past either edge could reveal `app/layout.tsx`'s fixed ambient gradient behind the page — split into an outer `overflow-hidden` white box + inner `overflow-y-auto overscroll-y-none` scroller (the exact "overflow-y hidden but still scrollable" the owner asked for), applied to the desktop pane's list and the thread's own message scroller too. Fifth: wallpaper save is blocked purely on migration 0073 (`conversations.wallpaper_url`) never having been applied — confirmed directly against the live database (`column does not exist`); a genuine, separate transient bug was ALSO found and fixed along the way (a fresh service-worker install racing `clients.claim()` against an in-flight settings PATCH can throw a raw network error even though the server never saw the request) — `ThreadOptionsSheet`'s save path now retries once. Sixth: the disappearing-messages system notice was directly confirmed, via a real two-account test with a genuine hard reload, to persist correctly server-side; no code bug found there once the service-worker race above was ruled out. `ThreadOptionsSheet` also got a substantial further redesign per "still looks like novice" — a WhatsApp/Snapchat-style contact-info hero (avatar, name, verified badge) replacing the plain title bar, and every section now uses the app's own mandatory `ModuleIconBadge` 3D glass-tile icon instead of flat gray circles. WhatsApp-style hairline dividers added between every conversation row. Verified: `tsc` clean, the full 135-test vitest suite, four full `next build`s across the round, and direct before/after empirical repros (WebSocket-frame capture for typing, real hard-reload for the disappearing notice, screenshots for dark mode/dropdown/options-sheet) rather than trusting static reads — commit `b0eefea`, pushed and deployed via `vercel --prod`, confirmed live via the build-stamp endpoint. Migrations 0073/0074/0075 still pending owner apply — 0073 specifically is now a confirmed, deterministic blocker for wallpaper, not just a theoretical gap). Previously, same day (batch 62 — owner sent screenshots + a long list: crosscheck everything, the options-menu overflows + wants it premium, friends' stories still don't show, typing only worked once, the profile picture, the list background is light purple not white, "users can also set the whole message page theme," a premium theme-picker, and a WhatsApp-style disappearing-messages notice. The most important finding: a fix from EARLIER in this same session caused the typing regression — the router.refresh() added to fix stale story data broke the shared typing channel, caught only by literally disabling it and re-running the same live 2-account repro (typing worked across bursts again with it removed). Replaced with a single-purpose `GET /api/conversations/[id]/story` endpoint that only ever touches story state, confirmed via both the typing repro (still passes) and a dedicated story-staleness repro. Root cause of "stories don't show": next.config.ts's 6-hour client router-cache (a deliberate, separate choice) served a stale RSC payload on client-side nav regardless of the page's own force-dynamic — otherStoryGroup had no independent live-update path. Root cause of "light purple background": app/layout.tsx's own root-level ambient gradient decoration (intentional, for the marketing/Home look) was bleeding through the Messages list page, which had no opaque background of its own — fixed with explicit bg-white. Also found via the requested crosscheck: none of the 5 sheets built this session locked body scroll while open, unlike ~14 other call sites elsewhere in the app that already follow this exact convention — fixed at all 6 sites (5 sheets + ComposeLauncher's inline one), which is what "avoid the page overflowing" was describing. ThreadOptionsSheet redesigned for "premium... feel alive" (drag handle, grouped cards, staggered entrance, scale-pop swatches); Chat Theme wash bumped from an almost-invisible 5% to 12% plus a matching header tint, closing the "whole page theme" gap. New: a real WhatsApp-style in-chat system message when disappearing messages is toggled, showing the exact period — migration 0075. Migrations 0073/0074/0075 all pending owner apply, all fetch/write defensively per the lesson learned earlier this session. Verified: tsc clean, 135 tests, a full next build, and direct before/after Playwright repros for the typing regression, the story staleness, and the scroll-lock — not just screenshots. Commit `32b76ba`, pushed and deployed via `vercel --prod`, confirmed live via the build-stamp endpoint). Previously, same day (batch 61 — owner reported messages don't refresh instantly, wanted chat wallpaper support, and said the top-right profile button "feels compressed" when tapped; mid-round added more: avatar flush to the mobile edge, only one swipe-open row at a time, white WhatsApp-style chat background, a location "permission error," shared-post embed issues, and no-emoji violations. Root-caused each rather than guessing: (1) `next.config.ts`'s `Permissions-Policy: camera=(), microphone=(), geolocation=()` uses an EMPTY allowlist, which blocks the feature for the site's OWN origin too, not just third parties — the real cause of the location error, with no user-side fix possible; also silently broke voice-message and comment voice/video recording (both use getUserMedia) — changed to `(self)`. (2) `conversation-room.tsx`'s realtime resync only ran on RE-subscribes, never the first one, so a message sent in the gap between SSR render and the channel finishing its first join was lost until the user left and came back — confirmed with two live test accounts (1/3 messages arriving → 3/3 in 7ms after the fix) — the real cause of "doesn't refresh instant." (3) Emoji were baked directly into a Postgres trigger (`sync_conversation_preview`, migration 0072) as well as the push-notification preview text — both fixed (migration 0074 adds `last_message_kind` so the inbox row renders a real icon instead). (4) `UserMenu`'s avatar read `user_metadata.avatar_url` (only ever set by OAuth) instead of the real `profiles.avatar_url` — an account with a real uploaded picture still showed a letter; fixed via `/api/me`, with a `UserCircle` icon fallback instead of a letter. (5) `UserMenu`'s dropdown wasn't portaled unlike every other menu in the app, and read as "compressed" inside the mobile Messages header specifically — portaled + position-computed like the rest. Also shipped: chat wallpaper (migration 0073, upload a picture as a per-conversation background, live-synced); learned mid-session that adding a new column straight to `getConversation()`'s main SELECT 404s every thread until the migration lands — reproduced locally, then fixed with a separate best-effort query pattern used for both new migrations; a WhatsApp-style white default chat background (forced-light overrides, not just removing dark mode, since `.dark .glass` is genuinely invisible against a white backdrop); avatar realigned to the same edge the search bar already uses (was double-inset); exclusive swipe-open row; and the shared-post embed enlarged + reordered to match the reference image with real like/comment counts via icons. Verified: tsc clean, 135 tests, a full `next build`, and direct screenshots of every changed surface against real test-account data — commit `facfb49`, pushed and deployed directly via `vercel --prod` (git-integration auto-deploy seemed to lag this session). Migrations 0073 + 0074 still need applying — both degrade gracefully without crashing anything if not yet applied). Previously, 2026‑07‑13 (batch 60 — owner reported the Chats page still crashed after batch 59's PIN-gate fix. Rather than guess again, reproduced it empirically: two fresh test accounts via the admin API, a real conversation, a real `next build`+`next start`, driven with Playwright. **The PIN gate was never the cause.** `app/(app)/messages/layout.tsx` always mounts its desktop-pane `ConversationList` (`hidden lg:flex` — CSS-hidden, never unmounted by React) alongside `app/(app)/messages/page.tsx`'s own mobile-list `ConversationList`, on every single visit to `/messages`, on every device. Both instances render a row for the same conversation and both opened their own realtime channel for its typing indicator; `@supabase/realtime-js` reuses the channel object for an already-registered topic, so the second caller's presence-listener registration landed on an already-subscribed channel, which realtime-js throws on — an uncaught error that crashed straight to the generic error boundary, 100% reproducible for any account with at least one conversation, independent of PIN state. A same-day earlier fix had special-cased a narrower version of this same collision (a list row vs. its own open thread) and missed the far more common one. Real fix: `use-typing.ts`'s realtime channel is now a module-level, ref-counted singleton per conversation — however many components observe one conversation at once, there's exactly one channel and one subscribe call. Confirmed via the same repro script (crashed before, clean after) plus tsc/135 tests/full `next build`. Also: top nav background is now solid/opaque, no backdrop blur ("pure white, not blurred transparent"). Commit `1015b07`, pushed. See [[typing-pin-stepup-crashes-2026-07-13]] for the full correction, including a reusable test-account+Playwright repro technique worth reaching for again before trusting a static-analysis theory on a live crash). Previously, same day (batch 59 — owner report: notification bell had a stray dark tint on unread, the Chats tab crashed to "Something went wrong," and Secret Chats' PIN was wrongly gating general chat too, with its own unlock keypad sometimes getting permanently stuck. Root-caused rather than patched over: the PIN gate's `GATED_PREFIXES` included the bare `/messages` prefix from its original Part 11a design as an app-wide quick-lock — scoped down to Secret Chats + `/account/security` only, removing the SSR gate from the normal inbox and every plain thread entirely. `isPinLocked()` had no error handling on every gated Server Component render — the one function in this whole PIN feature missing the fail-safe try/catch every sibling function already had — hardened to fail open instead of crashing the page. Separately, the client gate's own "does this account have a PIN" check ran exactly once per browser session with empty effect deps and no retry — a single transient failure permanently hid the unlock keypad for the rest of that session while the server kept correctly showing "locked" forever, which is precisely "stuck with no input to write pin"; now retries on every navigation until confirmed. Entering the correct PIN also used to make the keypad vanish instantly while the still-loading page underneath briefly showed the stale locked placeholder — now an explicit "Unlocking…" transition (tied to `useTransition`'s real pending state, not a guess) bridges the gap. Also same round: the bell no longer tints dark while unread (only the red count badge indicates it now, matching the mockup); the purple accent dots were removed from the whole top nav and the now-dead component deleted; Home's floating rounded-card top nav was replaced with the same full-width, edge-to-edge, flush-at-top bar every other route uses. Left open pending the owner: the top-nav Reels icon apparently doesn't match their original mockup, but that image wasn't available to re-check against this round — asked them to resend/describe it rather than guessing. `tsc`/135 tests/`next build` all clean; commit `8e38c04`, pushed). Previously, same day (batch 58 — the messaging mockup round's 3 deferred items shipped + a 6-bug crosscheck, see below). Previously, same day (batch 57 — second messaging mockup round: a real typing-indicator bug root-caused and fixed (the presence timestamp was never refreshed while a burst continued, so the indicator went stale ~5s after typing STARTED rather than after it stopped — replaced with a 2s heartbeat + receiver-side-only clock trust, immune to cross-device clock skew), plus "typing…" now shows on the inbox LIST (not just an open thread); inbox gets a Channels tab (coming-soon), a redesigned horizontal Pinned avatar-strip with "View all", swipe-to-reveal Archive/Delete (a new non-destructive per-user hide), and top-bar add-friends/avatar icons; chat threads get a real "…" menu on direct chats (previously group-only) exposing Chat Themes (new: 5 swatches recolor both the sent bubbles AND a background wash, more than the mockup itself asked for, per explicit owner choice), Disappearing Messages with a new Custom-days option (the Off/24h/7d/30d backend already worked, just wasn't exposed outside Secret Chats), and Delete; the composer gets a real emoji-picker button; and three brand-new attachment types shipped for real — Location (device GPS + free OSM reverse-geocode, no paid map key), Contact (share one of your Frenz friends), and Poll (single-choice, live tally). Migrations 0068-0072 to apply. A real production-build-breaking bug was caught by `next build` (not by typecheck alone) — a client component's mixed value+type import dragged a server-only module's `next/server` `after()` call into the browser bundle; fixed by following this codebase's own already-established client-safe-constants-file pattern. Deliberately deferred to a follow-up round, not silently dropped: the stories-row inside a chat thread, real download-progress UI for document bubbles, and a WhatsApp-style hold-to-record/slide-to-cancel voice gesture (the recorder itself already fully works, tap-only). See the full entry below the fold). Later the same day (batch 58 — the three deferred items above shipped for real, THEN an independent 3-agent parallel crosscheck (correctness line-by-line, cross-file call-site tracing, cleanup/conventions) found and fixed 6 more real bugs before any of them reached production: a poll's id was dropped by the realtime message-update handler (stuck-loading bubble for anyone with the thread already open), forwarding a location/contact/poll message silently failed (fixed for location/contact; a poll forward is deliberately left a no-op since its votes are scoped to the original conversation's own membership), the voice-hold slide-to-cancel gesture left stale tracking state that poisoned the very next plain tap into an unintended blank auto-send, a failed auto-send retried forever instead of falling back to manual controls, a partial poll-creation failure left a permanently stuck bubble (now soft-deleted like any other message delete), and Chat Theme changes weren't live for anyone but the person who changed them. Also fixed: an emoji-picker z-index that broke the app's toast-always-on-top convention, and a defensive dedupe against a duplicate realtime channel in the desktop split view. `next build` + the full vitest suite (135 tests) verified clean after every fix. Previously, same day (batch 56 — Home's mobile top nav rebuilt to match an owner mockup exactly: a floating rounded pill bar replacing the flat edge-to-edge header, the For You tab now a vivid Electric-Blue→Royal-Purple gradient pill using the app's real brand gradient (distinct from the deliberately-darker tile used everywhere else per the 2026-07-10/11/12 "too much purple splashing" corrections), Following/Reels restyled as plain circular chips with a small purple accent dot, matching Search/Add-friend — scoped to `/home` only so every other route stays pixel-identical. Continue Watching's header also rebuilt to the mockup: a subtitle plus a "View All" link to /downloads replaces the old inline hide/show switch, which now goes through the Home Modules Editor like every other optional section instead of its own bespoke mechanism). Previously, same day (batch 55 — typing indicator genuinely fixed for the first time (a `@supabase/realtime-js` gotcha: it always sends a `broadcast` block in a channel's join payload even for presence-only channels, so the RLS policy needed to authorize both extensions, not just `'presence'`), a live schema-drift bug that made setting a PIN fail, and two missing required env vars that were silently crashing recovery-codes/step-up/PIN-verify — all confirmed against the live database with real test accounts, not just read. See the full entry below the fold). Previously, 2026‑07‑12 (batch 54 — mockup-faithful redesign of the inbox, chat thread, home top/bottom nav after owner rejection of the previous pass; a CRITICAL database-policy bug (infinite RLS recursion) found to have silently broken live message delivery, reactions and typing since group chats shipped — migration 0052 to apply; real iOS haptics, audible nav taps, inline Accept/Follow-back on notifications, the "security alert on every app entry" fix, the theme-flash-on-entry fix, and a startup-lifecycle audit (docs/STARTUP_AUDIT.md) that time-boxed the auth calls that could hang the whole app on a loader — see the full entry below). Previously, same day (batch 53 — nine owner-reported messaging bugs fixed in one pass, Notification System Parts 8-9 (achievements/digest/frequency limits + a consolidated publish API) finally committed, and Premium Messaging V2 Part 10: real message search + starred messages — see the full entry below the fold). Previously, same day (batch 52 — a critical service-worker fix + a project-wide "fire-and-forget writes were silently never running" bug sweep — see the full entry below the fold). Previously, same day (batch 51 — ten owner-reported polish/bug fixes, a messaging cross-check that found 4 real bugs, and Notification System Parts 6-7: per-user notification settings + push delivery reliability). Previously, 2026‑07‑11 (batch 50 — Feature 12 Premium Messaging V2 Part 5: media messaging — real image/video/voice-note/document attachments in chat, a "send what I just downloaded" action, and one real security fix (attachment URLs now checked against our own storage, not just "is this a URL"). Previously, same day, owner personally cross-checked Part 4 and found one real bug (the message options menu could render off the bottom of the screen) — fixed and verified. Previously, same day, batch 49 — Feature 12 Premium Messaging V2 Part 4: notifications, alerts & smart delivery — chat @mentions (composer autocomplete + highlighted rendering + notification), priority/DND-aware push delivery, message burst-bundling, interactive push actions (mark read/mute), in-app interaction sounds with a real per-device-synced settings panel, and an admin broadcast system. A meaningful chunk of the owner's spec (lock-screen reply, custom OS notification sounds, Live Activities, watch/car targets) is native-iOS/Android-app-only and cannot be done from a web app — documented clearly, not fudged. Previously, same day, batch 48 — Feature 12 Premium Messaging V2 Part 3: real-time delivery engine — typing indicators finally built, presence status + auto-away, offline send queue, message forwarding, delta sync, connection-health UI, and a real messaging-health admin panel — plus an owner-requested cross-check that found and fixed a critical resync bug that was silently wiping thread history, a mobile-only menu-overflow bug, an offline-queue message-disappears-on-reload bug, and a live Postgres deadlock hit while applying the new migration. Previously, same day, batch 47 — Feature 12 Premium Messaging V2 Part 1: group conversations + full message lifecycle — reply/edit/delete/pin/react — shipped on top of the existing 1:1 chat, new migrations 0041+0042 to apply; see the full entry below for what's real vs deliberately deferred (encryption, attachments, typing indicators). Previously, same day, batch 46 — "stuck" bug hunt: fixed a real silent-failure bug in the Enable Notifications button, closed a service-worker update-detection gap, added hang-timeouts to the update/reload flow, enlarged the boot-splash logo to the real asset, and forced the first-login/cache-cleared splash to a white background. Previously, 2026‑07‑10: Owner follow-up: *"the continue watching and friends activity switch resets when i leave the homepage and come back, and the switch is too fat and common on mobile, i want it premium."* Two real, separate causes of the reset: the switch's on/off state was never actually reading what had been saved before — it just always started as "on" no matter what, and even after fixing that, the page's own caching could still show an old copy of Home from before the switch was flipped. Fixed both so a toggle now genuinely sticks across a real leave-and-return. Also redesigned the switch itself — smaller and in plain black-or-white instead of the wider purple-gradient one, matching the same premium, decluttered direction as the rest of this session's work. Previously, same day: *"Change all icons with purple background and purple icon from purple to a dark or premium white or transparent color in all pages to avoid too much purple color splashing and change the plus post button to a different shape and dark color... use tiktok style of icon and use a premium human font like snapchat and tiktok font in all pages."* — the nav/icon system from earlier the same day was real and correctly built, but having the SAME blue→purple gradient on every single nav icon, topbar icon, module header, and menu row at once read as "too much purple splashing" even though each individual piece was right. Recolored all of it to a dark-or-white treatment instead (literally both, depending on light/dark theme — a tile that inverts to always be the opposite of its surroundings, zero color at rest, which is also the actual TikTok nav look: bold plain icon, no colored badge). Checked every other purple/gradient element in the app first and deliberately left the unrelated ones alone — user avatar placeholder circles, the colored rings around unwatched Stories, and buttons like "Go Pro" are a different, intentional, colorful pattern, not "icons." The center Create (+) button also got its own explicit ask: changed from a circle to a rounded-square shape and a fixed dark color (not the light/dark-adaptive treatment everything else got), so it's now the one deliberately different-looking button in the whole nav bar. Also swapped the entire app's font to a more rounded, modern typeface closer to what Snapchat/TikTok use (their actual fonts aren't available to license, so picked the closest well-regarded free alternative) — since it's wired at the single root layout level, this reached every page in one change with nothing else to touch. Previously, same day: *"the image view in feed still loads like it navigate to a different page when clicked... open immediately in same page without redirecting and loading for 0ms"* plus *"use same premium 3d unique icon from homepage on all pages too... all navigation pages, and all pages current and future pages"* plus *"dont comsume cpu and battery, animate only when clicked"* — found two more real causes of the recurring image-open-delay complaint beyond the URL-mismatch fix from earlier the same day: a deliberate 280ms tap-vs-double-tap disambiguation delay (tightened to a synced 220ms, kept equal on both sides so the existing double-tap-to-Wow gesture stays correct), and the image/post viewers' code-split chunks had no loading fallback at all unlike the reels viewer's — added tap-time chunk prefetching plus a new instant fallback that paints the tapped photo immediately from data already on hand. Also rolled the nav's "3D premium" icon-badge treatment out to the whole public site (the marketing header's hamburger menu + drawer, the account dropdown) and wrote it into the engineering doc as a mandatory rule so future pages inherit it automatically; the treatment is pure static CSS with zero idle animation, so the battery/CPU ask was already satisfied by how it was built. A dev-server-only false alarm during testing (a menu button that looked completely broken) turned out to be nothing once checked against a real production build — noted as a lesson for next time. Previously, same day: Continue Watching and Friend Activity got an inline on/off switch right next to their title (persisted via a new race-safe `hideModule`/`showModule` API instead of a client-computed full-array PATCH, which could have silently clobbered a concurrent change); all three module headers (+ every nav destination, top bar action, and the account settings page) got a real "3D premium" glass-badge treatment (gradient tile + gloss highlight + soft shadow) replacing the previous round's subtler gradient-only-on-active-icon approach, which — verified via a fresh visual mock — genuinely was too subtle to register as changed on the 4-out-of-5 tabs that are inactive at any moment; and "Publish to everyone" now prefetches its upload slot + auth check the moment the options sheet opens instead of only after the tap, shaving that round-trip off the critical path. Previously, same day: existing multi-video reels retroactively moved to Feed (migration 0039 — the earlier fix only stopped new uploads), and the fullscreen album viewer (a separate component from the feed's inline carousel) had the identical "every slide loads at once" bug, fixed the same way. Same day, earlier: Owner mobile-tested comments and found real horizontal-scroll bugs — 3 root causes fixed (fixed-width mention dropdown, waveform bars missing min-w-0, video preview missing max-w-full), proven via a Playwright repro showing the exact overflow before/zero after; also corrected Part 10's deferred card-lift with a properly-scoped fix on media elements after owner pushback on skipping. Same day, earlier: Feature 17 Part 10 motion-system slice: app-wide reduced-motion via MotionConfig, a unified haptics module replacing 11 scattered magic-number vibrate calls, and a shared bottom-sheet spring token deduping 7 byte-identical copies — no migration. Same day, earlier: Voice notes + video replies for comments, built from scratch — real MediaRecorder/AudioContext waveform recorder + camera video-reply recorder, new migration 0038 to apply; plus 3 owner-reported bug fixes: feed Comment button now actually opens the comments sheet on images/albums, multi-image carousels load slides sequentially near the current index instead of all at once, and multi-video uploads route to Feed only — Reels never carries more than one video. Same day, earlier: Feature 17 Part 9 comments-platform slice: reply/mention/comment-reaction notifications, @mention autocomplete, "Friends First" comment sort, local composer drafts — new migration 0037 to apply. Same day, earlier: Reel-album swipe's real fix — native scroll was winning the race against the JS drag on real touch, needed a non-passive touchmove listener, not just touch-action; multi-media feed carousel gained the double-tap-Wow burst + instant pointer-based tap it never had. Same day, earlier: Feature 17 Part 8 engagement slice: relationship-aware repost notifications, real mute-creator, animated action-bar counters, image-viewer Download cleanup, collection search — 2 new migrations 0035+0036 to apply. Same day, earlier: Home now caches instantly across in-app navigation + quietly auto-refreshes when stale; welcome splash corrected to fire ONLY on first-ever login / cache-cleared after owner feedback; loader wordmark restyled smaller w/ a dedicated display font. Same day, earlier: reel-album swipe upgraded to a real finger-tracked live drag with rubber-band edges — "as smooth as a top platform"; instant-open pass: feed images/Reels/Continue Watching all preload ahead of time instead of showing a load on open; new TikTok/Twitter-style full-screen welcome splash on fresh sign-in + resume-from-minimize, reusing the new branded F. Previously, 2026‑07‑09: "For You" is now genuinely ranked server-side — relationship + quality + freshness, replacing what was secretly pure reverse-chronological; feed's For You/Following/Reels control lifted into the shared top nav, redesigned as a premium high-contrast pill w/ new Frenz sparkle+reels icons; definitive carousel vertical-scroll fix + full-photo image viewer + new branded F logo everywhere; reusable pull-to-refresh + Stories-style Continue Watching player shipped — unified zoom/expand across feed video/carousel/reel albums + reel-album crossfade, Feed card polish shipped, owner-reported bug batch: mobile topbar brand mark removed, Continue Watching instant-reopen cache-warm shipped, Profile-menu stuck-backdrop nav bug fixed, Stories strip redesign shipped, Home page content-balancing bug fixed + Continue Watching wired in, bottom nav redesign shipped, Home topbar redesign shipped, Frenz Motion engine + Signature Icon System slice 1 shipped, independent security crosscheck + report-only CSP/COOP shipped, active-sessions/device management shipped, F logo hairline edge fixed + premium OTP email, real carousel-scroll fix + recurring dark-mode-on-reentry fix, F logo's black backdrop removed, site-down incident fixed, Friends discovery deck)._

---

## 2026‑07‑20 — LCP attributed properly: it is the hydration task, and four cuts

Yesterday's pass measured the block but not its cause. Capturing every LCP
*candidate* alongside the long‑task timeline settled it: there is exactly one
candidate — the hero H1 — and it paints the instant the first big hydration task
ends (task at 1093ms lasting 659ms, H1 at 1848ms; second run 1060+758, H1 at
1860ms). FCP is ~1.1s, so the gap between paint and LCP *is* that task.

Two hypotheses were tested and rejected on evidence rather than argued about.
Webfonts: `font-display: swap` was already set and there are zero font preloads,
but blocking every woff2 moved worst‑case 2588 → 2504ms, which is noise. The
page‑transition template: the static HTML carries no transition class, so the
first‑mount guard is working.

Four cuts shipped. The boot‑splash logo was a 512px, 159kB PNG rendered at 152px
and preloaded at high priority on every page — it held the connection from 561ms
to 2958ms on a 1.6Mbps link while render‑blocking CSS waited; resampled to 384px
it is 15kB. Four app‑shell components (status‑bar scrim, edge‑swipe‑back,
offline banner, scroll‑FPS monitor) moved out of the root layout into the app
group, where they shipped to every marketing page and could not act.
`content-visibility` now skips layout for everything below the hero. Third‑party
ad scripts wait for idle instead of firing during hydration — the same request
and injection, only later, and not a CSP change.

Result, stated honestly: **median LCP 1976 → 1792ms and best‑case 1244ms, both
under budget; worst‑of‑five is 2352ms, still over.** The remaining gate is the
hydration task itself, which needs the hero's client components to stop
hydrating eagerly — a refactor rather than a tweak. The local harness also
swings about a second run to run, so the live site is the number that counts.

Three sitemap items were closed as not applicable rather than built: a sitemap
index exists to split past 50,000 URLs and this site has 198; an image sitemap
would need per‑page images, and the generated OG cards 404 without the content
hash Next appends, leaving a choice between breakable URLs and one generic card
repeated 198 times; and no public page presents video as its primary content.

---

## 2026‑07‑19 — The landing hydration block, measured (and a fix that did not work)

The 07‑17 audit flagged a 300–835ms main‑thread block on every page as the top
performance item, with the cause explicitly unverified. Measured properly now:
production build, slow‑4G (1.6Mbps / 300ms RTT) plus **4× CPU throttling**,
390×844 mobile, three runs.

`/` comes in at **LCP 1708/1976/2608ms** — the worst run is over the two‑second
budget — with 1.3–2.4s of total blocking. Run‑to‑run variance is large enough
(1708–2760ms) that a single run cannot decide anything; medians across at least
three runs are the only honest comparison.

**The block is React hydration itself, not a heavy component.** CPU profile
self‑time: react‑dom 827ms, scheduler/internals 421ms, webpack runtime 225ms —
and the landing page's own code 112ms, about 5% of it. Roughly 195kB of
react‑dom, scheduler, framer‑motion and the Supabase auth SDK execute before any
landing code runs. Supabase is there because the site header calls `useUser()`,
so an anonymous visitor downloads and parses an auth SDK to discover they are
anonymous.

**A fix was tried and reverted.** Moving the Supabase client to a dynamic import
inside the effect produced **no measurable improvement** — blocking medians
2132ms before against 2107ms after, LCP worst 2608 → 2760. One profile run
showed react‑dom time dropping 827→302ms, which looked like a win and turned out
to be noise once compared across three runs. Because the chunk still loads
immediately after mount, total transferred JS was identical at 356.8kB across
the same 29 files; only the parse timing moved. Reverting was the right call: an
unproven change to authentication on every page, unverifiable signed‑in in that
session. Recorded so nobody retries it expecting a win — the target has to be
removing bytes, not reordering them.

Also spotted and not chased: an intermittent CLS of 0.0607 (two runs of three)
attributed to a hero‑effects glow div. Under the 0.1 threshold, but roughly 25×
the 0.0025 recorded on 07‑17, and it has a named node to start from.

---

## 2026‑07‑19 — Working the recorded handoff: personal plane, corpus admin, translation pipeline

Three items, in the order the previous session's handoff set: the personal plane
first, admin surfaces second, locale work third.

**Personal plane (`5c8b357`, migration `0088` — NEEDS APPLYING).** Progress,
bookmarks and private notes over lessons and support articles. One row per
(user, item) with three independently-nullable timestamps rather than three
tables: they are three facts about one relationship, always read together.
Course progress is *derived* from lesson completions and counts against
*resolvable* lessons, so a retired lesson cannot strand a finished course at 90%
forever. Not an extension of `collections` — `collection_items.post_id`
references `posts`, so a lesson has nowhere to go.

This is the first table recording what an individual **reads**, so the privacy
work is the load-bearing part: exactly one RLS policy (a test asserts the count,
because an aggregate over "who reads the security school" should be an explicit
decision, not something that falls out of a loose grant), `no-store` on every
response including errors (Cloudflare fronts Vercel; a shared-cache hit would
serve one reader's notes to the next visitor), and a test pinning that exactly
one `NextResponse.json` call exists so no path can bypass the header. The UI is
a client island so `/learn`, `/help` and `/trust` stay prerendered.

**Corpus operations (`2af9229`).** `/admin/corpora` — an inspection console, not
an editor, because the corpora are compiled TypeScript and a save button would
be a lie. It found the same unreachability defect on the operator side:
`/admin/content` and `/admin/download-hub` had no link from the dashboard,
reachable only by typing the URL. Third time this class has appeared. Severity
is meant literally — `broken` means a reader is hitting something wrong now, and
a test asserts there are none; orphan lessons are a gap, not a break. That
distinction is the lesson from the orphan metric that once reported 155 problems
out of 169 nodes: a console that cries wolf gets ignored, then deleted.

**Translation pipeline + hreflang (`a3c93b7`).** `npm run i18n:export -- fr`
gives a translator JSON; `i18n:import` compiles it to typed TS. No
machine-translation step, deliberately — `0086` already says `machine` is a
status that must be reviewed, and an auto-filled catalogue would flip a locale
to 100% and switch the site into a language nobody has read.

**The bug worth recording** is one I wrote and the round trip caught: the first
version exported the English as the starting value and the import accepted any
non-empty string, so importing an *untouched* export reported French 100%
complete and flipped it to "offered" — in English. Every individual step read as
correct; only running it end to end showed it. The format is now
`{en, translation}` and the old flat shape is refused rather than guessed at.

hreflang derives from real availability, so `/help` emits exactly `en` and
`x-default` and no invented `/fr/help` (checked in the build artifact). Wrong
hreflang is worse than absent. The `/[locale]` routing tree is deliberately not
built: restructuring 212 routes today would prerender ~200 pages of English at
French URLs. The gate belongs before the routes.

---

## 2026‑07‑19 — Help Center: the corpus had two empty sections and no route

Continuing the Academy/Discovery queue after the glossary. The next open item was
the Help Center, and the codebase-first check found it in a worse state than
"not built": `lib/support/types.ts` already declared `getting-started` and
`troubleshooting`, `sections.ts` gave both presentation metadata and an ordering,
and the search index already grouped by those names — **with zero articles behind
them and no route to render them on.** Declared, wired, and empty.

**Shipped:** five articles (saving your first video · what an account adds ·
installing on your phone · when a link will not download · quality, size and
playback problems), `/help` and `/help/[slug]`, and the article body extracted to
`components/support/support-article.tsx` so the two centres are two views over one
corpus rather than two copies of one renderer.

**Every claim was checked against the product before it was written**, and two
did not survive: a draft said downloads are "free and unlimited" (the Free tier
is capped at 30/day on the pricing page) and that separate video/audio streams
are combined server-side (the code flags `hasAudio` but the merge is not
established from the frontend — reworded to describe what the reader should do
instead of asserting a mechanism). The landing FAQ still says "completely free
and unlimited", which contradicts the pricing page — flagged for the owner.

**The real bug this uncovered:** one corpus, two centres, and *every* consumer
had hardcoded `/trust/<slug>` — the article route generated static params for the
whole corpus, the sitemap listed every slug under /trust, the search index built
/trust hrefs, and the assistant cited them as fact. Adding the first help article
would have published it at two canonical URLs while advertising the one that
404s. Search engines pick a winner, ranking splits, and nothing looks broken
because both URLs render a perfectly good page. Fixed with a single `articleHref`
derivation; `support.test.ts` now pins that the two route-param lists partition
the corpus with nothing shared and nothing lost. Verified on the build artifact —
5 help + 7 trust HTML files, no overlap — and at runtime, where a trust slug
under /help returns a real 404.

Reachability wired through all three systems per the `c743384` lesson (NAV_LINKS,
the explicit `MENU_GROUPS` id list, the footer column, the registry), with
keywords people actually type ("not working", "add to home screen"). Verified:
tsc, lint, 479 tests, a full build (212 static pages), and screenshots in both
themes.

---

## 2026‑07‑18 — Living Content Platform Phase 1: the Reality Ledger (RFC accepted)

Owner asked for a full "Living Content Platform" — Product Genome™, Experience
Graph™, Living Content Engine™, Experience Sync Engine™, a Global Content
Orchestrator™, 26 backend services, ~8 migrations, an admin platform. Designed in
full in **`docs/LIVING_CONTENT_PLATFORM_RFC.md`**; Phase 1 built and shipped.

**The most useful finding was that two of the five named systems already existed
here in embryo.** `config/seoPages.ts` (1033 lines, cluster × modifier → hundreds of
pages, FAQs, metadata, internal links) *is* a Living Content Engine, just scoped to
the downloader vertical. `lib/platform/modules.ts` *is* a Product Genome, at 8 fields
instead of ~30. The work is generalising those, not greenfield.

**Architectural crux — authoring plane ≠ render plane.** An enterprise CMS implies
request-time DB reads, which would put a ~290ms Supabase round trip in front of every
marketing page and un-static `/` (`e7f25c6`), spending the 2-second page budget. So:
Postgres is the **authoring** plane (drafts, review, approval, versions); approved
content **compiles to typed TS modules** that Next renders statically. Publishing is a
build, not a write. Content becomes type-checked, diffable in git, and free at request
time. Owner approved this model.

**Phase 1 — the Reality Ledger, enforced by tests.** `ProductVeracity` now sits on
every module (`stage`, `claimable`, `provingRoute`, `evidence`, `verifiedAt`),
deliberately separate from the display-only `status`. `lib/content/reality-ledger.ts`
+ its 16-assertion CI test make it mechanically impossible to claim a product that
isn't built, or to state a magnitude nobody can source.

**It found three live violations on first run.** `stats-counter.tsx` was animating
**"35,000,000+ Videos Downloaded"** and **"8,000,000+ Community Members"** on scroll so
they read as live telemetry. Measured against the database that day, both were
overstated by four to five orders of magnitude. That is a factual claim about the
business, presented as measured, on the front door. Also: `platform-showcase`
claimed "20+ Platforms" against 11 in the registry. And `Frenzsave Smart` carried
`status: "beta"` while having no `/smart` route and its only UI surface commented out
of `app/layout.tsx:236` — recorded as `internal` / not claimable.

Every figure on the band is now **derived from the product** (`11` platforms, `4`
watermark-free, `Free`, `None` account needed) so it is true by construction and
re-states itself as the product grows. The honest version is also the faster one: the
component dropped its `IntersectionObserver` + `requestAnimationFrame` loop and is now
a **server component with zero client JS** on a page under a 2s budget.

**Detector design.** First cut flagged 21 sites, 19 noise (CSS `rgba()`, Tailwind
arbitrary values, real plan quotas like "10,000 requests/day" — those are specs, not
social proof). Narrowed to social-proof shapes only. It also flagged its own changelog
until comment-stripping was added: documenting a past violation must never trip the
gate, or authors learn to stop writing down why a number was wrong.

Open for the owner: `/studio`, `/cloud`, `/smart` are dead `basePath`s (safe today —
no `nav` entries — but an app launcher built off `getModulesFor()` would 404); and the
`download` module tagline still says "20+ platforms" unsourced. Phases 2–5 (full
Genome, Experience Graph + compile step, authoring DB + editorial workflow, Sync
Engine) remain open.

---

## 2026‑07‑16 highlights (batch 70 — chat appearance PER-CONVERSATION, the real "can't save" cause, /messages made standalone)

Owner's next round: chat bubble style/color/font should change **only in the chat where they were set, not in every chat**; the font-style picker "shows can't save," and so does the chat wallpaper; the bubble color loads late (shows the default blue for a moment on every entry); make the chat-list rows sit tightly together like WhatsApp (the divider line already separates them); `/messages` sits on the F loader for seconds on a reload / iOS back-swipe and feels like it "re-routes through login," when it should be standalone like every other page; plus a full theme-init audit and a home-page instant-load investigation.

- **Chat appearance is now per-conversation** (reverses batch 65's per-user design). `chat_appearance_preferences` keyed `(user_id, conversation_id)`; migration **0078** (non-destructive/idempotent). API route + `useChatAppearance(conversationId)` / `setChatAppearance(conversationId, …)` threaded through the room + settings sheet.
- **The real "font/bubble can't save" cause — verified against the LIVE database, not the repo migration.** Production's `chat_appearance_preferences` had already diverged from repo-0077: it already has a `conversation_id` column and a composite `(user_id, conversation_id)` primary key with no CHECK constraints. The shipped code, though, still wrote the old per-user shape (`onConflict: "user_id"`), which fails outright against a composite PK ("no unique or exclusion constraint matching the ON CONFLICT specification") → every save 500'd and rolled back. The app fix (send `conversation_id` + `onConflict: "user_id,conversation_id"`) matches the live shape and works with or without 0078. Lesson: probe the live schema before trusting the repo migration — they can diverge.
- **Bubble color/style loads instantly now** — `getConversation()` SSR-reads the viewer's appearance row for the thread and seeds the first render, so the saved look paints on frame 1 instead of default-blue-then-switch.
- **Chat wallpaper "can't save" = migration 0073 STILL unapplied** — confirmed live again (`column conversations.wallpaper_url does not exist`). Code is correct; needs `0073_conversation_wallpaper.sql` applied. OWNER ACTION.
- **/messages F-loader / white-screen / "re-routes through login"** — root cause: `messages/layout.tsx` was an `async` layout that blocked on `getUserBounded` + `listConversations` (~14s worst case) before any JSX, with no Suspense boundary above it, so the whole subtree (incl. the page's own loading skeleton) couldn't flush — and that data only feeds the desktop pane mobile never shows. Made the layout **synchronous**, streaming the pane's data via `<Suspense>`; the mobile page now shows its skeleton immediately and does its own auth, unblocked — genuinely standalone like other routes. Also moved the boot-splash dismissal decision + CSS into `<head>` (new `BootHead`) so a streamed force-dynamic page can't paint the F splash and leave it up waiting on a hide-script in a later body chunk (same streaming-orphan fix already done for the theme script).
- **Chat list rows flush like WhatsApp** — removed the inter-row gap (`space-y-0`) and switched each row to a single bottom hairline (`border-b … last:border-b-0`, `rounded-none`).
- **Home instant-load** — `home/page.tsx` ran three sequential blocking awaits before first paint (`getUser` → `getHomeProfile` → `getHomePreferences`); parallelized the latter two + the cookie read via `Promise.all` (getUser stays first for the redirect). Feed already streams + prefetches 800px ahead, so on-scroll media delay is inherent lazy-load, flagged not force-patched.

Verified: `tsc`/`next lint`/135-test vitest/full `next build` all clean, plus **live DB probes** with the service-role key that empirically confirmed the ON-CONFLICT save failure, the missing `wallpaper_url` column, and that the new write shape is accepted by production. Migrations 0073 (wallpaper) + 0078 (appearance per-conversation) pending owner apply — both degrade gracefully if not yet applied.

## 2026‑07‑16 highlights (batch 69c — F loader only on FIRST-ever entry; last theme-flash window closed)

Owner follow-up after 69b: the stuck state is gone, but `/messages` still showed the F loader "for too long" on an iOS back-gesture or a browser reload — the ask: those must open INSTANTLY (page skeleton only), and the F loader should appear ONLY when someone newly enters the app with no saved cache (first-ever visit or cleared site data). Also: the theme still flashed, "but more little than before."

**F loader:** the already-booted marker was `sessionStorage` ("once per tab session") — but iOS kills a backgrounded PWA's whole process, so every relaunch/back-gesture arrived with EMPTY sessionStorage, took the show path, and (on a streamed `force-dynamic` page like `/messages`) the loader stayed until `DOMContentLoaded` — i.e. until the server finished rendering, seconds. Switched the marker to `localStorage` (`frenz-booted`), which survives process kills: reloads, back gestures, and PWA relaunches now take the instant branch, where `frenz-boot-off` is added synchronously before first paint — the splash never becomes visible at all. It still shows on a genuinely first-ever entry (or post-clear), and the `frenz_just_signed_in` force-show is unchanged. (Existing users will see the loader exactly once more — the first cold load that sets the new localStorage key.)

**Theme flash:** `THEME_JS` ran in `<body>`. On a streamed response, the first network chunk can end after `</head>` but before that script's bytes — the parser yields on the network and the browser can paint the empty body with the DEFAULT (light) background before `html.dark` is ever set. Moved the script into `<head>` (new `ThemeBootScript` export rendered first in `app/layout.tsx`'s explicit head) — in the head it provably executes before ANY first paint. Empirically proven with a chunked-HTTP test: served `</head>` then delayed the body 1.5s — `html.dark` was already set mid-gap, before a single body byte arrived (impossible under the old placement, where the script itself was in the not-yet-arrived body). Verified placement in the real `next build` output HTML too.

All 9 prior boot/theme scenarios re-pass with the updated code, plus tsc/lint/135 tests/full build clean. Separately: the CI failure email from the 69b push was NOT a push failure — a pre-existing flaky test (`home-feed.test.ts` "ties preserve original order": each row got its own `new Date()`, so rows created across a millisecond boundary genuinely differed in age and rankForYou's continuous freshness term broke the "tie") hit its timing window on run #451 after 450 lucky passes; deflaked with one shared module-level timestamp, verified 10 consecutive runs, CI green again.

## 2026‑07‑16 highlights (batch 69b — the F-loader-stuck and theme-flip bugs fixed PERMANENTLY, node-independent)

Owner, frustrated that the "stuck on the F loader" (message page reload + back-gesture) and "webapp switches to the opposite theme every time I leave and come back" bugs had each survived several rounds of real fixes, asked to fix both permanently. Found the deeper cause of each — the earlier fixes were correct but incomplete.

**Stuck-on-F-loader — the permanent fix.** The boot splash (`#frenz-boot`, the full-screen F) removes itself with a plain inline script. Batch 67 (2026-07-15) made its `hide()` re-query the node by id to survive a `/messages` hydration mismatch that makes React discard and regenerate a brand-new `#frenz-boot` node — a real fix, but it only covered the SLOW path. On a plain **reload** (where `sessionStorage` says this tab already booted), the script took a FAST path: `el.style.display='none'; return` — it never scheduled `hide()` at all, and set no failsafe on that path. So when React regenerated the node after a reload, nothing ever hid the fresh node — permanently stuck, even past the 6-second failsafe (which that path skipped). Fixed by making dismissal **node-independent**: the script now toggles a class on `<html>` (`frenz-boot-out` to fade, `frenz-boot-off` to hard-hide) and CSS hides ANY `#frenz-boot` node while that class is present. A class on `<html>` can't be dodged by node regeneration (React never clears the documentElement class; next-themes only touches the `light`/`dark` tokens), the CSS matches whichever node is live, and the 6s failsafe + a `pageshow` restore-guard both just re-add the class — so recovery is guaranteed on every path: cold load, reload, and iOS back-gesture alike.

**Theme-flips-to-opposite-on-reentry — the permanent fix.** This affects **system-mode** users (the default; explicit light/dark users hit an early return and were never affected). In system mode the boot script paints the cached resolved theme instantly, then 60ms later re-checks the live `matchMedia` and corrects if it disagrees — to catch "OS theme changed while the app was fully CLOSED." The bug: that live re-check ALSO ran on `pageshow`/resume, which is exactly when WKWebView reports a STALE (often inverted) `prefers-color-scheme` for a moment. On resume the transient stale read overwrote the correct cached value with its opposite AND re-saved it, poisoning the cache; because WebKit "self-corrects" a value it merely read stale WITHOUT firing a `change` event, nothing ever undid it — so it flipped and stayed flipped, every reentry. Fixed by suppressing the live re-check on the `pageshow` path (it now only runs on a genuine cold boot, which is the only time its stated purpose — "OS changed while fully closed" — can occur). A real OS change while the app is open/backgrounded still arrives through the `matchMedia` `change` listener, which fires only on an actual transition, never on a stale read.

Both fixes verified empirically in Chromium with a **negative control**: the OLD code was confirmed to (a) leave a regenerated `#frenz-boot` node stuck-visible even past the 6s failsafe, and (b) flip a system+light user to dark and poison the cache when `matchMedia` reports a transient stale-dark on resume — while the NEW code passes all 9 scenarios (cold-start show/hide, instant-hide on reload, regenerated-node-stays-hidden on both reload and cold paths, and the theme staying light with an un-poisoned cache across a stale-read resume). Plus `tsc`, `next lint`, the 135-test vitest suite, and a full `next build` all clean. Full writeup: memory `messages-theme-flip-and-f-loader-permanent-fix-2026-07-16`.

## 2026‑07‑16 highlights (batch 69 — the REAL "stuck in reload" root cause on /messages: a Supabase refresh-token race)

Owner reported the message page still gets stuck in reload — both a plain browser/webapp reload AND the iOS back-slide gesture inside the installed PWA — despite every earlier round's real, correctly-fixed bugs in this same area (batch 67's hydration-mismatch self-heal, the SW timeout raise, the bfcache `pageshow` gaps). This time the cause was upstream of all of those: a genuine Supabase **refresh-token rotation race**, evidenced by an `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` already sitting unexplained in a batch-67 dev log.

`/messages` is the one route in the app where a nested `layout.tsx` *and* its `page.tsx` **each independently** call `createClient()` + `getUserBounded()` for the same request (`/home`'s layout does no auth work at all, which is exactly why it never reproduced this). When the access token is expired, both separate client instances read the identical stale refresh-token cookie and each try to refresh it — Supabase refresh tokens are single-use, so whichever call goes first succeeds (in-memory only; a Server Component structurally cannot persist a cookie write) while the second gets a real, unrecoverable auth error. Middleware would normally refresh the token once up front and avoid this, but it deliberately **skips** that refresh for RSC/soft navigations to non-guarded routes (a real, pre-existing perf optimization) — and that is exactly the path both an in-app reopen of Messages and the custom `EdgeSwipeBack` component's `router.back()` (the iOS swipe-back gesture) take. The final piece: `getUserBounded()` caught *any* thrown error and mislabeled it `{ kind: "timeout" }`, rendering a "this is taking longer than usual, Retry" button — but retrying re-runs the identical already-broken cookie state forever, since nothing can un-spend a consumed refresh token. That's the actual "stuck in reload" — not a timeout at all.

Fixed in `lib/supabase/server.ts`: `createClient()` is now wrapped in React's `cache()`, so every caller within one request (layout + page) shares a single client/session instead of racing two independent ones. `getUserBounded()` now only classifies its own race-timer rejection as a real timeout; any other thrown error (a genuine invalid/expired session) now correctly returns `signed-out`, sending the user to a real, working `/login` instead of trapping them in an unwinnable Retry loop. This is a general fix at the shared `createClient()` level, so it protects any other route with the same double-auth-call shape, not just `/messages`. Verified: `tsc`, `next lint`, the full 135-test vitest suite, and a full `next build` (152 routes, `/messages` + `/messages/[id]` both compiled) all clean.

## 2026‑07‑16 highlights (batch 68 — chat font-STYLE picker (10 typefaces) + real structural bubble shapes, feed image fixes, nav avatar, a real shared-cache race found+fixed)

Owner corrected batch 66's chat appearance feature: the font picker was a font-SIZE picker (small/medium/large/xlarge) when the ask was a font **style** selection of 10 different typefaces, and the bubble-style picker only ever varied corner-radius — not real "design structure" per a saved reference image of speech-bubble shapes (`public/chat bubble styles.jpg`). Rebuilt both: `FONT_STYLES` (10 — default/classic/elegant/modern/rounded/bold/minimal/mono/handwritten/playful) in `lib/social/chat-appearance.ts`, backed by a new `lib/social/chat-fonts.ts` (8 curated `next/font/google` families at a single weight each, plus 2 free options — the app's own existing body font for "default" and a plain system-font stack for "minimal" — kept in its own file specifically so the API route's zod schema validating the PATCH body never pulls in font-loading code it has no use for). `next/font` only actually downloads a family once something renders with its class, so the 8 "extra" fonts cost nothing for anyone who never opens the picker or picks "default"/"minimal". The DB column/API field deliberately stays `font_size`/`fontSize` (just a text column, no migration needed) — now holding a style id instead of a size id; the TS-level field was renamed `fontStyle` for clarity going forward. Bubble shapes: 5 real structural options now — Classic (corner-pinch tail, the old default), Modern (uniform rounding, no tail), Sharp (boxy), Pill (full capsule), and new **Speech tail** — a genuine protruding triangular pointer via a `::after` pseudo-element (`app/globals.css`) using `background: inherit` so the tail always matches the bubble's actual fill exactly, including the theme gradient, `bg-brand`, or a personal `bubbleColor` override. Verified live via Playwright: the protruding tail renders correctly and color-matches in both the picker's own live preview and a real thread.

While live-verifying the new font picker, found a real bug: clicking a style sometimes silently reverted to "Default" even though the write succeeded server-side (200). Root cause in `features/data/cache.ts` — the app-wide stale-while-revalidate cache used by many features, not just this one: a `revalidate()` fetch started at a component's MOUNT time (e.g. `ConversationRoom` calling `useChatAppearance()` on the already-open thread underneath) could still be in flight when the user fires an optimistic `mutate()` from a different mounted consumer (the sheet, opened on top) — when that slow fetch finally resolved, it unconditionally overwrote the cached data with the older pre-click value, silently clobbering the newer optimistic write with nothing left to correct it. Fixed with a version counter bumped on every `mutate()`; a resolving `revalidate()` now checks whether it's been superseded before writing, discarding a now-stale response instead of applying it. This is real shared infrastructure (feed, home preferences, chat appearance, etc. all build on this same cache), so the fix has broad benefit beyond this one picker — re-verified live after the fix, font-style selection now sticks correctly on the first click.

Also this round: the bottom nav's Profile tab now shows the visitor's real `profiles.avatar_url` (same source already used for the topbar) instead of always the generic person glyph. Feed images no longer visibly shift under touch or press-and-hold — removed an `active:scale-[0.985]` press-feedback treatment (from `FeedImage` and both `MediaCarousel` slide types) that read as the photo itself moving on a large image, not a subtle press cue. Feed images also now open instantly on tap — removed a 220ms tap-vs-double-tap disambiguation delay that held every single-tap open behind a timer; the full-screen `ImageViewer` already has its own independent double-tap-to-like once open, so the inline thumbnail no longer needs to gate opening on that, and a genuinely fast second tap still additionally fires the Wow burst as a bonus without ever delaying the open. The message status line (Sent → Delivered → Seen) had one branch (a brand-new message with no receipt yet) rendering as a plain non-flex `<span>` while every other branch used `flex items-center` — now every branch is explicitly `flex flex-row items-center`, so a status change is a pure content swap, never a layout-direction change.

Discovered but deliberately deferred: while testing, the message list threw a repeated React "duplicate key" warning on a real thread with day-dividers present — traced far enough to rule out a simple JSX key-naming mistake (the two branches sharing `key={m.id}` are mutually-exclusive `if/return` paths within one map iteration, never actual siblings), which points instead at a real client-side bug somewhere in the message-merge logic producing two array entries with the same `.id` (real DB ids are UUIDs with a genuine uniqueness constraint, so this isn't a data-integrity issue at the DB level). Not chased further this round given the message-sync system's history of subtle, carefully-fixed races (see batch 63's typing-auth-race, the RLS-recursion incident) — a rushed fix here risks a regression; flagged for a dedicated investigation starting from every `setMessages` call site in `conversation-room.tsx`. Verified: `tsc`/`next lint`/135-test vitest suite/full `next build` all clean, plus direct live Playwright verification (not just reads) for the font/bubble picker and the cache-race fix. Commits `9500acb` (feed fixes), `9423b95` (nav avatar), `81d2933` (chat appearance redesign + cache fix), pushed and confirmed live via the build-stamp endpoint.

## 2026‑07‑15 highlights (batch 67 — the real "stuck on loading" root cause found, plus a messages UI polish round)

Owner kept reporting the message page gets "stuck on loading" / the PWA "shows an older version" despite several earlier rounds' real, correctly-diagnosed fixes (batch 65's Stories-timeout gap, batch 64's reload-loop guard). Reproduced it 100% reliably this round in a clean local environment (fresh `.next` cache, fresh dev server, service workers explicitly blocked to rule those out first): navigating to `/messages` specifically (not `/home`) triggers a React hydration mismatch near the boot splash's position in the root layout tree. **The actual catastrophic part**: the boot splash's removal is a plain vanilla `<script>` (not React) that captures `document.getElementById('frenz-boot')` ONCE at the top and reuses that reference everywhere — including its own "always fires after 6s no matter what" failsafe. When React discards and regenerates the mismatched subtree, it creates a brand-new DOM node with the same id; the old script's captured reference now points at a detached node, so every hide/remove call afterward — including the failsafe specifically built to guarantee recovery — was silently operating on a node no longer on the page. The real, visible splash was never removed: a genuine permanent stuck-on-the-logo screen, 100% reproducible, with no failsafe catching it. Fixed by having the removal script re-query the live element by id every time it actually runs, instead of trusting the stale captured reference — self-heals regardless of why a mismatch happens, verified live (the page now loads correctly past the point it previously hung forever).

Second, related bug found alongside it: the service worker's `networkFirst` navigation strategy had a hard 10s timeout, falling back to a cached copy or — for personalized, never-cached pages like `/messages` — a dead-end "You're offline" screen whose only recovery path was a browser `online` event, which never fires for a merely slow response (the device was online the whole time). Meanwhile `/messages/[id]/page.tsx` chained three independently-bounded timeouts sequentially (auth 6s + conversation fetch 8s + a stories fetch that was ALSO given 8s despite its own comment calling it "best-effort, never blocks") — a structural worst case around 22s, more than double the SW's cutoff, so the SW routinely won the race and replaced the page's own graceful "this is taking longer than usual, Retry" state with the dead-end offline screen instead. Fixed three ways: SW timeout raised 10s→20s; the offline HTML now self-retries every 5s in addition to listening for `online`; the stories fetch got its own shorter 4s budget instead of sharing the conversation fetch's 8s.

Also this round: Continue Watching wasn't showing on the admin/test account because it was toggled off in that account's own saved Home preferences (cleared directly in the live DB) — and separately confirmed Continue Watching is driven by actual download history (`downloads` table), so it will legitimately show nothing on any account, including the owner's own main account, that hasn't downloaded a video through the app yet — not a bug. Migrations 0076/0077 (batch 66, below) were directly confirmed APPLIED in the live database this round (0073/0074/0075 remain pending). The root layout's page-wide blue/violet/purple ambient wash — the recurring root source of "light purple background" reports patched piecemeal on individual pages across several earlier rounds — was removed entirely in favor of a flat background fill; confirmed via live screenshot that Home, Messages, `/account`, and `/friends` all render pure white now with nothing left to bleed through. The messages inbox header (title + subtitle) was nudged right with a smaller, lower subtitle, while row content (avatar + name) was pulled further left toward the true screen edge — deliberately opposite directions per explicit owner direction, so the two read as an intentional hierarchy rather than one flat column. Row swipe-to-reveal (Archive/Delete/More) previously opened on a light, fast flick because velocity alone could satisfy the open threshold regardless of how little the row had actually moved — raised so a flick only counts if it's also covered a real fraction of the strip. Both the message-bubble and inbox-row "…" menu backdrops switched from `onClick` to `onPointerDown` to close reliably on a background tap — a plain click over a scrollable list can get swallowed by the browser's own tap-vs-scroll gesture arbitration on touch. Verified: `tsc` clean, `next lint` clean, full 135-test vitest suite passing, plus direct live-browser repros (not just reads) for every fix in this round. Commits `2479748` (the two critical bugs) and `d8605ca` (the UI polish round), pushed and confirmed live via the build-stamp endpoint. Full writeup: see memory `messaging-stuck-loading-root-cause-2026-07-15`.

## 2026‑07‑14 highlights (batch 66 — granular blocking, personal chat appearance, thread reload-on-reopen fixed)

Owner dropped a large multi-part messaging ask: remove a purple gradient bleed shown in a screenshot, instant refresh "when a message or any changes occur," a full premium visual pass, granular blocking (chat/status/calls + a general block), user-settable font size + bubble style/color, and "posts shared in chat / profile images shouldn't reload each time." Scoped via EnterPlanMode + two Explore-agent research passes given the size, grounding every claim in current code rather than trusting memory (which had already drifted stale on one point — see below).

**Real findings, all verified against live code before writing anything:** wallpaper full-bleed and the purple-bleed-above-header fix were BOTH already code-correct as of the previous same-day round (re-verified directly, not assumed — if the owner's new screenshot still shows it, that's very likely a stale/undeployed build, not a live bug); the inbox-list live-update trigger (`sync_conversation_preview()`, migration 0075) already touches `conversation_members.updated_at` on every message change, which the inbox's realtime subscription already listens to — no fix needed. The REAL cause of "posts reload every time chat opens": `/messages/[id]` is `force-dynamic` and refetches the whole conversation server-side on every navigation, even reopening the same thread seconds later, with zero cross-mount memory in `ConversationRoom` (shared-post preview cards were already correctly cached separately, confirmed). A real, previously-unknown gap: full blocks never hid Stories, unlike every other content surface.

**Shipped:** a module-level session-warm thread cache (mirrors `message-post-embed.tsx`'s own cache shape) that paints a reopened thread instantly from the last session's state, then quietly resyncs in the background — kills the reload. Granular blocking — new `user_restrictions` table (migration 0076, `scope in ('messaging','status','calls')`) layered under the existing full block, wired into messaging, Stories visibility (closing the real gap above), and the thread header's placeholder call buttons; a new `BlockOptionsSheet` in the chat "…" menu, which previously had zero block/mute/report entry point at all. Personal chat appearance — new `chat_appearance_preferences` table (migration 0077, per-user, not per-conversation — font size scales all bubble text, bubble color/style personalize the viewer's own sent bubbles only), built on the app's existing stale-while-revalidate cache so a change applies instantly across every open thread with no reload; a new `ChatAppearanceSheet` with a live 2-bubble preview. Plus: inbox header spacing tightened, and inbox rows gained real tap-press feedback (a genuine, verified gap — the primary mobile list surface had none while every other interactive element in the app already does).

**Deliberately scoped out, not silently dropped:** a custom per-conversation Chat Theme color beyond the 5 existing presets (the new personal bubble-color picker already covers most of that need); a full re-skin of already-premium surfaces like the typing indicator and reaction picker, spot-checked and found already at the bar set by 15+ prior polish rounds.

Verified: `tsc`, lint, the full 135-test vitest suite, and a full `next build` (152 routes, both new API routes confirmed compiled) all clean. Not verified live in a browser this round (no authenticated test session set up in this pass) — flagged honestly rather than claimed. Migrations 0076/0077 need the owner to apply, same as every prior round.

---

## 2026‑07‑14 highlights (batch 65 — root cause of the "stuck in loading" reports: an unhandled auth-promise rejection)

Owner escalated: "the message page auto refresh and gets stuck in loading when i try to go back with the ios back gesture and not the top back button... is now happening in all accounts" — worse than a similar-sounding admin-only bug from 2026-07-12.

`features/auth/use-user.ts`'s `useUser()` hook — which backs the app-wide header/topbar's UserMenu on every authenticated page — called `supabase.auth.getUser().then(...)` with no `.catch()`. Batch 63 had already found and confirmed a real browser race earlier the same day: a freshly-installed service worker calling `clients.claim()` mid-fetch can make an in-flight `fetch()` throw a raw network error even though the server never saw the request. When `getUser()` hits that exact race, the promise rejects — and with no `.catch()`, the `.then()` callback simply never runs, so the hook's `loading` state (initialized `true`) never clears. No error, no retry, no timeout — just permanently stuck.

An Explore-agent audit of the entire codebase for the identical shape (a bare `.then()` off `.auth.getUser()`/`.auth.getSession()` gating a loading-type boolean, with no `.catch()`) found this was the only site with the exact fault — not a repeated mistake elsewhere. Fixed by failing open (treats the failure as "not signed in" for that render, which self-corrects moments later via the same effect's `onAuthStateChange` listener) instead of hanging forever. Also hardened the `getSession()` call added to `use-typing.ts` earlier the same day with the identical fallback, since it had the same missing-`.catch()` shape (though it doesn't gate a visible loading state, so it wasn't reproducing this exact symptom — just a latent version of the same class of bug).

Verified concretely rather than by inspection alone: used Playwright's request interception to forcibly abort the real `auth/v1/user` network call (reproducing the exact rejection on demand instead of hoping to hit the timing window), and confirmed the UserMenu's loading skeleton cleared and the real avatar rendered — before the fix, that same forced failure would have left it spinning forever, by basic Promise semantics.

Not independently re-verified: the specific iOS edge-swipe-vs-button distinction, and "now happening in all accounts" vs. previously narrower — no real iOS device or standalone-PWA lifecycle is available to this session's tooling. This fix closes one concrete, confirmed mechanism that produces the reported symptom; it may or may not be the entire explanation.

`tsc` clean, full 135-test vitest suite, a full `next build`. Commit `4c40d3f`, pushed, deployed via `vercel --prod`, confirmed live via the build-stamp endpoint.

---

## 2026‑07‑14 highlights (batch 64 — same-day follow-up: dark-mode list regression reverted, wallpaper made full-bleed, sound-modal open bug fixed)

Owner caught a real regression from batch 63 within minutes of it shipping: "the message page doesnt switch to dark mode but the inside chat switched." Batch 63's `FORCE_LIGHT_VARS` fix had over-corrected — the original ask was about the chat THREAD's default background, not locking the whole inbox LIST to light mode forever. Reverted: removed the forced-light override from the list (mobile page, desktop pane, and the header's own dropdown/popovers, which had been forced light to match), swapped hardcoded `bg-white` for theme-reactive `bg-background` everywhere in that subtree. Once everything in the list consistently follows the SAME real theme, the original "text invisible in dark mode" bug doesn't come back either — it was only ever a mismatch between a forced-light ancestor and theme-reactive descendants.

Also fixed the same turn: the purple ambient-gradient bleed was STILL showing (a second, different gap this time — `messages/layout.tsx`'s outer wrapper has its own `pt-[env(safe-area-inset-top)]` padding never covered by any opaque background, unrelated to the list's own scroll container already fixed in batch 63); wallpaper made genuinely full-bleed ("top 0 bottom 0 just like chat theme") via a new shared `ThreadAppearanceProvider` context that lifts theme/wallpaper state above both the thread header and the message room (previously two independent, unsynced pieces of state — the header never even lived-updated at all) so one image can span the whole screen instead of being cropped by solid header/composer bars; and a real regression in the "message sound" modal — introduced by batch 63's own header-dropdown rebuild — where clicking it closed its own parent dropdown in the same tick it tried to open, discarding the state before it ever rendered. Fixed, and given a proper premium redesign (icon-badge header, per-row icons) per the owner's ask in the same message.

Confirmed via a fresh live-database query: migration 0073 is still not applied — wallpaper save remains blocked on that alone, not code, and the full-bleed image path couldn't be exercised end-to-end for that reason (verified structurally sound instead, using the already-working Chat Theme feature as a stand-in through the same new shared context — a screenshot showed the theme tint carrying seamlessly across header/messages/composer with zero seams).

Two additional reports from the same message — the page fully reloading on the iOS edge-swipe back gesture, and the installed home-screen "webapp" not showing live updates (typing, refresh) until a manual reload, while a normal browser tab works fine — were investigated but not confirmed or fixed with certainty. No `beforeunload`/`unload` handlers exist in the codebase (ruled out). Two plausible, non-code-changed explanations were given to the owner instead of a guessed fix: the installed PWA may simply not have picked up today's deploy yet (the existing service-worker update-reload logic needs a fresh relaunch or ~60s+ backgrounding to trigger), or a service-worker update completing at the exact moment of a gesture could look identical to "the gesture caused a reload." Neither is verifiable in this environment — no real iOS device or standalone-PWA lifecycle available to Playwright.

Verified: `tsc` clean, full 135-test vitest suite, two full `next build`s, direct empirical Playwright repros for every fix that could be exercised. Commit `ed4a073`, pushed, deployed via `vercel --prod`, confirmed live via the build-stamp endpoint.

---

## 2026‑07‑14 highlights (batch 63 — the real typing bug, found via raw WebSocket frames; dark-mode color inheritance; header dropdown overflow; overscroll bleed-through)

Owner's follow-up round after batch 62's fixes: wallpaper still failed to save, typing STILL wasn't showing, the options sheet still looked novice, the disappearing-messages notice seemed not to persist, the header's "…" still overflowed on the x-axis, and — mid-turn — a purple flash appeared at the top/bottom of the list while scrolling.

**Typing — the actual root cause, finally.** Batch 62's `router.refresh()` regression was real and really fixed, but it was never the whole story. Text-based Playwright assertions (`locator("text=/typing/i")`) had been giving unreliable signal in both directions this round — a false pass once matched a composer placeholder that happened to contain the word "typing" (a test user literally named "Typing A"), and a false-looking fail was actually a slow local dev box still on a loading screen. The only way to settle it was to capture the actual WebSocket traffic. That showed it directly: `typing:<conversationId>` is a `private: true` presence channel, and Realtime Authorization requires a valid JWT on the JOIN frame itself for `auth.uid()` to resolve inside the RLS policy (migration 0066). `use-typing.ts`'s `acquireChannel()` created and subscribed this channel synchronously on mount — on a fresh page load this can race ahead of the Supabase client's own async session bootstrap, and the join frame went out with no `access_token` field at all (confirmed byte-for-byte against sibling channel joins in the same capture, every one of which had one). The server rejected it outright: `"Unauthorized: You do not have permissions to read from this Channel topic"`. Every other realtime channel in this app is non-private, so none of them were ever exposed to this exact race — typing was the only reachable case, which is also why it read as "worked once, then stopped" rather than "always broken." Fix: `await supabase.auth.getSession()` once before `.subscribe()`. Re-verified via the same frame-capture technique (access_token now present, join replies `{"status":"ok"}`) and a screenshot of the real "X is typing…" pill rendering end-to-end.

**Dark-mode text inheritance — the FORCE_LIGHT_VARS gap.** Last round's fix (override the CSS custom properties on a wrapper) worked for every element with its own explicit `text-foreground`/`text-muted-foreground` class, but a bare `<h1>` or an unclassed row-name `<span>` inherits `color` from `<body>` as an already-resolved computed value, not a live reference to the variable — so the page title and row names stayed invisible light-on-white in dark mode. Fixed by having `FORCE_LIGHT_VARS` also set `color` explicitly, which every unclassed descendant then inherits correctly. The identical gap, found independently, was breaking the new header dropdown (below) and its Presence/Notification sub-popovers, both fixed the same way.

**The real "dotted menu."** The owner's repeated "opens on the x-axis, breaks overflow-x hidden" was never about `ThreadOptionsSheet` (already y-axis, correctly fixed last round) — it's `InboxHeaderActions`'s own "…" toggle, which revealed 4 more tools inline via an `x: 12 → 0` slide, wide enough to overflow a narrow mobile header. Rebuilt as a real portaled dropdown that opens downward (matching UserMenu's own pattern), with Search/Status/Sounds re-styled as vertical menu rows instead of bare icon circles.

**Overscroll bleed-through.** The mobile list's `overflow-y-auto` scroller had no outer clipping wrapper, so an iOS rubber-band bounce past either edge could reveal `app/layout.tsx`'s fixed ambient gradient behind the page. Split into an outer `overflow-hidden` white box + an inner `overflow-y-auto overscroll-y-none` scroller — exactly the "overflow-y hidden but still scrollable" the owner asked for — applied to the desktop pane's list and the thread's own message scroller too.

**Wallpaper + disappearing-messages, re-confirmed.** Wallpaper save is blocked purely on migration 0073 (`conversations.wallpaper_url`) never having been applied — confirmed directly against the live database (`column "wallpaper_url" does not exist`). Along the way, a genuine, separate transient bug was found and fixed: a fresh service-worker install racing `clients.claim()` against an in-flight settings PATCH can throw a raw network `TypeError` even though the server never saw the request — `ThreadOptionsSheet`'s save path now retries once. The disappearing-messages system notice itself was directly confirmed, via a real two-account test with a genuine hard reload, to persist correctly server-side; no code bug there once the service-worker race was ruled out.

**Also shipped:** `ThreadOptionsSheet` redesigned further per "still looks like novice" — a WhatsApp/Snapchat-style contact-info hero (avatar, name, verified badge) replacing the plain title bar, every section now using the app's own mandatory `ModuleIconBadge` 3D glass-tile icon instead of flat gray circles; WhatsApp-style hairline dividers added between every conversation row.

Verified: `tsc` clean, the full 135-test vitest suite, four full `next build`s across the round, and direct empirical before/after repros (WebSocket-frame capture for typing, a real hard reload for the disappearing notice, screenshots for dark mode/dropdown/options-sheet) rather than trusting a static read. Commit `b0eefea`, pushed and deployed via `vercel --prod`, confirmed live via the build-stamp endpoint. Migrations 0073/0074/0075 still pending owner apply — 0073 specifically is now a confirmed, deterministic blocker for wallpaper.

---

## 2026‑07‑12 highlights (batch 55 — Premium Messaging V2 Part 11a: real account security — TOTP 2FA, recovery codes, WebAuthn passkeys, a quick-lock PIN, device trust/naming, and a security audit log)

Owner dropped a very large "Security, Privacy, Trust, Safety & Moderation Platform" spec (Part 11). Given the size — full end-to-end encryption of every message/call type, MFA/passkeys, a moderation pipeline with risk-scoring and appeals, parental controls, encrypted backups, and two "exclusive feature" dashboards, each individually a substantial feature — it was audited then scoped into sub-parts with the owner's sign-off before writing any code (11a: account security/devices, shipped this round; 11b: message privacy + a real Secret Chats E2EE mode; 11c: moderation pipeline + Privacy Dashboard + Trust Center, both queued next).

A fresh codebase audit found real, extendable primitives already in place (email-OTP+password+Google auth, a working session list/revoke system, `privacy_settings`'s self-owned-row pattern, `blocks`/`muted_creators`, a `reports` table with a 3-report auto-hide trigger) but **zero** MFA/passkey/encryption/audit-log infrastructure anywhere — confirmed by grep, not assumed.

**Shipped for real, migrations `0053`–`0059` to apply:**
- **TOTP two-factor authentication** via Supabase's own native `auth.mfa` API (no new library) — enroll/verify/disable UI, and an MFA-challenge step (`/login/mfa-challenge`) now sits in front of every login path (OAuth/magic-link callback, the box-code flow, and password sign-in) for any account that enrolls. Zero effect on accounts that don't.
- **Recovery codes**, scoped deliberately narrowly per the owner's own constraint: a code can only unstick an *already-signed-in* session's 2FA gate (via Supabase's own admin factor-removal API), never mint a session from scratch — no custom auth bypass was built.
- **WebAuthn passkeys** (`@simplewebauthn/server`+`browser`, 2 new deps) as a real Face ID/Touch ID/Windows Hello **step-up verification gate** for sensitive actions (recovery-code regeneration, disabling 2FA) — deliberately NOT a passwordless-login replacement, since Supabase Auth has no native WebAuthn factor type and minting a session from a custom-verified assertion would need a bespoke, riskier path.
- **App-level quick-lock PIN** — a full-screen keypad gate on `/messages` and `/account/security` after an idle timeout, server-side lockout after 5 failed attempts.
- **Device naming + "trusted device"** layered onto the existing session list without altering Supabase's own `auth.sessions` table.
- **A generic, append-only `security_audit_log`** (login, device-added, MFA/passkey enroll+remove, session revoke, password change, recovery-code use/failure, PIN lockout) — built with an unconstrained `event_type` specifically so the next round (moderation pipeline) can extend it with zero new migration.
- New `/account/security` page consolidating all of the above; a real "Recent activity" list reads straight from the audit log.

A genuine `bytea`-serialization bug (Buffer objects don't survive supabase-js's JSON encoding into a `bytea` column — PostgREST expects/returns hex-encoded `\x...` strings) was caught and fixed during verification, before it ever shipped, via `lib/security/bytea.ts`'s `toBytea`/`fromBytea` helpers — would otherwise have silently broken every PIN check and passkey verification in production while looking correct in code review.

Verified: `tsc --noEmit`, `next lint`, `next build` (152 routes, including all new ones), and the full 124-test vitest suite all clean.

---

## 2026‑07‑12 highlights (batch 54 — mockup-faithful display rebuild + a critical database-policy bug that had silently broken all live messaging)

Owner rejected the previous nav/chat pass as not following the supplied mockups, reported eight more real problems (typing/haptics dead, reactions send no push, only the admin account receives pushes, can't accept requests or follow back, a security alert on every app entry, the colorful loader replaying when returning Home, messages refresh still stuck on a loader, theme flashing the wrong mode for a second on entry), and asked for a full production-grade startup audit before fixing the loader class of bugs. New standing rule saved: **never simplify or drop anything from an owner example or instruction.**

**The biggest find — one database policy had silently broken every "live" part of messaging since group chats shipped.** The rule that decides "who may read the chat-members list" referred to itself, which the database treats as an error ("infinite recursion") — and because every page LOADS its data through the server (which bypasses those rules), everything *looked* fine while everything *live* failed: new messages didn't appear in an open chat until a refresh, reactions never actually saved (the little pill showed for a second, then vanished — and could never push a notification, because there was nothing to push about), the typing indicator could never connect, and live attachment/receipt updates were dead. Confirmed empirically by signing in as a real user and watching the database return the recursion error. **Migration 0052 fixes all of it** (a safe helper function replaces the self-referential rule everywhere it appeared) — typing, live delivery, live reactions and reaction pushes all start working the moment it's applied.

**Displays rebuilt to the mockups, faithfully this time.** Messages: big bold title with compose + "..." circles, the glass "Search messages" pill, a real All / Unread / Groups / Requests tab row with live count badges — Requests is a working surface (incoming friend requests with Accept/Decline, verified end-to-end against the database), pinned chats sit above a RECENT section, rows got the larger ringed avatars, presence dots, ✓-prefixed previews and gradient unread badges, and the global top bar now steps aside on that page so it starts straight at the title like the mockup. Chat thread: glass back circle, "Active now" presence wording, phone/video circles (honest "coming soon" for now — no call engine exists yet), TODAY/date dividers, a time under every message, "Seen 9:17 AM ✓" style receipts, and the composer rebuilt as attach-circle + one pill input carrying gallery/mic buttons + a round gradient send, with a personalized "Message Maya…" placeholder. Home: the "● FROM SOMEONE YOU FOLLOW" eyebrow above each post exactly like the mockup. Bottom nav: floating pill with the active tab's icon riding a raised glowing circle, the mockup's gradient round Create button, and the whole bar now tucks down into the home-indicator area in the installed app instead of floating high above it.

**Haptics finally work on iPhone.** iOS Safari has never supported the web vibration API — every haptic call was silently doing nothing on exactly the devices the owner tests with. Added the one real workaround the platform has (a hidden native switch control whose toggle fires the system tick), so taps now click on iOS too; plus a soft audible tap sound on every nav button as asked.

**Security alert spam explained.** "New device signed in" fired on every app entry because the check assumed it only ran right after a login; on a two-device account, whichever device didn't create the most recent session looked "new" forever (the delivery log showed the admin account getting 7 copies at a time). It now only fires within 15 minutes of an actual sign-in, compares against pre-login history only, and won't repeat within 12 hours.

**The remaining "stuck at loading" class, audited then fixed at the root.** Full startup trace in `docs/STARTUP_AUDIT.md` (every boot step, what can block, what can fail, races, bottlenecks). The two remaining un-time-boxed waits on the critical path were the session check in the middleware (a stalled connection there held the ENTIRE page — nothing painted at all) and the same check at the top of the messages pages (data queries were already time-boxed, the auth step before them wasn't). Both now race a hard timeout; a slow network degrades to a Retry screen or an un-refreshed pass-through — never an infinite loader, and deliberately never a false "logged out" redirect. Also fixed: the colorful welcome splash replaying on every return to Home on a new device (the page cache kept serving the splash long after it had been seen — it now re-checks at mount), and the 1-2 second wrong-theme flash on entry with theme=System (iOS reports the system theme late on launch; the boot script now listens for the correction instead of reading it once).

**Notifications can now act.** A friend-request notification carries real Accept/Decline buttons and a single-person follow notification carries Follow back — verified live (accept created the friendship row in the database). Message-reaction pushes are wired (they'll flow once 0052 is applied, since reactions couldn't even save before). On "only the admin gets pushes": the delivery log proves sends to other users succeed (status 201 from Apple/Google) — those devices are running a stale service worker from before its eval fix and will heal on their next app open; worth re-checking the log after a day live.

## 2026‑07‑12 highlights (batch 53 — nine messaging bugs fixed one at a time, Notification System Parts 8-9 committed, Premium Messaging V2 Part 10: search + starred messages)

Owner sent a list of nine separate real-world problems plus a "couldn't find audio/music/download in chat" note, asked whether Parts 8 and 9 were actually done, and asked to continue straight into Part 10 once everything was fixed — committing and pushing at the end this time.

**The colorful boot logo now only shows on a real cold start or right after signing in — never on a plain refresh or normal navigation.** It used to show on every hard page load, refresh included, because a refresh and a true first-open look identical to the browser. Fixed by remembering "this browser tab already booted once" for the rest of that session, and giving login its own one-time pass so signing back in still gets the colorful moment even in an already-booted tab. Also: the purple glow behind the logo — read as "the logo itself looks blurry" — is gone entirely, and the logo itself is noticeably bigger on the two moments it's still allowed to appear.

**The "..." menu on a message (Reply/Forward/React/Pin/Edit/Delete) was invisible on desktop.** It doesn't error, it just doesn't show up — the menu was being positioned using the whole screen's coordinates, but a premium blur effect on the surrounding panel was quietly changing what "the whole screen" meant to the browser, pushing the menu hundreds of pixels off to the side, out of view. Same root cause hit the "..." menu on each inbox row and each notification when tapped near the bottom of the screen (a different, related clipping issue) — both fixed the same way.

**Push notifications arriving ~2 minutes late, explained and fixed.** The send-a-push step was written as "fire it off, don't wait for it" right before the app finishes responding to whatever triggered it (a new message, a follow, a comment) — and on this app's hosting, the server is allowed to freeze that in-flight work the instant it's done responding, sometimes not finishing it until some unrelated later visitor happens to wake that same server back up, which could be minutes later or never. Fixed at all nine places in the app that send a push this way, using the hosting platform's own "keep this running until it's truly done" primitive instead of a bare fire-and-forget.

**Tapping a message notification on mobile got stuck loading; the inbox got stuck loading after an iPhone back-swipe or a refresh.** Two separate causes. First: tapping a notification while the app was already open told the service worker to force a full hard reload of the page to the new location — a mechanism that's known to be unreliable specifically on iPhone, and could leave the tab stuck mid-navigation. Changed it to just hand the destination to the already-running app and let it navigate normally, the same fast path a regular tap already uses. Second: the "refresh stale data when you come back" logic listened for the tab being backgrounded-and-returned, but iPhone's "swipe from the edge to go back" gesture restores a frozen snapshot of the page without ever technically backgrounding it — so nothing ever told the app to check for fresh data, and it just sat there showing whatever it was showing the moment you swiped away. Added the specific signal for exactly that case, app-wide (not just the inbox), which should also cover the laptop-app-stuck-on-open report since it's the same underlying gap.

**Posts that had genuinely vanished from feed and reels, explained.** There's an existing, working anti-abuse rule: once a post collects 3 reports, it's automatically hidden pending review — a real, intentional safety feature. What was missing: the person who posted it was never told any of this happened. From their side, a real post they made just silently disappeared with zero explanation. The rule itself is untouched; the owner now gets a real notification (in-app and push) the moment it happens, explaining what's going on.

**Typing indicators, in-app sounds, and "last seen."** The typing indicator's actual code and its underlying database permission were both already correctly built — no bug found there; if it's still not showing live, that now points at something environment-specific worth a fresh live test rather than a code problem. The sounds bug was real: browsers refuse to let a web page play any sound until the person has clicked or tapped SOMETHING on the page first, and the very first sound most people would hear is an incoming message — which fires from a background network event, not a click, so the browser was silently refusing it forever. Fixed by priming sound playback the moment the person does anything at all on the page. "Last seen" never existed as a feature at all (not a regression) — built it for real: chats now show "last seen 5m ago" style text for someone who isn't currently online.

**The side "..." menu that was cut off at the bottom of the screen** — same root cause and same fix as the message-actions menu bug above; both were "..." dropdown menus computing their position wrong relative to a blurred container.

**Audio/music sending, checked and fixed.** The backend already fully supported sending an audio file as a message (the exact same system voice notes already use) — but the "+" attachment picker only ever offered Camera, Gallery, or Document; there was simply no button to pick an existing audio/music file from the device. Added one.

**New: group owners/admins can now turn off member messaging.** A real toggle in the group info sheet — when it's on, regular members can still read everything and react, but only the owner or an admin can actually send a message; the composer shows a clear "Only admins can send messages" notice instead of just silently failing.

**Notification System Parts 8-9 were already fully built from an earlier session but never committed** — confirmed and pushed now: achievement/milestone notifications (real follower/download-count milestones, not fake AI), a frequency cap so a burst of activity can't flood someone with push, a daily digest, notification history export + clear-all, and one consolidated internal API new features can call instead of hand-rolling their own notification logic each time (existing call sites deliberately left alone this round, documented as a real follow-up, not migrated in a rush).

**Premium Messaging V2 Part 10 — the owner's spec described a "world's smartest" AI-powered search platform:** semantic natural-language search, voice search, visual/photo search, a knowledge graph, and search across products that don't exist in this app (Communities, Marketplace, Business Chats, AI Chats, Life Memories, Cloud Files). Built the real, honest slice instead: genuine full-text search across every message in every chat you're actually in, reachable from a new search icon on the Messages page, plus a real "Starred Messages" save feature (distinct from the existing shared thread-pin — starring is private to you) with its own view and a working "jump to that exact message in its chat" link. Explicitly NOT built this round, same discipline as every other part: AI/semantic search, voice search, visual/OCR search, automatic smart categories, "smart collections" (Photos Together, etc.), knowledge-discovery statistics, and cross-product search into things that aren't real products here yet.

Full clean run of typecheck, lint, the production build, and the automated test suite after every step, not just at the end.

## 2026‑07‑12 highlights (batch 52 — service worker was completely broken since it was first built, plus a project-wide dead-write sweep)

Owner sent real screenshots: trying to turn on notifications failed with `SyntaxError: Can't create duplicate variable: 'SWX'` on mobile and `ServiceWorker script evaluation failed` on desktop — and asked, fairly, whether previous fixes had actually been done at all.

**The real answer: this specific bug had nothing to do with anything fixed earlier — it's a structural problem that's existed since the service worker was first built, several sessions ago, and no prior review ever caught it.** The service worker is split across 8 files that all get loaded together into one shared space in the browser. Every one of those 8 files started with the same line declaring a shared variable — which works fine the FIRST time, but the browser refuses to declare the exact same variable a second time the same way, so starting with the second file, the browser threw an error and gave up loading the rest — meaning the service worker, as a whole, could never actually finish loading. Since push notifications depend on the service worker being alive, "Enable notifications" was doomed to fail from the very beginning of that feature existing. Fixed by changing how that one shared line declares itself so browsers allow it to repeat across files (the exact same reuse-the-existing-object behav9or was always intended — just written in a way real browsers reject). Actually opened a real browser and registered the service worker for real to confirm it now completes successfully, rather than trusting a look at the code.

**While specifically hunting for anything else this severe, found a second, wider bug class: some "quietly update this in the background, don't make anyone wait for it" database writes had never actually been running, ever.** The library that talks to the database only sends a request once something explicitly "uses" the result — writing "do this in the background" code without that one extra step silently builds the request and then throws it away without ever sending it. Confirmed this precisely with a small isolated test (watched whether a real network call fired or not) rather than guessing from documentation. Found and fixed five real instances across the app: a message's "Delivered" checkmark, the download counter on a post (had never once incremented), and a developer API key's "last used" timestamp — all silently no-ops until now.

**Also, per an explicit request for a genuinely independent second look, a related caching bug was found and fixed**: the service worker was saving a copy of EVERY page you visit, including your own private messages page, in one shared storage bucket with no separation between different pages/users. On a slower connection — which an installed home-screen app experiences far more often than a normal browser tab — that could serve a stale (or, worst case, a completely different signed-in person's) copy of the page instead of your current one. This is the concrete, "only in the installed app, never in the browser" explanation for the messages page getting stuck. Now only genuinely public, non-personal pages are ever saved that way. Also added an outright 8-second cap to how long the messages/inbox page will wait for its data before showing a "try again" button instead of spinning forever, regardless of the cause.

**Also corrected two things flagged as "already fine" that weren't**: the icon color gradient was rebuilt again — the first attempt still leaned too dark/black at the small size icons actually render at, screenshotted at real size this time before calling it done. The everyday loading screen (shown on every normal refresh or sign-in, not just the one-time welcome) now shows the real, full-color logo — this had been left deliberately muted on the reasoning that the colorful version was reserved for a rarer, once-ever moment, but after being asked for this three times, that reasoning was simply the wrong call for what was actually wanted.

Full clean run of typecheck, lint, production build, and the automated test suite throughout — plus, this time, real executable checks (an actual service-worker registration in a live browser, an actual network-call spy test) rather than confidence from reading the code, specifically because a code-only review is exactly what let both of today's root causes go unnoticed for so long.

## 2026‑07‑12 highlights (batch 51 — ten polish/bug fixes + messaging cross-check + Notification System Parts 6-7)

Owner sent a list of ten separate real-world complaints in one message, then asked to continue with two more large spec parts once those were done.

**Trending Reels now only shows on larger screens, and genuinely costs nothing on mobile.** It wasn't just hidden with CSS — the code was changed so that on a phone-sized screen it never even fetches its data or starts autoplaying its videos in the first place, which is where the real battery/data cost was. The Reels button in the feed's own top tabs (the thing that replaces Trending Reels as the way into Reels on mobile now) was given a solid colored background so it's unmistakably a button, not just another plain icon.

**Every icon that had gone flat black or flat white got its color back — but a calmer, more "premium" version of the color, not the original bright one.** A few sessions ago the purple/blue gradient on every nav icon was toned all the way down to plain black-or-white because it read as "too much purple splashing." This round brought the color back as asked, but designed as a deep, moody navy-into-blue-into-purple blend rather than the old bright, fully-lit version — checked at the actual small size these icons render at (a 3-color gradient can look almost one-color at 36 pixels if it's not tuned for that), and adjusted twice after literally screenshotting it before calling it done.

**Live video recording removed from comments; photo attach and voice notes stay.** Looking closely at how the existing "add a photo" button already works, it turns out the phone's own picker already offers gallery, downloads, AND camera-photo in one combined menu — so nothing new had to be built for that part of the request, only the separate "record a video right now" button needed removing.

**The multi-photo post scrolling bug turned out to be half already-fixed, half a red herring.** The actual scroll-blocking behavior had already been fixed in an earlier session. What was still happening: hovering over ANY multi-photo post showed a hand/pointer cursor across the whole thing (a default browser behavior for anything tappable), which looks exactly like "this is grabbing my mouse and won't let me scroll" even though scrolling worked the whole time. Confirmed this with an automated test simulating real mouse-wheel scrolling before and after, then fixed the cursor to look like a normal arrow, matching every other post.

**The loader/skeleton request needed no changes at all** — checked carefully and the colorful splash screen already only shows on a genuine first visit or after clearing site data, and every other loading skeleton in the app was already plain gray with no color, exactly as asked. Verified rather than assumed.

**The share-link preview card got a real "premium" pass**, not just a re-save: a subtle metallic ring around the logo badge (so it reads as a coin/medallion instead of a flat sticker), a thin frame around the whole card (the kind of detail higher-end product packaging uses), a third soft light source for more depth, and a new, more distinctive typeface for the "Frenz" word — swapping fonts here hit a real technical snag (the new font's raw file crashed the image-generation engine with a cryptic error) that took a proper font-processing tool to fix correctly rather than papering over.

**"Home always feels slow to load"** turned out to be a side effect of how actively this app gets updated. There's a safety feature that reloads the whole app if it detects a newer version has been deployed while you were away — correct behavior in general, but during a day with lots of updates going out, it was triggering on almost every brief app-switch, not just genuine long absences. Now it only checks after you've actually been away for a real stretch of time (about a minute), not a quick glance at another app.

**The "failed to turn on notifications" error had two real causes.** One was a configuration value that likely had an invisible extra character at the end from being copied into a settings dashboard — a very common, very hard-to-spot mistake that silently breaks the browser's ability to register for notifications. The other was that the error message shown to users blamed "your connection" no matter what actually went wrong, which was misleading and made it harder to diagnose. Both are fixed, and the two different failure types now show accurate, distinct messages.

**The "messages page gets stuck loading" bug had a real, structural cause**: every time you opened a chat, the app was quietly opening a brand-new live connection to the server without properly closing the old ones when you left. Do that enough times in one session — open a few chats, back out, open a few more — and those un-closed connections pile up until new ones stop working properly, which shows up as the page getting stuck on a spinner. Fixed by making sure there's only ever one shared connection for the whole session, and that every feature properly closes its piece of it when done.

**A cross-check of the messaging system (built over the past several sessions) turned up four more real bugs**, found by deliberately having a second, independent review look for problems rather than just re-reading the same code: leaving a one-on-one conversation through the wrong screen could accidentally lock you out of that chat permanently; a reaction (like a heart or emoji) added to a message right as it was being deleted could get stuck showing forever on a message that's supposed to be gone; a connection that failed on its very first attempt could get stuck saying "connecting" forever with no way to recover; and two photos/videos sent back-to-back before either had fully gone through could, in a rare timing case, cause one of them to silently vanish from the chat. All four are fixed — and in a genuinely useful moment, a SECOND independent check of the fix for the "stuck connecting" bug caught that the fix itself had a subtle mistake that would have quietly broken it again after the first retry, which was caught and corrected before it ever shipped.

**Then, as requested, work continued into the two new large specs — Notification Settings and Delivery Reliability.** Built a real settings page (on the Account page, next to the existing privacy/profile settings) where notifications can be turned on/off overall, by delivery method (push vs. in-app), and by category (Social, Downloads, Communities, News, Premium, Security, System) — each with its own "show it at all" and "buzz my phone for it" switches. Added one real "Quiet Hours" window (not the spec's unlimited named schedules like "Sleep Mode"/"Gym Mode" — one honest, working window covers the real need) that holds back push notifications during that time, except for security alerts, which always get through no matter what. Added a "hide message previews in push" privacy toggle, so a locked phone shows "New message" instead of the actual text if wanted. Every one of these settings is actually wired into the real notification-sending code, not just saved and forgotten — turning off a category genuinely stops it from pushing to your phone AND stops it from showing in the bell/notification list.

On the reliability side: every push notification attempt (success, retry, or failure) is now logged, a failed send gets one automatic retry before giving up, and a new admin dashboard section shows real delivery health (how many sent, how many needed a retry, failure rate, common error reasons) — the same style as the existing messaging-health dashboard. A cleanup job keeps that log from growing forever. Deliberately not built: a separate message-queue/Redis system, multi-region servers, or unlimited custom notification-sound packs — all real infrastructure this app's current scale doesn't call for yet, same reasoning already applied to earlier parts of this feature.

**Migrations 0046 and 0047 need the owner's apply step** (alongside 0041-0045, still pending from the previous round). Full clean run of typecheck, lint, production build, and the automated test suite (93 tests) throughout, plus real before/after screenshots for every visual change before calling it done.

---

## 2026‑07‑11 highlights (batch 50 — Feature 12 Premium Messaging V2 Part 5: media messaging)

Owner cross-checked Part 4 personally first and reported a real bug: *"the message option toggle display improperly when tapped at the bottom of the screen and make other things didn't show."* The per-message "..." menu had already been fixed once this session to stay on-screen horizontally on narrow phones, but that fix never accounted for the VERTICAL direction — tapping "..." on the last message in a chat (which is right above the message box, i.e. always near the bottom of the screen in any real conversation) could push the menu below the visible screen with the lower buttons unreachable. Fixed by having it check how much room is actually left below before opening, and flip upward instead when there isn't enough — confirmed on a real phone-sized screen with the worst case (a message with every option available) that all six buttons are now fully visible. The owner also confirmed they'd committed the previous work themselves but weren't sure everything made it in — checked directly against the commit and confirmed all 50 changed files from Parts 3 and 4 are present.

Owner then dropped Part 5's spec: media messaging — photos, videos, voice notes, documents, music, contacts, location, and more, plus a specific ask (*"users should be able send audio they downloaded and videos they downloaded"*). Real media attachments in chat is something every prior part of this feature had explicitly deferred until now, so this was the round to actually build it.

**Photos, videos, voice notes, and documents can now genuinely be attached to a message.** A new "+" button next to the message box opens Camera, Gallery, or Document — pick a file and it uploads immediately (shown as a small preview chip while it does), then send it with or without a caption, up to 10 files per message. The microphone button records a real voice note with a live waveform, exactly like the voice notes already built for comments — and that turned out to be the biggest time-saver of this whole round: the voice recorder and the video/audio playback bubbles built for comments months ago were written generically enough that they dropped straight into messaging with no changes needed at all, turning what looked like a multi-day build into a few hours. Tapping a photo opens it fullscreen; videos and voice notes play right in the bubble.

**The owner's specific ask — sending something you just downloaded straight into a chat — is built.** Rather than guess how to wire this up, first traced exactly how the existing "Publish to everyone" button (on a downloaded video) already works: by the time that button is tappable, the actual downloaded file is already sitting in the browser as real data, and publishing just uploads that same file. Added a matching "Send to chat" option right next to it that reuses the exact same already-downloaded file and the exact same upload step, then lets you pick who to send it to.

**A real security gap was found and closed while double-checking this work.** The check that a message attachment is legitimate only confirmed it "looks like a URL" — it never confirmed the file actually came from Frenzsave's own storage. That meant, in theory, someone could have crafted a message that looked like a normal shared photo or document but secretly pointed at a malicious link hosted somewhere else entirely. This same gap already existed in the older photo/video-posting code too (not something new from this round), but a private chat is a more trusted-feeling place for exactly this kind of trick to work on someone, so it was worth fixing properly here: every attachment URL is now checked against Frenzsave's own storage before it's allowed to save.

**What's deliberately not built, and why:** an in-app licensed music library (needs real licensing deals this app doesn't have), a "Frenzsave Cloud" file system (isn't a feature that exists anywhere else in the app to connect to), sharing your contacts/location/calendar events (real work, just lower priority than the core media types this round), GIFs and animated stickers (needs a paid third-party service this app isn't signed up for), any AI-generated or marketplace/community content cards (all reference other big features already deferred elsewhere), pinch-to-zoom on photos (confirmed nowhere else in this entire app has real pinch-zoom either — not a regression, just not re-inventing something that doesn't exist yet), and a precise upload percentage/speed/time-remaining display (shows a simple "uploading" spinner instead — a real progress bar needs a bigger technical change than this round's scope).

**Verification:** the real, actual components (not a rough mockup) were driven with browser automation again showing every attachment type rendering correctly, the fullscreen photo viewer, and the attachment picker — checked at both a normal desktop size and a real phone width, no display problems found. Full clean run of typecheck, lint, production build, and the automated test suite after the security fix too.

**Migrations 0041 through 0045 all still need the owner's apply step**, and the owner asked for one more cross-check once this was finished, followed by committing and pushing everything from Part 1 through Part 5.

---

## 2026‑07‑11 highlights (batch 49 — Feature 12 Premium Messaging V2 Part 4: notifications, alerts & smart delivery)

Owner's Part 4 spec asked for the "world's most premium messaging notification system" — every notification type imaginable, custom sound packs, lock-screen reply, haptic pattern libraries, Live Activities, admin broadcast, 100-million-user delivery. Before writing any code, three real scoping questions got asked and answered: build one polished default sound set now rather than all 7 packs the spec lists (architected so more packs are a data change later, not a rebuild); target broadcast alerts by plan tier (the one real, already-queryable user segment this app has); and — the big one — a meaningful share of the spec describes things a web app running in a browser simply cannot do, no matter how much effort goes in: replying from the lock screen without unlocking, a custom notification sound instead of the phone's own default, Apple's "Live Activities," or targeting a smart watch or car system. Those all require a real native iOS/Android app; a website cannot reach into the operating system that deeply. The owner's call: document that plainly (same as encryption/attachments in Part 1) and build the closest real thing the web can actually do.

**Chat @mentions, built for real:** typing `@` followed by a group member's name now shows a live autocomplete matching that thread's own roster (no server round-trip — the member list's already loaded), Enter picks the top match, and a sent mention notifies that person specifically — with its own distinct "mentioned you" push wording and higher delivery priority than a routine group message — and renders as a real tappable link in the chat bubble, reusing the exact same link-detection logic already used for hashtags/links elsewhere in the app so a mention notifies precisely the person it visibly renders a link for.

**Smart, priority-aware delivery:** a direct message or a mention now always reaches the recipient's lock screen, even if they've set themselves to Do Not Disturb (built on top of Part 3's presence-status feature) — while a plain group message gets held back during DND instead (it's still waiting the moment they open the app, just doesn't buzz their phone). A rapid burst of several messages in a row now shows one push saying "5 new messages" instead of quietly replacing itself five times with only the last one visible. On Android/Chrome, a message notification now has real tappable "Mark as read" / "Mute" buttons right on the notification itself — iOS Safari doesn't support notification action buttons at all (a genuine platform limitation, not something this app left out).

**In-app interaction sounds — the owner's own explicit ask (spec item 4b):** short, clean sound effects for new messages, mentions, reactions, and someone starting to type, toggleable individually or all at once from a new settings icon at the top of the inbox (deliberately not inside an open chat, exactly as asked). These are real synthesized tones generated in the browser itself rather than shipped audio files — a website has no way to license a proper sound-pack library, so a small set of clean, designed "blips" (the same idea behind a lot of real OS UI sounds) is the honest version of this feature for now, built so real recorded sounds could slot in later without changing anything else. The setting is saved to the account, not just the device, so it's the same on every phone/browser someone signs into.

**A real admin broadcast tool:** send an announcement to everyone, or just Free/Pro/Business plan users, from a new panel on the admin dashboard — it actually creates a real notification + push for every matching person (capped at a sensible number for this app's real current size; truly handling 100 million recipients would need a background job system, not something to fake here) and keeps a visible send history.

**Verification:** the real components (not a mock) were mounted with fake data and driven with actual browser automation again — confirmed the mention autocomplete, the rendered mention link, every sound-setting toggle, and the full broadcast send → confirmation → clear → history-refresh cycle all genuinely work. One screenshot from a longer combined test run looked like the sound-settings dropdown hadn't opened; re-tested that one interaction on its own with a more careful wait instead of a fixed pause and confirmed it was just the test script's timing, not a real bug, before ruling it out. Full clean run of typecheck, lint, production build, and the test suite (76/76) afterward. Also bumped the service worker's version numbers (both places the house rule requires, after the last time only one was bumped and updates silently didn't reach anyone) since its push-handling code changed for the new action buttons.

**Migration 0044 still needs the owner's apply step** (same defensive lock-timeout added after the deadlock hit applying 0043), and nothing in this batch has been committed yet either, per the owner's standing instruction.

---

## 2026‑07‑11 highlights (batch 48 — Feature 12 Premium Messaging V2 Part 3: real-time delivery engine)

Owner asked to finish Part 3 (the real-time engine spec dropped earlier the same day — see batch 47's closing note), then cross-check the whole thing for bugs and display issues on all devices, then move straight to Part 4. This batch covers the build, the deadlock the owner hit applying the new migration, and the audit.

**Shipped for real:** idempotent sends (a client-generated id so an offline-queue replay can never create a duplicate message), message forwarding into any of your own chats, delta sync (a reconnect now asks for only what changed since the last successful sync instead of re-fetching the last 300 messages every time), and a real offline send queue (IndexedDB-backed, ordered, with genuine exponential backoff and a permanent-failure log). **Typing indicators are finally built** — deliberately deferred in Part 1 because they needed a Supabase feature ("Realtime Authorization," a privately-locked-down live channel) with zero precedent anywhere in this codebase, and shipping an unverified security-sensitive policy felt worse than waiting; this round verified the exact syntax against current docs before writing it, rather than guessing. Also new: manual presence status (Available/Away/Busy/Do Not Disturb/Invisible) with a picker at the top of the inbox — deliberately NOT inside an open chat, per the owner's own instruction — auto-clearing "Away" after 5 minutes idle, and "Invisible" wired all the way through so it genuinely never appears online, not just hidden in the UI. A connection-health banner and "waiting to send / failed to send" labels on messages round out the live-delivery picture, and a new admin panel shows real, computed messaging numbers (send volume, failure rate, active chats) rather than placeholder stats.

**The owner hit a live database deadlock applying the new migration** (`ERROR: deadlock detected`, two processes each waiting on a lock the other held). The app was live with real traffic touching the messages table at the exact moment the migration tried to add columns to it — not data-corrupting (Postgres's own safety mechanism just aborted one side automatically), but worth hardening against: added a lock timeout to the migration so any future collision like this fails fast and is safe to just re-run, instead of potentially hanging.

**Independent cross-check afterward found and fixed 4 more real issues:**
- **The most serious one:** the "catch up on what I missed" logic that runs on reconnect had a leftover bug from before delta sync existed — it correctly figured out what had changed, but then threw that work away and returned only the small changed set instead of the merged full thread. In practice this meant every reconnect (backgrounding the app, a flaky connection, switching tabs back) would silently collapse an open chat down to a handful of messages until the next hard reload. Fixed to properly merge instead of replace.
- A message still waiting in the offline queue disappeared from the chat entirely if the app was closed and reopened before it had a chance to send — it was still safely queued and would eventually go out, but looked like it had vanished in the meantime. Fixed so a still-queued message reliably reappears on reopen.
- **A real mobile-only display bug, caught by actually rendering the components and taking a screenshot at phone width (390px)**, not just reading the code: the message options menu could run off the right edge of the screen and get its text cut off, specifically on longer received messages. Fixed by having it measure available space and stay on-screen regardless of message length or device width.
- Two smaller security tightenings: the new presence-status endpoint had no rate limit (every other new endpoint did); a telemetry endpoint accepted a conversation id from the client without checking the user actually belonged to it (low risk — it only ever wrote to that user's own record — but cheap to close properly).

**Verification this round went a step further than prior UI-only rounds:** rather than the usual static mock (still the only option for anything needing a real logged-in session, which can't be completed in this environment), the actual live components were mounted in a throwaway, unauthenticated test route with realistic fake data and driven with real browser automation — at both a normal desktop width and a real 390px phone width — which is specifically what caught the mobile menu-overflow bug above. The throwaway route was deleted afterward; nothing from it shipped. Full clean run of typecheck, lint, production build, and the test suite (76/76) after every fix.

**Explicitly deferred, not silently skipped:** anything still requiring features this app doesn't have yet (voice/video calls, end-to-end encryption, attachments — unchanged since Part 1), literal multi-region server infrastructure (Supabase's own Realtime service plus the already-chosen Paris region already are that layer), and ML-based spam/abuse detection (no training data to build one honestly).

**Migrations 0041–0043 all still need the owner's apply step in Supabase** before any of this works live — same as every prior pending migration in this project. Nothing in this batch has been committed yet either, per the owner's standing instruction to hold `git commit`/`git push` until told.

Owner immediately followed with Part 4's full spec — premium messaging notifications: lock-screen rich actions, custom sound packs, per-notification haptic patterns, OS "Live Activities," admin broadcast alerts, 100-million-user delivery scale. A meaningful share of that spec describes native-mobile-app-only capabilities (interactive lock-screen reply, custom notification sounds, Live Activities, smartwatch/car targets) that a web app simply cannot do without shipping real iOS/Android apps — this needs the same honest-scoping pass as every prior part before writing code, not started yet.

---

## 2026‑07‑11 highlights (batch 47 — Feature 12 Premium Messaging V2 Part 1: group conversations + message lifecycle)

Owner dropped a large "Premium Messaging V2" spec describing an enterprise-scale messaging platform (groups, communities, business chats, end-to-end encryption, 100M-user infra, a separate Redis pub/sub layer, quantum-ready crypto). Its own instructions asked for analysis before any code, so this round followed the pattern used throughout this project's history for big aspirational specs: audit the real system first, plan the honestly-scoped slice (via a formal plan + 3 clarifying questions answered by the owner), then build it.

**What was actually there:** direct messages only, hard-capped at exactly 2 participants by the schema itself (a `user_low`/`user_high` pair with a uniqueness constraint) — no groups, no reactions, no reply/edit/delete/pin, and a real, previously-unnoticed bug: `useInboxRealtime()` was fully working code that was never called from anywhere, so the inbox/topbar badge only updated while a thread was actually open.

**Owner confirmed 3 scoping calls up front:** encryption deferred entirely (TLS + Supabase at-rest only — a superficial E2E implementation would be fake security, not real); groups and message-lifecycle features (reply/edit/delete/pin/react) ship together in one schema pass rather than split across rounds, since groups change the shape everything else builds on; rich attachments (image/voice/video messages) deferred to a later part — this round is text + the existing shared-post-link embed only.

**Shipped:** two new migrations (`0041`/`0042`, need applying in Supabase) add group-capable conversation membership, message reply/edit/delete/pin, message reactions, and wire messages into the real notification system — all additive, direct 1:1 threads keep their exact current behavior throughout. The messaging service layer was generalized from "exactly 2 participants" to "any number of active members" without changing how existing 1:1 chats behave. New group creation/management UI (name it, add people, promote/remove/transfer ownership, leave), reply/edit/delete/pin/react on any message bubble, and mute/archive/pin on conversation rows. The dead `useInboxRealtime()` bug is fixed for real — the inbox badge now live-updates anywhere in the app, not just inside an open thread.

**Typing indicators were deliberately NOT built**, despite being designed in the plan — they need a Supabase feature ("Realtime Authorization," a privately-scoped presence channel with its own database policy) that has zero precedent anywhere in this codebase. Shipping it without being able to verify the exact syntax against current docs risked either a broken feature or, worse, a real privacy leak — a channel that isn't properly locked down would let any signed-in user who knows a conversation's ID see who's typing in it, even if they're not a participant. Deferred as a clearly-flagged follow-up rather than guessed at.

**Two real bugs were caught and fixed before shipping, not asked for:** wiring messages into the notification system would have made a new message produce TWO separate pop-up toasts (the generic one and the existing dedicated richer one) — caught and deduped. Separately, `lib/social/friends.ts`'s "last time you chatted with this friend" lookup assumed every conversation has a direct chat partner, which stopped being true the moment groups existed — TypeScript's own type-checker caught this before it could ship as a live crash.

Verified: `tsc --noEmit`, `next lint`, `next build` (all 173 pages, every new API route registered with no conflicts), `npm run test` (76/76, including 9 new tests for the trickiest pure logic — group unread-cursor counting and reaction aggregation) all clean. Not yet verified against live Supabase data — migrations 0041/0042 still need the owner's apply step, same as every other pending migration in this project.

**Same-day follow-up: owner asked for an independent cross-check of everything above before continuing — found and fixed 8 real bugs.** The most severe: the ORIGINAL messaging permission rules (written years before groups existed) were never actually updated to understand groups. Since the app's live-update mechanism strictly obeys those permission rules, this meant two things were silently broken the whole time groups have "existed" in this branch: new messages in a group would never show up in real time for anyone (only after leaving and reopening the app), and — worse — reacting to a message in a group would fail every single time, with no visible reason why. Both fixed at the source (the still-unapplied migration, so nothing in production was ever actually affected). Also found: a second, unrelated permission rule for reactions accidentally only let you see your OWN reactions live, never anyone else's; a real "vanishing chat" trap where archiving a conversation removed it forever with no way to bring it back (now has a proper Archived view + Unarchive); every message/conversation action menu was built to only appear on mouse-hover, making them completely unreachable by touch — a real problem for what is primarily a phone app; a long-running chat would eventually get permanently stuck showing only its oldest 300 messages instead of the recent ones; a rare timing edge case that could permanently break a 1:1 chat with no recovery; and an ownership-transfer step that, on a very unlucky double failure, could leave a group with no owner at all (now one atomic database operation instead of two separate steps). Re-verified clean across the board afterward.

**Then started Part 2 (owner sent the full "Premium Messaging UI, Luxury Design System" brief) — first slice shipped same session.** Rather than attempt the whole brief (it asks for voice/video calling, an AI assistant button, custom wallpapers, and more — none of which have any backend to build on), reused the app's own existing premium visual language end-to-end: the frosted-glass surfaces, gradient/glow treatments, and spring-motion/haptic system already established elsewhere in the app, applied properly to messaging for the first time. Concretely: message bubbles now use the real brand gradient (an old inconsistency, an off-brand blue/purple pair instead of the app's actual brand colors, got fixed along the way) with a soft glow, incoming bubbles get a genuine frosted-glass look, and new messages animate in — arriving messages "slide in," your own sent messages "pop" — matching the brief's own language for the two directions. The message box itself was a fixed one-line field before; it now grows as you type, multiple lines, Enter to send / Shift+Enter for a new line, like every real chat app. Buttons across the whole messaging surface now have the same satisfying tap-feedback (a little compress + a light buzz) the rest of the app already has elsewhere but messaging never got. A completely empty chat used to just say "Say hello" in plain text; it now gets a proper icon and a real premium empty-state look. Also found, while touching this: three different sheet panels (including one that predates this week's work entirely) had each separately hand-typed a near-identical "how a sheet slides up" animation value instead of using the one shared value already defined for exactly that purpose elsewhere in the app — consolidated all three onto it. Since exercising the actual messaging screens requires being logged in, and there's no way to complete a real sign-in here (it requires receiving a live email code), verified visually the same way prior visual-only rounds in this project have: a faithful mock built from the exact same colors/spacing/classes, rendered and screenshotted locally. Re-verified `tsc`/lint/build/tests clean after every change in this whole follow-up.

**Nothing in this batch has been committed yet — owner asked to hold off on `git commit`/`git push` until told to proceed.**

---

## 2026‑07‑11 highlights (batch 46 — "stuck" bug hunt: push-enable silent failure, SW update gap, boot/splash visual refresh)

Owner, testing on a laptop for the first time this session: sidebar nav "stuck, nothing happens"; separately, "the webapp since the pwa updates is stuck at loading"; separately, "enable notification button... doesn't click, please check the pwa in particular for any bug and error."

**Real bug found and fixed: the Enable Notifications button silently failed with zero feedback.** When the browser successfully subscribed to push but the follow-up save to our server failed (a network blip, an expired session), the code quietly reported "not subscribed" instead of surfacing an error — and neither place that calls it (the in-app nudge banner, the Notification Center's toggle) had any error handling at all, so the failure vanished into the console. From the outside: tap the button, a brief spinner, then nothing — indistinguishable from the tap not registering. Worse, the nudge banner treated that same silent failure as if the user had dismissed it, which both hid the banner and counted toward its 5-strikes "stop asking" limit — a transient server hiccup could permanently silence the prompt on that device. Fixed: a real failure now shows a clear "couldn't turn on notifications, try again" message with a retry button, and is never confused with a user's own dismissal.

**Found and closed a service-worker update-detection gap.** The service worker is split into several files for maintainability, loaded by one small entry file. Browsers only check that ONE entry file's contents for changes to decide whether to install an update — they don't separately check the other files. Every past change made only to one of those other files may never have actually reached already-installed users, since the entry file's own contents never changed. Fixed by making sure the entry file's contents always change too whenever the underlying logic does, and wrote the rule into the code so it isn't missed again.

**Closed two "hang forever" gaps.** Network requests have no automatic timeout by default. Found two places — the app's page-loading logic and its check-for-a-new-version logic — that could theoretically hang indefinitely on a stalled connection with no fallback, which would look exactly like "stuck at loading." Both now give up and fall back gracefully after a bounded wait instead of hanging.

**Sidebar "stuck, nothing happens" — not conclusively reproduced.** Read through the entire desktop nav and every component that's always mounted alongside it looking for a blocking overlay, a swallowed error, or a broken click handler; found none. No browser-automation tool is available in this environment, so this could not be click-tested live — said so explicitly. If it's still stuck after this round's fixes, the next step needs a live repro with real browser devtools open during the actual stuck click.

**Visual refresh, exactly as specified.** The quiet loading skeleton shown on every page load now uses the real brand logo image (previously a rough hand-drawn approximation) sized notably larger, matching the "big, bold logo" boot-loader style of apps like X/Twitter and Tango. The separate full-screen welcome shown on a genuine first login (or after a cleared cache) now always has a white background regardless of light/dark theme, matching how the app's install icons already work.

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` (67/67) all clean.

---

## 2026‑07‑10 highlights (batch 45 — real Home-switch reset fix + premium switch redesign)

Owner: *"the continue watching and friends activity switch resets when i leave the homepage and come back, and the switch is too fat and common on mobile, i want it premium."*

**Found two real, separate reasons the switch didn't stick.** First: the switch was never actually built to remember what you'd chosen — every time the page loaded fresh, it just assumed "on," no matter what you'd picked before. Fixed by having it read the real saved setting on load instead of guessing. Second, a subtler one: even after fixing that, the app's own performance feature (caching Home so it opens instantly when you come back to it) could still occasionally show an old, already-out-of-date copy of the page from before you'd flipped the switch. Fixed by having a toggle explicitly tell the app "this page needs a fresh copy next time," so leaving and coming back now always reflects your latest choice.

**Switch redesign.** Shrunk it and dropped the wide purple-gradient fill for a plain black-or-white one (matching the icon color direction from earlier today) — smaller, calmer, and no longer competing for attention against the words next to it.

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` (44/44) all clean; the new switch design confirmed with a side-by-side screenshot, old vs. new, in both light and dark mode.

---

## 2026‑07‑10 highlights (batch 44 — de-purpled the icon system + Create button redesign + premium font)

Owner: *"Change all icons with purple background and purple icon from purple to a dark or premium white or transparent color in all pages to avoid too much purple color splashing and change the plus post button to a different shape and dark color to look different from other NAV buttons. use tiktok style of icon and use a premium human font like snapchat and tiktok font in all pages."*

**The icon system from earlier today was correctly built, just too repetitive.** Giving every nav icon, top-bar icon, and section header its own colored badge was a real improvement over the flat icons before it — but once that same purple gradient appeared on every single one of them at once, across every page, it read as "too much purple" even though nothing was individually wrong. Fixed by recoloring the badge to something that's always either dark or white depending on whether you're in light or dark mode — genuinely both of the colors asked for, chosen automatically, and no color splash at all the rest of the time (which also happens to be exactly how TikTok's own navigation looks — plain, bold, black-or-white icons, no colored circles).

**Checked every other purple element in the app before touching anything**, to make sure only actual icons changed. Left alone on purpose: the colorful circles shown for people without a profile photo, the colored ring around an unwatched Story, and gradient buttons like "Go Pro" — those are a different, deliberate design pattern (meant to be colorful), not icons, and changing them wasn't part of the ask.

**The center "+" create button got its own specific treatment**: changed from a circle to a rounded-square shape, and a fixed dark color that stays dark in both light and dark mode (everything else adapts automatically; this one button doesn't, matching the literal ask). It's now the one button in the whole bar that looks deliberately different from the rest, instead of just another circle.

**Font, everywhere, in one change.** Swapped the entire app's typeface to a more rounded, modern, "premium social app" style closer to what Snapchat and TikTok use — their actual fonts are private to those companies, so picked the closest respected free alternative with the same feel. Because the whole app's text already flows from one single setting, this reached the homepage, every page, and every future page automatically, with nothing else needing to change.

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` (44/44) all clean; confirmed with a real screenshot of the live built site (both the new font rendering on the homepage, and a before/after comparison of the nav icons and the new button shape).

---

## 2026‑07‑10 highlights (batch 43 — real image-viewer instant-open fix + site-wide icon rollout)

Owner: *"the image view in feed still loads like it navigate to a different page when clicked, i just want it to open immediately in same page without redirecting and loading for 0ms and use same premium 3d unique icon from homepage on all pages too, landing page, sitemap, seo pages, all the navigation pages, and all pages current and future pages, make the dont comsume cpu and battery, animate only when clicked."*

**Image viewer — two more real causes found, beyond the URL-mismatch fix from earlier today.** First: every single tap on a feed photo was deliberately held for 280ms before opening anything, to tell it apart from the start of a double-tap (which likes the post instead) — a real, intentional, already-shipped design, not a bug, but never previously examined as a contributor to "feels slow." Tightened it to a synced 220ms on both sides (not just shortened — kept EQUAL so the double-tap-to-like gesture can never accidentally break). Second, and bigger: the code that opens the fullscreen photo viewer is deliberately loaded on demand (kept out of the main page so the app itself stays fast) — but unlike the equivalent code for Reels, which already paints something instantly while it loads, the photo viewer showed literally nothing during that moment. A tap that landed before the code had finished loading looked exactly like nothing happened — which reads exactly like "it's navigating somewhere and loading." Fixed by starting that load the instant a finger touches the photo (not waiting for the tap to fully register), and by immediately showing the exact photo that was tapped — using the picture that's already on screen — the instant it's tapped, with the fully-interactive version taking over invisibly a beat later once its code has finished loading.

**Icons — rolled out everywhere the nav treatment hadn't reached yet.** The account menu and the marketing site's own menu (the one on the homepage, blog, pricing, and every other public page) still had the old plain icons — now upgraded to the same premium tile treatment as the app's main navigation. Also wrote this into the internal engineering guide as a permanent rule, so every page built from here on automatically gets it without needing to be asked again. On the battery/CPU point: the treatment was already built to be completely static (no animation at all unless you actually tap something), so nothing needed to change there — confirmed by re-checking every piece of it rather than assuming.

**A worthwhile side-note on how this was verified**: while testing the menu changes, one button appeared to be completely broken in the testing tool being used — until checked against the actual, real, finished version of the site, where it worked perfectly on the first try. Recorded as a lesson: don't trust a broken-looking test result from an in-progress development preview without also checking the real thing.

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` (44/44) all clean; the icon changes were confirmed against a real production build with a live browser, not just the code.

---

## 2026‑07‑10 highlights (batch 42 — Home module on/off switches + 3D premium nav/icon overhaul + faster publish)

Owner: *"make a way user can turn on and off to show continue watching in feed, the premium switch should be opposite the continue watching text, put same switch for friends activity in homepage. and the trending reels, continue watching and friends activity icon looks too amateur and plain... and the top and bottom navs and icon still looks the same from before what i told you. and make the publish to everyone from download list and continue watching to always publish faster."*

**Inline Home module switches.** Continue Watching and Friend Activity each now show a real iOS-style switch to the right of their title — turning one off collapses just that section's content immediately (header stays, so it's a real on/off, not a one-way dismiss you'd need Settings to undo). Persisting this safely needed a small API change: the client only ever knows about its OWN module, so instead of resending a full `hiddenModules` array (which could silently overwrite a hide/show made a second earlier from the account Home Modules Editor or a second tab — a real lost-update race, the same class of bug fixed elsewhere this project), `/api/home-preferences` gained two surgical fields, `hideModule`/`showModule`, applied server-side against whatever's already saved in THIS request.

**"Still looks the same" — the previous round's nav polish only ever touched the ACTIVE icon**, recoloring its line-art with a gradient mask. That's invisible on the 4-out-of-5 tabs that are inactive at any given moment, which is exactly what reads as "unchanged" at a glance. This round replaces that with an actual dimensional badge: every nav destination (bottom nav, sidebar, and now the top bar's search/create/notification icons too) sits on its own tile — a colored gradient glass badge with a diagonal gloss highlight and a soft colored shadow when active, a calm neutral glass tile when not — instead of a bare floating glyph. The same badge treatment was applied to the Trending Reels/Continue Watching/Friend Activity section headers, which is what "amateur and plain" was about (two of the three had no background at all before, the third was a flat single-tone tile). Verified with a real rendered screenshot comparing old vs new side by side before shipping — the previous round's mistake was trusting the code without looking.

**Publish speed.** "Publish to everyone" (download list → opens the player → •••  menu, or the same flow from Continue Watching) was always slow because the ENTIRE upload sequence — request a signed upload slot, then upload the file — only ever started the moment you tapped Publish, even though the video had usually been sitting fully downloaded for a while by then. Now the signed upload slot (and the auth check) are requested the moment the ••• sheet opens — a real signal of intent to maybe publish, not a blind prefetch on every video — so by the time Publish is actually tapped, only the real network-bound part (the upload itself) is left; it falls back to a fresh request if the sheet stayed open long enough for the signed URL to expire (5 min).

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` (44/44) all clean; the new nav/badge/switch components were also rendered in a real headless browser (light + dark) and visually compared against the old flat icons before shipping, learning from the previous round's mistake of shipping code that "should" look different without actually checking.

---

## 2026‑07‑10 highlights (batch 39 — retroactive multi-video-reel migration + fullscreen album viewer loading fix)

Owner follow-up on the previous batch's Reels restriction: *"i still see mulitple videos post in reels."* Plus: *"muliple posts in reels especially image still takes time to open when tapped, check if there is a conflict on loading when tapped, if they all renders immediately, and fix it so the exact image that was tapped get loaded immediately."*

**Multi-video reels still appearing — because only new uploads were ever stopped.** The previous fix changed the upload picker and the server-side check, but neither one touches posts that were *already* published as a multi-video reel before that change — those keep appearing in the Reels deck untouched, since nothing ever re-classifies existing data. Checked whether there was a second creation path (`/api/reels`'s own POST route) — confirmed it only accepts a single media URL, no album support at all, so it was never a way to create one. New migration retroactively moves any existing post with more than one video attached from Reels to the Feed, matching the same rule now applied going forward. A single-video reel is untouched (it doesn't use the album table at all); a mixed photo+video album was already Feed-only from an earlier rule, so this can only ever match a genuine multi-video reel.

**The fullscreen album viewer had the identical loading bug the inline feed carousel was already fixed for** — but it turned out to be a completely separate piece of code that fix never reached. When you actually tap a post to open it, a different component takes over (the one responsible for the swipe-through-album experience you land in), and it had the same "every slide loads immediately" problem in an even more basic form — its images had no lazy-loading behavior configured at all, so an album with many photos fired that many requests the instant you opened it, and the one you actually tapped had to compete with all the others. Applied the same fix as before: only the tapped photo and its immediate neighbors load right away; the rest load in as you swipe toward them.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide, plus targeted logic tests for the loading-order math.

---

## 2026‑07‑10 highlights (batch 38 — owner mobile-tested: real overflow-x bugs + card-lift correction)

Owner tested the comments platform on an actual phone and reported horizontal page scroll, plus pushed back on Part 10 deferring card-lift and page transitions: *"dont skip any features does reduces the quality standard... replace any outstanding changes with the one that is better and fits what i want."*

**Three real overflow-x bugs found and fixed**, all traced to the voice/video/mention work from the previous two batches: (1) the @mention dropdown was a fixed 256px wide, anchored to the left edge of a wrapper that itself sits well right-of-center after several icon buttons — on a narrow phone its right edge extended far past the screen; fixed to size itself to its own wrapper's already-correct width instead. (2) Voice waveform bars (both recording-preview and playback) were fixed-width with no `min-w-0` on their flex row — a flex item without it refuses to shrink below its content's width, forcing the row wider than the screen; fixed by making bars flexible so they always divide up exactly the space available. (3) The video-reply preview had no width ceiling, so a landscape clip capped only by height rendered wider than most phones; added one.

**Verified empirically this time**, not just by reasoning through the CSS: built a static reproduction of the exact buggy vs. fixed DOM structure and measured actual overflow with Playwright at a 375px mobile viewport — confirmed the old dropdown overflowed by 106px and the old waveform by 84px, both exactly zero after the fix, with a screenshot confirming it still reads cleanly. Also added a defensive `overflow-x-hidden` on the whole comments section per the owner's explicit ask, shortened the composer's placeholder copy, and added idle-time preloading + a branded loading state for the voice/video recorder code so the first tap never shows a dead gap — likely the source of the "unprofessional loading and delay" complaint.

**Re-examined the card-lift deferral and found a real, correctly-scoped fix** instead of leaving it skipped: the original blocker (press feedback on a card bubbling up from its nested action buttons, causing a double animation) is real for the *outer* card, but doesn't apply to the *media* inside it — the mute/expand buttons there are DOM siblings of the video/image, not descendants, so a plain CSS press effect on the media itself is completely safe. Shipped on all three feed media components. Page transitions stayed deferred, but for a re-confirmed structural reason: Next.js's mechanism for animating between routes would force-remount pages that this session's own "instant navigation" caching work depends on staying mounted — implementing it would functionally undo already-shipped performance work the owner also explicitly asked to protect in this same message.

A useful bug was caught along the way, too: an explanatory code comment inserted between an ESLint disable directive and the line it was meant to cover silently broke that directive (disable comments only apply to the literal next line) — a small but real example of exactly the kind of self-review this pass was about.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide.

---

## 2026‑07‑10 highlights (batch 37 — Feature 17 Part 10: motion system slice)

Owner dropped **"Feature 17 Part 10 — Feed Motion System, Micro Interactions, Gestures, Premium Animations & Living UI"** — spring physics taxonomy, elastic overscroll, card lift/depth, media pinch/rotate, shared-element page transitions, live typing/viewer animations, a synchronized haptic system, and "Adaptive Motion Intelligence" tied to battery/thermals/network. Same audit-first approach as every prior Part.

**The audit's real finding**: the app's own shared spring-token module (`lib/motion/springs.ts`, built in Part 1 of this very system) was barely used — only 4 files imported it against **27 files hand-rolling their own duplicate spring objects**, and its reduced-motion constant had never been imported anywhere in the codebase — dead code. Haptics told the same story: **11 separate `navigator.vibrate` call sites**, each picking its own magic number, no shared module. Most of the spec's "delight" asks (double-tap-Wow burst, animated counters, repost burst, comment animations, pull-to-refresh, skeleton loading) were confirmed already built and didn't need rebuilding.

**Shipped 3 items**: (1) `<MotionConfig reducedMotion="user">` wrapped around the whole app — one framer-motion primitive that makes every animation everywhere automatically respect the OS "reduce motion" setting, replacing the dead constant with something that actually works app-wide instead of file-by-file. (2) `lib/motion/haptics.ts` — 4 named intents replacing the 11 scattered magic numbers. (3) `springs.sheet` — the single most duplicated *exact* spring value in the codebase (byte-identical across 7 different bottom-sheet components), now a shared token.

**Deliberately not attempted, with real reasons**: full spring consolidation across all 27 files (only the 7 confirmed byte-identical duplicates were touched — the rest carry genuinely different values, a bigger design call than this slice); whole-card press/lift feedback (investigated and found a real technical blocker — both CSS `:active` and framer-motion's `whileTap` bubble from a tapped child up to its parent, so it would visibly double up with every nested button's own press animation, and framer-motion's own inline `transform` style for the card's entrance animation would silently override any competing CSS-only approach); page/route transition animations (Next.js currently has none, but adding one risks fighting this session's own "instant navigation" performance work already shipped on Home); and everything genuinely unbuildable without a real API (pinch/rotate gestures, shared-element continuity, battery/thermal/network-adaptive animation).

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide.

---

## 2026‑07‑10 highlights (batch 36 — voice/video comments + 3 owner-reported bug fixes)

Owner: *"include and construct the voice and video comment beatifully and smoothly"* — plus, in the same message, three bug reports: the Comment button in the feed wasn't opening comments directly, multi-image posts still delayed opening, and multi-video uploads shouldn't be allowed to become multi-video Reels.

**Voice notes and video replies, built from scratch (no external service)**: batch 35 deliberately deferred these since the app had zero `MediaRecorder`/`getUserMedia` usage anywhere to build from. `features/social/voice-recorder.tsx` is a WhatsApp/Instagram-style recorder — tap mic, live reactive waveform (Web Audio `AnalyserNode`), 3-minute cap; on stop, the full clip is decoded once into real amplitude peaks (not a decorative fake) so playback renders instantly everywhere with zero re-decode. `features/social/video-comment-recorder.tsx` is a full-screen portaled camera capture modal, front-camera-first with flip, a Stories-style progress ring on the shutter, 60-second cap, and a client-captured poster frame. Playback (`features/social/comment-media.tsx`): a tap-to-seek waveform scrubber with a playback-speed cycle for voice, and a muted poster preview (never autoplay — a thread with many video replies autoplaying at once is exactly the battery/data problem this app's performance mandate exists to prevent) that opens fullscreen with sound on tap for video. Migration `0038` adds the attachment columns. Both recorders are code-split via `next/dynamic` so the camera/mic UI most viewers never trigger stays out of every comment section's initial bundle.

Caught two real bugs via careful re-reading before shipping: the voice preview's `<audio src>` was computing `URL.createObjectURL` inline during render, which — since playback progress updates many times a second — would have minted a fresh blob URL and restarted the audio element on every tick instead of playing smoothly (fixed: created once in state, revoked on unmount). And a duration fallback was reading a stale `useCallback`-closed value that always held 0 (fixed with a ref kept in sync).

**Bug 1 — Comment button opened media without ever showing comments**: `smart-feed.tsx`'s `openViewer(item, comments)` took a `comments` flag but the image/album destination branch never referenced it at all — only the video-reel and generic-post branches did. Threaded a new `autoOpenComments` prop through `ImageViewer`, firing the viewer's existing `openComments()` on mount.

**Bug 2 — carousels still delayed opening**: the real cause, found this round, wasn't the tap gesture (already fixed last round) but that `MediaCarousel` mounted every slide's `<img>`/`<video>` unconditionally on render — a 10-20 photo album fired that many simultaneous requests, and the one slide actually being viewed queued behind the others for the browser's connection cap. Fixed with a sequential/sticky nearby-window loader: only the current slide ± 1 neighbor ever mounts a real `src`; everything else is a placeholder until scrolled near, loading one at a time as you swipe, staying loaded once visited. Verified with 6 passing logic tests.

**Bug 3 — multi-video uploads could become a multi-video Reel**: narrowed to Feed-only, both in the upload destination picker and re-enforced server-side in `/api/stories` (a request can always be replayed regardless of what the UI currently offers). Existing already-published multi-video reels are untouched — the reel-viewer's album-swipe machinery stays in place for them, this only closes the path for new uploads going forward.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide. No live device mic/camera testing was possible in this environment — flagged honestly; the recording UI feature-detects support before showing itself, so it degrades safely on any browser where it doesn't work rather than showing a broken affordance.

---

## 2026‑07‑10 highlights (batch 35 — Feature 17 Part 9: comments platform slice)

Owner dropped **"Feature 17 Part 9 — Comments Platform, Discussion System, Threads, Community Conversations & AI-Powered Social Discussions"** — another enormous spec (voice/video/GIF/poll/document comments, AI summarize/translate/rewrite/suggest-reply/find-unanswered-questions, infinite nested threading, community/business discussion tooling, reputation systems). Same standing approach as every prior Part: an Explore-agent research audit of the real comment system first, no code written until the audit came back.

**The audit found real, concrete gaps hiding in plain sight.** `lib/social/notifications.ts`'s `NotificationType` union and `features/notifications/meta.tsx`'s icon/verb maps already had `'reply'` (Reply icon, "replied to you") and `'mention'` (AtSign icon, "mentioned you") fully wired — but nothing in the entire codebase had ever inserted a notification row of either type. Every comment, reply or not, only ever notified the post owner. Typed `@handles` rendered as clickable profile links (`rich-text.tsx`) but never notified anyone or offered autocomplete while typing. Reacting to a comment only ever bumped a counter. No relationship-aware comment sort existed, unlike the feed's own `rankForYou`. And the comments sheet unmounts its composer on close, silently discarding any half-typed reply.

**Shipped 5 items, migration `0037_comment_notifications.sql` (must be applied)**:
1. **Replies now notify the actual comment's author**, not just the post owner regardless of depth. Provably safe to key off `parent_id` alone because the UI structurally never renders a Reply button below depth 0 — nested replies always get `canReply={false}` — so `parent_id` in real usage is always exactly the comment tapped, never a flattened multi-level ancestor.
2. **@mention autocomplete** in the composer, reusing the already-existing `/api/search?type=people` endpoint (no new route) with a debounced dropdown + keyboard navigation. Mention *notifications* are resolved independently, server-side, by regex-parsing the final stored comment body with the same character class `rich-text.tsx` already renders as a link — so a mention notifies correctly whichever way the `@handle` got typed, one source of truth instead of two that could drift apart.
3. **Comment-reaction notifications** (new type `comment_reaction`), deduped via a comment-scoped index kept deliberately separate from the existing post-scoped one (which would otherwise wrongly collapse reactions to two different comments on the same post into a single notification).
4. **"Friends First" comment sort**, a fourth sort pill mirroring the feed's relationship-aware `rankForYou` — one bounded, batched friendships lookup added to `listComments` (same shape as its existing blocks lookup), not a query per commenter.
5. **Local draft persistence** for the composer, so closing the comments sheet mid-reply no longer loses the typed text.

**Deliberately not attempted, and why**: everything AI (confirmed via a fresh repo-wide grep that the only LLM integration anywhere is still the unrelated support-chat widget), voice/video comments (zero recorder infrastructure exists anywhere in the app to build from — a genuine from-scratch scope decision, not a slice), true infinite nested threading (structural — the UI itself never offers Reply below depth 0), in-discussion search, and an "edited" indicator (there's no comment-edit capability yet for a badge to attach to).

**A real latent bug found and fixed along the way**: `lib/push/social-push.ts`'s push helper always let a post's owner-lookup silently overwrite an already-explicit recipient — harmless until now because no caller had ever needed both a `postId` (for the title/link) and a different explicit recipient at the same time; reply-push needs exactly that (title from the post, recipient = the parent comment's author). Fixed to only default the recipient from the post owner when one isn't already given.

**Caught a real bug before shipping, not after**: a standalone Node logic-test script for the mention caret-detection/insertion math (8 cases) found that picking a suggestion when text already followed the cursor produced a double space — fixed by only inserting a separator when the trailing text doesn't already start with one.

Verified: `tsc --noEmit`, `next lint`, and `next build` all clean project-wide. No live Postgres execution was possible in this environment — the migration's SQL was read closely against the exact proven trigger patterns already shipped in 0013/0022/0036 rather than guessed at.

---

## 2026‑07‑10 highlights (batch 41 — the REAL image open-delay fix + the dark-theme flash's third, actual root cause)

Owner: images in the feed still delay to open when tapped ("make them download automatically on scroll... should open like iOS gallery, never load a bit"), and the recurring dark-theme flash on every app open — "examine everything that could be the cause and fix it."

**Images — found the actual structural cause, not another loading-order tweak.** Every prior round in this area (batch history in [[media-zoom-scroll-fixes]]) fixed real bugs — N simultaneous requests, missing `loading` attributes, sluggish tap recognition — but none of them touched the real reason opening a photo still hits the network: **the feed's inline thumbnail and the fullscreen viewer request two completely different URLs for the same image.** The feed only ever fetches next/image's resized/optimized variant (`/_next/image?url=...&w=...&q=...`); the fullscreen viewer renders a plain `<img src={item.mediaUrl}>` — the RAW original URL, never once requested by the feed. No amount of "load the thumbnail earlier" can fix an open that was always going to be a fresh fetch to a URL nothing had cached. Fixed with a new `lib/media/prefetch-image.ts` that warms the browser's own HTTP cache for the RAW url specifically (deduped, skipped on Data Saver/slow connections), wired into `FeedImage` (a one-shot `IntersectionObserver` at a generous 1200px margin — well ahead of an actual tap) and `MediaCarousel` (piggybacked on its existing slide-unlock window, so swiping near an album photo also warms its raw bytes).

**The dark-theme flash — this time verified empirically instead of re-reading scripts a third time.** Two previous rounds (documented in [[theme-system-default]]) already fixed the in-page boot overlay and `app/manifest.ts`'s static colors, yet the flash reportedly kept happening. Rather than re-derive the same JS logic by eye again, this round started a real dev server and used an instrumented Playwright script — a `MutationObserver` watching `<html>`'s `class` attribute from the earliest possible moment — across 5 realistic scenarios (fresh visitor on light/dark OS, a stale pre-migration user with a leftover "dark" localStorage value, an explicit-light user on a dark OS, a normal returning system-follower). **Result: the class-resolution logic is clean in every case** — no incorrect intermediate state, even in the specific race condition theorized as a likely cause. The two previously-fixed layers hold; the bug wasn't hiding there a third time.

Found two things that WERE real: no `color-scheme` CSS property declared anywhere (governs the browser's own native default rendering before author CSS fully applies — a real, independent flash class; added `color-scheme: light`/`dark` to the theme blocks), and a `theme-color` hex that never matched the actual dark background (`#080b14` vs. the real `#050816` — aligned). And the strongest remaining candidate: **no native iOS launch-screen images (`apple-touch-startup-image`) exist at all** — already flagged as an open gap in earlier PWA work but never built. iOS shows its own splash for an installed app BEFORE any of our HTML/CSS/JS runs — with nothing custom provided, it auto-generates a plain white one regardless of theme, completely independent of every layer already fixed. Generated real light/dark splash images (solid brand background + the existing logo centered) for the 6 highest-population active iPhone sizes and wired them in with device-matched media queries — not exhaustive (iPad and older/rarer phones fall back to iOS's plain default), an honest, documented scoping choice.

Verified: `tsc --noEmit`, `next lint`, `next build`, `npm run test` all clean. The splash images were visually confirmed via direct screenshot before wiring, and the actual served HTML was curled from a running dev server to confirm the link tags and image files are really reachable — not just trusted from reading the JSX.

---

## 2026‑07‑10 highlights (batch 40 — Nav/icon "3D premium" polish + full bug cross-check of Parts 11-15)

Owner asked for four things in one message: a bigger/clearer Reels icon in the top bar, "3D premium" polish for the top and bottom nav with smooth click motion, ALL icons across ALL pages redone as premium 3D masterclass icons, and a full cross-check of everything shipped that day for bugs, display issues, and mistakes.

**Scoped the "all icons everywhere" ask honestly.** Hand-redrawing unique geometry for every icon across the entire app (the feed action bar, every settings page, every sheet) is a multi-session design project, not a same-day task — said so directly rather than either attempting it blind or quietly only doing the nav and calling it "all icons." Built the reusable primitive needed to extend this efficiently later, and applied it now to the surfaces explicitly named (top nav, bottom nav, feed topbar tabs).

**Shipped:**
- **`components/icons/gradient-icon.tsx`** — a `GradientIcon` wrapper that fills ANY monochrome icon (the custom Frenz set, lucide-react, react-icons — anything using `currentColor`) with the brand gradient instead of a flat color, without redrawing geometry. Renders the icon once as an SVG mask's luminance source, forced to solid white via CSS inheritance (a wrapping `<g style={{color:"#fff"}}>`) rather than a `color` prop — an early draft tried the prop-injection approach and would have silently done nothing for the custom Frenz icons specifically, since they only expose `className`/`strokeWidth`, no `color` prop at all. Caught this by actually testing the real mechanism in a screenshotted static mock before shipping, not just reasoning about it.
- **Reels icon**: 18px→22px (the other two feed tabs stay 18px — only Reels was called out), stronger glow, and a permanent soft violet backdrop circle since it never gets the active-pill treatment the other tabs do.
- **`PressIcon`'s shared motion enhanced** — every nav icon already routes through this one component, so upgrading it once (tap now compresses AND nudges down 1px like a physically-pressed button; the activation bounce gained a brief upward lift) propagated everywhere instantly.
- **Applied `GradientIcon` to the active-state icons** in the bottom nav and the desktop sidebar (including its react-icons/io5 items, proving the wrapper works across icon libraries, not just the custom set), and added nav-tap haptics that hadn't existed before.

Verified via the established static-HTML-mock + Playwright-screenshot method (auth still blocks driving the real nav headlessly here) — confirmed the gradient-mask technique on both fill-based and stroke-based icons, and confirmed the assembled bottom-nav composition before calling it done.

**Then, the bug cross-check** — spawned an independent review agent with no context from the building sessions, diffed the actual Parts 11-15 commits, and asked it to find what's wrong, not describe what the code does. It found 9 real issues, 2 of them serious:

1. **HIGH — feed continuity kept the wrong end of a truncated item list.** Items accumulate oldest-first, so a viewer's scroll position lives near the tail of the array — but the truncation before saving to `localStorage` kept the HEAD (`slice(0, N)`), discarding exactly the content near where the viewer actually was. The code's own comment claimed the opposite of what it did. Fixed to `slice(-N)`, with 3 new regression tests.
2. **HIGH — Friend Activity never checked muted creators.** The main feed excludes anyone the viewer has muted; the new Friend Activity module (mounted prominently on Home) didn't, so a muted friend's posts/likes/stories/follows still surfaced there. Fixed by filtering muted creators out before any of its four signal queries run.
3. A permutation-invariant bug in the Home Module Editor's order-normalizing logic (a duplicate key could survive and render the same section twice) — fixed with proper dedup, on both the read and write paths.
4. A lost-update race: the Module Editor's batched Save button bundled category-mute/boost fields that can ALSO be changed from a feed card while the settings page stays open, risking a silent overwrite of the newer change. Fixed by making category-chip removal its own small, immediately-persisted action, matching the discipline the rest of the app already uses for mute/unmute.
5. The new device-check security route had no rate limiting, unlike its same-day sibling the report route — added the same limiter, keyed per-user.
6. Preference changes could serve stale feed ranking for up to 20 seconds since the save route never busted the feed cache — fixed.
7-9. Two accessibility gaps (an identical aria-label on every drag handle; no keyboard alternative to dragging for reordering — added real Move-up/Move-down buttons) and one missing fetch-cancellation guard on a settings sheet.

Verified after all fixes: `npm run test` (44/44, 4 new), `tsc --noEmit`, `next lint`, `next build` all clean.

---

## 2026‑07‑10 highlights (batch 39 — Feature 17 Part 15: Engineering Foundation — first committed test suite)

Owner dropped **"Feature 17 Part 15 — Home Platform Architecture, Design System, Future Expansion & World-Class Engineering Foundation"** — the capstone of the Feature 17 series, and a different kind of ask from Parts 11-14: this one is about engineering process/infrastructure (design tokens, component library, state/service architecture, real-time foundation, theme engine, observability, testing strategy, dev tools, i18n, AI-integration architecture), not a user-facing feature.

Most of what the spec names already exists from earlier rounds the same day — Frenz Core itself, design tokens, the motion/haptics/icon systems, the loading architecture — all already documented and shipped. A direct check (not a full audit — this session already knew the terrain) found exactly two things named by the spec with genuinely zero coverage.

**Headline finding: this repo had ZERO committed automated tests.** No test runner in `package.json`, no `*.test.ts` file, no test config anywhere — despite an entire day of sessions verifying non-trivial logic (feed ranking, personalization caps, offline-queue decisions, new-device detection) via throwaway Node scripts in the scratchpad that got the verification done and then were simply discarded, never reaching the repo as lasting regression protection. A GitHub Actions CI pipeline already existed (typecheck → lint → build on every push/PR), so there was a ready-made place to plug real tests into.

**Shipped:**
- **Vitest** added as a dev dependency (`npm run test` / `test:watch`), config deliberately minimal — this pass covers pure logic only, no jsdom/component testing yet.
- **7 real, committed test files, 40 passing tests** — converting this session's OWN throwaway verification into permanent tests that import the actual functions rather than reimplementing them: `rankForYou` and `capPerFriend` and `shouldDropAfterStatus` and `normalizeOrder` (each had to be exported from private — now real, testable public functions); a NEW `shouldAlertForNewDevice()` extracted out of the DB/push-calling `checkNewDevice()` specifically so the actual decision logic gets a direct unit test; and first-ever test coverage for two PRE-EXISTING, previously-untested pure functions this session happened to touch — `feedReason`/`balanceByKind` (core "why am I seeing this" logic) and `parseDevice` (the user-agent parser).
- **Wired into CI** — a `Test` step added to `.github/workflows/ci.yml`, between Lint and Build.
- **Scroll FPS + JS-heap-memory observability** — a new sampled beacon (same ~15%-of-sessions, fire-and-forget contract as the existing Core Web Vitals reporter) reusing the pre-existing `/api/vitals` sink, no new service. Frame counting only happens DURING an actual scroll burst (first scroll event to ~150ms after the last one) — deliberately never a continuous idle animation-frame loop, which would be a real, pointless battery cost for a background monitor.
- `docs/FRENZ_CORE.md` gained a mandatory "Testing Strategy" section (the same way "Loading Architecture" became a mandatory section once that system shipped) — the standing rule going forward: any new non-trivial pure function gets a real exported function + a colocated test, not a throwaway scratch script.

**Deliberately not attempted, with reasons**: Component/E2E testing (Playwright) — a materially bigger investment (auth fixtures, a running dev server, browser automation) than this pass, flagged as the next testing tier. Feature flags / remote config / A-B testing — only a product-level `live`/`beta`/`soon` module status exists, not a granular per-feature flag system; a real one is a standalone infra project. Real internationalization (translated UI, RTL) — the app is English-only UI-wide (auto-captions default to English+French for the Africa-primary audience, but that's caption text, unrelated to app chrome); building real i18n is a huge, separate undertaking, and there's no RTL toggle yet to even test against. Theme engine extensions beyond light/dark/system (OLED black, seasonal, creator themes) — cosmetic, lower priority than the two real gaps this pass closed.

Verified: `npm run test` (40/40 passing), `tsc --noEmit`, `next lint`, `next build` all clean project-wide.

---

## 2026‑07‑10 highlights (batch 38 — Feature 17 Part 14: Home Safety, Trust, Moderation & Privacy)

Owner dropped **"Feature 17 Part 14 — Home Safety, Content Quality, Moderation, Trust, Privacy & User Well-Being Platform"**: a content-quality/spam engine, misinformation handling, an AI moderation assistant, full reporting across every content type, expanded mute/block, child/family safety, account security, content labels, mental well-being tools, and a "Trust Dashboard." Same standing approach: an Explore-agent audit of the real moderation/reporting/security code first.

**Audit's headline finding: real infra exists in more places than expected, just applied inconsistently or left half-wired.** A `reports` table (migration 0007) with a real auto-hide-at-3-reports trigger and an admin moderation queue already exist — but of 5 places in the app that call `/api/report`, only ONE (the standalone post page's `ReportButton`) actually let a user pick a category; the other 4 (feed card, reel viewer, image viewer, comments) fired a hardcoded `reason: "inappropriate"` with zero input, no note field anywhere. Muting (migration 0035) was write-only — no page anywhere let a user see or undo their own mutes, unlike blocking, which already has a "Blocked accounts" list. And all 6 `security_*` notification types were fully declared, constrained in the DB, and even had icons/copy already built — but a full repo grep found zero actual inserts of any of them, the identical "reserved but dead" pattern batch 29-adjacent work found for `reply`/`mention` months earlier.

**Shipped 3 real items, no new migration** (this round only needed to read/apply data that already existed):

1. **Trust Dashboard — a muted-creators list.** `listMutedCreators()` mirrors `listBlocked()` exactly; a "Muted accounts" section appears on `/account` alongside the existing "Blocked accounts" one, with a real Unmute button. The muted/boosted content-category chips from batch 37's Part 13 work got folded into the same settings page too — a category muted from a feed card's "why am I seeing this" sheet is now reviewable and reversible somewhere real, not a silent, forgettable action.

2. **One real Report flow, used everywhere.** A new portaled `ReportSheet` (category picker — Copyright/DMCA, Inappropriate, Spam, Harassment, Other — plus an optional note field, matching the app's established sheet pattern) replaces all 5 previous report code paths. The one pre-existing correct implementation (`ReportButton`) now just opens this same sheet internally — its external props didn't change, so the standalone post page needed zero edits. The 4 hardcoded stubs across the feed card, reel viewer, image viewer, and comments all now open the identical sheet instead of firing a single unconfigurable fetch.

3. **`security_new_device` wired for real.** Compares the CURRENT sign-in request's user-agent against the account's other sessions (via the same `list_user_sessions` function the Active Sessions settings page already reads) — a genuinely new device (with real session history to compare against) gets a real notification + push. Deliberately triggered from a same-origin CLIENT fetch, fired once per browser session by a new mount-once bootstrap component, rather than from inside the server-side OAuth/magic-link completion routes — those routes call Supabase's auth API directly from OUR OWN SERVER, so the user-agent captured there would be the server's outgoing request, not the real visitor's browser, making the whole comparison meaningless for exactly those two paths. This also meant not needing to touch any of the four actual sign-in code paths, a deliberately cautious choice for security-sensitive code.

**Honestly imperfect, documented as such**: the new-device check is a coarse user-agent comparison, not real device fingerprinting — there's no IP/location signal available, and two different physical devices sharing an identical browser/OS string would look the same. An occasional extra alert is judged the safer failure mode than silently missing a real new device.

**Deliberately NOT attempted, confirmed absent, with reasons**: a content-quality/spam ML engine, misinformation handling (community notes, fact-check partnerships), an AI moderation assistant — all need real classifier/partnership infrastructure that would be faked if attempted. Keyword/hashtag/community/business muting and temporary (expiring) mutes — real, buildable, just not bundled into this pass. Child & Family safety — no birthdate/age data is collected anywhere. Content labels (Sponsored/AI-generated/Sensitive/etc.) — no schema for any of them. Mental well-being tools (screen-time insights, break reminders) — needs new client-side usage tracking, not attempted. Creator/Business/Community safety tools — no communities/marketplace/business backend exists. Also flagged, not fixed: `recompute_trust_scores()` has no cron actually invoking it in this repo despite a code comment claiming one does — a small separate task for later.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide. The new-device comparison logic (single/zero-session accounts never alert; a genuinely new user-agent alerts; a previously-seen one doesn't even when it isn't the most recent session; the just-created session never gets compared against itself; input order doesn't matter) verified with 7 passing checks in a throwaway Node script.

---

## 2026‑07‑10 highlights (batch 37 — Feature 17 Part 13: Adaptive Personalization, Home Customization & Preferences)

Owner dropped **"Feature 17 Part 13 — Adaptive Personalization, Home Customization, AI Preferences & User-Control Platform"**, right after batch 36 confirmed no cross-device preferences table existed anywhere. Same standing approach: an Explore-agent audit of the real settings/ranking/mute code first.

**Audit findings**: `features/account/` has no generic "preferences" pattern except `privacy_settings` (a single self-owned row, RLS-restricted — the right template to mirror). The feed's "why am I seeing this" Smart Explanation chip (`lib/social/smart-feed.ts`'s `feedReason()`) was plain static text, not a button, no menu. `post.category` is real and user-picked (a fixed 13-value taxonomy, `lib/social/categories.ts`), but frequently null — not inferred. `muted_creators` (migration 0035) already filters `loadHomeFeed`'s results — the right pattern to extend for category-level muting. Framer-motion's `Reorder` API (drag-to-reorder lists) has never once been used in this codebase despite framer-motion being a dependency everywhere. "Hide this post"/"Not interested" were both a plain client-side array filter — session-only, gone on reload, never persisted anywhere.

**Shipped, all on one new table** (`supabase/migrations/0040_home_preferences.sql` — **must be applied**, mirrors `privacy_settings`'s exact self-owned-row/RLS shape):

1. **Home Module Editor** (`features/account/home-modules-editor.tsx`, on `/account`) — real drag-to-reorder (framer-motion's `Reorder.Group`/`Reorder.Item`, first use of it in this app) + hide/show for the 4 optional Home sections (Stories, Friend Activity, Trending Reels, Continue Watching), a Reset-to-default button, and three feed-behavior toggles. The main feed is deliberately never in this list — it's infinite, "reordering" it isn't a meaningful operation. `app/(app)/home/page.tsx` now reads the viewer's saved order/visibility and renders sections through a `renderModule()` dispatch — every section keeps its EXACT existing Suspense boundary and skeleton, just reordered/conditionally shown, not rebuilt.

2. **"Why am I seeing this" made actually actionable** (`features/social/content-preferences-sheet.tsx`) — the reason chip is now a real button (plus a "Content preferences" row in the overflow menu whenever the post has a category), opening a sheet with the real explanation text and two real, persisted actions: "Show more {category}" / "Show less {category}" (mutually exclusive — boosting a category clears any existing mute on it and vice versa), plus "Mute creator" (reuses the existing handler, unchanged). Every action immediately affects the NEXT `for_you` feed query — not a cosmetic settings toggle disconnected from the actual ranking.

3. **Preferences wired into real ranking** (`lib/social/home-feed.ts`) — scoped exactly like `rankForYou`/Part 7 already was: only `sort === "for_you"` fetches and applies preferences; `following`/`recent`/`trending` stay untouched. A muted category is excluded from the row set BEFORE ranking (mirrors `muted_creators`'s absolute "remove, don't just de-rank" semantics); `rankForYou` gained a `prefs` parameter — `preferFriends` raises the relationship bonus 120→220, `boostedCategories` adds a flat +60 to matching posts. `fewerReposts` skips the existing `surfaceFollowedReposts` injection outright (stops ADDING reposts on top of the organic feed — the most literal reading of "show fewer reposts").

4. **Quiet Mode** — one real toggle wired into `SmartFeed`: suppresses the Spark/discovery-card deck and the "While you were away" catch-up banner entirely — both are literally the feed's own recommendation/engagement-nudge surfaces, a narrow, defensible scope rather than a vague "calmer feed" reskin nobody could verify.

**Deliberately reframed rather than built as literally asked**: the spec's "AI Preference Studio™" wants a natural-language text box ("I want fewer viral videos" → the algorithm just understands it). There's no real NLP/LLM wired into feed ranking in this app, and building a fake parser that pretends to understand free text would be dishonest — per the standing "Smart, never AI" naming convention, shipped the REAL underlying mechanism (the structured mute/boost/prefer-friends/fewer-reposts controls above) instead of a chat box with nothing behind it.

**Deliberately NOT attempted, confirmed absent, with reasons**: Focus Modes (Study/Work/Travel/Weekend/Family/Creator/Business) — no time-of-day/location/calendar signal exists to key off, would be cosmetic. Feed Health Dashboard (time spent, content-diversity ratios) — needs a new analytics/event pipeline; batch 36's audit already confirmed only video playback + Core Web Vitals are monitored today. Child & Family controls — no birthdate/age data is collected anywhere in this app (a prior onboarding audit already confirmed this). Full Accessibility Customization (manual font-size/high-contrast/gesture-sensitivity/button-size/voice-guidance toggles) — reduced-motion already auto-follows the OS preference (`MotionConfig`, Part 10), but there's no user-facing MANUAL override for that or anything else accessibility-related yet; a real version touches UI-wide plumbing, a separate, bigger slice. Per-post "Hide"/"Not interested" stay session-only (unpersisted) — the new category-level mute/boost mechanism is the actually valuable "control the algorithm" lever the spec wanted; persisting individual post dismissals is a smaller, separate feature not bundled in here.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean project-wide. Two throwaway Node scripts (12 checks total): `normalizeOrder` (a saved module order always resolves to a full permutation even if partial or corrupted, garbage entries dropped, nothing duplicated) and `rankForYou`'s new scoring (a boosted category outranks an otherwise-identical non-boosted post; raising the relationship bonus 120→220 via `preferFriends` is large enough to flip a ranking the smaller bonus wouldn't; muted-category exclusion never accidentally drops a null-category post).

---

## 2026‑07‑10 highlights (batch 36 — Feature 17 Part 12: Feed Performance, Offline Experience, Caching & Sync)

Owner dropped **"Feature 17 Part 12 — Feed Performance, Offline Experience, Cloud Synchronization, Caching & Scalability Platform"**, immediately after confirming (re: Part 11) that backend-less spec items already logged as deferred are a known future roadmap, not something to keep re-flagging. Same standing approach: an Explore-agent audit of the real caching/offline/sync/performance code first.

**Audit findings**: one shared Redis-or-in-memory cache (`lib/cache.ts`) used by every content type via key-prefix, not separate per-type caches as the spec assumes. `next.config.ts`'s `staleTimes.dynamic` is already 6h (from batch 32). `lib/media/resume-positions.ts` (video playback resume) is a plain in-memory `Map` — confirmed lost on refresh. No offline write queue or Background Sync usage anywhere. No cross-device state-sync table (`user_preferences`/`device_sync`/etc. — none exist; only real DB-backed state is collections/saved-posts/push-subscriptions/muted-creators, everything else — theme, video-quality pref, feed sort tab — is `localStorage`/component-state only, not cross-device). Network/battery-awareness exists in exactly 2 places (HLS quality capping, one download-cache-warm skip) — nowhere else. Real-time sync covers notifications/messages/presence/one feed-INSERT-pill; an open post's like/comment count does NOT update live from another viewer's action. Exactly one Vercel cron is actually registered (`/api/cron/trending`) — `/api/cron/friend-reminders` exists but its own code comment already explains why it's deliberately NOT registered (Hobby-plan cron limits; an opportunistic in-request runner in `/api/friends` is the real delivery path, the cron is just a reliability backstop) — verified this is an intentional design, not an oversight, before moving on.

**Shipped 2 real, concretely-scoped slices** (most of the spec — full offline mode for every action, per-content-type caches, multi-device Cloud State, feed-scroll/FPS/memory analytics, billions-of-users edge infra — needs infrastructure this session didn't build, consistent with every prior Part's "don't build blind" standard):

**1. Cross-navigation Feed Continuity ("Instant Resume").** `smart-feed.tsx`'s own code comment already admits `SmartFeed` remounts fresh every time a viewer leaves `/home` and comes back (a module-level `lastFeedFetchAt` variable exists specifically because a `useRef`/`useState` "wouldn't [survive]... since those reset on every fresh mount") — confirming a real, previously-flagged gap (batch 21/Part 4's audit): scroll position, the active tab, and every page loaded past the first via infinite scroll all silently reset. New `lib/social/feed-continuity.ts` snapshots `{sort, scrollY, tabs}` to `localStorage` (same idiom this file already uses for `frenz:feed-seen-at`), capped at 60 items/tab and ignored if older than 30 minutes. Restored via a `useEffect` that runs strictly AFTER mount — never a `useState` lazy initializer, which would read `localStorage` during the same render pass that must match the server's SSR output exactly, the identical hydration-mismatch trap `story-seen.ts`'s unseen/seen rings already had to solve. The restore effect populates the SAME `scrollPosRef`/`restoreScrollFor` refs the existing tab-switch scroll-restore effect already watches, so no second scroll-handling mechanism was needed. Persists on every real fetch, on a cache-hit tab switch, a throttled scroll listener (1.5s), and on unmount as a safety net. Deliberately same-device only — cross-device sync ("Cloud State™") is a materially bigger, separate ask, not attempted.

**2. Offline action queue for Like/Save/Follow ("Offline Interactions").** New `lib/offline/action-queue.ts` — an IndexedDB-backed write queue (survives a real app restart), keyed by a caller string (`like:<postId>`, `follow:<userId>`) so a later queued write with the same key REPLACES the earlier one, collapsing "toggled it 3 times while offline" into just the correct final state. `replayOfflineActions()` walks the queue oldest-first: a 2xx/4xx drops the action (a 4xx — e.g. an expired session — will never succeed on retry either), a network exception stops the whole pass so everything after stays queued in order. New `features/app-shell/offline-queue-sync.tsx` (mounted once in the persistent `(app)` layout, same pattern as `PresenceTracker`) replays on load and on every `online` event. Scoped to exactly 3 actions because all three are confirmed idempotent toggles against their real API routes (`POST` upserts/no-ops on conflict, `DELETE` no-ops on a missing row) — deliberately NOT extended to Comment/Repost/Join-community, which are creation actions that would need a client-generated idempotency key to avoid double-posting on replay, a bigger design not attempted here. No "queued for sync" toast by design — the spec's own "Invisible Recovery™" section asks for silent queuing "without interrupting the user experience," and the standing optimistic UI already is the confirmation.

Verified: `tsc --noEmit`, `next lint`, `next build` all clean. The offline queue's replay decision logic (oldest-first ordering, drop-on-2xx/4xx, keep-on-5xx, stop-the-whole-pass-on-network-exception) got its own 17-check throwaway Node script, reimplementing the exact control flow since IndexedDB isn't available in plain Node.

---

## 2026‑07‑10 highlights (batch 35 — Feature 17 Part 11: Discovery Modules, Friend Activity, Trending)

Owner dropped **"Feature 17 Part 11 — Discovery Modules, Friend Activity, Trending, Continue Watching & Smart Content Surfaces"**: roughly a dozen named Home discovery modules (Friend Activity, Trending Center, Continue Watching/Reading, Recommended Creators, Community/Marketplace/Business/Live Discovery, Learning Hub, AI Discovery, module customization/rotation). Same standing approach as every prior Part: an Explore-agent audit of the real code first, no code written until it came back.

**The audit's headline finding: most of this spec needs backends that don't exist.** A full grep across all 39 migration files confirmed zero `create table` for communities, marketplace, business listings, or courses, and no live-broadcast/RTMP feature separate from the existing Stories (24h ephemeral) and Cloudflare Stream (video-on-demand transcoding) systems. `features/app-shell/dashboard/join-communities.tsx` already hardcodes a fake `COMMUNITIES` array with its own comment admitting "a communities backend isn't modelled yet" — confirmed still orphaned/unimported, and deliberately NOT extended, the same "don't wire fake data into a live page to satisfy a spec bullet" call made in batch 21 (Part 4).

**But the audit surfaced two real, directly buildable gaps — the same bug shape as batch 29's "for_you was secretly fake" fix.**

1. **"Trending" was never actually trending.** `posts.hot_score` is real, materialized infrastructure: `recompute_hot_scores()` (migration 0009 — log-engagement/age^gravity, admin-tunable weights) runs nightly via a genuinely scheduled Vercel cron (`vercel.json` → `/api/cron/trending` at 3am, confirmed live, not dead code). `lib/social/feed.ts`'s lean Explore feed already used it correctly for its own `"trending"` sort. But `lib/social/home-feed.ts` — the richer pipeline behind Home, the Reels product, and SmartFeed — had no `"trending"` option in its `HomeFeedSort` type at all, so Home's own **"Trending Reels" rail** was requesting `sort: "recent"` under the hood: showing the newest reels while labeled "Trending." Fixed by adding a real `"trending"` sort (`order by hot_score desc, created_at desc`, mirroring `feed.ts`'s exact working pattern) and wiring it through `/api/reels`'s sort allowlist, Home's server-rendered rail data, and the rail's client-side revalidation query. `for_you`'s relationship+quality+freshness ranking and the plain `following`/`recent` chronological views are untouched.

2. **Friend Activity — the spec's own words, "one of the most important modules" — didn't exist on Home**, even though most of the data it needs already did. `lib/social/friends.ts`'s `friendsOverview()` already computes a friend-posts activity list, but only for the `/friends` hub page. New `lib/social/friend-activity.ts` builds a richer, Home-specific version from **four honest signals, zero new migrations**: friends' public posts (3-day window), friends' active stories (one entry per friend), friends liking one of the viewer's own posts (`post_reactions` joined against the viewer's recent posts), and a friend starting to follow someone new (excluding the case where they followed the viewer — that's already a notification, not discovery). Each query independently try/caught so one failing table can't blank the others; merged, sorted newest-first, and capped at 2 entries per friend via a small pure `capPerFriend` function (extracted specifically so it has its own logic test, same reasoning as `rankForYou`) so one very active friend can't flood the module. New `features/app-shell/dashboard/friend-activity.tsx`, mounted on Home between Stories and the Trending Reels rail — relationship-first content ahead of global-discovery content, matching the spec's own stated philosophy. Collapses to nothing (no Suspense-stuck skeleton, no fake empty-state filler) for a viewer with no friends or no recent friend activity, the same contract `ContinueWatching` already uses.

**Deliberately not attempted, with reasons**: Recommended Creators still ranks by raw `followers_count` — no mutual-friends-follow boost despite the spec's explicit "Friends following" signal bullet; real and cheap, just not bundled into this pass. `home-rail.tsx`'s "Popular Hashtags" is still hardcoded fake view counts — pre-existing (not introduced this round), found during this exact audit, left alone rather than half-fixed since a real version needs its own aggregation design. Continue Reading (no article/long-post content type — `posts.format` is `'feed'|'reel'` only), all four backend-less Discovery categories (Community/Marketplace/Business/Live), Learning Hub, AI Discovery/interest graphs (the same infra gap batch 29 already declined to fake), and a true Module Engine™ (hide/reorder/pin Home sections) all confirmed absent, none faked.

Verified: `tsc --noEmit`, `next lint`, and a full `next build` all clean project-wide. `capPerFriend`'s sort/cap/limit interaction verified with 7 passing checks in a throwaway Node script: one very active friend capped at 2 while a quiet friend's single item still surfaces, the overall limit is applied after capping (keeps the newest, doesn't starve a late-arriving friend), output is always sorted newest-first regardless of input order, the function never mutates its input, and empty input returns empty.

---

## 2026‑07‑13 highlights (batch 55 — typing indicator genuinely fixed + PIN-set/step-up crashes root-caused, migrations 0066+0067)

Owner reported typing was still broken, and separately, "setting pin in secret chat showed something went wrong, and the other security doesn't work." Root-caused all of it empirically — real test accounts created via the Supabase admin API, real bearer-token HTTP calls against a running dev server — rather than trusting the prior round's code-level fix.

**Typing indicator — actually fixed this time.** Reproduced directly: two real signed-in users, a genuine conversation membership row, and `channel.subscribe()` on the typing presence channel still came back `CHANNEL_ERROR`/"Unauthorized," even though the membership check itself was provably correct when called directly. The real cause, found by reading `@supabase/realtime-js`'s own source: the client library **always includes a `broadcast` block in every channel's join payload**, even a channel that only ever listens for presence events — there's no "only send broadcast if it's used" guard. Supabase's Realtime Authorization requires a matching database policy for every extension present in that join request, and the existing policy only ever authorized the `presence` extension, so the always-present `broadcast` component of the same request had nothing to authorize it and the whole join was denied. Migration `0066` widens the policy to cover both — confirmed fixed with a live two-user presence-sync test (not just "the migration ran without error").

**Setting a PIN failed with a generic error.** The live `security_pin` table was missing its `pin_length` column entirely — not a stale schema-cache issue (checked column-by-column), a genuinely missing column. Cause: `create table if not exists` is a no-op once a table already exists in any shape at all, so however this table first came to exist live (most likely an earlier partial migration-apply attempt), later re-runs of the migration file — which has always included this column — never actually added it. Migration `0067` adds it (the table had zero existing rows, so a plain column add was safe, no backfill needed).

**Two required secrets were never actually configured.** `RECOVERY_CODE_PEPPER` and `STEPUP_SIGNING_SECRET` were flagged as required when the account-security feature shipped, but never set anywhere. Missing, they crashed recovery-code generation, recovery-code redemption, and passkey step-up verification with a raw, opaque server error (not even this app's own clean error format) — and, critically, **the PIN *unlock* step itself**, since verifying a PIN also issues a step-up credential right after confirming the PIN was correct. So even once the schema bug above was fixed, a correctly-entered PIN still couldn't unlock anything until this was set. Hardened all four routes so a misconfigured secret degrades to a clean error instead of an opaque crash — but the real fix is the two env vars, which now need adding to Vercel's Production environment (generated locally and verified working end-to-end there first).

**Also fixed while re-checking the admin-account PIN-gate bfcache fix from the previous round:** the "restore from being frozen mid-navigation" handler re-read whether the gate was unlocked but never re-checked whether the configured auto-lock timeout had actually elapsed, so freezing the tab while unlocked, waiting past that timeout, and returning via an iOS back-gesture left the gate unlocked past its own window. Fixed, and the identical "a busy/loading state can get stuck forever if the tab freezes mid-request" gap was found and fixed in the 2FA, passkey, and recovery-codes settings panels too — same bug class, three more places it could happen.

Verified: `tsc`, lint, and the full test suite clean throughout, plus the live diagnostics described above (not just a code read).

---

## 2026‑07‑10 highlights (batch 34 — reel-album swipe's REAL fix, carousel double-tap-Wow + instant open, owner-reported)

Owner reported three things after batch 31's "smooth as a top platform" reel-album swipe shipped: it still didn't actually switch videos on a real swipe ("it scrolls and shows a scroll bar at the side but still in same video"); multi-media feed posts (photo/video carousels) never animate a Wow burst on double-tap the way single video/image posts do; and multi-image posts feel slow to open.

**The reel-album swipe's real bug, found this round.** Batch 31's `dragX` live-drag was structurally correct but never reliably won against the deck's native vertical scroll on a real touch device. `touch-action: pan-y` on the media stage only tells the browser vertical panning is *allowed* for touches starting there — it does not stop the browser from eagerly claiming an as-yet-ambiguous touch for the deck's own native scroll before `onPointerMove` has finished deciding the gesture is horizontal. And once claimed, JS has no way to take it back: Pointer Events cannot cancel native touch scrolling (`preventDefault()` on a `pointermove` silently no-ops for this) — only a real, non-passive `touchmove` listener's `preventDefault()` actually works, the same underlying browser gotcha this file already documents for `MediaCarousel`'s wheel handler (batch 5-era), just the touch-event version. Since the reel viewer only ever used Pointer events, it had zero mechanism to stop native scroll winning the race, which is exactly the flaky "sometimes it just scrolls and stays on the same video" behavior reported. Fixed with a real `addEventListener("touchmove", handler, { passive: false })` on the media stage that calls `preventDefault()` only while a horizontal album drag is actually underway (`dragActive`) — vertical reel-to-reel scrolling and non-album swipes are untouched, since that flag is never set for those paths.

**`MediaCarousel` never got the double-tap-Wow treatment.** `FeedVideo` and `FeedImage` (single-media feed posts) already had a premium centered Wow burst on double-tap, built on custom pointer-event tap detection. The feed's multi-media carousel had neither: it used a plain `onClick` per slide inside a native horizontally-scrolling, snap-mandatory container — exactly the kind of element mobile browsers delay/suppress `click` on while they disambiguate tap-vs-scroll, which is what read as "opening is slow." Rebuilt slide taps on pointer events + a 12px movement tolerance (the same pattern `FeedImage` uses), added the identical centered `WowSolid` burst + "Double-tap to Wow" hint, and wired `liked`/`onDoubleTapLike` through from `feed-post-card.tsx`. Fixes both reported symptoms at once, since they shared one root cause.

**Standing lesson (now true twice in this codebase):** touch-action alone never guarantees a custom JS gesture beats a competing native scroll — it only sets what the browser is *permitted* to do, not what wins first. Pair it with a real non-passive `touchmove`/`wheel` listener that calls `preventDefault()` once the custom gesture is confirmed, whenever a custom drag needs to reliably override a native scrollable ancestor.

Verified: `tsc --noEmit`, `next lint` (both changed files — the only warnings present are 2 pre-existing ones in `reel-viewer.tsx` unrelated to this change), and a full `next build` all clean. No live-device touch reproduction was available in this environment; the fix targets the exact documented browser behavior (a well-established gotcha, not a guess), and is additive/no-op unless the custom gesture has already been confirmed, so it cannot regress any currently-working path.

---

## 2026‑07‑10 highlights (batch 33 — Feature 17 Part 8: engagement/action-bar slice)

Owner dropped **"Feature 17 Part 8 — Feed Interactions, Social Engagement, Premium Action Bar & Meaningful Engagement System"** — another huge spec (premium multi-emotion reactions, voice/GIF/video comments, AI smart replies, a full repost network with scheduling/drafts, Collection Studio, live engagement, relationship-aware notifications). Same standing approach as every prior Part: audited the real code first (an Explore-agent research pass, no code written) before picking what to build.

**The audit's headline finding: this codebase is already far more mature than the spec assumes.** The reaction system is not a plain "Like" — it's already a premium 8-emotion long-press picker with a branded "Wow" glyph, float-up bursts, and per-user emotion storage ([[wow-interaction]]). Repost already supports "repost with your thoughts" (a caption flow, functionally a quote-repost), pin, 15-minute edit, drafts, and an Undo toast. Comments already have rich text, mentions/hashtags/URL linking, stickers, moods, per-comment reactions, and pin/"best answer." Save/Collections already have folders with visibility scoping. Share already covers DM/copy-link/OS-share. None of that needed rebuilding — the "REMOVE CURRENT DESIGN" section describing cartoon icons/weak animations/flat rows doesn't describe this app.

**Picked 5 small, real, currently-missing gaps instead of the aspirational rest** (no AI, no voice/video pipelines — this app has exactly one working LLM integration, a support-chat assistant entirely unrelated to the feed, confirmed via a full-repo grep):

1. **Relationship-aware repost notifications — the spec's own "Friend Repost Notifications" exclusive feature, and the one genuinely-missing capability the audit found.** Every existing engagement trigger only ever notified the original post's owner; a reposter never heard about engagement their repost drove. New migration `0036_repost_engagement_notifications.sql` (**must be applied in Supabase**): a new trigger, additive (doesn't touch the existing working triggers), fires on a like/save/comment and notifies every OTHER reposter of that post — but only when the actor and that reposter are actual friends (checked against the `friendships` table), matching the spec's literal "mutual friend" framing rather than spamming a viral repost's owner with every stranger's like. Ships as an in-app notification only for now — device push would mean duplicating the trigger's reposter-lookup + friendship-check in application code at two more API routes, a real scope increase not attempted here.
2. **A real mute-creator.** Two viewers already had a "Mute creator" menu row — it just toasted "coming soon," a visibly fake affordance. New migration `0035_muted_creators.sql` (**must be applied**, structurally mirrors the existing `blocks` table) + a new `/api/mute/:id` route + a feed-query filter in `lib/social/home-feed.ts` (a muted creator's posts stop appearing in the muter's own feed, silently — nothing severed, no notification, unlike a block). Wired into all three surfaces that show a post (feed card, reel viewer, image viewer) — feed-post-card.tsx never even had the menu row before this.
3. **Image-viewer's Download button was triple-exposed** — a persistent rail button, a persistent desktop-sidebar icon, AND an overflow menu item, while the feed card and reel viewer both correctly keep Download overflow-only (the spec's own explicit ask: "The Feed should NOT permanently display a Download button"). Removed the two persistent exposures, leaving just the overflow item, matching the other two viewers.
4. **Collection-picker search** — folders (collections) already existed with visibility scoping; there was just no way to search them once you had more than a couple. Added a search input (shown once there are enough collections to warrant it) with its own empty state.
5. **A shared `AnimatedCount` component** replacing 6 separately hand-rolled instant-swap count displays across the feed card, reel viewer (×2), image viewer (×2), and post viewer — counts now visibly count up/down instead of snapping, satisfying the spec's "Animated Like Counter" ask concretely. Skips the animation on first mount (a card appearing with 4,200 likes shouldn't count up from 0) and snaps instead of animating through a huge, unrelated jump (a defensive safety net, though React's own per-post keying means this shouldn't normally trigger).

**Deliberately not attempted, and why**: true quote-repost as an independent feed item (the existing caption system already covers "repost with opinion" in spirit — a bigger architectural change to make it a standalone card wasn't justified by this pass), scheduled/draft repost management, a real analytics link in the overflow menu (the data layer exists but no page renders it yet — linking to nothing isn't better than not linking), post-level "friends who liked this" (would need a new batched query on the hottest page in the app — deferred rather than risking a performance regression on Home), and the full action-button motion consolidation onto shared spring tokens (5 near-duplicate components with slightly different hardcoded spring values — a real cleanup opportunity, but a pure refactor of already-working interaction code across 4-5 files, lower priority than shipping new capability this pass).

**Verification**: `tsc`/lint clean project-wide; the new mute API route reviewed against the existing `blocks` route's security model (authenticated user only ever acts on their own row; RLS as defense-in-depth) — same shape, no gaps found; `AnimatedCount`'s mount-skip/snap-threshold decision logic verified with 13 passing logic tests; the SQL trigger's correctness was reasoned through carefully (self-exclusion, multi-reposter loop, symmetric friendship lookup) but — honestly — could not be executed against a live Postgres in this environment, so it hasn't been run, only read closely.

**Migration 0036 failed on the owner's first real run** — exactly the risk that last caveat flagged. `notifications_type_chk` had been widened THREE times across this table's history (0013 → 0018 → 0020_friends.sql, which added `friend_request`/`friend_accepted`/`friend_reminder`), and 0036's drop-and-recreate was built off only the 0018 copy — never grepped for a LATER migration also touching the same constraint name. Real friend-request rows already in the table violated the narrower replacement, and the same gap existed in the paired dedupe index. Fixed: the migration now carries the full union of every prior widening, not just the last one found. Standing rule going forward: `grep` every migration file for a check constraint's name before altering it, never assume the most recently written migration you happen to find is the last one that touched it.

---

## 2026‑07‑10 highlights (batch 32 — Home instant-nav, splash trigger-scope corrected, loader polish, owner-reported)

Owner: "i dont want the homepage to reload each time a user clicked the homepage after already loaded and in another page, i want the home page to load once and load instantly next navigation and auto refresh while already shown instantly. while the frenz logo and text loader are showing, skeleton F shouldnt show in first log in or after the cached data is cleared, and reduce the frenz text size to smaller and with a stylist font in the first loader. the F logo and text shouldnt show after the first login and it shouldnt show each time a user refresh or enter the app or website, it should only show on first login and when the web or app was cleared."

**Home: load once, instant on every navigation back, quiet auto-refresh while stale.** `next.config.ts`'s `staleTimes.dynamic` (the client Router Cache setting controlling whether an in-app navigation reuses the already-fetched page or refetches with a skeleton flash) was already configured, but at only 180 seconds — nowhere near a real browsing session. Raised to 6 hours: navigating away and back to Home now stays instant for any realistic session length. That alone risked stale content sitting silently cached, so the real gap this surfaced: SmartFeed's existing "Alive on return" quiet-refresh (already built, previously verified as "already correct") is keyed ONLY off `visibilitychange`/`online` — it can't see a pure in-app route change, since the tab itself never actually hides when you navigate Home → Explore → Home. Added a module-level "last actually fetched" clock (survives even if the component gets a fresh mount when the Router Cache restores a cached navigation) checked once per mount, reusing the exact same revive logic (top-of-feed → refresh in place; mid-scroll → quiet diff + the existing "new posts" pill). Scoped to the main feed only — Stories/Trending/Continue Watching/right rail don't have any client refresh capability today; extending that is a materially bigger, separate undertaking.

**Corrected the welcome-splash scope from earlier the same day.** Owner clarified, after seeing it live, that the splash should fire ONLY on first-ever login and after site data was cleared — not on every sign-in, and not on resuming from a minimize, which is what had just been shipped. Deleted `SessionSplash` entirely along with its cookie-marker wiring across `auth-panel.tsx` and both OAuth/magic-link callback routes — the pre-existing `BrandSplash` (first-visit-ever, gated on the `frenz_welcomed` cookie) already correctly covers both of the owner's actual conditions on its own; nothing new was needed for "cache cleared" specifically. Recorded as a standalone feedback memory since the lesson (don't infer a broader trigger set than literally asked, even when the request references another app's behavior) generalizes past this one feature.

**Fixed the loader double-flash + restyled the wordmark.** `BootSplash` (the plain grayscale skeleton baked into every cold page load) used to show BEFORE the colorful welcome splash even on the two occasions the colorful one actually appears — landing on `/home` with no `frenz_welcomed` cookie now suppresses the skeleton entirely (an inline synchronous script, same technique the file already used for its theme-detection script, so it's decided before anything has a chance to paint). The "Frenz" wordmark in the splash shrank from `text-3xl` extrabold Inter to a smaller, medium-weight `Space Grotesk` (a dedicated display face loaded via `next/font/google`, scoped to only this one splash text — the app's single body/UI font stays Inter everywhere else) for a more refined, "stylish" feel, verified against a rendered mock in both themes before shipping.

No live-device/navigation testing was possible in this environment (auth-gated) — the Router Cache remount question in particular (does SmartFeed's component instance truly persist across a cached navigation, or get a fresh mount?) could only be reasoned through for correctness under BOTH possibilities, not settled by actually watching it happen. If a reload is still visible after this, that's the next thing to pin down.

---

## 2026‑07‑10 highlights (batch 31 — reel-album swipe made "smooth as a top platform", owner-reported)

Owner: "make multiple videos in reels should be able to scroll to the next when scrolled down and when scrolled left it shows the other video in the reels card, the scrolling and switching should be as smooth as a top platform."

**Vertical (reel-to-reel, "scroll down for the next")**: audited `ReelDeck`'s scroller before touching anything — it already uses native `scroll-snap-type: y mandatory` with `requestAnimationFrame`-debounced active-index tracking and buffer-gated rendering (a fast fling can never land on a cold, unbuffered clip). This is already the smoothest a browser can do — hardware-accelerated, native momentum. No concrete bug found; left untouched rather than inventing a change in working code.

**Horizontal (within one reel's own album, "scrolled left shows the other video") — the real gap.** A prior slice this session added a crossfade when switching between an album's videos, explicitly because a TRUE sliding carousel wasn't safe to retrofit: the reel's single `<video>` element is deliberately kept mounted across slide changes (adaptive HLS/MP4 source attachment is imperative — remounting risks breaking autoplay/resume). That constraint is still real, but doesn't actually block a live-tracked DRAG — you only need the *neighbor's poster* visible during the gesture (a cheap placeholder), not its real video, and real platforms use exactly this trick for carousels of heavy media.

Rebuilt in `features/feed/reel-viewer.tsx`:
- The current slide now has `x` bound to a framer-motion `dragX` value, updated imperatively on every `pointermove` (no React re-render per frame) — it genuinely slides with the finger in real time instead of only reacting once you release past a threshold.
- New `AlbumNeighborPreview`: a poster-only layer (same blurred-backdrop treatment as the existing cover image) for the previous/next video, positioned via `dragX ± viewport width` so it slides into the revealed space in perfect lockstep with the current slide sliding away — verified the transform math visually in a static mock (dragging left correctly brings in the next poster from the right; dragging right brings in the previous from the left) before trusting it.
- **Rubber-band resistance** at the first/last video — dragging past the edge moves at 35% instead of 1:1, the "soft wall" feel every native carousel gives instead of doing nothing.
- **Release uses a dual threshold** (decisive distance OR a fast flick) to decide whether to advance, matching how real story/carousel decks actually behave — verified with 15 passing logic tests (rubber-band correctness at both edges, threshold/velocity/boundary combinations for the release decision).
- The actual video source swap still only happens once fully off-screen (the drag animates the rest of the way out first, `goSlide` fires only after) — so it's exactly as invisible as the previous crossfade was, just reached via a real gesture instead of a threshold-then-flip.
- Non-album horizontal drags (the page-variant For You/Following tab swipe) and vertical native scrolling are completely untouched — only the album+horizontal path was rewired.

Verified: `tsc`/lint clean (confirmed the file's 2 pre-existing lint warnings are unrelated by diffing lint output before/after this change), 15/15 logic tests passing, transform positioning confirmed via a rendered mock screenshot — not just derived on paper.

---

## 2026‑07‑10 highlights (batch 30 — instant-open pass + welcome-back splash, owner-reported)

Owner: "make images in feed open immediately when clicked and make the continue downloading videos [not] load when opening, it should load ahead just like reels and status... make the reels button in feed open instantly without loading, reels page should be loaded already as users scroll on feed... use the new F with the colors as the first time login loader, when a user logged in, cleared their minimize and comes back to just like how tiktok and twitter first time loader is."

**Images now open as instantly as videos already did.** `ImageViewer`/`PostViewer` are code-split (`next/dynamic`) so the FIRST tap in a session had to fetch their JS chunk before opening — `ReelsFeed` already avoided this via an idle-time `preloadReelsFeed()` warm-up, but nothing warmed the other two viewers. Added `preloadPostViewers()` to the same existing idle-time effect in `smart-feed.tsx` — all three viewer chunks (Reels, Image, Post) now warm together once the feed settles, so every tap — image or video — opens from an already-loaded chunk.

**Continue Watching videos now load ahead, not on open.** Audited why tapping a Continue Watching video showed a "Loading video… X%" stream instead of playing instantly: `warmMediaCache` (a prior fix — see the round-10 entry below) only ever ran ONCE, at the exact moment a NEW download finished. Anything downloaded in an earlier session — which is most of what's actually sitting in the Continue Watching row day to day — was never warmed, so reopening it always re-fetched over the network from scratch. Fixed in `features/app-shell/dashboard/continue-watching.tsx`: a mount effect sequentially warms every visible recent video not already cached (never in parallel, so it can't spike bandwidth), skipped entirely for whatever's already cached, and still fully respects `warmMediaCache`'s existing Data Saver/slow-connection gate. `download-player.tsx`'s player already checked the cache first — it just needed something to actually keep it filled ahead of time, the same contract Reels/Stories already have.

**Reels opens instantly, and the /reels route itself is warmed while scrolling the feed, not just its JS.** The feed's own topbar Reels tab already opened the in-place deck instantly when videos were loaded (seeded straight from already-loaded feed items, zero extra fetch) — the one remaining gap was its fallback path (`router.push("/reels")`, used when no video has loaded yet), which was a real, unwarmed navigation. Added `router.prefetch("/reels")` to the same idle-time effect above, so by the time anyone actually needs that fallback, the route is already primed — matching the existing `router.prefetch` pattern `mobile-nav.tsx` already uses for Home/Friends/Messages.

**New: a TikTok/Twitter-style full-screen welcome splash on sign-in + resume-from-minimize**, using the new branded F (already the default via `FrenzLogo` from the earlier logo re-brand). The app already had exactly this visual — `BrandSplash`, gated to the very first /home visit ever, via a 1-year cookie — but it never fired again after that. Extracted the pure visual into a new shared `WelcomeOverlay` component (`brand-splash.tsx`) so `BrandSplash` (first-visit) and the new `SessionSplash` (everything else) can never visually drift apart. `SessionSplash`, mounted once in `app/(app)/layout.tsx` (so it covers whatever page someone lands back on, not just /home):
- **Fires on a fresh sign-in** — a short-lived (`60s`) `frenz_just_signed_in` cookie is set at the moment sign-in actually succeeds in all three real sign-in paths (`auth-panel.tsx`'s password path and OTP-verify path, and both `app/auth/callback/route.ts` and `app/auth/confirm/route.ts` for Google/magic-link), immediately before the redirect into the app. `SessionSplash` reads-and-clears it once on mount, so it can only ever fire the one time it's meant to. The password-reset branch of the OTP flow deliberately does NOT set it — that lands on "set a new password," not a real "welcome in" moment.
- **Fires on resuming from a real minimize** — a `visibilitychange` listener tracks how long the tab/installed app was actually hidden; only ≥15s away counts (a quick glance at a notification shouldn't repaint the whole app with a splash), matching the intent of "cleared their minimize and comes back."
- Kept brief (1.1s, vs. the first-visit splash's 1.5s) — a resume transition, not a first-impression beat.
- **Not the same as the still-open "iOS splash screens" item** in the PWA spec (`apple-touch-startup-image` — the native OS-level image iOS shows before any JS runs) — this is a JS-driven in-app overlay for a different moment (after the app is already running) and doesn't close that item.
- Verified visually: rendered the real overlay markup + the actual new logo file in a static mock, screenshotted in both light and dark — centered mark, gradient wordmark, soft violet glow, full-bleed, matches the ask. `tsc`/lint clean across every touched file.

---

## 2026‑07‑09 highlights (batch 29 — Part 7: real "For You" ranking layer)

Owner dropped **"Feature 17 Part 7 — Intelligent Feed Engine, AI Ranking, Content Distribution & Personalization Platform"**: the largest brief in this series so far — a full recommendation-systems spec (multi-layer ranking engine, relationship/interest/quality/freshness/context/safety layers, negative-signal spam detection, interest graphs, contextual time-of-day recommendations, trend detection, "Missed Moments™", a conversational "Personal AI Feed Coach™", AI summarization). Same standing call as Parts 1-6: audit the real code first, ship a well-scoped, honest slice instead of attempting the whole platform blind — this brief in particular is mostly ML/LLM infrastructure this codebase doesn't have, so the slice had to be chosen carefully.

**The audit found something the brief's own mission statement predicts and names as the exact failure mode to avoid**: `lib/social/home-feed.ts`'s `loadHomeFeed` had **no ranking step for "for_you" at all** — every sort (`for_you`, `following`, `recent`) just ran `ORDER BY created_at DESC`, meaning "For You" and "Recent" produced the *identical* ordering. The tab literally named after personalization was doing nothing but showing everyone's posts newest-first. Meanwhile `lib/social/smart-feed.ts` (client-side, from the earlier Feature 5 work) already had a `feedReason()` function computing a "why am I seeing this" explanation chip — genuinely useful, but purely decorative: it never actually influenced ordering, so a post could be labeled "Popular right now" while sitting in an arbitrary chronological slot lower than posts with far less engagement.

**Shipped: a real, explainable ranking layer for "for_you"** (`rankForYou` in `lib/social/home-feed.ts`) — no ML, no external calls, matching the file's own pre-existing design philosophy comment ("a transparent, auditable score over signals we already store. Naming stays 'smart', never 'AI'"):
- **Relationship layer** — a large flat bonus if the viewer follows the publisher (the brief's own "relationship quality matters more than follower count" principle, made literal).
- **Quality layer** — `likes + comments×2 + shares×3 + saves×2 + downloads×2`, the exact same weights `smart-feed.ts`'s `engagementScore`/`feedReason` already use client-side (kept in sync deliberately, so the reason chip stays truthful about what actually drove ranking, not just plausible).
- **Freshness layer** — a smooth decay (`40 / (1 + ageHours/30)`), not a hard age cutoff — a much better older post CAN still outrank a mediocre brand-new one, matching "Freshness Engine: balance new/recent/evergreen without overwhelming users," rather than the all-or-nothing age gate a naive implementation would reach for.
- Applied **only to `sort === "for_you"`** — `following` and `recent` (Reels) deliberately stay plain reverse-chronological, which is the behavior a dedicated Following/Reels tab is expected to have (an unfiltered view of exactly what was posted, not a second algorithmic feed).
- The existing per-publisher diversity cap now runs **after** ranking instead of after plain chronological order, so it keeps each creator's best-ranked posts in the feed, not just their newest — a free correctness improvement from the reordering, not a separate change.
- Verified with 7 targeted logic tests in a throwaway Node script (not just read-and-trust): a followed creator's mediocre post outranks a higher-engagement stranger's; quality ordering is correct among strangers; freshness decays smoothly (an old great post can beat a fresh mediocre one, but equal-quality posts favor the fresher one); exact ties preserve original recency order (no arbitrary shuffling); an anonymous viewer with an empty following set still gets a meaningful quality+freshness order; the function is fully deterministic. All 7 passed.
- `tsc --noEmit` + lint clean.

**Deliberately deferred — real infrastructure gaps, not polish, same "don't build blind" reasoning as every prior part:**
- **Interest Layer / private interest graphs** — would need a viewer-affinity query (aggregating the viewer's own liked/downloaded post categories) on every feed load; a real, buildable feature but a separate slice with its own latency/caching considerations, not bundled into this one to keep the ranking change reviewable and low-risk.
- **Negative signals / spam & clickbait detection** — the existing hard `trust_score` cutoff (already in place, untouched) is the only safety signal; real spam/clickbait/bot detection needs a moderation pipeline that doesn't exist.
- **Missed Moments™** (birthdays, milestones, life events) — no such data model exists on `profiles`/`posts`; this is a new feature with its own schema, not a ranking-signal tweak.
- **Contextual (time-of-day) recommendations, trend detection (local/national/global), multi-feed modes beyond the four that already exist** — all real, scoped features on their own, not attempted here.
- **AI summarization, Personal AI Feed Coach™** — both need an actual LLM integration this codebase has never had (the product's own established convention is "Smart" branding, not a real "AI chat" surface) — out of scope for a ranking fix.

---

## 2026‑07‑09 highlights (batch 28 — feed tabs lifted into the top nav, owner-reported)

Owner asked: "take the For You, Following and Reels [tabs] upwards to the top nav and design the text and all the icons there more premium with high contrast" — then clarified "remember i mean in feed" (scope: the feed page only, not a global topbar redesign).

- **New shared top-nav slot, feed-only.** `features/app-shell/topbar-slot.tsx`
  is a tiny external store (same pattern as `topbar-visibility.ts`) letting a
  page inject content into the CENTER of `AppTopbar`. `SmartFeed` is the only
  writer — it sets the slot on mount/whenever `sort` changes and clears it on
  unmount, so every other page's topbar (search bar included) is completely
  untouched. `AppTopbar` renders the slot content in place of the search
  bar/spacer when present, with a compact search-icon fallback added for
  desktop (⌘K/search still needs a reachable entry point once the inline pill
  is gone).
- **The old sticky segmented control (a separate bar below the topbar,
  plain text + thin underline) is REMOVED from the feed body** — it now
  lives inside the topbar itself via the slot, not duplicated.
- **New premium `FeedTopbarTabs`** (`features/feed/feed-topbar-tabs.tsx`):
  the active tab expands into a solid blue→violet gradient pill with a white
  icon+label (the highest-contrast element in the bar); the other tabs
  collapse to a plain icon-only circle so three labels never fight for the
  topbar's tight mobile width — verified to fit comfortably at 390px
  alongside both icon clusters via a static mock screenshot (real headroom to
  spare). "Reels" can never carry the active/toggle state (tapping it opens
  the reel deck in place or navigates to `/reels` — `sort` never becomes
  `"recent"`), so instead of faking a toggle it stays a permanently
  violet-accented launcher pill with its own solid icon — an honest
  representation of "always tappable" vs. "currently selected."
- **Two new Signature Icon System glyphs** in `components/icons/frenz-icons.tsx`,
  built from the same straight-line/`rect rx`/`circle` primitive language as
  the rest of the set:
  - `FrenzSparkleOutline`/`Solid` — a 4-point sparkle/twinkle polygon for "For
    You" (personalization).
  - `FrenzReelsOutline`/`Solid` — a portrait reel frame with a play notch.
    The outline draws the notch as an open stroke triangle (matching how
    `FrenzInboxOutline`'s flap is drawn); the **solid** variant needed the
    triangle to read as a genuine cut-out rather than an invisible
    same-color overlay, so it uses an SVG `<mask>` (white rect body, black
    triangle) to punch the play notch out of the filled frame —
    `useId()`-scoped so the mask id never collides if the icon renders more
    than once on a page.
  - "Following" reuses the existing `FrenzFriendsOutline`/`Solid` (already
    means "people" on the sidebar's own Friends nav item — one glyph, one
    meaning, app-wide).
  - All verified by rendering the raw SVG path/mask markup in a static mock
    and screenshotting it (not just reasoning about the path data) — caught
    nothing wrong, but this is exactly the kind of "malformed at 18px, fine
    at 48px" risk a screenshot catches that a pure code review wouldn't.

No live-device testing (auth-gated environment) — verified via `tsc`/lint
(clean) and the static topbar mock at both mobile (390px) and desktop
(900px) widths, not the real app.

---

## 2026‑07‑09 highlights (batch 27 — definitive carousel scroll fix, full-photo viewer, new branded F logo everywhere, owner-reported)

Owner reported: album carousels still couldn't be scrolled past on touch ("multiple pictures in feed still doesn't scroll … I can only scroll sideways"), tapped photos didn't show in full, and asked to replace the logo everywhere with the newly-branded F art (a transparent version for share/email/favicon/marketing, a dark-tiled version for the in-app webapp logo).

- **The real carousel vertical-scroll bug — found and PROVEN, not guessed.**
  `MediaCarousel` (the feed's album/multi-media carousel, used by BOTH photo
  and video albums) set `touch-action: pan-x` on its native horizontal
  scroller. A CDP touch-emulation reproduction (real trusted touch events,
  not synthetic) showed conclusively: with `pan-x` a vertical swipe that
  begins on the carousel scrolls the page **0px** — the scroll container
  captures the vertical gesture and, because it can't scroll vertically
  (`overflow-y: hidden`), never chains to the page. Fix: `touch-action:
  pan-x pan-y`, which the same reproduction proved restores vertical page
  scroll (322px) while keeping horizontal carousel scroll (372px). This is
  why single feed videos always scrolled fine — `FeedVideo` uses
  `touch-pan-y`, not `pan-x`. The ONLY other explicit `pan-x` is the
  fullscreen `AlbumSwipe` (image viewer), correctly left alone — it's a
  locked modal with no page to scroll, where JS owns the swipe-down dismiss.
  Every other in-app horizontal rail (stories, trending, continue-watching,
  notification tabs…) uses default `touch-action: auto`, which the matrix
  proved scrolls both axes — so none of them were ever affected. The reels
  deck uses `pan-y` (its own scroll axis) and was never the bug; inline
  **video albums** in the feed ARE `MediaCarousel`, so they're fixed by the
  same one-line change.
- **Tapped photos now show in FULL.** The single-image viewer
  (`ImageViewer`) had a "full-bleed" rule that switched near-screen-aspect
  photos to `object-cover`, cropping their edges — which read as "the
  picture doesn't show full." Removed it: a tapped photo is now always
  `object-contain` (whole picture visible) over a blurred backdrop that
  fills the letterbox. (Albums already used `object-contain`; only the
  single-photo path had the crop.)
- **New branded F logo, everywhere, two variants.** Two clean square exports
  drive the whole product from `components/brand/frenz-logo.tsx`:
  `public/brand/frenz-logo.png` (transparent) and
  `public/brand/frenz-logo-tile.png` (the same F on its dark navy tile,
  opaque). `FrenzLogo`/`FrenzWordmark`/`FrenzMark` default to the
  **transparent** mark and take a `tile` prop for the dark-tiled app-icon
  variant. Placement per owner's instruction:
  - **Transparent** — marketing header/footer, loaders, the pull-to-refresh
    spinner, the sign-in email (`resend.ts`), the **favicon** (`app/icon.png`,
    the browser-tab mark "by the side of the URL"), and the **share/Open Graph
    cards** (`OG_ICON_BASE64` regenerated at 184px → covers the root
    opengraph-image, twitter-image, and per-downloader OG). SEO/landing pages
    inherit the transparent mark through the shared header/footer.
  - **Dark tile** — the in-app **webapp logo** (the app sidebar wordmark) and
    the opaque home-screen icons that must not be transparent: `app/apple-icon.png`
    (iOS), `public/icon-192.png`/`icon-512.png`/`icon-maskable-512.png` (PWA +
    Android maskable), and `public/icon.png` (the push-notification icon in
    `sw.js`). All regenerated from the tile with `sharp`.
  - **Sitemap**: a sitemap is a URL list with no logo — nothing to change
    there; the "share a link" and "favicon by the URL" asks are the OG cards
    and `app/icon.png` respectively, both updated.
  - **Superseded 2026‑07‑11** (owner: *"remove the black background from the
    pwa logo... so it becomes white background... let the shared og look
    like [a] premium background without write up"*): the dark-tile variant
    above is retired. Every PWA/app icon (`app/apple-icon.png`,
    `public/icon-192/512/1024.png`, `icon-maskable-512.png`, the 152/167
    legacy Apple sizes) is now generated white-background + centered from the
    single transparent `frenz-logo.png` master via `scripts/gen-icons.mjs` —
    there is no more separate dark-tile source file in the pipeline.
    `OG_ICON_BASE64` was regenerated at 480px (was 184px). The OG/share image
    (`components/og-image.tsx`) dropped its wordmark+headline+description
    text entirely — every route (including per-`[downloader]` pages, which
    used to get dynamic headline text) now shares one universal white,
    soft-glow "premium logo card" with no text; per-page descriptions live
    only in each route's `generateMetadata` meta tags now, never on the
    image itself.

## 2026‑07‑09 highlights (batch 26 — pull-to-refresh + Stories-style Continue Watching player, owner-reported)

Owner asked directly for three things: "implement a slide down from top to refresh in the webapp", "make the videos in continue watching change[] to the next automatically like stories after watching and can be next by tapping right and backward by tapping left", and "when watching from [Continue Watching] it shouldn't show those buttons below, it should show the view of status and put all the buttons in the dotted menu above."

- **Pull-to-refresh became a reusable primitive**: extracted the Home feed's
  existing pull-to-refresh (premium quiet-grayscale-F treatment, real haptic,
  never calls `preventDefault` so native scroll stays untouched) into
  `features/ui/pull-to-refresh.tsx`. Deliberately did NOT refactor
  `SmartFeed` to use it — it interleaves the same touch stream with
  horizontal tab-swipe detection, and touching an already-shipped, delicate
  combined gesture handler for a pure extraction carried more regression
  risk than the small duplication was worth. Wired the new shared component
  into **Explore** (a real cache-bypassing refetch, not just re-selecting
  the already-cached current tab) and **Notifications** (`revalidate` the
  grouped list). Reusable for any other page on request.
- **Rebuilt the Continue Watching player as a Stories-style sequential
  viewer.** `features/downloads/player-store.ts` went from holding a single
  `DownloadRecord` to a `PlayerQueue` (`items[]` + `index`), with
  `playerNext`/`playerPrev` (next auto-closes past the last item, matching
  how Stories end). `ContinueWatching`'s recent-downloads row now opens the
  whole row as a queue seeded at the tapped video (`openPlayerQueue`), not
  just that one video in isolation — `openPlayer` (single-item, no queue
  context) stays for the plain Downloads-dashboard list, unchanged.
- **`DownloadPlayer` rebuilt to match**: a segmented top status bar (one
  segment per queued video, the current one filling with real
  `currentTime`/`duration` progress — exactly Stories' own progress-bar
  convention), tap-left-third/tap-right for prev/next, press-and-hold to
  pause (same tolerance/timing constants as `FeedVideo`/`reel-viewer.tsx`
  for a consistent gesture feel across every media surface), and
  `onEnded={playerNext}` for the requested "auto-advance after watching."
  **Removed the persistent bottom action bar entirely** — Publish/Share and
  Save to device moved into the existing ••• sheet alongside
  Favorite/Choose-quality/Copy-link/Open-original/Remove, so there's now
  exactly one place for every action, matching the brief's "put all the
  buttons in the dotted menu above." The title (previously shown in the
  removed bottom bar) moved to a top overlay with a "2/4" position label.
- Single-item opens (`openPlayer`, no queue) fall back to the exact original
  layout — no status bar, no position label, close/more buttons at their
  original position — so nothing regresses for the plain Downloads list.
- Verified with a standalone mock (status bar + close/more/title layout at
  real mobile width) + `tsc`/lint; no live-device gesture testing was
  possible in this environment (auth-gated).

## 2026‑07‑09 highlights (batch 25 — unified zoom button + reel-album smooth transition, owner-reported)

Owner reported directly: "let the zoom button on post cards in feed open the video in reel and open images in full screen size" + "I still can't scroll on top of a multiple posts in feed and in reels, I can only scroll sideways and I want side ways scroll to be smooth motion."

- **Real bug: the video "zoom" button opened a completely different, lesser
  fullscreen mode than tapping the video did.** `FeedVideo` (`features/media/
  feed-video.tsx`) had TWO separate fullscreen mechanisms: tapping the clip
  itself already opened the real Reels viewer (`onExpand`), but the small
  Maximize2 button in the corner triggered its own local `enterFs` — a
  same-element "promote this box to `position:fixed`" in-place enlarge with
  its own bespoke chrome (`FullscreenVideoLayer`), never showing comments,
  the reel deck, or anything the real viewer has. Fixed by pointing the
  button at the same `onExpand` handler tapping the video already uses — one
  consistent "zoom" behavior everywhere. **`MediaCarousel`
  (`features/media/media-carousel.tsx`, the feed's multi-image/video album)
  had the exact same duplicated pattern** — its own Maximize2 button did its
  own local `enterFs`/`exitFs` in-place enlarge instead of calling
  `onExpandItem`, even though tapping a slide directly already correctly
  opened the real reel/image viewer. Fixed the same way, targeting whichever
  slide is currently showing (`index` state, already tracked for the page
  counter/dots).
- **Cleaned up, not just patched around**: once both buttons pointed at the
  real viewers, the entire local fullscreen-promotion mechanism in both
  files became **fully unreachable** (verified via grep — each `enterFs` had
  exactly one caller, the button just changed) — removed the dead
  `fs`/`enterFs`/`exitFs` state, refs, effects, and conditional
  className/pointer-handler branches from both components, rather than
  leaving zombie state that a future reader would have to re-verify is
  inert. `features/media/fullscreen-video.tsx` (`FullscreenVideoLayer`) and
  `lib/dom/neutralize-transforms.ts` became fully orphaned as a result
  (confirmed zero other importers) — deleted both outright.
- **Investigated "can't scroll over a multi-post" for both surfaces, found
  different root causes.** For the **feed** carousel: re-verified the
  existing `touch-action:pan-x` + non-passive wheel-redirect fix (shipped
  earlier — see the carousel-scroll-freeze history in [[smart-home-feed]])
  is still structurally sound — no conflicting `touch-action`/
  `overscroll-behavior`, and `SmartFeed`'s own pull-to-refresh/tab-swipe
  touch handlers never call `preventDefault` and already exclude
  `[data-hscroll]` elements. **Could not find a further concrete bug here
  through static analysis** — said so honestly rather than making blind
  speculative changes to an area with two prior documented regressions.
  For **reels**: found the album-swipe mechanism (`ReelCard` in
  `features/feed/reel-viewer.tsx`) was NEVER given the feed carousel's fix
  at all — it's pure pointer-drag math (`dx`/`dy` on `onPointerMove`), not a
  scrollable element, so there's no `wheel` trap, but also no explicit
  `touch-action` on the album's media wrapper (relying on inheriting the
  deck's `pan-y` implicitly). Added it explicitly for a defensible, zero-
  risk-to-add guarantee that vertical always reaches the deck regardless of
  browser touch-action edge cases.
- **Shipped the smooth-motion request for reel albums**: switching between
  an album's videos was a hard instant cut (`goSlide` just flips an index,
  swapping the source with no transition) — confirmed via `git log` this
  fix was never ported from the feed carousel (which gets real momentum for
  free via native CSS scroll-snap). A true sliding-carousel transition
  wasn't safe to add here: the reel's `<video>` element is deliberately kept
  mounted and stable across slides (`useAdaptiveSource` attaches HLS/MP4
  imperatively; remounting it via a `key`-based approach risks breaking
  adaptive playback). Instead added a brief crossfade (`slideFade` state,
  `transition-opacity`) that fades out on `goSlide` and back in once the new
  slide's video actually has data (`onCanPlay`, with an `onError` fallback
  so it can never get stuck invisible) — smooths the transition without
  touching the video element's lifecycle.
- All changes verified against `tsc --noEmit` + lint; no live-device touch
  testing was possible in this environment (auth-gated), noted honestly.

## 2026‑07‑09 highlights (batch 24 — feed card polish, Feature 17 Part 6 slice 1)

- **Owner dropped "Feature 17 Part 6 — Premium Feed Card System, Post Layout,
  Content Presentation & Media Experience,"** the sixth brief of the day.
  `feed-post-card.tsx` turned out to already be a mature implementation —
  smart reason chips ("From someone you follow" etc., [[smart-home-feed]]),
  a custom Wow reaction + long-press picker, repost badges/discovery,
  inline polls, true-aspect-ratio media, code-split action sheets. Most of
  the brief's asks (Business/Creator/Community post types, Live posts,
  Marketplace/embedded content, Memory Connection™, an AI comment summary)
  need backends that don't exist yet — same "don't build blind" call as
  every other Part today. Auditing the real component against the brief's
  "Post Footer" and "Post Typography" sections surfaced two concrete,
  zero-backend-cost gaps: data the app already fetches but never displayed.
- **View count and video duration were fetched on every post and shown
  nowhere** — `FeedItem.viewsCount` and `.durationSec` come straight off the
  `posts` table on every feed load, but the card only ever rendered a views
  badge in the generic-fallback media branch (unknown/text posts), never on
  the actual video or image branches almost every post uses. Added a
  views+duration badge to the video branch (top-left — the corners
  `FeedVideo`'s own mute/expand controls use are bottom-right and top-right)
  and a views badge to the image branch (bottom-right, unclaimed there).
  Confirmed no overlap with `FeedVideo`'s existing controls via a
  standalone mock + Playwright screenshot before shipping, same method as
  every prior slice today.
- **Bare URLs typed into a caption rendered as inert plain text** —
  `components/social/rich-text.tsx` already linkified `#hashtags` and
  `@mentions` but had no case for a plain `https://...` URL, despite the
  brief explicitly listing "inline links" under Post Typography. Extended
  the same tokenizer to match `https?://` URLs, open them externally
  (`target="_blank" rel="noopener noreferrer"`), and strip trailing sentence
  punctuation (`.`, `)`, etc.) so a link at the end of a sentence doesn't
  swallow the period — verified with a standalone Node script against five
  representative caption strings (mid-sentence URL, URL immediately
  followed by a hashtag/mention, a parenthesized URL, plain text with no
  tokens) before trusting it, not just reading the regex.
- **Deliberately did not touch**: full rich-text formatting (bold/italic/
  quotes/lists) — rendering markdown syntax nobody can currently type into
  the composer would be a half-feature; needs composer/authoring support
  first, not just a renderer change. Also left the action-bar icon set on
  lucide-react rather than migrating it to the [[frenz-motion-icon-system|
  Frenz icon system]] this time — lucide is already clean/professional
  there, not literally "cartoon," so it didn't clear the bar of a concrete,
  provable defect the way the view-count/duration gap and the missing
  URL-linkification did.
- **Left open** (all need new backend/content models): Comments Preview
  (needs a "most meaningful reply" ranking + no pinned-comment system
  exists yet), Relationship Context™ ("your friend Sarah liked this" —
  needs a friends-aware batched query, real but scoped as its own future
  slice), Business/Creator/Community post badges and layouts, Live posts,
  embedded content (music/maps/products/events), Memory Connection™.

## 2026‑07‑09 highlights (batch 23 — owner-reported bug batch: topbar brand mark reverted, Continue Watching instant-reopen, stuck profile-menu overlay)

Owner reported three issues directly (not a Feature 17 spec drop): the mobile topbar's Frenz wordmark, Continue Watching not opening instantly, and Home not responding after visiting Settings.

- **Reverted the mobile topbar brand mark** (`features/app-shell/app-topbar.tsx`) — the Frenz logo + text added there in [[frenz-motion-icon-system|Part 2]] of the design-system work. Owner wants it gone; restored the plain spacer.
- **Real bug found and fixed: the app's primary download path never cached the media it downloaded**, so reopening anything from Continue Watching/History always re-fetched the entire file from the network and showed a loading spinner — every single time, not just the first. Root cause: there are TWO separate download code paths in the app. `features/downloads/manager.ts` (the in-app "Downloads" dashboard) fetches the file itself and properly calls `saveMedia()` to cache the blob in IndexedDB. But `features/downloader/use-downloader.ts` — the **main, primary downloader** (paste-a-link-and-download, the app's core feature) — uses `downloadToDisk()`, a raw `<a>` anchor click handed to the browser's native download manager (deliberately, to work around a real prior iOS Safari bug where `fetch()`+Blob saves silently fail). That native path never gives the app a Blob, so it never had anything to cache. **Fixed** by adding `warmMediaCache()` (`features/downloads/local-media.ts`) — an independent, best-effort background `fetch()` that runs alongside (never blocking or replacing) the native download, populating the same IndexedDB cache `DownloadPlayer` already checks first. Skips itself entirely on Data Saver / 2G/3G connections, since it's a genuine second full download of the file, not free — an honest trade-off given [[egress-cloudflare-storage]]'s prior real egress-cap incident. Any failure here is silent since the real, user-visible download already succeeded independently via the anchor.
- **Real bug found and fixed: Home in the bottom nav stopped responding after visiting Settings from the profile menu.** Root cause: `features/profile/profile-menu.tsx`'s mobile drawer renders its backdrop + slide-in panel inside `AnimatePresence`, gated only by that library's exit-animation timing — tapping "Settings" (a `<Link onClick={() => setOpen(false)}>`) fires a route change and the close animation at the same instant, and the still-mounted, still tap-capturing backdrop can outlive the page it was opened from if the route transition interrupts or delays the exit-complete callback. The very next tap (often "Home") lands on the invisible leftover backdrop instead of the nav underneath, and its own `onClick` is just `setOpen(false)` again — a no-op that looks like "nothing happened." **Fixed** by wrapping the backdrop+drawer pair in a plain `<div>` whose `pointer-events` are gated directly on the synchronous `open` boolean, not on AnimatePresence's animation state — so a stray tap always passes through the instant the menu closes, regardless of how (or whether) the exit visually finishes.

## 2026‑07‑09 highlights (batch 22 — Stories strip redesign, Feature 17 Part 5 slice 1)

- **Owner dropped "Feature 17 Part 5 — Stories Strip, Quick Discovery, Social
  Presence & Premium First Content Row,"** the fifth brief of the day. It asks
  for a lot of speculative surface area (Communities/Business/Live/AI Stories,
  Story Constellations™, Relationship Rings™, Memory Shortcut™) that has no
  backend to build on yet — same "don't build the whole brief blind" approach
  as Parts 1-4. Reading the actual `stories-row.tsx` + `friends-stories.tsx`
  implementation surfaced two **real, previously-unnoticed bugs** that map
  directly onto the brief's own "REMOVE CURRENT DESIGN" list, which became
  the slice.
- **Real bug: your own active story showed up twice.** `getActiveStories`
  surfaces the viewer's own story group first in the list when they have one
  active — but both `StoriesRow` (Home) and `FriendsStories` (`/friends`)
  ALSO rendered a separate hardcoded "Your Story" card unconditionally, then
  looped over the *entire* group list including that same self-entry. Anyone
  with an active story saw their own avatar twice in the row. Fixed by
  filtering the viewer's own group out of the loop in both components
  (matched by `handle`, threaded down from the server as a new `viewerHandle`
  prop — cheap since the server already has it, avoids an async client fetch
  flash).
- **Real bug, worse than cosmetic: there was no way to view your own active
  story from the row.** The hardcoded "Your Story" card always opened the
  *composer* on tap, even when the viewer had a live story to review — and
  once the duplicate-self bug above is fixed, there'd be no second entry to
  fall back on either. Fixed: "Your Story" now opens the shared `StoryViewer`
  (seeded at your own group's real index in the full array) when you have an
  active story, and only falls back to the composer when you don't. The ring
  around it also now only appears when there's something to watch — it
  previously showed the same gradient ring unconditionally, which is
  misleading (implies live content that may not exist).
- **Shipped Story rings: Unseen vs. Seen** (the brief's own "Story Rings"
  section, and the single most-expected Stories behavior that was completely
  missing — every ring looked identical regardless of viewing history). No
  `story_views` table exists yet, so implemented via a device-local
  `localStorage` mark (`lib/social/story-seen.ts`), the same honest trade-off
  already made for the feed's "while you were away" catch-up
  ([[smart-home-feed]]) — real viewing history, just not cross-device synced
  yet. Hydration-safe: renders "everything unseen" identically on server and
  client's first paint, then refines from `localStorage` in an effect right
  after mount, avoiding a hydration-mismatch warning.
- **Fixed the same off-brand gradient found in Part 3's Create button**: both
  Stories components used a one-off three-stop `fuchsia→violet→blue` ring
  gradient that matches no documented token. Unseen rings now use `.bg-brand`
  (the canonical two-stop Electric Blue→Royal Purple gradient); seen rings
  get a quiet neutral hairline instead of a muted rainbow, per the brief's
  "avoid excessive colors."
- Wired Frenz Motion's `PressIcon` onto every story avatar button in both
  components (previously had zero press feedback at all — not a redesign, a
  gap, since literally nothing else in the row responded to touch).
- **Verified visually**: a standalone HTML mock of the row (unseen/seen/no-
  story states side by side) screenshotted via local Playwright, same
  approach as every prior Feature 17 slice.
- **Left open** (all require backend/product work this brief's brevity can't
  paper over): Story Constellations™, Relationship Rings™ (Best
  Friends/Family/Creator/Business ring styles — no relationship-type data
  model), Memory Shortcut™ (no Life Memories system yet), Community/Creator/
  Business Stories (no content-type distinction in the `stories` table),
  presence indicators (online/live/recording — no presence system), long-press
  preview + quick actions (mute/pin/favorite/hide), Living Stories Strip™
  realtime background refresh, Adaptive Story Density™.

## 2026‑07‑09 highlights (batch 21 — Home page architecture, Feature 17 Part 4 slice 1)

- **Owner dropped "Feature 17 Part 4 — Home Page Layout, Content Architecture,
  Information Hierarchy & Scroll Experience,"** the fourth brief of the day.
  Before writing anything, audited how much of it already existed — a lot of
  it turned out to overlap with the earlier "Smart Home Feed" work (Feature 5,
  built 2026-07-05/06): zero-empty-feed fallback, "while you were away"
  catch-up, and spark-card discovery cards were already shipped and live.
  That narrowed this slice to three things that were genuinely missing or
  broken, found by reading the actual feed/pagination code rather than
  guessing from the spec text.
- **Real bug found and fixed: content-type balancing was completely inert.**
  `lib/social/smart-feed.ts`'s `balanceByKind()` (caps same-media-type runs
  at 2 — exactly the brief's "avoid long sequences of identical content")
  was fully implemented and exported, but `features/feed/smart-feed.tsx`
  called `buildSmartStream(items, { balance: false })` — balancing
  permanently OFF on Home. The code comment next to that call explained the
  *intended* design ("skipped when the caller already balanced each page on
  arrival, to prevent the loaded feed from visibly reshuffling as new pages
  append") — but grepping for `balanceByKind` showed it was never actually
  called anywhere except inside that disabled branch. The described
  mechanism had never been built. **Fixed** by balancing each page at the
  point it's fetched (`fetchPage` in `smart-feed.tsx`), not the whole
  accumulated list: on a full replace, `balanceByKind(data.items)`; on
  pagination, the new page is balanced seeded with the *last two
  already-rendered items* as context (`entry.items.slice(-2)`) so the
  run-cap carries across the page boundary, then those two context items are
  sliced back off before appending — verified with a standalone Node script
  (not just read the code) that this never reorders already-seen posts and
  correctly caps a run at the page seam, while a naive per-page-only
  balance (no context) let a run of 4 through. Also balanced the
  server-rendered first page at the `useState`/cache-seed level, since it
  never passed through `fetchPage` at all.
- **Wired "Continue Watching" into Home** (`app/(app)/home/page.tsx`) — the
  component already existed (`features/app-shell/dashboard/continue-watching.tsx`,
  real data via `useDownloadManager`/`useHistory`, returns `null` when empty)
  but was dead code, imported nowhere. This is a section the Part 4 brief
  names explicitly. Placed between the Trending Reels rail and the main
  feed — the brief's example order is Trending Now → Continue Watching →
  Recommended Creators, and Recommended Creators already lives in the right
  rail (`HomeRail`), so this keeps the same relative order the brief asked
  for. **Audited the other five orphaned `dashboard/` components too**
  (`featured-hero`, `join-communities`, `explore-categories`, `latest-news`,
  `home-download-bar`) and deliberately did **not** wire them in — three are
  fully hardcoded mock content (a communities backend "isn't modelled yet"
  per that file's own comment), which would mean shipping fake data as if it
  were real, directly contradicting the brief's own "dynamic sections,
  nothing should feel random" principle.
- **Fixed a real double-margin bug**: Home stacked three separate top-spacing
  rules between the Reels rail and the feed — the outer `space-y-6` (24px),
  an extra `pt-2` wrapper div (8px), and `SmartFeed`'s own internal `mt-4`
  (16px) — 48px of accumulated gap where every other section boundary only
  gets 24px. Removed the redundant wrapper div and `SmartFeed`'s internal
  margin, letting the single `space-y-6` own all inter-section spacing
  consistently (the brief's "unbalanced spacing" complaint, and a real,
  visible inconsistency, not a hypothetical one).
- **Left open** (matches the "don't build the whole brief blind" approach
  from Parts 1-3): Suggested Communities / Friend Activity modules (need a
  communities backend that doesn't exist yet), a Module Engine™-style
  enable/reorder/personalization system, cross-navigation scroll + video
  playback continuity (Feed Continuity™ — SmartFeed only restores scroll
  position per-tab within itself right now, not across leaving/returning to
  `/home`), Adaptive Home™ time-of-day content shifts, AI Home Assistant
  recommendations, offline home / home widgets (weather, birthdays, etc.).

## 2026‑07‑09 highlights (batch 20 — bottom nav redesign, Feature 17 Part 3 slice 1)

- **Owner dropped "Feature 17 Part 3 — Premium Bottom Navigation, Global Tab
  Bar, Create Button & Navigation Experience"**, the third brief of the day
  in this series. Two structural asks turned out to already be satisfied by
  earlier work, so the slice narrowed fast: the spec's required tab set
  (**Home, Friends, Create, Inbox, Profile — "no Downloads"**) already
  matches `features/app-shell/mobile-nav.tsx` exactly, and the "proprietary
  icon family, no stock icons" requirement for those four tabs was already
  shipped in the Part 1 Motion/Icon slice (`components/icons/frenz-icons.tsx`).
  No code changes needed for either — verified, not assumed.
- **Redesigned the Create button** (`features/app-shell/mobile-nav.tsx`) per
  the brief's explicit "❌ Oversized Create button" removal item: shrunk
  56px → 48px, elevation lift `-mt-6` (−24px) → `-mt-3.5` (−14px), and — a
  real inconsistency this caught, not just a taste call — the gradient was a
  three-stop `blue→violet→fuchsia` that doesn't match any documented brand
  token ([[design-tokens]] only defines the two-stop Electric
  Blue→Royal Purple gradient, exposed as the `.bg-brand` utility). Switched
  to `.bg-brand` so the Create button now uses the same gradient as
  everything else in the app instead of its own one-off variant. Softened
  the halo/shadow to match the smaller scale. Replaced the ad-hoc
  `active:scale-90` with [[frenz-motion-icon-system|Frenz Motion]]'s
  `PressIcon` spring, same as every other nav icon now.
- **Added a static active-state glow** (a single `drop-shadow` filter, brand
  purple) to the active tab's icon in both the mobile bottom nav and the
  desktop sidebar, addressing "❌ Weak active states." Deliberately static,
  not an idle-breathing pulse — the brief's own "Living Navigation" section
  says "nothing exaggerated," and a looping animation on a permanently-visible
  nav element has a real battery/perf cost for zero functional benefit.
- **Verified other "REMOVE CURRENT DESIGN" line items were already non-issues**
  rather than inventing fixes for them: nav bar spacing already uses
  `justify-around` (even by construction), tab icons already have no heavy
  circular background (only the Profile avatar bubble and Create button are
  circular, which is the correct/expected treatment for those, not a defect).
- **Verified visually** the same way as the two prior Part 1/2 slices — a
  standalone HTML mock at real mobile width + Playwright screenshot — since
  auth still blocks driving the live nav headlessly.
- **Left open** (all substantial standalone features, not visual polish):
  the Create Hub bottom sheet (photo/video/story/reel/live/AI/draft/template
  picker), Priority Inbox re-ranking, Navigation Intelligence long-press
  per-tab shortcuts, header/nav personalization settings, and true morph
  transitions between active/inactive icon states.

## 2026‑07‑09 highlights (batch 19 — Home topbar redesign, Feature 17 Part 2 slice 1)

- **Owner dropped "Feature 17 Part 2 — Premium Top Navigation, Global Header &
  First Impression Experience."** Like Part 1, it's a huge brief (Smart
  Header™, Living App Bar™, Quick Switch™ swipe-between-feeds, an optional
  AI shortcut, voice/image/QR search, seasonal Adaptive Branding™,
  notification-priority ranking, per-screen contextual headers,
  personalization settings). Rather than build all of it blind, shipped the
  slice that was **unambiguous and immediately actionable**: the brief's own
  "REMOVE CURRENT DESIGN" list explicitly said to delete the Download button
  and the daily greeting — those aren't open design questions, they're
  instructions. Everything exploratory (Quick Switch, AI button, voice
  search, etc.) stays open for a future slice.
- **Removed the "Download" pill from the Home topbar**
  (`features/app-shell/app-topbar.tsx`) — downloads already have a dedicated
  tab on the owner's own profile (`features/profile/downloads-tab.tsx`, via
  `ProfileTabs`) and a persistent sidebar entry on desktop
  (`features/app-shell/app-sidebar.tsx`), so nothing was actually lost, just
  the loud gradient CTA that cluttered Home.
- **Removed the "Good morning, {name}" greeting** — deleted
  `features/app-shell/dashboard/home-greeting.tsx` entirely (verified unused
  elsewhere first) and the now-dead `firstName` computation in
  `app/(app)/home/page.tsx`. Updated the "hero-instant, sections-skeleton"
  MANDATORY pattern doc in `docs/FRENZ_CORE.md` — Home no longer has an
  above-the-fold hero at all now (the identity/redirect check is still the
  only synchronous gate), which is fine; the pattern still applies to any
  page that *does* have a real hero.
- **Added the Frenz wordmark to the topbar, mobile-only** — the desktop
  sidebar already carries the brand mark, but on mobile (sidebar hidden)
  the app previously showed zero brand presence once the launch splash
  passed. Fills the space freed up by removing the Download button + the
  dead mobile spacer, centered between the two icon clusters.
- **Wired Frenz Motion press-spring feedback** (`components/motion/press-icon.tsx`,
  from [[frenz-motion-icon-system|the Part 1 slice]]) onto the topbar's mobile
  search icon and the Create button.
- **Real bug caught before shipping**: `PressIcon` had a hardcoded inline
  `style={{ display: "inline-flex" }}` (added in the Part 1 slice). Inline
  styles always beat classes in CSS specificity, so wrapping any
  responsively-hidden element (`hidden sm:inline-flex`, `sm:hidden`) in
  `PressIcon` would have silently forced it visible/invisible at every
  breakpoint regardless of the Tailwind class — exactly the case introduced
  here (Create button, mobile search icon). Fixed by dropping the inline
  style entirely and letting `className` fully own `display`, same as every
  other element in this codebase. Caught during self-review, not by a test.
- **Verification**: auth blocks driving the real `/home` page headlessly (no
  test-account email inbox access), so — same approach as the icon-gallery
  check in Part 1 — built a standalone HTML mock reproducing the topbar's
  exact flex structure at 390px and screenshotted it with local Playwright to
  confirm the brand mark centers cleanly in the freed-up space instead of
  guessing from source alone.

## 2026‑07‑09 highlights (batch 18 — Frenz Motion engine + Signature Icon System, slice 1)

- **Owner dropped "Feature 17 — Premium Home, Feed & Navigation Platform, Part
  1"**, a full enterprise design-system brief (icon philosophy, color system,
  typography, spacing, glass/material system, every component category,
  accessibility, performance — the works). Given the scope, agreed with the
  owner to treat it as the green light for the next two items already queued
  on the approved design roadmap (tokens ✓ → **motion system** → glass/depth →
  perf → dark/light) rather than attempting the entire brief at once.
- **Frenz Motion** (`lib/motion/springs.ts`): one shared spring-physics
  vocabulary (`press`/`bounce`/`elastic` presets) so every interactive control
  moves the same way instead of ad-hoc CSS transitions per component.
  `components/motion/press-icon.tsx` wraps a glyph with spring compression on
  tap and a small overshoot bounce when it becomes active, gated on
  `useReducedMotion()`.
- **Signature Icon System** (`components/icons/frenz-icons.tsx`): the first
  proprietary Frenz glyphs (Home, Friends, Inbox, Person — outline + solid
  pairs) replacing `react-icons/io5` on the two nav destinations that appear
  in *both* the mobile bottom nav and the desktop sidebar (kept them
  consistent across surfaces rather than upgrading one and not the other).
  Built entirely from native `<rect rx>` / `<circle>` primitives plus
  straight-line paths — deliberately not freehand bezier art, since icon
  geometry is exactly the kind of asset that needs visual QA and this
  environment can't preview a render before shipping it. Verified by
  screenshotting a standalone SVG gallery (outline/solid × light/dark × actual
  26px nav scale) rather than trusting hand-derived path coordinates blind.
  Explore/Trending/Reels/News/Communities/Notifications/Downloads/Saved stay
  on `react-icons/io5` for now — next slice.

## 2026‑07‑09 highlights (batch 17 — independent security crosscheck + site-wide hardening)

- **Ran a dedicated, independent security review** of the active-sessions diff
  (batch 16, below) using a fresh sub-agent with no memory of writing the
  code — specifically to verify the earlier self-caught fix (the
  `revoke_user_session` ownership-check ordering bug) was actually correct
  and complete, and to look for anything else missed. Also traced the CORS
  config (`lib/api/cors.ts`, unchanged) against the new session-revoke
  endpoints for CSRF risk: `Access-Control-Allow-Origin: "*"` with no
  `Access-Control-Allow-Credentials` means browsers refuse to send cookies
  on a cross-origin credentialed request to any `/api/v1/app/*` route —
  this pre-existing setup already blocks a cross-site page from riding a
  signed-in user's cookie to revoke/list their sessions. **Result: no
  high-confidence findings** — the fix held up, nothing new surfaced.
- **Shipped Content-Security-Policy in report-only mode**
  (`next.config.ts` `buildCsp()`) — the item docs/SECURITY.md had tracked
  as "needs a full origin inventory" since 2026-07-06. Inventoried real
  external origins by grepping the codebase rather than guessing: Paystack
  checkout is a server-side hosted-page redirect (no script/iframe, so no
  CSP entry needed); no Google/analytics/Sentry/AdSense scripts are
  actually wired in despite unused boilerplate env vars in `.env.example`;
  Cloudflare Stream uses `iframe.cloudflarestream.com` (player) +
  `customer-<code>.cloudflarestream.com` (HLS/thumbnails); Supabase needs
  both its REST host and a `wss://` entry for Realtime. **Real finding
  along the way**: `features/monetization/inject.ts` recreates and
  executes `<script>` elements from admin-configured Adsterra/PropellerAds
  ad markup — third-party script origins that are NOT knowable at build
  time. This confirms report-only (never blocks) is the correct first
  step, not a guess — enforcing now could have silently broken ad revenue.
  `img-src`/`media-src`/`connect-src` stay intentionally broad (`https:`)
  for the same reason `images.remotePatterns` already allows any https
  host (arbitrary yt-dlp thumbnail CDNs); `object-src none`, `base-uri
  self`, `frame-ancestors self`, `frame-src` (scoped to Stream only), and
  `form-action self` are already tight since they cost nothing. Violations
  collect at new `POST /api/csp-report` (logs only, no DB write, capped
  body size, no auth — matches how browsers actually send these). Also
  added `Cross-Origin-Opener-Policy: same-origin-allow-popups` (blocks
  reverse-tabnabbing; doesn't affect Google sign-in since Supabase does a
  full-page redirect, not a popup). **Owner action**: watch
  `/api/csp-report` output in Vercel logs for a few days of real traffic
  (with ads on) before ever moving this to enforcing.

## 2026‑07‑09 highlights (batch 16 — active sessions / remote device sign-out)

- **Owner dropped a large "Premium Auth, Caching & Performance" spec** covering
  Redis-backed sessions, IndexedDB caching, offline queue, predictive
  prefetch, and more. A survey found most of it already existed (Supabase
  manages Secure/HttpOnly/SameSite cookies with rotation already; Upstash
  Redis + rate limiting were already wired via `lib/cache.ts`/`lib/rate-limit.ts`;
  the service worker, `staleTimes` router cache, and the `features/data`
  SWR-style cache were already in place). Decision with the owner: **extend**
  Supabase's session handling rather than replace it with a custom Redis
  session store — replacing already-working, security-critical auth wasn't
  worth the risk, and it contradicts the documented Frenz Core direction
  (Passkeys/MFA/device-auth are planned *on top of* Supabase auth).
- **Shipped first slice: active-sessions / multi-device remote sign-out**
  (the one genuinely missing piece). Rather than build a second, parallel
  session tracker, migration `0034_session_management.sql` exposes
  Supabase's own `auth.sessions` table via three `SECURITY DEFINER` SQL
  functions (`list_user_sessions`, `revoke_user_session`,
  `revoke_other_user_sessions`) — locked to `service_role` only, search_path
  hardened, every table reference fully qualified. `GET /api/v1/app/sessions`
  lists a user's real devices (Redis-cached 20s via `getCached`); `DELETE
  /api/v1/app/sessions/:id` revokes one device; `DELETE
  /api/v1/app/sessions` revokes every device but the caller's. "This
  device" is identified by decoding the `session_id` claim already present
  in the caller's own (already-verified) Supabase access token — no new
  tracking cookie needed. Revoking deletes the `auth.sessions` row (+ its
  refresh tokens): the target device can't refresh again, though its
  current short-lived access token stays valid until natural expiry — same
  behavior as Supabase's own dashboard revoke, and the existing
  `middleware.ts`/`onAuthStateChange` machinery already handles the
  graceful redirect-to-login once that happens, so nothing new was needed
  there. UI: `features/account/active-sessions.tsx` on the Account page —
  device list with a friendly label parsed from the User-Agent (no
  dependency added), "This device" badge, per-device sign-out, and a bulk
  "sign out other devices" action.
- **Needs migration `0034` applied** (same pattern as 0030/0031/0032) before
  the sessions panel works in prod — until then it fails closed (Postgres
  "function not found" → the route returns a 500, not a crash).
- **Crosscheck pass caught a real bug before ship**: `revoke_user_session`'s
  first draft deleted `auth.refresh_tokens` by session id BEFORE the
  ownership check, so an authenticated caller with an arbitrary session
  UUID could invalidate a stranger's refresh token even though the
  `auth.sessions` row itself stayed protected. Fixed by deleting the
  ownership-scoped `auth.sessions` row first and only then its refresh
  tokens. Also fixed: the UI showed the same "no sessions" copy for a
  failed fetch as for a genuinely empty list (misleading), and revoking
  your own current session left the browser's local cookie stale instead
  of signing out immediately.

## 2026‑07‑09 highlights (batch 15 — F logo hairline edge + premium OTP email)

- **F logo still had a thin dark edge.** The transparency fix (batch 13) used a
  flood-fill color-distance threshold of 65, which was enough to clear the
  four corners but left a ~1-3px dark hairline rim right along the
  rounded-square boundary — visible as "little black edges" on the landing
  page, especially at larger render sizes (easy to miss in a quick preview;
  obvious once flattened onto a solid contrasting color to strip out
  transparency-rendering ambiguity in image previews). Bumped the threshold
  to 120 for every icon derivative and re-verified all 4 corners clean with
  no leakage into the tile at that value.
- **OTP sign-in email redesigned — more premium + spam-avoidance.**
  `lib/email/resend.ts`: the code now renders as individual digit chips
  (matches the in-app OTP input's look, and is length-proof — one cell per
  character, not hardcoded — so it's correct whatever length Supabase is
  configured to issue), added the real transparent brand icon next to the
  wordmark. For deliverability: added a hidden preheader (padded with
  zero-width spaces so mail clients don't also append the first visible body
  line to the inbox preview) instead of an arbitrary auto-picked snippet, and
  the send now sets `reply_to` to the support address instead of leaving a
  dead-end noreply sender — both read as more trustworthy to spam filters
  than a bare transactional blast with no reply path.

## 2026‑07‑09 highlights (batch 14 — the carousel scroll fix didn't fully land + dark mode recurred)

- **Multi-media carousel scroll: the earlier CSS-only fix (batch 12) wasn't the
  real root cause.** `overscroll-behavior` only controls scroll-chaining
  *after* a scroll boundary is hit — it never explained why hovering a
  multi-image/video post and scrolling froze the page, because mouse
  wheels/trackpads fire `wheel` events, and a horizontally-scrollable element
  claims a vertical wheel gesture for itself as a native, long-standing
  browser behavior, regardless of CSS. Real fix: a genuine (non-passive)
  `wheel` listener on the carousel that redirects vertical-dominant scrolling
  to the page, while a horizontal trackpad swipe still scrolls the carousel
  natively. Gotcha: React's synthetic `onWheel` prop is passive by default, so
  calling `preventDefault()` inside it silently no-ops — this has to be a real
  `addEventListener("wheel", fn, { passive: false })`.
- **Dark mode showing on every reentry, despite Light being selected —
  recurred.** A previous fix (2026-07-08) addressed our own in-page boot
  overlay reading the wrong theme signal. That fix was necessary but not
  sufficient: `app/manifest.ts` had `background_color`/`theme_color`
  hardcoded to the dark theme's color. For an installed/home-screen app, the
  OS paints its own native splash screen and status-bar tint directly from
  those **static** manifest values — before any of our page's HTML/JS runs at
  all, and a manifest can't make them conditional the way our `viewport.
  themeColor` meta tag can. Every relaunch flashed dark OS chrome regardless
  of the user's actual choice. Fixed by setting both to white, matching the
  boot overlay's own neutral default. Lesson for next time a "wrong theme on
  launch" report comes in: check both layers (in-page boot script AND the
  manifest's static colors) — they're independent, and fixing only one still
  leaves the other showing.
- **F logo "doesn't load" false alarm.** After the transparency fix (below),
  the owner reported the site not loading / loading slowly. Checked the live
  Vercel deployment directly (`vercel ls`: Ready, 2 min build) and curl'd the
  production routes (all 200, no server errors) — found no evidence of an
  actual break. Re-compressed the new icon PNGs at max lossless effort
  regardless, as a low-risk precaution.

## 2026‑07‑09 highlights (batch 13 — F logo transparency)

- **The F logo's dark backdrop is gone, everywhere.** Every brand-mark asset
  (favicon, in-app `FrenzLogo`, standard PWA icons, the OG/Twitter share-card
  icon, the icon+wordmark lockup) was cropped from delivered artwork that had
  an opaque dark-purple/near-black fill behind the rounded-square tile — so
  every placement of the logo showed a visible dark box around it. Stripped
  via flood-fill from the 4 canvas corners using each corner's own **fixed**
  seed color. Important gotcha hit and fixed along the way: an earlier
  attempt let the flood-fill reference drift to each newly-accepted
  neighbor's color instead of staying fixed — that leaks straight through the
  tile's own internal gradient and erases the *entire* icon, not just the
  corners (caught it visually before committing, reverted, redid it with a
  fixed reference). Two assets deliberately stay opaque rather than
  transparent: `app/apple-icon.png` (iOS can render alpha as forced black on
  the home screen) and `icon-maskable-512.png` (Android maskable icons need a
  full-bleed fill so launchers don't show a transparent hole) — both now fill
  with the brand's Royal Purple (`#6C4DFF`) instead of black.
  `components/og-icon-data.ts`'s hardcoded base64 (see the crash entry below
  — it's never read from disk at runtime) was regenerated from the new
  transparent icon.

## 2026‑07‑09 highlights (batch 12 — site-down incident + 2 real bugs + 1 feature)

- **Production was crashing on every page** — the home feed showed "Something
  went wrong" and other routes showed a raw Next.js client-side exception.
  Root cause: `components/og-image.tsx` did a **module-level `readFileSync`**
  of a `public/` asset to build the social-share icon's data URI. On Vercel,
  `public/` isn't reliably available to serverless function bundles, so the
  import threw — and because this module backs the root OG/Twitter-image
  metadata that every route resolves, it took the *entire app* down, not just
  share cards. A previous session had already diagnosed this and written the
  fix (`components/og-icon-data.ts`, a hardcoded base64 constant generated
  once from the source PNG) — but it was left **uncommitted and never wired
  into `og-image.tsx`**, so the broken version stayed live the whole time.
  Fixed and pushed (commit `4381b4b`). Lesson: a file existing locally is not
  the same as a fix being shipped — always check `git status`/`log` before
  trusting that prepared code is actually live.
- **Desktop mouse-wheel scroll froze over any multi-image/video post.** The
  feed's album carousel (`features/media/media-carousel.tsx`) had
  `overscroll-behavior-y: contain` stacked on top of `overflow-y: hidden`.
  Since the element can never scroll vertically at all, `contain` blocked the
  wheel event from chaining up to the page instead of passing through — so
  hovering a multi-media post and scrolling froze the whole page on large
  screens. (This property had been added in a prior "Instagram axis-lock
  hardening" pass with good intentions — `touch-action: pan-x` alone was
  already sufficient for the touch-side "swipe sideways only" contract; the
  extra property was redundant and, on desktop, actively harmful.) Removed
  (commit `3c140b1`).
- **Friends → Discover grid now opens a continuous full-screen deck.**
  Tapping a video/photo tile used to navigate away to view that one post
  alone. It now opens a TikTok-style vertical swipe deck
  (`features/friends/discovery-deck.tsx`), seeded on the tapped tile, that
  keeps scrolling through the rest of the grid's videos/photos — paginating
  via a new `GET /api/discovery` route as it nears the end
  (`lib/social/discovery.ts` gained `offset`/`nextOffset`). Scoped to
  video + image only (no text-only post type exists in the schema). The
  deck is browse-only (autoplay/mute-toggle + creator link + "View post"
  link to `/p/[id]`) — no comments panel, to keep scope proportional; full
  engagement still happens on the post page (commit `848d54a`).
- **Investigated, found already correct, no change made:** tapping a video in
  the main Feed or the Trending Reels rail already opens the shared
  `ReelsFeed`/`ReelDeck` overlay seeded on that clip and keeps scrolling
  (paginating from `/api/reels`). If this still looks broken after the crash
  fix deploys, it was likely the crash itself causing the symptom, not a
  separate bug in this path. Nav (sidebar/bottom bar) already renders
  synchronously with no blocking fetch before first paint, and video
  preloading (~200px ahead via `IntersectionObserver`) already exists in both
  the feed and reels.

## 2026‑07‑07 highlights (batch 11)

- **The real Frenz logo replaced the placeholder F, everywhere.** Every logo
  asset in the product — the browser-tab favicon, the iOS home-screen icon,
  the PWA install icons, the push-notification icon, the Open Graph/Twitter
  share card, and the in-app mark used in the sidebar, site header, and
  install/splash screens — had been a programmatic stand-in (a plain "F"
  letter on a flat gradient) since day one, never the finished design. The
  owner supplied the actual artwork (a glass, gradient F with an integrated
  play-triangle notch); it's now cropped to one master image and every one
  of those touchpoints is generated from it, so there's exactly one logo
  asset in the whole product going forward. The maskable PWA icon specifically
  got extra safe-zone padding so an OS circular icon mask can't clip it.

## 2026‑07‑07 highlights (batch 10)

- **Full cross-check of both the webapp and the public site**, this time
  focused on scroll performance and general rough edges. The verdict on the
  scroll-critical path (main feed, reels) was reassuring: it was already
  well engineered — throttled scroll handlers, correctly scoped
  memoization, no forced-reflow patterns. The real gaps were in secondary
  surfaces: the notification list and comment threads weren't memoized (so
  marking one notification read re-rendered every visible row), and the
  mobile bottom nav — the one overlay present over scrolling content for
  the entire session — was using the heaviest blur tier available. Both
  fixed. On the public site, the download-result card was shipping into
  every visitor's first page load even though it only appears after
  someone submits a link; it's now loaded on demand instead.
- **Swept the app for emoji used as UI decoration** (dashboard section
  icons, landing-page placeholder avatars, a handful of toast messages) and
  replaced them with real icons or initials, per the standing "no emoji in
  the product" rule — with one deliberate exception restored: the
  notification list's own wording (e.g. "accepted your friend request")
  keeps its emoji, per an earlier explicit decision. Left the reaction
  picker and story-sticker emoji alone on purpose — those are things a
  user picks and sends, not decoration, so changing them is a bigger call
  than a cross-check pass should make alone.
- **Feed virtualization (windowing very long scroll sessions) was looked at
  again and still deliberately deferred** — the feed already reclaims the
  expensive parts (video decoders, off-screen rendering cost) and a full
  windowing rewrite carries real regression risk against a feature that's
  already working well.

## 2026‑07‑07 highlights (batch 9)

- **Startup‑performance audit against a TikTok/Instagram/Facebook‑style
  loading spec.** Rather than re‑build what already works (reels' rolling
  preload, feed video's lazy‑load/pause‑offscreen, the router/service‑worker
  caching, background refresh) — all confirmed already correct — the audit
  went looking for real gaps and found three:
  - The **persistent app shell** (`app/(app)/layout.tsx`, `app/u/layout.tsx`)
    was doing a server round‑trip (auth check + profile fetch) before
    rendering the sidebar/topbar/mobile‑nav **at all**, on every navigation,
    for every signed‑in visitor — a direct violation of "the shell must never
    wait on a network request." The value it fetched (a user handle) turned
    out to be silently discarded by the very component it was passed to. Both
    shells are now synchronous — no fetch, instant paint.
  - The same profile fetch was separately summing "likes received" across up
    to 500 of a user's posts, **every time it wasn't cached**, for a number
    that no page currently displays (its one consumer was itself dead code
    from an earlier shell design). Removed the scan entirely.
  - The blurred backdrop behind feed photos was downloading the **same
    full‑resolution image twice** — once raw for the blur, once optimized for
    the sharp foreground. It now fetches a genuinely tiny, separate thumbnail
    for the blur instead, roughly halving the bytes per feed photo.
  - Feed virtualization (windowing the DOM for very long feeds) was
    considered and deliberately deferred — it's a real, larger undertaking
    given how much the feed already depends on (per‑tab scroll‑position
    cache, realtime "new posts" pill, resume‑from‑position), and wasn't
    worth the regression risk without being asked for by name.

## 2026‑07‑07 highlights (batch 8)

- **Double-tap-to-Wow, audited and fixed.** Feed photos and reels already had it
  working (verified directly rather than assumed). Feed videos never actually
  had it — a single tap opened fullscreen immediately with no window for a
  second tap to register. Fixed to match photos: a brief pause before opening
  fullscreen, and a tap within that window Wows the post with the same heart
  burst instead.
- **Add‑to‑Home‑Screen and notification copy rewritten** around the actual
  benefits — faster experience, quicker access, faster downloads, and
  notifications only if you want them (with a clear note that they can be
  turned off anytime in Notification settings). The notification prompt now
  also appears for signed‑out visitors, inviting them to sign in rather than
  silently doing nothing. Declining either prompt 5 times on a device now
  stops it for good on that device, until browser storage is cleared.
- **Feed hardened to feel like Instagram**: multi‑photo/video posts now have a
  belt‑and‑suspenders guarantee that they only ever slide sideways — never up
  or down — closing a subtle CSS gap where the browser could technically still
  consider vertical movement. The story rail was already built Instagram‑style
  and needed no changes.
- **Confirmed the "instant hero, skeleton everything else" loading style is in
  place** (the home page already renders its greeting immediately while stories/
  reels/feed stream in behind their own skeletons — the TikTok/SofaScore/
  Facebook feel) and made it the documented, mandatory template for every page
  built from here on.

## 2026‑07‑07 highlights (batch 7)

- **Albums now open on the EXACT slide you tap, and swipe through everything
  in fullscreen** — photos, videos, or a mix. This was a real bug: the feed's
  carousel always opened the same thing regardless of which slide you tapped.
  Fixed on both the feed and the standalone post page, for photo, mixed, and
  video albums alike.
- **Reel chrome (the ✕ and ••• buttons) now fades** with the rest of the
  controls — visible on tap, gone after ~3 seconds — instead of sitting
  permanently on screen, matching TikTok/Instagram.
- **Found and fixed the Send‑sheet cut‑off bug.** Root cause: the Share sheet
  was the only pop‑up sheet in the app that didn't detach itself to the top of
  the page — every other sheet in the app does this, so it was an oversight
  specific to the brand‑new Share feature. Once found, the fix was a one‑line
  pattern match to the other five sheets. Added a second, independent safety
  net to the video‑fullscreen buttons too, so this class of bug is far less
  likely to resurface anywhere else.

## 2026‑07‑07 highlights (batch 6)

- **Found and fixed a real full‑bleed regression in Reels.** The "seamless tab
  slide" added the batch before wrapped the reel deck in an animated
  container — and framer‑motion leaves an inline `transform` on that container
  even once the animation settles. Any transform on an ancestor makes
  `position: fixed` descendants anchor to THAT box instead of the true screen,
  which is exactly what pulled the reel player's top bar/scrubber away from the
  real edges (under the status bar). Fixed by making the wrapper itself
  `fixed inset-0` — the slide animation looks identical, but the deck reaches
  the true top again. The same bug class was found latent (not yet visibly
  broken) in the feed card's video‑fullscreen button and fixed there too.
- **Image viewer now goes full‑bleed** the same way video already does: a photo
  shaped close to the screen covers it edge‑to‑edge instead of always
  letterboxing.
- **iOS message push, re‑investigated:** confirmed there's no remaining
  app‑side bug (verified the whole subscribe → dispatch → service‑worker path),
  shaved a small real delay (parallelized two independent queries in the
  message‑push handler), and documented why the rest of the gap between iOS and
  Android is Apple's own Web Push relay behavior — it is close to impossible to
  make materially faster from application code today.

## 2026‑07‑07 highlights (batch 4)

- **Reel albums:** a reel made of several videos now supports the exact gesture
  the spec called for — vertical swipe still advances to the next REEL (native
  deck scroll, untouched), horizontal swipe moves between the album's videos.
  The two never conflict; position dots show which video you're on.
- **Send on Reels:** the same paper‑plane Share sheet from the feed now lives on
  both reel action‑rail layouts (mobile rail and the desktop persistent sidebar).
- **Wow reaction picker (slice 2):** long‑press the Wow button for 8 flavors
  (Love/Fire/Funny/Applause/Surprised/Celebrate/Insightful/Support). Stored as a
  nullable `emotion` column on the SAME reaction row (migration 0033) — counts,
  notifications and every existing query are unaffected; picking a new flavor
  updates in place instead of erroring. The read path is 42703‑tolerant by
  design: a naive 3‑column select failing on a pre‑migration database would have
  silently blanked every viewer's like/save state, not just the new field, so
  it falls back automatically. The chosen flavor now survives a page reload.

**Owner action:** apply migration **0033** in Supabase (alongside 0030/0031/0032).

## 2026‑07‑06 highlights (batch 3)

- **Chat is truly instant now:** the live stream (`postgres_changes`) has no
  replay, so messages sent while a phone was backgrounded were silently lost
  until a manual refresh. The room now catch‑up‑resyncs (merge, not replace) on
  app resume, reconnect and channel re‑subscribe; failed sends clean up their
  ghost bubble; the inbox refreshes its unread state on resume too.
- **Shared posts render as rich cards in chats** (creator, cover, caption, tap to
  open), privacy‑gated server‑side — a link to a post you can't see shows a quiet
  "unavailable" chip, never content.
- **Push notifications send with `Urgency: high`** (+ APNs‑safe collapse topic) —
  Apple holds normal‑urgency pushes on idle/locked iPhones, which was the
  delayed‑notification symptom. Remaining variance is iOS power management.
- **Auto‑refresh audit:** the client data layer already revalidates every mounted
  query on focus/online/visible; with the feed's revive logic and today's
  message/inbox resync, no surface needs a manual refresh. (Comments realtime in
  open viewers remains queued.)

## 2026‑07‑06 highlights (batch 2)

- **Seamless For You/Following switching (feed + reels):** tabs slide past each
  other (GPU transform), never reload or jump to top; each tab restores its
  scroll/reel index, and a new session‑wide resume store
  (`lib/media/resume-positions.ts`) makes every video continue exactly where it
  stopped across tab switches, viewer closes and remounts.
- **True full‑bleed video:** clips shaped close to the screen now COVER it
  edge‑to‑edge — under the status bar and home indicator (TikTok style) — in the
  reel player and in fullscreen; clearly different shapes stay uncropped over the
  blur backdrop. Album carousels got their own fullscreen (same‑element promotion)
  with slides, counter and dots still fully swipeable.
- **Share/Send system (slice 1):** paper‑plane button on every feed card → lazy
  bottom sheet: send to multiple friends/recent chats as DMs (search, multi‑select,
  optional message, success animation, push to recipients via
  `/api/posts/[id]/share`), plus Copy link, OS share sheet, and Repost shortcut.
- **New reels play instantly:** players prefer the MP4 until Cloudflare Stream
  confirms the encode (`streamReady`), Safari's native HLS finally has an
  error→MP4 fallback (the "reel stuck on spinner until you reopen" bug), and
  publishing busts the author's own feed caches (`bustHomeFeedCache`) so a new
  post/reel appears immediately.

## 2026‑07‑06 highlights

- **Fullscreen video (slice 1):** every `FeedVideo` gets a fullscreen button. The
  video's own box is promoted to a fixed edge‑to‑edge layer (same element — instant,
  no flicker, position preserved); native Fullscreen API is engaged where it exists.
  Code‑split chrome (`features/media/fullscreen-video.tsx`): auto‑fading controls,
  seek bar + times, speed cycle, PiP (with iOS fallback), double‑tap center = Wow,
  double‑tap sides = ±10s, keyboard parity, safe‑area padding everywhere.
- **Global Loading Engine saved to Frenz Core** (`docs/FRENZ_CORE.md` → Loading
  Architecture is now MANDATORY for all features): `lib/loading/priority.ts`
  (`afterInteractive`/`whenVisible`), `LazyMount`, `FadeImage` (decoded fade‑in),
  every route's `loading.tsx` announces to screen readers.
- **Installed PWA auto‑update:** per‑deploy build stamp + `/api/app-version`; the
  app reloads itself once when a new deploy lands (fixes "old UI until delete and
  re‑add to home screen"). SW v6 adds navigation preload + media bypass (faster
  page opens and reel loads in the installed app).
- **Downloads:** TikTok tiers are codec‑aware (bytevc1/H.265 vs H.264) with an
  H.264 rescue path — high quality always downloads as a playable VIDEO; ffmpeg
  outputs now require a video stream (audio‑only "videos" impossible); client blobs
  get real MIME types (iOS share sheet always offers Save Video); the redundant
  "Download started" toast is gone (the floating progress card is the notification).
- **Feed (owner directives):** Smart Filters chip row (Photos/Videos/…) REMOVED;
  the sticky For You/Following bar no longer moves while scrolling (topbar is
  locked visible on the feed); the purple gradient stripe on post cards removed
  (mature, professional cards); album carousels slide sideways only and never
  trigger the tab swipe.
- **Audit pass (same day):** albums now render as full carousels on the post page
  (`getPostMediaItems`, 42P01‑tolerant) and in the PostViewer overlay — tapping a
  photo zooms that slide, tapping a video opens the reel viewer; profile grids show
  a Layers+count album badge (one batched query inside the existing 30s cache);
  removed the post page's overlapping "Full screen" pill; verified z‑layering
  (fullscreen 140 > viewers 110–120 > toasts 100), SW media bypass, no reload
  loops in the build‑stamp check, and clean tsc/lint/production build.

## Brand & Design

- **Product name:** primary name is **Frenz**. "FrenzSave" is used only for the
  SEO/download URL and a few crucial meta spots.
- **Brand "F" logo:** the premium luxury gradient "F" in
  `components/brand/frenz-logo.tsx` (`FrenzLogo` / `FrenzMark` / `FrenzWordmark`)
  is the single source of truth — reuse it everywhere, never inline a different F.
- **Design tokens:** the design system lives in `app/globals.css` — brand palette
  (Electric Blue `#0A84FF` primary, Royal Purple `#6C4DFF` accent, `#050816` dark
  bg), motion tokens, glass/glow utilities. Use tokens, not ad‑hoc values.
- **No emoji in the UI:** never use emoji anywhere in the product design — use
  realistic, colorless line icons (lucide / react‑icons) instead.
- **Theme default stays `system`** (light/dark/system). Never force a theme; light
  mode stays bright/white.

## Engineering foundation

- **Frenz Core** is the mandatory foundation — every feature integrates with it;
  nothing bypasses it. One backend, one identity, one cloud, one security model,
  one design system, shared engines. Canonical spec: `docs/FRENZ_CORE.md`.
- **Platform architecture:** modular‑monolith; module registry in `lib/platform`;
  unified backend (`/api/v1/app/*`) + a cross‑platform SDK (`lib/sdk`) shared by
  web/iOS/Android/desktop. Perf guardrails documented in `ARCHITECTURE.md`.
- **Performance review gate (MANDATORY):** no feature is done until it passes a
  perf review — rendering efficiency (memoize list items, animate only
  transform/opacity), memory (clean listeners/timers/observers, release media),
  network (dedupe/cache/paginate), battery/thermal (pause offscreen +
  backgrounded media, one decoder), and mobile smoothness. Targets: Lighthouse
  Perf 95+, A11y/Best‑Practices/SEO 100, healthy Core Web Vitals.
- **Independent audio playback:** feed videos autoplay **muted** (HTML `muted`
  attribute) so users keep hearing their own music/podcast while scrolling. Never
  take audio focus except on the user's explicit unmute (fade via
  `lib/media/audio-playback.ts`). No Web Audio API, no hidden audio elements, no
  `navigator.mediaSession`.
- **Sticky-sidebar gotcha:** `<body>` uses `overflow-x: clip` (not `hidden`) so it
  never becomes a scroll container — `hidden` breaks `position: sticky` on the app
  sidebars, which then scroll away and leave empty space. Any body-scroll-lock
  effect (opening a full-screen viewer, sheet, or modal) must set
  `document.body.style.overflowY` only — never the `overflow` **shorthand**, which
  silently resets `overflow-x` back to the browser default and reintroduces the
  exact same breakage. Every full-screen overlay in the app follows this rule.
  The main app sidebar (`app-sidebar.tsx`) no longer relies on `sticky` at all —
  it's `position: fixed` (pinned to the viewport unconditionally, preceded by an
  invisible spacer that reserves its width in the layout's flex row), so it
  can't be affected by scroll state under any overlay, full stop.

## Product surfaces (shipped highlights)

- **Home dashboard** at `/home` — app shell + rich paginated Smart Feed; landing
  redirects logged‑in users here.
- **Smart Home Feed** — smart‑feed engine (reasons, content balance, spark cards,
  "while you were away"), premium `SmartFeed` on `/home` with pull‑to‑refresh,
  filters, zero‑empty fallback. Called **Smart**, never "AI". The hero segmented
  control (For You / Following / Reels — minimal text + sliding underline, no
  pill/border, same identity language as the Reels tabs) always stays visible;
  only the filter‑chip row below it collapses via the tiny bottom‑edge handle, on
  every screen size (remembered across visits). Filter chips justify‑between and
  drop their edge fade on large screens, and the active chip uses the brand
  gradient + glow. **For You/Following switching is instant and never reloads**
  — each tab keeps its own cached items/pagination cursor (Following is silently
  prefetched in the background so even the first switch never shows a skeleton),
  and switching never jumps the page back to the top.
- **Reels** — full‑screen deck (For You / Following tabs, scrubber, double‑tap
  like, decluttered rail, Repost, inline edit, direct download). Muted‑by‑default
  independent audio. Every reel **loops continuously** while in view — advancing
  only ever happens by scrolling, never automatically. The options (•••) button
  sits top‑right (mirroring the close X at top‑left, always visible) and escapes
  into the same right gutter the action rail uses on large screens instead of
  sitting on top of the video; elapsed/total time sits top‑center below the tabs
  (auto‑hides with the rest of the UI). Press‑and‑hold pauses **and** opens the
  options sheet — one gesture reaches every action. A decisive **horizontal
  swipe switches For You/Following** instantly, same as tapping the tab — and
  like the feed, **each tab is cached and Following is prefetched in the
  background**, so switching is instant and resumes on the exact reel you left,
  never back at the first one. The For You/Following tab bar is centered over
  the true video‑viewing area (accounting for both the app sidebar on the left
  and the persistent comments panel reserved on the right) so it never compresses
  against the top‑right options button.
- **Comments side panels** — on large screens, opening an image or video from the
  feed shows a persistent right‑side comments panel (publisher+follow, caption,
  quick actions, always‑visible comments — no tap needed) instead of empty space
  beside the media; same split‑pane pattern as PostViewer. Mobile/tablet keep the
  tap‑to‑open bottom sheet. The image viewer reserves a real gutter
  (`lg:pr-24` on the media container) on large screens so its action rail can
  never overlap the comments panel — mirrors the reel deck's column/gutter split.
- **Caption "see more" + post info** — in the reel and image viewers, a small
  control below the caption expands it to the full (unclamped) text and reveals
  the exact date posted, in both the auto‑hiding overlay caption and the
  persistent large‑screen sidebar.
- **Notifications** — premium realtime Notification Center, Web Push, iOS install
  path, social push, live toast. **Push enable flow (2026‑07‑06):** the missing
  last mile was that nothing inside the installed iOS app requested notification
  permission (Apple only delivers Web Push to home‑screen installs after a
  user‑gesture grant *inside* the app). `PushNudge` now shows an "Enable
  notifications" banner in‑app until push is truly on (session snooze; permanent
  stop once subscribed), `syncPush()` silently repairs subscriptions on launch,
  and `POST /api/push/test` sends a verifiable test notification.
- **Friends (Frenz Connect)** — requests with notes, friendships, `/friends` hub,
  full‑page `/friends/discover` (search + suggestions).
- **Profiles** — Identity Ring w/ presence, living glow, live stats, Posts/Videos/
  Photos tabs, share, completion meter.
- **Creation Studio** — block‑based Story Studio (heading/text/quote/image/video/
  divider), drafts + recovery, morph publish animation. **Photo editor
  (2026‑07‑06):** picking an image in Create offers Edit — a non‑destructive
  editor (the edit is a parameter object over the original; nothing bakes until
  Apply, "Edit again" resumes the same sliders). Live GPU preview (CSS filter +
  blend overlays), press‑and‑hold to compare with the original, rotate/flip/
  reset, six adjustment sliders (brightness/contrast/saturation/warmth/fade/
  vignette) and 14 Frenzsave signature filter families with an intensity
  slider. Apply runs one typed‑array pixel pass (Safari‑safe — no canvas
  ctx.filter) and caps output at 2560px. Next studio slices: video trim +
  cover via the ffmpeg worker, crop, caption studio.
- **Downloader** — the SEO/download product; direct download of posts (free tier
  capped at 5/day, premium unlimited).
- **Repost & Share (Phase 1 + 2)** — reels action stack is Like · Comment ·
  Repost · Save + a premium overflow (•••) sheet. **Phase 2** (attribution model)
  is a `reposts` table (a pointer to the original — never copies media) +
  `posts.reposts_count` + notify trigger, in **migration `0025_reposts.sql`
  (must be applied in Supabase)**. Repost is a toggle (`POST`/`DELETE
  /api/posts/:id/repost`), synced across surfaces via a client repost store, with
  a live count; the profile **Reposts tab** is public. **Phase 2b (mostly
  shipped):** overlapping-avatar repost badge; a "@handle reposted" discovery
  header on feed cards; **surfacing** — a followed user's repost pulls the
  original post into the top of your For You feed even when it wouldn't otherwise
  rank; and **per-tab profile privacy** — Reposts / Liked / Saved each have their
  own Public / Followers / Private visibility (a disallowed tab is hidden entirely
  and its data never loads), in **migration `0026_profile_tab_privacy.sql` (must
  be applied in Supabase)**. **Phase 2b is complete:** an OS-style repost bubble
  animation on the feed + reels; grouped repost notifications ("X and N others
  reposted your post"); and **Collections** — user-curated, privacy-scoped sets of
  posts ("Save to collection") with a picker sheet and a profile Collections tab,
  in **migration `0027_collections.sql` (must be applied in Supabase)**. Repost
  conversations stay unified on the original post by design (a repost is a
  pointer). **Recommendation captions (2026‑07‑06):** tapping Repost opens a
  premium composer (original‑creator preview, optional "Why are you recommending
  this?" caption, 300‑char counter, per‑post draft auto‑save, instant Post Now,
  Undo toast); captions belong to the reposter and never touch the original. The
  caption can be edited within 15 minutes (shows "Edited") and reposts can be
  pinned to lead the profile Reposts tab — **migration
  `0030_repost_captions.sql` (must be applied in Supabase)**. The feed's
  discovery header quotes the newest followed reposter's caption and collapses
  to "Recommended by people you follow" past three reposters. The visible action
  bar is now Like · Comment · Repost · Save on feed cards too — Share, Copy link
  and Download live in the ••• overflow. **Long‑press & discovery (same day):**
  holding the Repost button (feed, reels rail, desktop sidebar) opens an
  advanced options sheet — Quick Repost / Repost‑with‑caption before; Edit
  caption (inside the live 15‑minute window), Pin/Unpin, Copy link, Remove
  after. Tapping the reels avatar cluster or the feed "reposted" line opens a
  "Reposted by" sheet (followed users first, captions, quick Follow) via
  `GET /api/posts/:id/reposters`. Still open from the expanded spec: quote
  reposts, per‑repost discussions, creator repost analytics.
- **Auth (passwordless Email OTP)** — sign‑in/sign‑up is one flow: email → a
  6‑digit code delivered in a premium branded Resend email (the code itself
  comes from Supabase Auth, so sessions stay stock) → straight into /home. The
  code screen auto‑focuses, auto‑advances, accepts paste + iOS autofill,
  verifies automatically on the 6th digit, shakes on a wrong code, and offers a
  30‑second resend countdown + change‑email. Common email typos get a "Did you
  mean?" fix. Google OAuth stays; passwords are gone from the UI (existing
  password accounts sign in via the code — same email, same user). Requests are
  rate‑limited per IP and per email and never reveal whether an account exists.
  Email setup (RESEND_FROM, domain verification, optional Supabase SMTP +
  template) is documented in **docs/EMAIL_SETUP.md**. **OTP length gotcha:**
  Supabase projects issue 6–10‑digit codes (dashboard setting; this project
  uses 8) — the API returns the real `codeLength` and the input boxes adapt, so
  never hardcode the length. Still open: the spec's required‑onboarding steps
  (username availability, DOB, country), active‑sessions view, trusted devices.
- **PWA native slice 1** — the install prompt waits for real engagement (2nd
  page view or a 600px scroll) instead of interrupting on landing; returning to
  the app after 2+ minutes (or reconnecting) auto‑refreshes the feed in place
  at the top, or lights the "new posts" pill mid‑scroll; the app icon carries a
  live unread badge (Badging API — bell count, background‑push flag, cleared on
  read/tap; service worker bumped to v5). Still open: iOS splash screens,
  offline action queue, navigation‑state restore.
- **Loading engine slice 1** — shared skeleton system grew `SkeletonSection`
  (screen readers now hear "Loading…" — wrap every loading.tsx body in one) and
  `SkeletonRow`; route audit added layout‑matched skeletons for
  /friends/discover, followers, following and /welcome. Remaining
  page‑without‑skeleton routes are static marketing pages by design.
- **Security hardening (2026‑07‑06)** — full posture in **docs/SECURITY.md**.
  Highlights: git history scanned, no credentials ever committed (the "SMTP
  credentials" scanner alert was a placeholder block in EMAIL_SETUP.md, now
  rewritten); real XSS fix — JSON‑LD on post/profile pages now escapes user
  content via `lib/seo/json-ld.ts` (rule: never raw JSON.stringify into a
  script tag); SQL injection unreachable by construction (PostgREST
  parameterization + RLS + server‑only service role); security headers,
  rate limits and CSRF properties documented. Next: CSP report‑only rollout.
- **Optional passwords** — Account → Password (set/change with confirm);
  login gained "Sign in with a password" and "Forgot password?" which verifies
  ownership with the usual email code and lands on Account → Password to set
  the new one. Codes remain the primary sign‑in.
- **Reels immersion spec (verified 2026‑07‑06)** — the shipped player already
  conforms (100dvh snap deck, safe‑area insets, tap/double‑tap/hold gestures,
  adaptive HLS with battery/network caps, predictive preload, floating glass
  UI). Deliberate deviations kept: preload depth stays at next‑1 (five would
  burn data/battery), and reels stay muted‑by‑default (owner directive: never
  steal audio focus).
- **Feed / Reels separation (2026‑07‑06)** — Feed and Reels are now separate
  products: every post carries an explicit `format` ('feed' | 'reel'), each
  surface queries only its own format, Reels has its own API
  (`GET /api/reels`) and cache keys, and uploads choose explicitly (videos →
  Reel or Story; photos → Post / Story / Both). Existing videos were
  backfilled as reels — the feed becomes text/photos (+ future long‑form
  'feed' videos). Architectural note: a `format` column on `posts` rather
  than separate tables, because the whole social graph (reactions, comments,
  reposts, collections) references posts — product separation lives at the
  query/API layer. **Migration `0031_content_format.sql` must be applied in
  Supabase.** Queued next from the spec: a dedicated reels recommendation
  algorithm (watch‑time signals), feed carousels/articles, per‑product
  analytics. Also queued as recorded specs: the **Wow interaction system**
  (signature reaction replacing Like) and **Frenzsave Moments** (premium 24h
  temporary sharing on the stories base).
- **True‑aspect video + edge‑to‑edge (2026‑07‑06)** — video frames are never
  cropped anywhere: the reel player uses object‑contain on every screen (tall
  clips fill the full height; landscape/square clips show complete over the
  blurred backdrop), and feed cards measure each clip's real aspect ratio and
  size themselves to it (clamped between 9:16 and 16:9). The installed app is
  now truly edge‑to‑edge (`viewport-fit=cover` + black‑translucent status
  bar): reels and photos draw under the clock/battery like TikTok, and every
  top‑anchored bar/control pads itself clear via `env(safe-area-inset-top)`.
  **Rule:** any new fixed/sticky top‑anchored element must include the
  safe‑area inset; the app topbar is `4rem + inset` tall, so sticky offsets
  below it must use `calc(4rem + env(safe-area-inset-top))`.
- **Batch Download (Pro & Above, 2026‑07‑06)** — multi‑photo fetches (TikTok
  albums) show the premium batch panel from the owner's mock: numbered
  selection grid with animated gradient checkmarks, Select All, live counter,
  "Download N Items" with total size, parallel background streaming with one
  summary card, a Fast/Private/No‑Watermark/No‑Sign‑up feature strip, and a
  crown upsell for free users (batch itself is Pro+; singles stay free).
  Queued next from that spec: worker‑side ZIP packaging and batch reposting.
- **Multi‑media posts / carousels (2026‑07‑06)** — creators can now publish
  albums: pick several photos/videos at once (drag‑drop or gallery
  multi‑select, up to 20), reorder with the cover always first, remove/add
  tiles, and edit each photo non‑destructively; destinations adapt (photo
  albums → Feed; video albums → one Reel or a Feed album; **mixed albums →
  Feed only**, enforced server‑side too). Publishing uploads each item with
  live "Uploading i of n" progress and creates one post whose ordered items
  live in `post_media` (**migration `0032` must be applied**). Feed cards
  render albums as a native scroll‑snap carousel — full‑width slides,
  1/n counter, animated dots, letterboxed over a blurred backdrop (never
  cropped), slide videos autoplaying only while visible. Still open: reel
  albums (horizontal swipe inside a reel), album rendering in the post
  viewers, profile‑grid album badges.
- **Download experience (2026‑07‑06)** — downloads never navigate to a raw
  file again (the old link path stranded iOS/installed‑app users on a Quick
  Look preview). Every download button now streams in the background through
  the in‑app manager with a floating progress card (percent, size, speed,
  time left, cancel/retry) while the app stays fully usable. On completion:
  desktop/Android auto‑save; iOS shows **Save to device**, which opens the
  share sheet ("Save Video" → Photos) — the one reliable web path, and it
  requires a real tap. Files also land in the in‑app library for offline
  rewatching. Remaining (backlog): background‑fetch continuation, resumable
  ranges, completion push.
- **Wow icon + floating reactions (2026‑07‑06)** — the Wow mark is now a real
  astonished face (wide eyes, open mouth; gradient‑filled when pressed) after
  the spark read as an "AI" icon; and every Wow tap lifts the mark from the
  tap point — spring pop, randomized drift/rotation, grows and fades (the
  premium floating‑reaction animation spec, GPU transform/opacity only).
- **💙 Wow (slice 1, 2026‑07‑06)** — Like is now **Wow**, Frenzsave's signature
  interaction. A custom twin electric‑spark mark (never the emoji): quiet
  outline at rest, electric blue→purple gradient with a soft glow when
  pressed — on the feed action bar, reels rail, desktop sidebars and both
  viewers; double‑taps bloom the gradient mark ("Double‑tap to Wow").
  Notifications and push say "Wow'd your post"; the profile tab is "Wows".
  The database keeps `type='like'` (presentation‑level rename — zero data
  risk). Next slices: long‑press reaction picker, spark‑particle press
  animation, milestones, Most Wow'd leaderboards.

## Performance, battery & thermal

An app-wide performance mandate (feel native-fast, no phone heat/battery drain,
premium look intact; Lighthouse 95+). Every feature also passes a perf review
before it's done. Already in place: `content-visibility` on feed cards
(virtualization-lite), memoized feed cards with stable callbacks, single-video
playback via a coordinator + Page-Visibility pause, versioned service-worker
caches, router `staleTimes`, barrel-import optimization, AVIF/WebP via next/image.
**Pass 1:** code-split the interaction-only overlays (reels engine, post/image
viewers), per-card sheets, and profile Downloads/Collections tabs off the initial
bundles via `next/dynamic` (kept mounted after first open so close animations
play), and cut the sticky feed-nav backdrop-blur cost on scroll. **Pass 2:**
migrated the high-byte images to `next/image` (AVIF/WebP + right-sized srcset +
lazy) — the shared grid cover (cascades to every profile/explore/collection grid),
collection covers, profile banner + avatar, and the feed-card header avatar. The
**Pass 3:** the inline feed photo now uses next/image too — an image's natural
dimensions are captured client-side at upload and stored (nullable
`media_width`/`media_height`, **migration `0028_post_media_dimensions.sql`**), so
the photo renders AVIF/WebP at the right size with no crop or layout shift; older
posts without dims keep the plain `<img>`. Dimensions are written and read via
separate best-effort paths so a not-yet-applied migration can't break publishing or
the feed. More avatars moved to next/image too. Windowing isn't needed —
`content-visibility` already gives feed cards virtualization-lite.

## Adaptive video streaming

Reels play through **Cloudflare Stream** (adaptive HLS: an automatic quality ladder
+ AV1/H.265/H.264, delivered from the global edge) using our own controllable
`<video>` — native HLS on Safari/iOS, **hls.js** (dynamically imported, lazy chunk)
elsewhere, tuned for a reels feed (small buffer, cap-to-player-size, worker parsing)
and always falling back to the plain MP4 if a stream isn't ready. Only the active +
next reel wire HLS (predictive preload of the next; decoders released for the rest).
Publishing a video kicks off **ingestion** (`/api/posts/:id/stream-ingest` →
`copyToStream`, storing `stream_uid`); the original R2 MP4 stays as the archival +
fallback source. Entirely additive and **env-gated** — with no Stream credentials
(`CF_STREAM_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE`)
everything plays exactly as before. The **inline feed video** uses the same adaptive
path (attaching only near the viewport, releasing off-screen). An **admin backfill**
(`/api/admin/stream-backfill`) ingests existing videos; **auto-captions** are
generated on ingest (English + French by default — `DEFAULT_CAPTION_LANGUAGES`,
chosen for the Africa-primary, Francophone-heavy audience) and render through HLS
automatically; and **playback metrics** (time-to-first-frame, rebuffers, dropped-frame
ratio, last bitrate, errors) are logged via a sampled beacon (`/api/metrics/playback`).

**Slice 4 (network/battery-aware quality + reliability):** the HLS ladder never
defaults to its top rung — `lib/media/network-conditions.ts` reads Data Saver +
connection type synchronously (so it never delays stream attach) and the async
Battery API to refine the cap moments later, applied to hls.js via
`autoLevelCapping`. Viewers can also override it — a three-way **Auto / Data saver /
Highest quality** control (localStorage) in the reel's overflow (•••) menu, the one
manual knob the spec asks for. A **Stream ready-webhook**
(`/api/webhooks/stream`, HMAC-verified) flips `stream_ready`/`stream_error` on posts
when Cloudflare finishes transcoding — a confirmed encode failure makes the player
skip HLS entirely rather than wasting a fetch; register it once via
`/api/admin/stream-webhook-setup` (admin-only) and set the returned secret as
`CF_STREAM_WEBHOOK_SECRET`. It's also the reliability net for captions, re-requesting
any language that didn't take right after ingest. **Migration
`0029_stream_status.sql`** adds `stream_ready`/`stream_error`/`caption_languages` —
best-effort/optional, so none of this gates playback before it's applied.

## Infrastructure & ops

- **Deploys:** GitHub → Vercel. **Always `git push origin main` after committing**
  — the owner judges progress by the live site.
- **Vercel region:** functions run in **`cdg1` (Paris)** for an Africa‑primary
  audience (was `iad1`). Supabase is Cloudflare‑fronted REST, so Paris keeps DB
  access healthy while cutting the user↔function transatlantic latency. Revisit
  with edge caching + read replicas when global.
- **Storage / egress:** app supports Cloudflare R2 + Stream (env‑gated, falls back
  to Supabase Storage). Media served via `media.frenzsave.com`. Watch Supabase
  egress; anon reads are edge‑cacheable and hot reads are Redis‑cached.
- **Worker transcode:** VP9→H.264 on Railway must cap x264 threads (`-threads 2`)
  or it OOMs.
- **Railway builds** with `npm ci` — any `package.json` change must commit the
  updated `package-lock.json` or the deploy fails.
- **`vercel.json`** schema forbids extra keys (e.g. a `comment`) on header/route
  objects — it fails validation.
- **Admin / alert email:** `nwujuchriss@gmail.com` (not the git‑config email).

## Cross‑platform SDK (native‑app groundwork)

- `lib/sdk` — dependency‑free `FrenzsaveClient` (auth injection, request dedupe,
  retry w/ backoff, timeouts, `X-Client` tag). Typed methods for `me`, `feed`, and
  core actions (`like`, `save`, `follow`, `repost`, `authorizeDownload`). Web uses
  the same client via `getApi()` / `useApi()`.
- Next: extend bearer‑token auth to the plain `/api/*` action routes so the native
  (cookieless) clients can call them, and progressively route web reads through the
  SDK so the web exercises the identical fast path.

---

_This file is intentionally free of secrets. If you're looking for keys/tokens,
they're in your local `.env.local` (gitignored)._

---

## 2026‑07‑16 — Composer split (Post/Reel/Story), icon flattening, three chat bugs (`93a3b75`)

**Composer split — done.** Owner: *"every create reels, story, and post button
should open directly to the create reels page, all shouldnt use one global editor
style sheet, use facebook and instagram combine style sheet."* Post, Reel and
Story are now three real routes with three separate surfaces:

- `/create/post` — Facebook‑led: light, text‑first. Close + title + Post pill,
  author row with a Public audience chip, "What's on your mind, {first}?",
  cover‑first album rail, inline photo editor, FB's "Add to your post" tray.
- `/create/reel` — Instagram‑led: black, 9:16, `object-contain` (never‑crop).
  Video‑only and single‑item, **refused at pick time** — any album or non‑video
  publishes to the feed by product rule, so accepting one and silently
  redirecting the user's "Reel" would be dishonest.
- `/create/story` — Instagram‑led: black, single media, IG's "Your story" send
  chip, 24h framing, block Story Studio entry.

The routes live inside the `(app)` group so the persistent shell stays mounted
(instant transition); each surface is a `fixed inset-0` layer over the chrome,
the same pattern message threads use. `features/create/composer-core.ts` shares
**mechanics only** (validation, object‑URL lifecycle, poster capture, upload,
publish) — one network contract, zero shared styling. No backend change was
needed: `/api/stories` already spoke `post|reel|story|both`. All four entry
points migrated (topbar `+`, nav `+` sheet, home stories rail, `/friends`
rail); `upload-modal.tsx` + `upload-store.ts` deleted.

**Continue Watching.** The restore chip that "just loads and disappears" was
real: visibility was a server‑side filter, so the chip could only PATCH and
remove itself while the section waited for the next Home load. Visibility is
client‑gated now (`home-modules-store.tsx`) while the server still renders every
module — instant both ways. A `router.refresh()` would have worked but blows
away the Router Cache (the "Home reloads on every entry" bug). Migration `0079`
is a one‑time data repair clearing accidental `continue_watching` hides (3 of 4
rows had it), guarded by a new `public.schema_repairs` ledger so a re‑run can't
undo a later deliberate hide.

**Icons.** Owner: *"remove all blue icon back from all pages … whatsapp ios app
kind of emoji without background color … high icon contrast to be darker."*
`IconTile` / `ModuleIconBadge` / `NavIconBadge` are now bare full‑contrast
glyphs — no tile, gradient, gloss, ring or shadow. That covered "all pages" in
one change. Also stripped the `+` sheet's tinted mockup tiles (incl. the blue
Download tile — this supersedes the earlier "reproduce the mockup exactly"
instruction), the compose launcher, and the nav profile fallback. `tint`/`tone`
props were removed, not ignored. Left alone: the nav's blue active‑tab color and
the gradient `+` FAB — both explicit prior owner specs, and both foreground/
button color rather than an icon background.

**Chat, three real bugs.**
1. *Sent image/video collapsed to a small empty bubble until you left and
   re‑entered the thread.* Two causes, both required: `append()` replaced the
   optimistic bubble wholesale with the realtime echo, which carries
   `attachments: []` by design (attachment rows land in a separate insert),
   wiping media already on screen; and `resync()`'s change‑detector ignored
   attachments, so the recovery path fetched them and dropped them with
   `return prev`. Preserving the optimistic list is safe — staged attachments
   are uploaded at pick time, so they already hold the final URLs.
2. *Header not fixed with the keyboard open.* `interactiveWidget:
   "resizes-content"` shrinks the layout viewport on Android, but iOS shrinks
   only the VISUAL viewport and scrolls — so a `fixed inset-0` thread is pushed
   off‑screen. `useKeyboardViewportPin()` re‑anchors to
   `visualViewport.offsetTop/height` while the keyboard is up.
3. *Wallpaper scope* — "Both of you" (shared `conversations.wallpaper_url`) vs
   "Only you" (`chat_appearance_preferences.wallpaper_url`, migration `0080`).
   Two independent pictures; personal wins, clearing falls back to shared.

**Pending migrations: 0073 (still), 0079, 0080.** All degrade safely if
unapplied.

**Verification note.** tsc/lint/170 tests/build were all green *and still
missed three things* that only screenshots caught: a blue camera icon in the new
Post tray, a blue→violet Story hero, and one surviving `bg-brand-tile` — each
exactly what the icon pass was meant to remove. Fixed before shipping. Driven
end‑to‑end in a real browser with a real session: the `+` sheet routes to
`/create/reel` and `/create/story`, and no tinted icon tiles remain.

---

## Academy course self-checks (2026-07-20)

**What shipped.** A "Check your understanding" self-check at the end of each of
the 7 courses — 28 questions, every one drawn from a lesson its own course
teaches, with an explanation shown for right and wrong answers alike.

**The answer key ships to the browser, and that is stated rather than hidden.**
Grading is client-side. A `/api/assessments/grade` endpoint would look like
security and provide none — the questions still ship, so anyone who wants the
answers submits twice. Building it would be theatre and would put a Paris round
trip in front of a checkbox on pages that are currently static. The honest
framing is the one the design supports: a reader finding out whether they
understood a course, with no stakes.

**Therefore no certificates, no scores on a profile, no leaderboard.** A
credential backed by a quiz whose answers are in the page source is a fabricated
credential — the same family as the fabricated statistics already declined three
times.

**The score is the excuse; the review list is the product.** Every question
names its source lesson, so a wrong answer resolves to "go and read this"
in the course's teaching order rather than to a number.

**Not wired into the personal plane, deliberately.** "I read this" and "I
answered questions about it" are different facts. Collapsing them would corrupt
the input to `recommendNext`, which reads completions — someone who guessed
through four questions would stop being recommended lessons they never opened.

### Three things that only showed up because they were measured

1. **`border-destructive` emitted no CSS.** This palette has no `destructive`
   token. Wrong answers rendered identically to untouched ones, distinguishable
   only by an icon. tsc, lint, 555 tests and the build were all green; a
   screenshot caught it. Fixed to `rose-500` (the house convention), and
   `lib/design-tokens.test.ts` now fails on any shadcn token this palette does
   not define. **It immediately found the same bug already live in
   `features/notifications/push-toggle.tsx`** — two error messages rendering in
   body colour.

2. **The corpus cost 15 kB of first-load JS on every school page.** Importing
   the questions into the component the page renders took `/academy/[school]`
   from 260 kB to 275 kB — for a quiz that is collapsed by default and that most
   readers never open. The perf-budget ratchet has headroom at 300 kB, so it
   stayed green. Only building the branch twice and comparing showed it. Split
   into a `React.lazy` panel fetched on click, with the question COUNT passed
   from the server as a prop: back to 261 kB. `academy-perf.test.ts` pins the
   split. (`next/dynamic` with `ssr: false` was avoided — it has never resolved
   correctly here.)

3. **`lib/academy` was not scanned by the Reality Ledger.** Quiz prose asserts
   how software behaves, exactly like a lesson body. Added to `MARKETING_DIRS`
   and verified empirically with a throwaway probe file — it correctly caught
   both a false existence claim and magnitude claims before being deleted. The
   existing Academy prose passes clean.

**Also:** `/admin/corpora` now reports questions per course and lists courses
with no check as a `note`, not a `gap` — a course without a self-check is
complete, it just has no optional extra. Scoring it higher would repeat the
orphan-detection mistake where a metric flagged 155 non-problems.

**Verified end to end** in a real browser against a production build: opened the
check, answered, submitted, confirmed the review list, the per-question
explanations, the disabled fieldset and the reset — no console errors.
