# Feature 21 — Part 2: Global Navigation, Discovery & Wayfinding

**Part 2 deliverable: architecture and design. No implementation code.**
Status: awaiting owner review. Date: 2026-07-17.
Reads with `docs/FEATURE_21_LANDING.md` (Part 1) — the pillar config, lane system
and semantic graph designed there are the substrate this navigation renders from.

---

## 1. The finding that shapes everything else

Navigation is a *view* of the site. It can only be as deep as the site is real.

I checked every item in the Product Mega Menu™ spec against the codebase:

| Group | Spec'd | Exists | Reality |
|---|---|---|---|
| **Communication** | 5 | **4** | Messaging, Stories, Reels, Notifications real. Communities does not exist. |
| **Creation** | 5 | **1** | Photo Editor real. AI Studio, Video Editor, Music, Creator Platform do not exist. |
| **Business** | 4 | **0** | Marketplace, Professional Network, Business Platform, Enterprise — none exist. |
| **Identity** | 4 | **0** | Avatar Studio, Activity Rank, Reputation, Time Capsule — none exist. |
| **Infrastructure** | 4 | **2** | Downloads, Search real. Cloud, Connected Devices do not exist. |
| **Total** | **22** | **7** | |

A five-column mega menu built literally to spec is **15 dead links and two entirely
empty columns.**

This is worse than the Part 1 pillar problem, for a specific reason: **nav links are
the primary signal Google uses to infer site structure.** A global nav that links
sitewide to 15 pages describing products that don't exist is the textbook shape of
doorway content — and because it's *global*, it puts that signal on every page of
the domain rather than one. The same is true for the AI-search goal in the spec:
answer engines read navigation to learn what a company offers, then tell users
confidently that Frenz has a Marketplace.

**The design consequence is not "build less."** It's that navigation renders from
the Part 1 graph, filtered by lane. The menu is a projection of `config/pillars.ts`,
so it shows exactly what's real, and **fills in automatically the day a product
ships** — one config edit, no nav surgery. That is precisely the "unlimited future
products" scalability the spec asks for, delivered honestly.

**What the mega menu looks like on day one:** two well-populated groups
(Communication, Infrastructure), one thin one (Creation), and no Business/Identity
columns. That is a *good* menu. Four confident products beat 22 links where 15 go
nowhere, and it matches the spec's own stated philosophy — "clarity over clutter,"
"every click should reduce uncertainty." A dead link is uncertainty.

The same filter applies to Solutions™ (only *For Creators* and *For Developers* have
real substance today — "For Businesses" has no Business Platform to describe) and to
the footer (Status, Careers, Press, Investors, Brand Assets, Accessibility, Help
Center, Learning Center, Roadmap are all pages that do not exist).

---

## 2. Hard constraint: the mega menu must be a portal, not a header child

**This repo has already been bitten by this exact bug and fixed it.**

`components/layout/site-header.tsx:48` puts `backdrop-blur-xl` on the `fixed`
header. Per the CSS filter-effects spec, `backdrop-filter` — like `filter` and
`transform` — **establishes a new containing block for `position:fixed`
descendants.** Any fixed-positioned panel inside that header resolves its
coordinates against the *header's* box, not the viewport.

That is not theoretical here. `app/(app)/messages/layout.tsx` put `lg:backdrop-blur-xl`
on `<main>`, and the message-actions menu — which computed `left`/`top` clamped
against `window.innerWidth`/`innerHeight` — rendered off-screen: an intended
`left:921px` landed at `left:1554px` in a 1280px viewport. The owner reported it
independently ("the side dotted toggle... cut out by the chat container"). It was
fixed by rendering through `createPortal(..., document.body)`.

**So: the mega menu, the search overlay, and the mobile panel all render via
`createPortal(document.body)`.** This is already the house convention — 10+ files
use it (`user-menu.tsx`, `create-action-sheet.tsx`, `chat-appearance-sheet.tsx`,
`notification-card.tsx`, …). A `<GlassPanel>` portal primitive should be the shared
base so this is structural rather than remembered.

**Secondary reason, independent of positioning:** a blurred panel nested inside a
blurred header samples an already-blurred backdrop. The glass reads muddy and wrong.
Portaling to `body` fixes the aesthetics and the geometry with one decision.

---

## 3. Global Search: a build-time static index, not `/api/search`

`/api/search` cannot serve this, and it's worth being precise about why rather than
bolting marketing content onto it. It is the **social** search: `searchAll(q, type,
viewerId)` over people and posts, auth-aware (`getRequestUser`), `force-dynamic`,
`Cache-Control: private, no-store`. Marketing search wants products, docs, blog,
tutorials, pricing, help — a different corpus, anonymous, identical for everyone,
and cacheable forever.

**Design: generate `search-index.json` at build time from the Part 1 graph.**

Because pillars, clusters and blog posts are already *data* (`config/pillars.ts`,
`config/seoPages.ts`, `lib/seo/blog.ts`), the index is derivable at build. Ship it
as a static asset:

- **Zero network latency** on query — no round trip to `cdg1` from an
  Africa-primary audience. This is the 2-second rule applied to search.
- **Edge-cached, immutable, hashed.** Free at any traffic level.
- **Works offline** — a real win given the PWA.
- **No backend, no index infrastructure, nothing to operate.**
- Fetched lazily on first search intent (focus/`⌘K`), never in the initial bundle.

**"Natural language" honestly.** The spec wants "I want to edit videos" → Video
Editor. That is an **intent alias table** in config — curated phrasings and synonyms
mapped to pillar ids, plus token ranking. It is not an LLM, and calling a synonym
table AI in the code would be its own small fabrication. The branding can say
whatever marketing needs; the module stays legible. Curated aliases also *beat* a
model here: they're deterministic, reviewable, instant, and free.

**Scale threshold, stated rather than hand-waved.** A client-side index is right
while the corpus is small — roughly <500 documents / a few hundred KB gzipped. It
does not scale to "unlimited documentation." When the corpus crosses that, the
index moves server-side behind the same interface. Designing the interface now
means that's a swap, not a rewrite. Nobody should pretend a shipped JSON blob scales
forever.

---

## 4. The five engines (Part 2)

All five are views over the **one** graph from Part 1. That is the point: there is a
single source of truth, and navigation, search, breadcrumbs, related links, sitemap
and schema are all derived from it. Anything else drifts.

### Discovery Navigation Engine™ — nav as a projection of the graph
Renders header, mega menu, footer and mobile panel from `config/pillars.ts` +
`config/graph.ts`, filtered to `lane === "live"`. Each item carries icon, one-line
description, and use cases from the pillar config — so the menu teaches, and the
copy is the same copy the pillar page uses. One source, no divergence.

### Universal Wayfinding™ — breadcrumbs + "you are here"
Breadcrumbs derive from graph ancestry. **Current state: breadcrumbs exist on
exactly one page** — `app/[downloader]/page.tsx` hand-rolls a two-item
`BreadcrumbList`. Every other page has none. Graph-derived breadcrumbs fix that
sitewide, with `BreadcrumbList` schema for free.

### Intent-Based Navigation™ — Solutions, gated on reality
Audience-first entry points (For Creators, For Developers today). Each solution is a
curated ordering of `live` pillars, so a solution page cannot reference a product
that doesn't exist. Reuses the Part 1 journey layer — client-only, post-paint,
sessionStorage, no PII, no consent banner. **Never reorders the primary nav**: a nav
that moves between visits destroys the spatial memory that makes navigation feel
invisible. Adaptation belongs in the "explore next" rail, not the chrome.

### Semantic Navigation Framework™ — structured data + a11y
`SiteNavigationElement` on the primary nav, `BreadcrumbList` per page, real `<nav>`
landmarks with `aria-label`, descriptive anchor text (never "Learn more" — it
carries no information scent for users *or* crawlers).

**Schema consistency gap.** `lib/seo/json-ld.ts` exists specifically to escape
`<`/`>`/`&` before JSON-LD reaches a `<script>`, because raw `JSON.stringify` there
is a stored-XSS vector. It's used on `/p/[id]` and `/u/[handle]` — correctly, those
are the pages with user-controlled titles and bios. But `app/[downloader]/page.tsx:121`,
`app/blog/[slug]/page.tsx:69` and `app/layout.tsx:199` hand-roll `JSON.stringify`.
**Not exploitable today** — all three serialize static config. But nav/breadcrumb
schema is about to land on every page, and the moment any of it touches
user-controlled data the vector is live. Route all schema through `jsonLd()`; the
graph-derived emitter makes that automatic and closes the class.

### Global Discovery Graph™ — already designed in Part 1 §5
Same `config/graph.ts`, same enforced invariants (no orphans, no dangling edges,
`live` pillars ≤2 clicks from `/`, reciprocal links, every `live` pillar has a
resolvable `productHref`). Part 2 adds two: **every nav item resolves to a real
route**, and **every nav item's target is `lane === "live"`**. Both are build-time
tests. A dead link in the global nav should fail CI, not ship.

---

## 5. Header states

The spec lists ten states. Several collapse, and saying so is the design:

| Spec state | Design |
|---|---|
| Initial / transparent | Real. Top-of-page, no border. |
| Scroll-aware / condensed | **One state, not two.** Threshold-toggled class at ~64px, not scroll-linked interpolation (§7). |
| Search-focused | Real. Portal overlay, `⌘K` / `/`. |
| Mega menu open | Real. Portal panel (§2). |
| Logged-in / Guest | **Already exists** — `site-header.tsx` is `"use client"` and resolves via `useUser()`. Keep. This is also what lets `/` be static (Part 1 §4). |
| Install PWA | Real, conditional on `beforeinstallprompt`. Never on iOS (no such event) — must not render a button that can't work. |
| Offline | Real, cheap: `navigator.onLine` + a listener. Meaningful for a PWA. |
| Accessibility state | **Not a state.** Accessibility is a property of all nine others. Modelling it as a state is how it becomes a mode nobody tests. §8. |

**Login copy stays** *"login or create account to access all features"* (owner,
2026-07-16).

---

## 6. Structure

**Primary nav — 9 items is not premium simplicity.** The spec asks for Products,
Solutions, Creators, Business, Developers, Enterprise, Learning, Pricing, About —
while also asking for "clarity over clutter." Those fight, and four of the nine
(Creators, Business, Enterprise, Learning) have no pages behind them. Recommended:

```
Products ▾   Solutions ▾   Developers   Pricing   Blog        [Search] [Theme] [Sign in] [Get started]
```

Five primary items, each real. Creators/Business/Enterprise/Learning enter as
Solutions entries or top-level items **when they have something to point at.** The
current nav (`Home / Features / Community / News / Download`, with Features pointing
at the `/#platforms` anchor) is downloader-era and gets replaced.

**Footer** = the graph's full link surface, categorized. The downloader column stays
exactly as-is — it is doing real SEO work. Status/Careers/Press/Investors/Brand
Assets/Accessibility are added when those pages exist, not before.

**Mobile.** The spec says "avoid giant hamburger menus" — we currently have one
(`site-header.tsx:103-246`, a 62%-width right drawer). Redesign: search-first, large
targets, recently-visited (sessionStorage), popular products, install prompt. Gesture
support and swipe-to-close are real asks and belong on the shared portal primitive.

---

## 7. Performance — where the spec fights itself

**"Glassmorphism, adaptive transparency, dynamic blur, subtle reflections" +
"120 FPS" + "battery efficiency" + an Africa-primary audience on mid-range Android
are not simultaneously satisfiable.** `backdrop-filter` is among the most expensive
compositing operations there is; on a `fixed` header it re-rasterizes as content
scrolls beneath it.

Honest resolution:

- **Never animate blur radius.** Animating `backdrop-filter` re-rasterizes every
  frame. Transition `opacity`/`background-color` between two fixed blur values.
  The repo's motion tokens are already GPU-safe (transform+opacity only) — inherit
  them, don't invent.
- **Threshold, not scroll-linked.** Toggle a class at a scroll threshold. A
  scroll-linked blur interpolation is a jank generator for an effect nobody
  perceives.
- **Keep the existing `supports-[backdrop-filter]` fallback** already in
  `site-header.tsx:48` — that pattern is correct and should extend to the panels.
- **Menu previews are the real risk.** "Preview animation" × 22 items above the fold
  would be the single heaviest thing on the marketing site. Previews are static
  posters by default, lazy, decoded on hover/focus *intent* (~100ms delay), never on
  menu mount, and skipped entirely under `prefers-reduced-motion` and Save-Data.
- **"120 FPS" is the wrong target** and worth naming: most of the audience is on
  60Hz hardware. The real target is *never miss a frame at the device's refresh
  rate*. A 120 number on a budget Android is a claim about nothing.

**Instant menu opening** means the panel is in the client bundle and mounts without
a fetch. Nav data is static config, so this is free — no round trip, ever.

---

## 8. Accessibility

Menus follow the **WAI-ARIA menu-button / disclosure pattern**, not a hover trap:
full keyboard operation, `Escape` closes and restores focus to the trigger, focus is
trapped in the open panel, arrow-key traversal, `aria-expanded` on triggers, real
`<nav aria-label>` landmarks. Hover-only mega menus are unusable by keyboard and
touch alike — open on click/Enter, hover is an *enhancement*.

The global `prefers-reduced-motion` guard in `globals.css` already neutralizes
animation app-wide; every nav transition inherits it. WCAG AA is the gate; AAA is a
target where type and contrast allow, and claiming blanket AAA would be a claim we
can't hold.

**RTL finding — concrete.** The spec asks for RTL. The current drawer is built from
**physical** properties: `site-header.tsx:112` uses `right-0` and `border-l`, so in
an RTL locale it would slide in from the wrong side with its border on the wrong
edge. The rebuild uses **logical** properties (`inset-inline-end`,
`border-inline-start`, `ps-`/`pe-`). Cheap now; a full re-audit later. There is no
i18n layer in the repo yet, so RTL is *designed for* and not yet exercised — worth
stating plainly rather than implying it's handled.

---

## 9. Build order

Slots after Part 1's foundation — the nav renders from the graph, so the graph is
the dependency.

| # | Slice | Depends on |
|---|---|---|
| 1 | `<GlassPanel>` portal primitive (§2) + a11y menu behaviour (§8) | — |
| 2 | Graph-derived breadcrumbs sitewide + `BreadcrumbList` via `jsonLd()` | Part 1 graph |
| 3 | Header rebuild: states (§5), 5-item nav (§6), logical properties (§8) | 1 |
| 4 | Product mega menu — Communication + Infrastructure only | 1, 3, pillars |
| 5 | Mobile panel: search-first, recents, install | 1, 3 |
| 6 | Build-time search index + `⌘K` overlay (§3) | Part 1 graph |
| 7 | Solutions (For Creators, For Developers) | pillars |
| 8 | Footer as full graph surface | Part 1 graph |
| 9 | Intent ranking on "explore next" | 6, journey layer |

Slice 1 is independently useful — it's the shared fix for a bug class this repo has
already hit once.

---

## 10. Open questions

**Still open from Part 1, one of them blocking:**
1. **The fabricated stats band** (`stats-counter.tsx` animates four hardcoded
   constants presented as measurements). Remove, or wire to real counters? Blocking.
2. Paste-link tool → `/download`, or a section on `/`? Drives the Share Target
   migration.
3. Ads on `/`.
4. Any product in flight deserving a `preview` roadmap entry?

**New in Part 2:**
5. **Primary nav shape** (§6) — confirm 5 real items over the spec's 9, four of which
   have no destination.
6. **Solutions on day one** — ship with just *For Creators* and *For Developers*, or
   hold Solutions entirely until there's a third?
