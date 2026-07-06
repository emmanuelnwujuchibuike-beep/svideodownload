# Frenzsave — Project Notes & Decisions

A durable, human‑readable record of the project's key decisions, conventions and
system knowledge. Mirrored from the working knowledge base so it's readable on
GitHub.

> **No secrets here.** API keys and tokens (Supabase `service_role`, Cloudflare R2
> secret, Paystack/Resend/VAPID private keys, etc.) live **only** in the
> gitignored `.env.local` and must never be committed. This file records what
> things are and why — never their secret values.

_Last updated: 2026‑07‑05 (instant tab switching + resume position, caption "see more"/post date, decluttered large‑screen viewers)._

---

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
  path, social push, live toast.
- **Friends (Frenz Connect)** — requests with notes, friendships, `/friends` hub,
  full‑page `/friends/discover` (search + suggestions).
- **Profiles** — Identity Ring w/ presence, living glow, live stats, Posts/Videos/
  Photos tabs, share, completion meter.
- **Creation Studio** — block‑based Story Studio (heading/text/quote/image/video/
  divider), drafts + recovery, morph publish animation.
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
  pointer). The repost feature set is now complete.

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
