# Feature 15 · Part 9 — Creator Studio™

The Premium Creator Experience: Creator Home, content management, audience &
engagement analytics, the content calendar, the Creator Assistant,
collaboration, achievements, and the three Frenzsave-exclusive surfaces
(Creator Journey™, Creator Health™, Creator Universe™).

Companion parts: Part 7 (Sounds), Part 8 (Discovery Engine). This part is the
**creator-facing** half of the same data Part 8 built for the viewer.

---

## 1 · What the audit found first

Every prior Part in this feature has started by reading the real code rather
than the brief, and this one changes the plan more than most: **a large share
of the brief already existed**, scattered across seven screens that no creator
would ever think to visit in sequence.

| Brief asks for | Already in the codebase | Verdict |
| --- | --- | --- |
| Engagement dashboard | `getCreatorAnalytics` — totals, views 7d/30d, engagement rate, top posts, traffic sources, retention average, topic reach, new followers 7d (`lib/social/creator-analytics.ts`) | **Extend** |
| Audience growth | `profile_snapshots` daily series (migration 0110) + `computeTrends` (`lib/profile/growth.ts`) | **Extend** |
| Follower insights | `getCreatorLounge` — top supporters, top comments, unanswered questions, reply rate | **Reuse** |
| Achievements | `computeAchievements`, 14 real-signal definitions, rarity ladder | **Reuse** |
| Creator Journey™ | `buildLifeJourney` — dated milestones from real rows | **Extend into a creator-scoped journey** |
| Notification centre | `creator_notification_prefs` + the notifications platform | **Reuse** |
| Music performance | Sounds platform, `sound_plays`, `posts.sound_id` (Part 7) | **Reuse** |
| Video organisation | `collections` + `collection_items` | **Reuse** |
| Content editing | `PATCH /api/posts/:id` (title, description, category, visibility) | **Extend** |

The genuine gaps — the things this Part had to build because nothing in 139
migrations could answer them:

1. **No creator home.** Analytics lived at `/account/analytics`, the Lounge at
   `/account/creator-lounge`, health at `/account/health`, stats on the profile
   rail. `lib/settings/categories.ts` said so in as many words: *"Creator
   analytics exist under Profile; there is no separate creator platform."*
2. **No content management.** A creator could edit one post from inside the
   reel viewer's action sheet. There was no list of their own work with per-post
   numbers and actions on it.
3. **No lifecycle state on `posts` at all.** `status` was
   `published | under_review | removed`. No pin, no archive, no schedule, no
   draft. Nothing to build a calendar or a manager on.
4. **No per-post retention.** Part 8 shipped `post_watch_events` and averaged it
   into one number. The *shape* of a watch — where people leave — was unread.
5. **No collaboration model.** A post has exactly one `publisher_id`.
6. **No creator-scoped health.** `lib/profile/health.ts` scores *profile
   completeness* (identity, security, privacy). It says nothing about upload
   consistency or burnout.

---

## 2 · Architecture

### 2.1 One surface, not eight

`/studio` is the creator's home. It does **not** duplicate the seven existing
screens — it composes their data functions and links out to them. The rule
applied throughout: *a Part 9 page may aggregate a Part 4–8 function; it may
never fork one.* `getCreatorAnalytics`, `getCreatorLounge`, `computeTrends`,
`computeAchievements`, `listTrendingSounds` are all called, none are copied.

```
/studio                  Creator Home — daily performance, latest work,
                         recent followers, goals, milestones, assistant
/studio/content          Content management — filter, pin, schedule, archive,
                         edit, delete; folders via existing Collections
/studio/content/[id]     Per-post performance — retention curve, drop-off,
                         traffic sources, hashtag + sound performance
/studio/audience         Audience — growth series, viewing times, returning
                         viewers, loyal fans, top supporters, interests
/studio/calendar         Content calendar — scheduled posts + planned entries
/studio/journey          Creator Journey™, achievements, Creator Universe™,
                         Creator Health™
```

### 2.2 The client/server split

Part 8 was bitten by a client component importing types from a module whose
import graph reached `server-only`. `tsc --noEmit` did not catch it; `next
build` did. Part 9 therefore splits every "catalogue + fetcher" pair up front:

| Pure / client-safe | Server-only |
| --- | --- |
| `lib/creator/widgets.ts` (widget catalogue, ordering) | `lib/creator/prefs.ts` |
| `lib/creator/retention.ts` (curve maths) | `lib/creator/post-insights.ts` |
| `lib/creator/health.ts` (scoring) | `lib/creator/studio.ts` |
| `lib/creator/journey.ts` (timeline shape) | `lib/creator/audience.ts` |
| `lib/creator/universe.ts` (graph layout) | `lib/creator/content.ts` |
| `lib/creator/hashtag-performance.ts` | `lib/creator/plan.ts`, `collab.ts`, `schedule.ts` |

Every file in the left column is a pure function over data passed in — no
React, no Supabase, no clock beyond an argument. That is also what makes them
unit-testable, which is why the six of them carry the Part's tests.

### 2.3 Data model (migration `0140_creator_studio.sql`)

**`posts` gains three timestamps and two status values.**

```sql
pinned_at    timestamptz   -- creator pinned this to their profile
archived_at  timestamptz   -- hidden from everyone but the creator
scheduled_at timestamptz   -- publish at/after this instant
status check now allows 'scheduled' and 'archived'
```

Why status values rather than only timestamps: **every feed query in the
codebase already filters `status = 'published'`**. A scheduled or archived post
is therefore invisible to `getHomeFeed`, `getFeed`, search, sitemaps, Orbits and
the profile grid the moment the row is written — with no change to any of those
call sites, and no risk of one being missed. The timestamps carry the *when*;
the status carries the *visibility*, in the vocabulary the schema already had.

**`creator_studio_prefs`** — dashboard layout, hidden widgets, pinned metrics,
accent, weekly upload goal. One self-owned row, same posture as
`user_home_preferences`.

**`content_plan`** — calendar entries that are *not yet posts*: ideas,
campaigns, community events, launches, collaborations. Deliberately separate
from `posts`: a plan has no media, no source URL and no publisher semantics, and
forcing it into `posts` would put non-content rows in front of every feed query
in the product.

**`post_collaborators`** — `(post_id, user_id)` with an invite status. Permission
based: an invite is `pending` until the invitee accepts, and only an `accepted`
collaborator sees the post's analytics.

Migration ordering follows the hard-won rule from `0130`: **all plain DDL first,
every `do $$ … $$` policy block last**, because plain DDL placed after a
dollar-quoted block in the same file has silently failed to apply on this
project before.

### 2.4 How a scheduled post actually publishes

This is the one place where the honest answer is worse than the brief's
implied one, so it is stated plainly rather than hidden behind a spinner.

Vercel gives this project **two cron slots and both are taken** (`/api/cron/trending`
at 03:00, `/api/cron/profile-snapshots` at 03:30). A third schedule is not
available, and a daily sweep would publish a 14:00 post at 03:00 the next
morning — which is not scheduling, it is a delay.

So `sweepDueScheduledPosts()` runs **two ways**:

1. On the existing trending cron, as a guaranteed daily floor.
2. **Opportunistically on real traffic** — the feed read path calls it through
   `after()` (already this codebase's fire-and-forget primitive), behind a
   60-second Redis lock so concurrent requests do one sweep between them, not
   hundreds.

In practice a post goes live within about a minute of its time, because the
site is being read. The dependency is real and is documented in the UI: the
scheduler says *"published within a few minutes of this time"*, never *"at"*.
A dedicated cron slot would remove the caveat; that is a plan decision, not a
code one.

### 2.5 Cost posture

Every Studio page is `force-dynamic` and owner-scoped — no shared cache to
poison, no SSE, no polling. **`features/admin/`'s standing ban on `setInterval`
is honoured here too**: the dashboards are server-rendered snapshots with a
manual refresh, not live sockets. "Real-time" in the brief is served by the
data being fresh on each navigation, which for a creator checking numbers a few
times a day is indistinguishable — and does not bill continuous compute.

`post_watch_events` reads are capped (5,000 rows per post-insight call, 20,000
per audience call) and every aggregate is computed in one pass.

---

## 3 · What shipped

### 3.1 Creator Home (`/studio`)

- **Daily performance** — views, watch-through, engagement and new followers for
  today against yesterday, from `post_views` / `post_watch_events` / `follows`.
  Each delta is a real difference between two real counts.
- **Weekly goal** — the creator sets an upload target; progress is counted from
  posts actually published in the current week. A goal nobody set shows the
  invitation to set one, not a fake target.
- **Latest work**, **recent followers**, **engagement overview**, **milestone
  progress** (the achievement nearest completion), **community updates** (the
  Lounge's unanswered questions), and **content suggestions** — every suggestion
  derived from a measured fact about this creator, listed in §3.7.
- **Customisation** — widget order, hidden widgets and pinned metrics, stored
  per creator. The catalogue is a pure module so the customiser can be a client
  component without dragging the server data layer into the bundle.

### 3.2 Content management (`/studio/content`)

One table over the creator's own posts with live filters (all / published /
scheduled / archived / pinned), search, and per-row actions: edit caption,
description, category and hashtags; change visibility; pin; schedule;
reschedule; archive; restore; delete. Bulk selection applies visibility,
archive and pin across a selection in one request.

Hashtags are edited as first-class chips even though there is no hashtag table:
this codebase stores them *inside the caption* and `lib/social/hashtags.ts`
parses them back out. The editor therefore reads tags out of the caption and
writes them back into it — the same representation search and trending already
read, so an edit here immediately affects real discovery rather than a parallel
field nothing consumes.

**Folders** are the existing Collections feature, surfaced here rather than
reimplemented. **Drafts** are `scheduled` posts with no date yet.

### 3.3 Per-post performance (`/studio/content/[id]`)

The retention curve is the substantial new measurement. `post_watch_events`
stores `watch_ms` (the playhead position when playback paused or ended) and
`duration_ms`. Bucketing `watch_ms / duration_ms` into deciles and taking the
survival function gives **the share of viewers who reached each tenth of the
video**, and the largest decile-to-decile fall is the **drop-off point**.

The honest caveat, stated in the UI and not only here: the sample is the
position at pause/exit, so a viewer who seeks backwards before leaving is
recorded at the lower position, and a looping rewatch registers as a second
event rather than a longer one. It is a real distribution of real playhead
positions — it is not frame-accurate attention telemetry, and it is not
labelled as such.

Also on the page: per-post traffic sources, hashtag performance (this post's
tags against the creator's own average), sound performance (plays and other
posts using it, via Part 7), and the reach breakdown that can be measured —
followers vs discovery, from `post_watch_events.source`.

### 3.4 Audience (`/studio/audience`)

- **Growth** — the `profile_snapshots` series through `computeTrends`. Fewer
  than two days of readings shows "not enough history yet", never a flat line.
- **Viewing times** — hour-of-day histogram of when this creator's content is
  actually watched, in the viewer's own local hours. This is the input to the
  assistant's upload-time suggestion, and it is the strongest genuinely-new
  audience signal in the Part.
- **Returning viewers** — identities with watch events on two or more distinct
  days, against one-time viewers.
- **Loyal fans / top supporters** — reused from the Lounge, plus watch-day
  counts.
- **Audience interests** — aggregated from followers' `user_interest_profile`
  rows, **suppressed entirely below a five-follower cohort** so no individual's
  private interest profile can be inferred from a creator's dashboard.

### 3.5 Content calendar (`/studio/calendar`)

A month grid of two real row types: scheduled posts (`posts.scheduled_at`) and
planned entries (`content_plan`). Drag is not simulated — rescheduling is an
explicit date change, which on touch is more reliable and on a screen reader is
the only workable interaction.

### 3.6 Collaboration

Invite a collaborator to a post by handle; they accept or decline; an accepted
collaborator is credited on the post and can open its analytics. Permissions are
enforced server-side on every read, not by hiding UI.

**Revenue sharing is not built**, and the reason is not scope: this platform has
no payout rails at all (`lib/platform/commerce-platform.ts` has carried
`{ id: "payouts", status: "planned" }` since it was written). Splitting a
revenue number that does not exist would be the fabricated-stat failure this
project has declined three times.

### 3.7 Creator Assistant

Named "Creator Assistant", not "AI Creator Assistant", per the standing naming
rule. It is the existing `/api/assistant` route with a creator-scoped `context`
string built server-side from measured facts only:

- best posting hour, from this creator's own watch-event histogram
- their strongest and weakest categories by views-per-post
- their own top hashtags by average views
- upload consistency and the current streak of active weeks
- retention average, and which post beat it by the most
- currently trending sounds (Part 7) and topics (Part 8)

The system prompt already instructs the model to treat `context` as data it may
cite and never exceed. Suggestions are prompts a creator can tap; nothing is
auto-applied to a post.

### 3.8 The three exclusives

**Creator Journey™** — the milestone timeline: first upload, first 100 views,
first follower, first 1,000 views, first viral post (the creator's own
best-performing post, named as such rather than against an invented global
threshold), verification, and each follower milestone actually crossed. Every
entry carries the **real date of the row that proves it**; a milestone with no
provable date is shown as a locked future step, not a guess.

**Creator Health™** — six pillars, scored 0–100: upload consistency, audience
satisfaction (engagement per view against the creator's own baseline),
community engagement (reply rate from the Lounge), follower growth, content
diversity (category spread), and **burnout risk**, which is deliberately
inverted — a *rising* upload rate combined with *falling* engagement is the
signal, and the recommendation is to slow down. This is the one metric in the
product designed to sometimes tell a creator to post less.

**Creator Universe™** — a force-free radial map of the creator's real
connections: their categories, their sounds, their collaborators, the
collections their work sits in, and the discovery surfaces their views come
from. Node size is a real magnitude (views, plays, follows); no node exists
without a row behind it. Rendered as inline SVG with a static layout — no
physics loop, so it costs nothing after paint and reduced-motion users get an
identical picture.

---

## 4 · Explicitly deferred, with reasons

Deferred here means **planned and blocked**, in this project's established
sense — not dropped, and not "out of scope".

- **Revenue overview, revenue sharing, revenue alerts.** No payout rails, no
  creator earnings table, no ledger. Blocked on the Creator Payout Service that
  `commerce-platform.ts` already lists as planned.
- **Audience demographics — age, country, city, language, device.** None of it
  is collected anywhere. Views are identified by `viewer_id` or a hashed IP and
  are never resolved to a location; there is no birthdate on `profiles`; there
  is no device or UA record tied to a view. This is the same wall Part 8 hit and
  documented, and the same answer: a country chart here would be invented.
  *Viewing times* is the honest slice of this that could be built, and was.
- **Community membership, community reach, community awards.** Still no
  `communities` table — the fourth consecutive Part to confirm it.
- **Challenges and challenge awards.** No hashtag-challenge data model.
- **Video upload/replace/trim and thumbnail replacement from Studio.** This is a
  *directory* platform: `posts` store metadata plus a source reference, and the
  media is re-extracted on demand. Replacing a thumbnail means adding an upload
  path and storage lifecycle that the post model does not have. Caption,
  hashtags, category, visibility, sound and schedule are all editable; the media
  itself is not, and pretending otherwise would produce a button that fails.
- **Duplicate a video.** `posts_publisher_source_uidx` makes a per-creator
  duplicate of the same source impossible by design (anti-spam, migration 0007).
  Duplicating would require either dropping that guard or writing a knowingly
  different source URL.
- **Series and playlists** as distinct types. Collections already model an
  ordered, named, shareable group; a third grouping noun with no behavioural
  difference is inventory, not a feature. Stated rather than silently skipped.
- **Pinned stories / pinned announcements / pinned community posts.** Pinning
  landed for posts and collections. Stories expire, announcements are an admin
  broadcast surface, communities do not exist.
- **Real-time push of dashboard numbers.** Deliberate, per §2.5.
- **Multi-region infrastructure, billion-creator scale, ML forecasting.**
  Architecture notes only; this app's real traffic does not warrant the spend,
  and building the harness for it would be unused inventory.

---

## 5 · Registries touched

A new table has to land in **two** catalogues or the suite goes red, by design:

- `lib/platform/data-domains.ts` — `creator_studio_prefs`, `content_plan`,
  `post_collaborators` into the `social` domain.
- `lib/portability/tables.ts` — all three exportable, owned by `user_id` /
  `user_id` / `user_id`.

Also updated: `lib/settings/registry.ts` (Studio entries, `status: "live"`) and
`lib/settings/categories.ts` — the `creator` category flips from `planned` to
`live`, because the note it carried is no longer true.

---

## 6 · Verification

`tsc --noEmit` clean · `next build` clean · full `vitest run` green, including
six new pure-function suites (retention, health, journey, universe, widgets,
hashtag performance). Migration `0140` applied and probed column by column —
`applied` and `fully applied` are not the same thing on this project.
