# Frenzsave Academy™ — Architecture RFC

Status: **design, pre-implementation**
Supersedes nothing. Extends `LIVING_CONTENT_PLATFORM_RFC.md` and `DOWNLOAD_HUB_RFC.md`.

---

## 1. Position

The brief asks for a learning ecosystem: 11 schools, ~24 backend services, 21 database
domains, an AI assistant, unified search, an admin platform, and full SEO/a11y/analytics
coverage.

**A large fraction of it already exists.** The Living Content Platform (migrations `0085`,
`0086`) and the Download Hub (`0087`) were built over the last two days and already
provide the editorial, localization, media, versioning, audit and workflow planes this
brief re-specifies under new names. The Academy's job is to *become the reader-facing
surface over infrastructure that is already running*, not to build a parallel stack.

Building a second content system beside the first would give us two sources of truth for
the same prose, two editorial queues, two audit logs, and an admin platform where nobody
can say which screen is authoritative. That is the failure this section exists to prevent.

### 1.1 What already exists

| Brief calls for | Already shipped as | State |
|---|---|---|
| Editorial Workflow Service | `0086` `editorial_workflows`, `workflow_stages`, `content_workflow_runs`, `stage_results`, `editorial_comments` | live |
| Localization Service | `0086` `locales`, `translations` | live |
| Media Library Service | `0086` `media_assets`, `asset_usage` | live |
| Documentation Service (versioning) | `0085` `content_items`, `content_versions` | live |
| Audit Service | `0085` `content_audit_log` | live |
| Publication + scheduling | `0086` `publications`, `content_schedules` | live |
| Monitoring Service | `0086` `sync_findings`, `link_health` | live |
| AI Learning Service | `app/api/assistant/route.ts` + `lib/assistant/knowledge.ts` (Anthropic, rate-limited, zod-validated) | live |
| Lesson Service | `lib/learning/catalog.ts` + `lessons.ts`, 8 lessons | live |
| Knowledge Graph | `lib/content/graph/build.ts` — Experience Graph over Genome + SEO registry | live |
| Search (command surface) | `lib/navigation/registry.ts` — ⌘K nav engine | live |
| Administrative Dashboard | `app/admin/content`, `app/admin/download-hub` | live |
| Structured data | `lib/seo/json-ld.ts`, `lib/seo/seo-pages.ts` | live |
| Developer portal | `app/(marketing)/developers`, `lib/sdk/` | live |
| Notification Service | `lib/notifications/*` | live |

### 1.2 What genuinely does not exist

Schools (campus taxonomy) · courses · curricula · learning paths · progress tracking ·
bookmarks · notes · achievements · assessments · structured FAQ · glossary · Help Center ·
unified Academy search index · recommendations · learning analytics · certification.

**These are the build.** Everything in §1.1 is integration.

---

## 2. The Reality Ledger gate

`lib/content/reality-ledger.ts` makes it mechanically impossible to ship copy claiming a
product exists when it doesn't. It has already caught fabricated landing stats and 16
marketed-but-unbuilt products. It applies here, and it bites hard.

### 2.1 School audit against the Product Genome

Genome state today (`lib/platform/modules.ts`): `download` live/claimable, `community`
live/claimable, `studio` concept/**not** claimable, `cloud` concept/**not** claimable,
`smart` internal/**not** claimable, `admin` live but internal.

| School | Teaches | Verdict |
|---|---|---|
| Creator School™ | download + publish + posts/reels/stories | **real** |
| Community School™ | `community` (live) | **real** |
| Security & Privacy School™ | account security, privacy, hidden accounts, blocking | **real** |
| Developer School™ | `/developers` + `lib/sdk` | **real** |
| Editing School™ | Creation Studio exists; AI editing does not | **partial** |
| Business School™ | Business Workspace™ | does not exist |
| Marketplace School™ | Marketplace™ | does not exist |
| AI School™ | AI Studio™ | does not exist |
| Cloud School™ | Cloud™ | does not exist |
| Professional School™ | Professional Workspace™ | does not exist |
| Enterprise School™ | Enterprise | does not exist |

**Roughly 5 of 11 schools teach software that exists.**

### 2.2 Why this is stricter than the Download Hub

The Download Hub resolved the same tension by declaring all destinations and deriving
availability — a planned destination renders as a labelled "SOON" chip. That was
acceptable because a Gateway action is *a link*.

**A lesson is not a link. A lesson is prose asserting how something works.** Writing
"Cloud School™: how to sync your library across devices" for a product in `concept` stage
is not an optimistic label — it is documentation for software that does not exist. Three
concrete harms, not stylistic ones:

1. **It poisons the assistant.** `ASSISTANT_SYSTEM_PROMPT` is the support bot's source of
   truth and already says *"Never invent features that aren't described below."* Feeding
   Academy prose into it would make the bot confidently instruct users to click buttons
   that aren't there.
2. **It poisons SEO.** `Course`/`HowTo`/`FAQPage` JSON-LD teaches Google and AI crawlers a
   *machine-readable entity*. Publishing structured data for imaginary capabilities is
   entity-authority damage that outlives the fix.
3. **It generates support load, not deflection.** The brief measures "support deflection";
   fabricated how-tos invert that metric.

### 2.3 The rule

> **A school may be DECLARED. A curriculum may be OUTLINED. A lesson BODY may only exist
> for a claimable capability.**

Availability is **derived from the Genome, never declared in the school record** — same
mechanism as `resolveAvailability()` in `lib/download-hub/recommend.ts`, which fails closed
to `planned` for unknown ids. Tense follows availability. When `studio` flips to
`claimable`, AI School™ lights up **with zero code change** — the lessons get written, the
gate stops blocking them, the nav entry stops rendering "soon".

This is the pattern the owner approved for the Download Hub, extended one notch tighter
because the artefact is prose rather than a link. Enforced in
`lib/academy/academy.test.ts` in CI, not by reviewer discipline.

---

## 3. Two planes

The single most important structural decision, and it falls straight out of the caching
work just completed.

```
┌─────────────────────────────────────────────────────────────┐
│ CONTENT PLANE — public, identical for everyone              │
│ schools · courses · lessons · FAQ · glossary · help · docs   │
│ → compiled to static TS → force-static → CDN → SEO          │
│ → 0ms origin cost, counts nothing against the 2s budget     │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ PERSONAL PLANE — per-viewer, private                        │
│ progress · bookmarks · notes · achievements · assessments   │
│ → Postgres + RLS → private, no-store → never prerendered    │
└─────────────────────────────────────────────────────────────┘
```

**These must never merge.** A lesson page that reads progress server-side becomes dynamic,
loses its CDN entry, and drops from `PRERENDER` to a Paris origin round-trip for an
Africa-primary audience — reintroducing exactly the 799–4752ms TTFB failure just fixed on
`/`. Worse, caching a page that embedded someone's progress would serve one user's state
to another.

**Resolution:** the lesson document is static and identical for everyone; the personal
layer hydrates on the client from `/api/academy/progress`. Progress is a *decoration*
(checkmarks, a resume button, a path percentage), never part of the document. This is the
same split that keeps `/` static while `SiteHeader` still knows who you are.

Consequence for personalization: "adaptive pathways" adapt **on the client**, over a static
corpus. The recommendation *inputs* are personal; the recommendation *engine* is a pure
function shipped in the bundle. No server round-trip, no cache poisoning, works offline.

---

## 4. Domain model

New tables (migration `0088_academy.sql`). Existing content/editorial tables are reused
verbatim — the Academy stores no second copy of prose, workflow or translation state.

**Content plane** (authoring in Postgres, compiled to static TS — owner's established
"DB = authoring plane only" model):
- `academy_schools` — id, slug, name, product_id (FK into Genome), summary, order
- `academy_courses` — school_id, slug, title, level, estimated_minutes, outcomes
- `academy_lessons` — course_id, slug, title, body ref → `content_items`, minutes
- `academy_paths` / `academy_path_steps` — the 10 briefed journeys, ordered, cross-school
- `academy_topics` — taxonomy shared with the Experience Graph
- `academy_faqs` — question, answer, school_id, product_id
- `academy_glossary` — term, definition, aliases, related terms
- `academy_help_articles` — kind: getting-started | troubleshooting | migration | release-note | known-issue | best-practice
- `academy_assessments` / `academy_questions` — knowledge checks

**Personal plane** (never compiled, always RLS'd, always `no-store`):
- `academy_progress` — user_id, lesson_id, state, completed_at, seconds_spent
- `academy_bookmarks`, `academy_notes` — user_id scoped
- `academy_achievements`, `academy_user_achievements`
- `academy_attempts` — assessment attempts, score, answers
- `academy_certificates` — **future-ready, no issuing logic** (brief says "if offered in the future"; issuing a credential nobody validates is a Reality Ledger violation)

**Analytics** (aggregate only, no raw URLs, hashed identifiers — the `0087` precedent):
- `academy_events` — bucketed, no free-text, 90-day retention
- `academy_search_queries` — query, result_count, clicked_rank → search quality

RLS on every personal table; `user_id = auth.uid()` and nothing wider. No table stores a
lesson URL against an identifiable user beyond what progress inherently requires.

---

## 5. Services map

All 24 briefed services, resolved:

**Reuse as-is (12):** Editorial Workflow · Localization · Media Library · Documentation
(versioning) · Audit · Notification · Monitoring · Search Indexing (extend nav registry) ·
Administrative Dashboard · Knowledge Base (content_items) · AI Learning (assistant route) ·
Analytics (vitals + events pipeline).

**Build new (12):** Learning Management · Course Registry · Lesson Service (extend
`lib/learning`) · Curriculum · Help Center · Developer Documentation · FAQ · Progress
Tracking · Achievement · Recommendation (Adaptive Learning Intelligence™) · Assessment ·
Certification (schema only, future-ready).

Module layout, following the existing `lib/<domain>/` convention:

```
lib/academy/
  types.ts        schools, courses, paths, availability
  schools.ts      campus registry (metadata only — bundle discipline)
  courses.ts      curriculum
  lessons.ts      bodies (extends lib/learning, does not replace it)
  paths.ts        the 10 journeys
  glossary.ts · faq.ts · help.ts
  recommend.ts    pure client-safe scoring
  progress.ts     personal plane client
  search.ts       unified index builder
  academy.test.ts Reality Ledger + pairing gates
```

**Bundle discipline is load-bearing here.** `lib/learning` already splits `catalog.ts`
(metadata) from `lessons.ts` (prose) because importing titles pulled every word of every
lesson into `/downloads` — 10 kB of text nobody would read. The Academy is an order of
magnitude more prose. Same split, enforced by test: metadata modules may never import a
body module.

---

## 6. Unified search

The brief wants search across 13 corpora. We already have two indexes: the ⌘K navigation
registry and the SEO page registry, joined by the Experience Graph.

**Build-time static index, not a search service.** A hosted search backend adds a network
hop, an API key, a cost centre and an outage mode to a corpus of a few thousand short
documents. The whole index compresses to well under 100 kB, ships as a static JSON chunk,
loads once, and then searches at zero latency — offline, on a bad Lagos connection, with no
origin round-trip. It also cannot leak, because it contains only public content.

The personal plane never enters the index. "Resume where you left off" is a client-side
join against local progress, not a search result.

Ranking: exact title > alias/synonym > heading > body, weighted by corpus (help beats blog
for a troubleshooting query), demoted by availability (a `planned` school ranks below a
live one). Query logs feed `academy_search_queries` for the "monitor search quality"
requirement — zero-result queries are the editorial backlog.

---

## 7. AI Learning Service

`app/api/assistant/route.ts` already exists and is well-built: zod-validated, rate-limited,
30s timeout, 12-turn cap, key server-side only, graceful 503 when unconfigured. **It is
extended, not replaced.**

Three changes:

1. **Knowledge base becomes generated.** `ASSISTANT_SYSTEM_PROMPT` is hand-maintained prose
   that will drift from the Academy the day after launch. It gets compiled from the same
   corpus the Academy renders — one source of truth, so the bot cannot describe a feature
   the docs contradict.
2. **Retrieval over the static index.** The relevant lesson/FAQ/glossary entries are
   selected client-side from §6's index and passed as context. No vector DB, no embedding
   service, no second infrastructure — the corpus is small enough that lexical retrieval
   over a shipped index is sufficient and free.
3. **Provenance is mandatory.** The brief requires distinguishing AI guidance from official
   documentation. Assistant answers render in a visually distinct surface, cite the lesson
   they drew from, and never render as documentation. The system prompt's existing
   *"Never invent features"* rule is reinforced by the §2.3 gate: unclaimable products are
   excluded from retrieval entirely, so the model is never *able* to describe them.

Cost control: `claude-haiku-4-5` default (already configured), retrieval keeps context
small, rate limiter already in place.

---

## 8. SEO & AI discovery

Every Academy document is static and server-rendered — the precondition for all of it.

- `Course`, `LearningResource`, `HowTo`, `FAQPage`, `BreadcrumbList`, `DefinedTerm`
  (glossary) JSON-LD, emitted from the same records that render the page so machine- and
  human-readable copy cannot drift. **Only for claimable capabilities** (§2.2).
- Emitted **per page**, never in the root layout — the landing page already learned this
  lesson; shipping graph bytes on every signed-in app page costs everyone for nothing.
- All JSON-LD via `lib/seo/json-ld.ts`'s `jsonLd()` helper, never raw
  `JSON.stringify` — four raw blocks were a stored-XSS vector when admin-DB-sourced, fixed
  during Download Hub. Academy content is admin-authored, so this is the same class of risk.
- Internal linking from the Experience Graph: school ↔ course ↔ lesson ↔ product ↔ SEO page.
  This finally connects the learning corpus to the ~148 downloader pages, which is the
  single largest topical-authority win available.
- Glossary terms become entity anchors; `DefinedTerm` is what makes a knowledge graph legible.

---

## 9. Performance

The 2-second budget is the owner's #1 rule and outranks features here.

- Content plane is `export const dynamic = "force-static"` — **declared, not inferred**.
  Vercel built `/` dynamic while local built it static, silently costing 800–4700ms. Every
  Academy route declares its contract.
- ISR via the root `revalidate` (lowest in tree wins — set in `app/layout.tsx`, not here).
- Lesson prose is text: no LCP image, no JS-gated opacity. The `/login` lesson applies —
  **never wrap an LCP element in `motion.div` with `initial={{opacity:0}}`**, because
  framer-motion writes that into SSR HTML and LCP then waits for hydration (8–11s measured).
- Progress hydration is `requestIdleCallback`-deferred and never blocks paint.
- Offline reading: the SW already caches `/`; Academy documents are static and cacheable.
  Any new SW rule must cover `/sw/:path*` as well as `/sw.js` — submodules were silently
  cacheable for 2h.
- Low bandwidth: text-first, media lazy, no autoplay, `prefers-reduced-motion` respected.

---

## 10. Accessibility

Not a checklist item — assessments and interactive demos are where a11y usually breaks.

Semantic headings and landmarks · full keyboard operation for every interactive demo,
knowledge check and code sample · visible focus · captions **and** transcripts on every
video (transcript doubles as search corpus and low-bandwidth alternative) ·
`prefers-reduced-motion` honoured by all campus motion · high-contrast safe tokens ·
RTL-ready layout using logical properties · assessments announce state changes via live
regions and never rely on colour or drag-only interaction.

---

## 11. Admin

Extends `app/admin/content`. No second admin surface.

Create/edit courses, lessons, FAQs, glossary, help articles · review AI-generated drafts
(existing editorial workflow: draft → review → approve) · schedule publication (existing
`content_schedules`) · manage localization (existing `locales`/`translations`) · view
learning analytics · configure recommendation weights · monitor search quality via
zero-result queries.

"Everything configurable without code changes" is satisfied by the established model:
**Postgres is the authoring plane; approved content compiles to static TS.** Editors never
touch code, readers never wait on a DB read. Both halves of the brief's demand are met by
the compile step rather than by trading one for the other.

---

## 12. Phasing

1. **Campus foundation** — types, school registry, availability derivation, Reality Ledger
   gate + tests. Nothing user-visible ships false.
2. **Curriculum & lessons** — courses, real lesson bodies for the ~5 real schools, migrate
   `lib/learning`'s 8 lessons in without breaking `/learn/[slug]` or the Download Hub rail.
3. **Campus UI** — `/academy`, school homepages, course and lesson pages, static + a11y.
4. **Help Center, FAQ, glossary** — including `DefinedTerm` entity anchors.
5. **Unified search** — static index over all corpora, ⌘K integration.
6. **Personal plane** — `0088` migration, progress, bookmarks, notes, resume.
7. **Adaptive Learning Intelligence™** — client-side recommendations, pathways.
8. **Assessments & achievements** — knowledge checks, accessible by construction.
9. **Assistant integration** — generated knowledge base, retrieval, provenance UI.
10. **Admin, analytics, localization wiring.**
11. **Certification** — schema only, future-ready, nothing issued.

---

## 13. Decisions register

| Decision | Rationale |
|---|---|
| Extend `0085`/`0086`, don't rebuild | Two content systems = two sources of truth, two editorial queues, ambiguous admin |
| Lesson bodies gated on claimability | Prose asserts behaviour; fabricated docs poison the assistant, SEO entities and support load |
| Availability derived, never declared | Schools light up with zero code change; fails closed for unknown ids |
| Two planes, never merged | Static content = CDN + SEO; personal = private. Merging breaks caching *and* privacy |
| Client-side personalization | Keeps documents static; recommendation engine is pure and shipped |
| Build-time static search index | No hop, no key, no outage, no leak; corpus is small |
| Extend the existing assistant | Already secure and rate-limited; generate its knowledge to stop drift |
| Certification schema-only | Issuing an unvalidated credential is a Reality Ledger violation |
| Metadata/body module split | Established: title imports pulled 10 kB of prose into `/downloads` |
