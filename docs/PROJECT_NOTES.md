# Frenzsave — Project Notes & Decisions

A durable, human‑readable record of the project's key decisions, conventions and
system knowledge. Mirrored from the working knowledge base so it's readable on
GitHub.

> **No secrets here.** API keys and tokens (Supabase `service_role`, Cloudflare R2
> secret, Paystack/Resend/VAPID private keys, etc.) live **only** in the
> gitignored `.env.local` and must never be committed. This file records what
> things are and why — never their secret values.

_Last updated: 2026‑07‑09 (unified zoom/expand across feed video, feed carousel, reel albums + reel-album crossfade transition — Feed card polish shipped, owner-reported bug batch: mobile topbar brand mark removed, Continue Watching instant-reopen cache-warm shipped, Profile-menu stuck-backdrop nav bug fixed, Stories strip redesign shipped, Home page content-balancing bug fixed + Continue Watching wired in, bottom nav redesign shipped, Home topbar redesign shipped, Frenz Motion engine + Signature Icon System slice 1 shipped, independent security crosscheck + report-only CSP/COOP shipped, active-sessions/device management shipped, F logo hairline edge fixed + premium OTP email, real carousel-scroll fix + recurring dark-mode-on-reentry fix, F logo's black backdrop removed, site-down incident fixed, Friends discovery deck)._

---

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
