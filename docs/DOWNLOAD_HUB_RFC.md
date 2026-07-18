# Download Hub™ — Architecture RFC

**Status:** ACCEPTED · **Date:** 2026-07-18 · **Supersedes:** nothing · **Depends on:**
`docs/LIVING_CONTENT_PLATFORM_RFC.md` (Product Genome, Reality Ledger),
`lib/navigation/` (Navigation Engine).

---

## 0. Summary

The downloader is this product's front door — it is the origin of the codebase, the
source of essentially all organic traffic, and the only surface a first-time visitor
reliably touches. It is currently treated as a utility: a paste box on a marketing
page, plus a flat file list at `/downloads`.

This RFC turns it into a **workspace** and attaches a **Discovery Gateway** — a
contextual recommendation layer that turns one completed download into an entry point
to the rest of the ecosystem.

The central design problem is not UX. It is that **the brief names ten destination
products and eight of them do not exist.** §3 is the resolution, and it is the most
important section here.

---

## 1. What already exists

An audit before designing, because the largest risk in this brief is rebuilding
shipped systems under new names. The brief lists twenty backend services. Twelve are
already live:

| Brief's service | Reality |
|---|---|
| Download Gateway | `app/api/download/route.ts` — quota, rate limit, worker proxy, native-attachment streaming |
| Media Validation | `lib/validation.ts` (`downloadRequestSchema`) + `lib/platforms.ts` (`detectPlatform`) |
| Metadata Service | `app/api/metadata/route.ts` |
| Format Discovery | `server/services/ytdlp-service.ts` |
| Media Processing Queue | Railway worker, `lib/worker.ts`, `lib/concurrency.ts` (`BusyError`) |
| Cloud Integration | `server/services/store-media-service.ts` (R2) |
| Analytics | `server/services/analytics.ts`, `/api/track`, `/api/vitals` |
| Search Indexing | `lib/navigation/`, `lib/seo/seo-pages.ts` |
| Audit | `supabase/migrations/*` audit tables, `lib/admin/` |
| Moderation Support | `lib/moderation/` |
| Rate Limiting | `lib/rate-limit.ts` |
| Notification | `lib/notifications/`, `lib/push/` |
| Administrative Dashboard | `app/admin/` |

**Genuinely missing, and therefore the scope of this RFC:**

1. **Discovery Gateway** — post-download recommendation. Nothing exists.
2. **Recommendation Service** — no ranking layer of any kind.
3. **Learning integration** — no educational content system tied to media workflows.
4. **A Hub** — `/downloads` is a list; the downloader itself lives on marketing pages.
   The two have never been one workspace.
5. **Project Integration / Thumbnail / Subtitle / Translation services** — these are
   surfaces of products that do not exist (see §3).

Decision: **extend, never re-implement.** Every service above is referenced by its
existing module path in the code that follows. A new `lib/download-hub/` owns only
the four genuinely-new concerns.

---

## 2. The Hub

### 2.1 One workspace, two audiences

`/downloads` currently redirects signed-out users to `/login`. That is correct for a
*history* page and wrong for a *hub* — the hub's single most valuable visitor is the
anonymous first-timer who arrived from a search result.

The Hub therefore renders for everyone, with capability tiers rather than a wall:

- **Anonymous** — paste, fetch, choose format, download. Full core workflow. No
  history persistence beyond `localStorage` (`features/history/store.ts` already
  does exactly this).
- **Signed in** — synced history, cloud saves, publish, send-to-chat.
- **Pro** — batch, higher quota (`lib/api/download-quota.ts` already tiers this).

**Why not gate the hub behind login?** Because the download *is* the acquisition
event. Asking for an account before delivering the thing the visitor came for
inverts the funnel: it spends trust you have not yet earned. The Gateway (§3) asks
for the account *after* delivering value, which is when the ask is credible.

### 2.2 Layout

```
┌─────────────────────────────────────────────┐
│  Paste bar  (persistent, focus-on-mount)    │  ← the job to be done, always reachable
├──────────────────────────┬──────────────────┤
│  Preview + formats       │  Recent saves    │
│  ↓ (on completion)       │  (rail)          │
│  DISCOVERY GATEWAY       │                  │
│  ↓                       │  Learn           │
│  Supported services      │                  │
└──────────────────────────┴──────────────────┘
```

The paste bar stays mounted across the whole flow. Re-pasting is the most common
repeat action and it must never require scrolling back or a route change.

### 2.3 Performance

Constrained by the project's 2-second cold-entry budget (`memory/rule-2-second-page-budget.md`).

- The Hub shell is **static**. Recommendations are computed **client-side** from a
  build-time-static catalogue (§3.3) — no request, no waterfall, no un-static'ing of
  the route.
- The Gateway renders *after* a download completes, so it is never on the critical
  path for LCP and can be code-split behind an explicit `await import()`.
  (**Not** `next/dynamic` with `ssr:false` — that never resolves in this codebase and
  fails silently. See `memory/navigation-engine-2026-07-18.md`.)
- Learning content is static TS compiled from the authoring plane, consistent with
  the Living Content Platform's compile-to-static decision.

---

## 3. The Discovery Gateway — and the reality problem

### 3.1 The problem, stated plainly

The brief asks every completed download to recommend AI Studio™, Video Studio™, Photo
Studio™, Subtitle Studio™, Voice Studio™, Cloud™, Creator Workspace™, Communities™,
Marketplace™, and Learning Academy™.

Against the Product Genome (`lib/platform/modules.ts`), the actual position is:

| Destination | Genome | Route | Claimable |
|---|---|---|---|
| Communities | `community` | `/home`, `/explore`, `/reels`, `/messages` | **yes — live** |
| Creator Workspace (publish) | `community` | `/create/post`, `/create/reel`, `/create/story` | **yes — live** |
| Video / Photo / Subtitle / Voice Studio | `studio` | none | no — `concept` |
| AI Studio | `smart` | none | no — `internal` |
| Cloud | `cloud` | none | no — `concept` |
| Marketplace | — | none | no — undeclared |
| Learning Academy | — | none | no — this RFC builds it |

Eight of ten do not exist. A recommendation panel that presents them as available
would be the exact failure the Reality Ledger was built to prevent, on the highest-
traffic surface in the product, to users at their most trusting moment.

### 3.2 Resolution — availability is a property of the data, not a reason to cut scope

The prior instinct here would be to drop the eight and ship two. That is the wrong
call, and this project has explicitly overruled it before ("build everything, don't
leave anything behind"). The objection to an over-built spec is to a *rigid*
implementation, not to its scope.

So: **build the entire Gateway, with all ten destinations declared, and make
availability a field.**

```ts
type Availability =
  | "live"      // route exists, genome claimable → real action, present tense
  | "preview"   // partially real → labelled, honest about limits
  | "planned";  // does not exist → future tense, notify-me, never a fake CTA
```

`availability` is **derived**, never hand-written:

```
availability = genome.veracity.claimable && routeExists(action.href)
             ? "live"
             : genome.veracity.stage === "beta" | "alpha" ? "preview" : "planned"
```

Consequences that make this the right shape:

- The engine, ranking, analytics, admin config, and UI are built **once, in full**,
  exactly as briefed.
- Nothing false ships. `planned` destinations render in a visually distinct
  "Coming to Frenz" group, in future tense, with a notify-me that writes a real row.
- **When a product ships, it lights up with zero code change** — flip `claimable` in
  the genome, add the route, and the Gateway starts recommending it. The Studio work
  is then purely building Studio, not also wiring Studio into discovery.
- The falsity class is **structurally impossible**, not merely absent today: a test
  asserts no `planned` action can carry a present-tense CTA, so a future edit that
  tries it fails CI.

This is why the Reality Ledger was worth building. It converts "don't lie in
marketing copy" from a thing someone has to remember into a thing the type system
and the test suite enforce.

### 3.3 Ranking

Recommendations are scored, not ordered by a fixed list, because relevance is
contextual — the right next step after saving a 12-second silent TikTok is not the
right next step after saving a 40-minute podcast.

```
score = base × contextFit × availabilityWeight × noveltyDecay
```

- **`base`** — editorial priority, admin-configurable.
- **`contextFit`** — predicate over `DownloadContext` (kind, duration, platform,
  hasAudio, resolution, plan, signedIn, downloadCount). Subtitle actions score high
  on long spoken video and near-zero on a silent clip.
- **`availabilityWeight`** — `live` 1.0, `preview` 0.6, `planned` 0.25. Real things
  outrank aspirational ones, always, by construction.
- **`noveltyDecay`** — an action dismissed or already taken decays hard, so the panel
  does not nag. Persisted per-user; `localStorage` for anonymous.

At most **three** primary recommendations render, plus one learning link. The brief
asks for ten; showing ten is a menu, not a recommendation, and it would convert
worse than three. Ten remain *declared* — the engine ranks over all of them.

### 3.4 Honesty in the interaction

Every recommendation is dismissible, and dismissal is durable. The Gateway must
never block, delay, or gate the download it follows — the file is already saved
before the panel renders. This is non-negotiable: the moment discovery interferes
with the job the user came to do, the downloader stops being the acquisition channel
that makes the rest of this worth building.

---

## 4. Learning Academy

Educational content is the one part of the brief that is *entirely* deliverable
today — it needs no product that does not exist. It is writing.

- `lib/learning/` — lessons as typed data, each tagged with `platformIds`, `topics`,
  and a `relatedActionIds` link into the Gateway catalogue.
- Rendered at `/learn` and `/learn/[slug]`, statically generated.
- Surfaced contextually: the Gateway attaches the highest-scoring lesson for the
  download's context. Saved a YouTube video with speech → "How to add subtitles".
- Linked from every SEO page (`lib/seo/seo-pages.ts` already generates ~100), which
  turns thin duplicate-risk pages into a genuine topical cluster. This is the
  strongest SEO move in the whole brief: internal links from many keyword pages into
  a small set of deep guides builds exactly the topical authority the brief asks for.

Lessons must not describe unbuilt products as usable — the Reality Ledger's
`findFalseExistenceClaims` already scans marketing dirs, and `lib/learning/` is added
to its scan set.

---

## 5. Data model

New tables (migration `0087_download_hub.sql`):

| Table | Purpose |
|---|---|
| `download_events` | One row per completed download: platform, kind, duration bucket, plan, anonymised client. Feeds ranking + admin analytics. |
| `gateway_impressions` | Recommendation shown / clicked / dismissed. The denominator for acceptance rate. |
| `gateway_config` | Admin-editable `base` weights and per-action enable flags. Read at build/ISR, never per-request. |
| `learning_lessons` | Authoring plane for lessons (compiles to static TS, per the Living Content Platform decision). |
| `learning_progress` | Per-user lesson completion. |
| `product_waitlist` | Notify-me signups for `planned` destinations. Real rows — this is why a `planned` CTA is honest rather than decorative. |

**Privacy.** `download_events` stores no URL and no title — only platform, media kind,
and a duration bucket. The URL is the single most sensitive field in this product: it
identifies exactly what a person watched. It is already never logged; that property
must survive this RFC. Retention 90 days, then aggregate-only.

RLS: every table owner-scoped; `gateway_config` admin-write via `public.is_admin()`;
`download_events` service-role insert only.

---

## 6. Admin

Under `/admin/download-hub`:

- Recommendation weights + per-action enable/disable
- Gateway funnel: impressions → clicks → completions, by action
- Learning content editor (authoring plane → compile → deploy)
- Supported-platform matrix and per-platform health
- Feature flags, read from `gateway_config`

Everything configurable without a deploy, per the brief — with the deliberate
exception of `availability`, which is **derived from the genome and not editable**.
Making availability an admin toggle would reintroduce exactly the failure §3 exists to
prevent: a human could mark a nonexistent product "live". Some things should not be
configurable.

---

## 7. Responsible use

The Hub explains, per supported service, what is and is not permitted, and links to
`/dmca` and `/terms`. Post-download actions that *publish* (`create/post`, `reel`,
`story`) carry an explicit ownership affirmation, because publishing someone else's
media to a public profile is a materially different act from saving it for personal
use. The existing moderation and reporting pipeline (`lib/moderation/`) covers what
gets published.

This is a genuine product constraint, not legal ornament: the download → publish path
is the one place this product could systematically manufacture infringement at scale,
and the affirmation is where that is addressed.

---

## 8. Phasing

| Phase | Scope | State |
|---|---|---|
| 1 | Gateway engine, action catalogue, ranking, availability derivation, tests | **this change** |
| 2 | Hub workspace UI, Gateway panel, post-download wiring | **this change** |
| 3 | Learning Academy registry, `/learn` routes, SEO interlinking | **this change** |
| 4 | Migration `0087`, event recording, waitlist | **this change** |
| 5 | Admin dashboard, config-driven weights | **this change** |
| 6 | Lights up as Studio / Cloud / Smart ship — no Gateway code changes required | future |

---

## Appendix A — decisions and their reasons

**Why derive availability rather than declare it?** A declared field drifts from
reality the moment someone forgets to update it. A derived one cannot: it reads the
genome and the filesystem, both of which are the truth.

**Why cap at three recommendations?** A recommendation panel's job is to make one
next step obvious. Ten options is a directory, and directories get skipped.

**Why client-side ranking?** Server ranking would make `/downloads` dynamic and spend
the 2-second budget for a panel that renders after the download finishes. The inputs
(catalogue, weights) are static; only the context is local. Rank where the context is.

**Why is the download event recorded without the URL?** Because analytics value is in
the aggregate — platform, kind, duration — and the URL adds nothing to that while
adding the entire privacy liability.

**Why let anonymous users use the whole Hub?** The download is the acquisition event.
Gating it spends trust before earning it.
