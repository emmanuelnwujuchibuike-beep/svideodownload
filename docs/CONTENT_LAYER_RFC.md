# RFC: FrenzSave Content Layer (Published Downloads, Trending, Engagement)

Status: **DRAFT — awaiting approval**
Author: engineering
Depends on: migration `0006` (social identity), `0001` (`downloads`, `profiles`, `settings`)
Builds toward: public download pages, trending, business creator analytics

---

## 1. Goals & non‑goals

**Goals**
- Let a user **publish** a download as a public page on their profile, with title, description, platform source, original creator, category, and engagement (views, likes, saves, shares, comments).
- A **trending** system ranked by real engagement, resistant to bots/manipulation.
- Everything **respects the privacy engine** (migration `0006`) — privacy always overrides discovery/recommendations.
- **Anti‑spam & fairness** baked in from day one (not bolted on).
- Premium adds **convenience/professional value**, never degrades the free experience.

**Non‑goals (explicit, for legal safety)**
- **FrenzSave does NOT host or re‑host the media file.** We are a *directory + on‑demand re‑downloader*, not a media host. This preserves the site's existing posture ("we don't host content"). See §3.

---

## 2. The model (recommended): Directory / Aggregator

A "published download" is a **metadata record + commentary**, not an uploaded file.

```
User runs the normal downloader  ──►  optionally taps "Publish to profile"
                                          │
                                          ▼
                         posts row: title, description, source_url,
                         platform, original creator, category, thumbnail_url,
                         media_kind, duration … (NO media file stored)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                            ▼
     public page /p/<id>          feeds trending              creator profile /u/<handle>
   (preview, meta, engagement,   (engagement ranking,        (their published posts grid)
    Download button → re-fetch    anti-manipulation)
    from source on demand)
```

- **Preview/thumbnail:** store the source platform's `thumbnail_url` (hotlink) with a lazy `<img>` + fallback. Phase 2 option: proxy/cache a *small* thumbnail through our image route for reliability — still not the media file.
- **Download button:** re-runs extraction from `source_url` via the **existing** `/api/download` pipeline, on demand. No file is ever stored on our side. If the source is gone, the page shows "no longer available" but engagement/metadata persist.
- **"Creator":** two distinct people — keep them separate:
  - `publisher_id` → the FrenzSave user who published it (the followable "creator profile" on FrenzSave).
  - `source_author` → the original platform author (e.g. the TikTok handle), shown as attribution, **not** a FrenzSave account.

**Why this model:** matches link‑aggregators (Reddit/Pinterest pattern), keeps DMCA exposure low (we host metadata + a link, not the file), and reuses the entire existing extraction stack. The full‑UGC "upload & host the file" alternative adds storage cost, CDN, virus/abuse scanning, and serious copyright liability — rejected.

---

## 3. Legal / safety guardrails

- No media bytes stored. Re‑download is transient (stream from source, same as today).
- Every public page has: an **affiliate‑style attribution** to the source, a **Report** button, and the existing DMCA path.
- `posts.status`: `published | removed | under_review`. A report or DMCA flips to `under_review`/`removed` and the page 410s.
- Publishing requires an **account in good standing** (not suspended, trust_score ≥ threshold — see §7) to throttle abuse.
- Respect source robots/ToS where feasible; never expose private‑source URLs (the downloader already only handles public content).

---

## 4. Database design (migration `0007`)

Builds on existing tables; all RLS‑enforced; counters denormalized + trigger‑maintained for O(1) reads (same pattern as `follows`).

```
posts
  id              uuid pk
  publisher_id    uuid → auth.users (the FrenzSave creator)
  source_url      text                 -- original platform URL (extraction key)
  source_url_hash text                 -- sha256(normalized url) for dedupe
  platform        text                 -- tiktok | instagram | youtube | …
  source_author   text                 -- original author handle/name (attribution)
  media_kind      text                 -- video | image | audio
  title           text not null
  description     text
  category        text                 -- enum-ish: music, gaming, news, sports, …
  thumbnail_url   text
  duration_sec    int
  visibility      text default 'public'  -- public | followers | private
  status          text default 'published' -- published | under_review | removed
  is_nsfw         boolean default false
  -- denormalized counters (trigger-maintained)
  views_count     bigint default 0
  likes_count     int default 0
  saves_count     int default 0
  shares_count    int default 0
  comments_count  int default 0
  downloads_count int default 0
  -- trending (materialized; see §6)
  hot_score       double precision default 0
  created_at      timestamptz default now()

post_reactions          -- like / save (one row per (user, post, type))
  user_id, post_id, type ('like'|'save'), created_at   pk(user_id, post_id, type)

post_comments
  id, post_id, author_id, parent_id (nullable, 1-level threads),
  body, status ('visible'|'hidden'|'removed'), likes_count,
  created_at

post_views               -- raw, deduped per (viewer-or-iphash, post, day) for anti-inflation
  id, post_id, viewer_id (nullable), ip_hash, day, created_at
  unique(post_id, coalesce(viewer_id, ip_hash), day)

post_events              -- shares & download taps (lightweight funnel)
  id, post_id, type ('share'|'download'), viewer_id, ip_hash, created_at

reports                  -- content + user moderation (also usable for profiles)
  id, reporter_id, target_type ('post'|'comment'|'user'),
  target_id, reason, note, status ('open'|'actioned'|'dismissed'), created_at
```

**Indexes:** `posts(publisher_id, created_at)`, `posts(status, visibility, hot_score desc)`, `posts(category, hot_score desc)`, `post_reactions(post_id, type)`, `post_comments(post_id, created_at)`, partial unique on `post_views`.

**Counter triggers:** reactions/comments/views/events update the denormalized counts on `posts`; `downloads_count` increments when the public page's Download button is used.

**Dedupe:** `source_url_hash` + `publisher_id` unique → a user can't publish the same source twice (anti‑spam). Cross‑user duplicates are allowed but **collapsed in trending/feeds** (canonical by hash, highest‑scoring wins) so the feed isn't flooded with the same clip.

---

## 5. Public download page `/p/<id>`

Server‑rendered (SEO), the spec'd fields:

- Preview (lazy thumbnail), Title, Description
- Platform source (badge + link), Original creator (attribution), Publish date, Category
- Views · Likes · Comments · Saves · Shares (live counters)
- **Download button** → on‑demand re‑extract via `/api/download` (gated by the per‑plan daily cap already built; "if allowed" = publisher's `visibility` + not `removed`)
- **Creator profile** card + **Follow** button (reuses `FollowButton`)
- **Report** button (writes to `reports`)
- **Related downloads** (same category / same publisher / same source_author, privacy‑filtered)
- Schema.org `VideoObject`/`ImageObject` + `BreadcrumbList`; `noindex` when visibility ≠ public or publisher set `allow_indexing=false`.

Comments section: policy from `privacy_settings.comments_policy` (everyone / followers / off), 1‑level threads, optimistic UI, rate‑limited.

---

## 6. Trending system

**Signals** (per post, windowed): views, downloads, likes, saves, shares, comments, **growth rate** (velocity), **engagement quality** (saves+shares+comments weighted higher than passive views; unique‑viewer ratio).

**Score (Reddit/HN‑style time decay, computed incrementally):**

```
engagement = w_v·views_u + w_d·downloads + w_l·likes + w_s·saves
           + w_sh·shares + w_c·comments
quality    = (saves + shares + 2·comments) / max(1, views_u)   -- 0..~
velocity   = engagement_last_6h / max(1, engagement_total)
hot_score  = ( log10(max(1, engagement)) * (0.5 + quality) * (0.5 + velocity) )
             / pow(hours_since_post + 2, GRAVITY)
```

- `views_u` = **unique** views (from `post_views`), not raw — kills view‑spam.
- Weights `w_*` and `GRAVITY` live in `settings.trending` → **admin‑tunable**, no redeploy.
- Recompute: incrementally on engagement events (cheap) + a periodic sweep (cron) for decay. `hot_score` is materialized on `posts` so feeds are a simple `order by hot_score desc`.
- **Per‑creator/source diversity:** feed builder caps N consecutive posts from one publisher/source so trending isn't monopolized.

**Anti‑manipulation (see §7):** only **trusted, deduped, unique** signals feed the score; flagged/bot signals are excluded *before* scoring.

---

## 7. Anti‑spam & fairness

Defense in depth — prevent artificial engagement, bots, dupes, spam comments, fake accounts, recommendation abuse.

- **Account trust (`profiles.trust_score`)** — already present. Raised by: verified email, age, real engagement received, no reports. Lowered by: reports upheld, rapid follow/unfollow, mass identical comments. Publishing, commenting and *counting toward trending* require `trust_score ≥ threshold` (admin‑set).
- **Unique‑signal counting** — views/likes/etc. deduped per (viewer | ip_hash, day). Engagement from brand‑new / low‑trust / no‑history accounts is **shadow‑discounted** in trending (still shown to the actor, not counted).
- **Velocity / anomaly guards** — sudden spikes (e.g. 500 likes in 60s from fresh accounts) are rate‑limited and flagged for review; the existing Upstash limiter + per‑action daily caps apply to likes/comments/follows.
- **Duplicate uploads** — `(publisher_id, source_url_hash)` unique; cross‑user dupes collapsed in feeds.
- **Spam comments** — rate limit + simple heuristics (links, repetition, all‑caps, bl- list); `comments.status` hides without deleting; repeated offenders lose `trust_score`.
- **Fake accounts** — signup already needs email; add optional hCaptcha on publish/comment when trust is low; block disposable‑email domains.
- **Reports → moderation** — `reports` table + admin moderation queue (extends the admin dashboard); `under_review` hides from feeds but not from the owner.
- **Fairness** — recommendations rank by **quality** (saves/shares/comments/unique‑views) over raw volume; privacy & `show_in_recommendations=false` always exclude a user/post.

---

## 8. Privacy integration (always overrides)

- Post `visibility` (public/followers/private) gates the page + feed inclusion, enforced in RLS like profiles.
- `privacy_settings.show_in_recommendations=false` → excluded from trending/related/recommendations regardless of score.
- `allow_indexing=false` or non‑public visibility → `noindex`.
- A block hides both users' posts/comments from each other (reuse `blocks`).
- Activity visibility governs whether likes/saves appear on a profile.

---

## 9. Premium strategy (value, not friction)

Free stays fully usable: publish, get a public page, be discovered, engage. Premium adds **convenience & professional tools**, never gates core enjoyment:

- **Pro:** ad‑free pages, scheduled publishing, larger media in the result preview, more daily downloads (existing), custom profile theme/banner.
- **Business (Diamond):** **creator analytics** (views/engagement/traffic sources/top posts over time), bulk publish + API publish, priority extraction, verified‑style presence, multiple managed profiles. (This satisfies the "enhanced business tools and analytics" requirement on real content data.)

No dark patterns; no crippling free downloads to force upgrades.

---

## 10. API surface (sketch)

```
POST   /api/posts                 publish (auth, trust-gated, dedupe, rate-limited)
GET    /api/posts/:id             public read (privacy-filtered)
PATCH  /api/posts/:id             edit own (title/desc/category/visibility)
DELETE /api/posts/:id             remove own
POST   /api/posts/:id/react       like/save toggle           (rate-limited)
DELETE /api/posts/:id/react
POST   /api/posts/:id/share       record share
POST   /api/posts/:id/comment     comment (policy + rate-limited + heuristics)
GET    /api/posts/:id/comments    threaded read
POST   /api/report                report post/comment/user
GET    /api/feed?sort=trending&category=…   privacy-filtered, diversity-capped
GET    /api/u/:handle/posts       a creator's posts (privacy-filtered)
```
All admin‑guarded moderation endpoints under `/api/admin/moderation/*`; trending weights under `settings.trending`.

---

## 11. Phased rollout (each phase shippable + tested)

1. **Schema + publish** — migration `0007`, `POST /api/posts` (trust‑gated, dedupe), "Publish to profile" on the result card, public page `/p/<id>` (no engagement yet), profile posts grid.
2. **Engagement** — likes/saves/shares + counters + unique view tracking; comments (policy‑gated, rate‑limited).
3. **Trending + feed** — `hot_score`, `/api/feed`, `/explore` page, diversity caps, admin‑tunable weights.
4. **Anti‑spam hardening** — trust thresholds, anomaly guards, reports + admin moderation queue, shadow‑discounting.
5. **Business creator analytics** — dashboard on real post data; scheduled/bulk/API publish.

---

## 12. Decisions needed before build (Phase 1)

1. **Confirm the directory/no‑rehosting model** (§2) vs full file‑hosting UGC. *(Recommend: directory.)*
2. **Who can publish at launch?** Everyone in good standing, or premium‑only/allow‑list first (safer ramp)? *(Recommend: everyone with trust ≥ threshold.)*
3. **Default post visibility** — public or followers? *(Recommend: public, with an obvious privacy switch.)*
4. **Thumbnails** — hotlink source thumbnail (cheap) vs proxy/cache small thumbnails (reliable, slightly more infra). *(Recommend: hotlink in P1, add caching proxy in P2.)*
5. **Categories** — fixed taxonomy (music/gaming/news/sports/comedy/education/…) or free‑form tags? *(Recommend: fixed enum first.)*
6. **Comments at launch** or defer to Phase 2? *(Recommend: defer to P2 to keep P1 tight.)*
```
