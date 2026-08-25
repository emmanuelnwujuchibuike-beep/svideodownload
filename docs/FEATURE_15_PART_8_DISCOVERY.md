# Feature 15 — Part 8: Discovery Engine, Personalization & Content Intelligence

## What this is, honestly

The brief asked for TikTok-For-You/Instagram-Explore-scale infrastructure:
vector embeddings, multi-region AI models, billions of daily recommendations,
a natural-language AI assistant. None of that exists here, and this app's
traffic doesn't justify building fake versions of it (see
[[feedback-no-fabricated-stats-declined-2026-07-18]]). So this Part extends
the real, transparent ranking engine that already existed
(`rankForYou`/`getHomeFeed`, `hot_score`/`recompute_hot_scores`, muted/boosted
categories) rather than forking a new one, and closes the one genuine gap an
audit found: **no watch-time/completion signal existed anywhere** — only
deduped view *counts*.

## Shipped (migration `0133_discovery_engine.sql`, unapplied until run)

1. **Watch-depth signal** — `post_watch_events` (viewer|ip, watch_ms,
   duration_ms, source) + `/api/watch` + `recordWatch()` in
   `lib/media/video-coordinator.ts`, wired at the Reels player's existing
   `onPause` checkpoint (same moment `savePlaybackPosition` already fires).
   Feed/other players are NOT wired yet — Reels is Part 8's stated focus
   ("Premium Short Videos"); extending to Feed video / ImageViewer is a real,
   separate follow-up.
2. **Momentum Engine™** (`lib/social/momentum.ts`, RPC
   `recompute_momentum_scores`) — a DIFFERENT score from `hot_score`:
   engagement-per-hour-since-posting (a young post already earning engagement
   ranks high even with a small absolute count) + real completion rate from
   watch events. Rides the existing `/api/cron/trending` cron (no new Vercel
   cron slot — those are scarce on this project). Feeds a small bonus into
   `rankForYou` and a new "Gaining momentum" reason tone in `feedReason()`.
3. **FrenzDNA™** (`lib/social/frenz-dna.ts`, table `user_interest_profile`) —
   per-category interest weights computed ONLY from the viewer's own
   likes/saves/watch-depth, never other people's activity. Read/reset via
   `/account/personalization`.
4. **Discovery Controls** — `user_home_preferences` gained
   `personalization_paused`, `sensitive_content`, `preferred_languages`.
   Sensitive content defaults OFF and filters `posts.is_nsfw` (which existed
   since migration 0007 but was never read anywhere) across every sort, not
   just for_you. Personalization-paused makes for_you behave exactly like
   "recent". Content-language filtering is stored but NOT enforced — posts
   carry no language tag, so this is honest groundwork, not a working filter.
5. **Discovery Orbit™** (`lib/social/orbits.ts`, `/api/orbit`, rail on
   `/explore`) — Friends/Creators/Music/Nearby/Trending/Learning/Gaming/
   Travel/Business orbits, each a thin adapter over data that already
   existed (`getHomeFeed`, `getSuggestedCreators`, `listTrendingSounds`,
   `getDiscoveryFeed`, `getFeed` with a category filter). **Community Orbit
   returns `deferred: true` with a real reason** — no `communities` table
   exists (confirmed absent twice now) — instead of fabricated rows.
6. **Creator Fairness** — `getNewCreators()` (`lib/social/suggest.ts`)
   deliberately does NOT sort by follower count; ranks by mutual-friends-follow
   count then `momentum_score`, capped under 2,000 followers. Also closes a
   flagged gap: `getSuggestedCreators` now blends in a mutual-friends boost
   instead of raw follower count alone.
7. **Discovery Analytics** — `getCreatorAnalytics` gained `discovery`:
   Traffic Sources (from `post_watch_events.source`), Retention (real
   completion %), Topic Reach (views by the creator's own post categories),
   new-followers-7d. Rendered on `/account/analytics`. **Country/city reach is
   deliberately absent** — nothing resolves a view to a location anywhere in
   this app; inventing one would be exactly the fabricated-stat pattern this
   project has declined before. Follower conversion is a raw 7-day delta, not
   a causal "this post caused N follows" claim — nothing attributes a follow
   to a specific post.
8. **"Business" added to the category taxonomy** (`lib/social/categories.ts`)
   — no CHECK constraint on `posts.category` to migrate, so this is a
   pure code change closing the Business orbit/tab honestly.

## Explicitly deferred (stated, not silently dropped)

- **Communities Orbit backend** — no `communities` table anywhere in 133
  migrations (re-confirmed this session). `features/app-shell/dashboard/
  join-communities.tsx` is still the same hardcoded placeholder it was in
  July.
- **Challenges** — no hashtag-challenge data model.
- **Smart Discovery Assistant** — a real Claude-backed assistant already
  exists (`/api/assistant`, `lib/assistant/knowledge.ts`) and could be
  extended with discovery-grounded context, but was not wired this pass —
  time-boxed out by a same-session priority interrupt (AdSense/YouTube
  landing-page fix). Real infra exists to do this properly later; do not
  build a fake NLP layer instead (see `personalization-preferences.md`'s
  "AI Preference Studio" precedent for why that was rejected before).
- **Video Collections** (Trending Today / Hidden Gems / Weekend Picks) — the
  data to compute these honestly (momentum_score, completion_rate,
  hot_score) now exists, but the rails themselves weren't built this pass.
- **Admin momentum-weights panel** — `lib/social/momentum.ts` is already
  admin-tunable via the `settings` table (same shape as `TrendingSettings`);
  no UI panel was added to edit it yet (mirror `features/admin/
  trending-editor.tsx`).
- **True ML / vector embeddings / multi-region infra / billion-user scale**
  — architecture notes only. This app's real traffic doesn't warrant it, and
  building placeholder infra for it would be inventory nobody uses.
- **Language-based feed filtering** — `preferredLanguages` is stored and
  surfaced in Discovery Controls; posts have no language tag, so nothing
  reads this preference yet.
- **Feed/ImageViewer watch-depth wiring** — only the Reels player reports
  `post_watch_events` today; Feed video and the image/carousel viewer don't.

## Verified

`tsc --noEmit` clean. `next lint` spot-checked clean on the changed files.
Migration 0133 not yet applied — same "apply promptly" note as every prior
migration in this project (see `feedback-migrations-applied-promptly.md`).
