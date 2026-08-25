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

## Shipped in the follow-up round (same Part, after the migration was confirmed applied)

9. **Video Collections** (`lib/social/discovery-collections.ts`, rail on
   `/explore`) — Trending Today, Hidden Gems (high engagement relative to
   reach, not absolute), New This Week (momentum-ranked), Friends' Favorites
   (posts the viewer's own friends liked/saved — absent, not faked, for a
   signed-out viewer or one with no friends). No "Weekend Picks" — this app
   collects no day-of-week signal, so a weekend-labeled rail would just be
   Trending Today wearing a different name. Deliberately a DIFFERENT file
   from `lib/social/collections.ts` — that name was already taken by an
   unrelated, pre-existing feature (user-curated saved-post boards) and got
   clobbered by an unchecked `Write` mid-session; recovered via `git
   checkout` and given its own name (`VideoCollection`/`getVideoCollections`)
   so the two can never collide again.
10. **Feed video watch-depth wiring** — `recordWatch()` now also fires from
    `features/media/feed-video.tsx` (both its `onPause` and its
    IntersectionObserver-unmount cleanup, mirroring the two checkpoints
    `savePlaybackPosition` already used there), tagged `source: "feed"`.
    Reels was the only surface reporting watch depth before this.
11. **Admin Momentum Engine panel** (`features/admin/momentum-editor.tsx`,
    `/api/admin/momentum`) — mirrors `TrendingEditor` exactly; its
    "Recompute now" button calls the SAME `/api/cron/trending` endpoint
    TrendingEditor's own button does, since momentum recompute rides that
    cron rather than owning a separate one.
12. **Smart Discovery Assistant** (`features/account/discovery-assistant.tsx`,
    embedded on `/account/personalization`) — the SAME Claude-backed
    `/api/assistant` + `useAssistant()` that already powers general support
    chat, extended with an optional `context` field
    (`lib/social/discovery-assistant-context.ts` builds it server-side from
    the viewer's REAL FrenzDNA interests, real new creators, real trending
    posts/sounds) appended to the system prompt as clearly-labeled data the
    model may reference but never invent beyond. Embedded, not the global
    floating widget — a Discovery Assistant belongs on the discovery page,
    and touching the globally-mounted widget's state wasn't necessary.

## Explicitly deferred (stated, not silently dropped) — the genuinely remaining gap

- **Communities Orbit backend** — no `communities` table anywhere in 133
  migrations (re-confirmed twice this Part). `features/app-shell/dashboard/
  join-communities.tsx` is still the same hardcoded placeholder it was in
  July. This needs a real product/schema decision, not more Part-8 code.
- **Challenges** — no hashtag-challenge data model. Same as above.
- **True ML / vector embeddings / multi-region infra / billion-user scale**
  — architecture notes only. This app's real traffic doesn't warrant it, and
  building placeholder infra for it would be inventory nobody uses.
- **Language-based feed filtering** — `preferredLanguages` is stored and
  surfaced in Discovery Controls; posts have no language tag, so nothing
  reads this preference yet. Would need a real language-detection pass over
  posts first — a separate feature, not a Part-8 gap.
- **ImageViewer watch-depth wiring** — deliberately NOT done. An image has
  no natural "duration" the way video does, so `post_watch_events`'
  watch_ms/duration_ms shape doesn't fit it; forcing a fake duration in
  would be the same "label doesn't match the query" defect class this Part
  keeps calling out elsewhere. A real "dwell time on an image" signal would
  need its own shape, not a shoehorned reuse of this one.

Everything else from the original brief that was realistically buildable
given this app's actual infrastructure has shipped.

## Verified

`tsc --noEmit` clean, full `next build` clean, full `vitest run` at
2213/2213 (both after the initial round and again after the follow-up
round). Migration 0133 confirmed APPLIED against the live database (probed
directly — all 4 new tables/columns exist).
