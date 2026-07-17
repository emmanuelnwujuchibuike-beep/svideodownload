# Feature 21 — Landing Experience, SEO Ecosystem & Discovery Engine

**Part 1 deliverable: architecture and design. No implementation code.**
Status: awaiting owner review. Date: 2026-07-17.

This document is the foundation the pillar pages get built on. It is deliberately
grounded in what this repository actually contains — every architectural claim
below cites a real file. Read it with `docs/PERFORMANCE.md` and the 2-second page
budget rule, which outranks everything here.

---

## 1. Where we actually are

We are not starting from zero. Three things already exist and they constrain the design.

**A landing page exists, and it is a downloader tool.** `app/page.tsx` renders a
hero headlined "Download. Discover. Connect." with a paste-a-link bar, "No Login
Required" trust badges, an ad slot, and a sticky bottom ad. It is a conversion
surface for download intent, not a front door for a social ecosystem.

**A programmatic SEO engine exists.** `config/seoPages.ts` defines clusters ×
modifiers that generate slugs, titles, keywords, FAQs and body copy; these flow
automatically into routing (`app/[downloader]/page.tsx`), `app/sitemap.ts`, the
header drawer, and the footer via `lib/seo/seo-pages.ts`. This is already the
"Topic Cluster Intelligence" framework the spec asks for. It should be extended,
not reinvented.

**A marketing shell exists.** `components/layout/site-header.tsx` and
`site-footer.tsx` wrap every marketing page. Notably the header is a **client**
component that resolves auth via `useUser()` — this matters for §4.

Existing marketing routes: `/`, `/about`, `/blog`, `/blog/[slug]`, `/contact`,
`/developers`, `/pricing`, `/privacy`, `/terms`, `/dmca`, `/welcome`, plus
`/[downloader]` (generated), `/u/[handle]`, `/p/[id]`.

---

## 2. Positioning decision (owner-approved, 2026-07-17)

**`/` becomes the ecosystem pillar. The downloader keeps its own pages.**

The reasoning, because this looked risky and isn't:

Download-intent search traffic does not land on `/`. It lands on the generated
`/[downloader]` pages, which are the pages that actually target "tiktok video
downloader" and its long tail. Those pages are untouched by this work — same
copy, same ads, same rankings. `/` ranks for *brand* queries, and a brand query
deserves a brand answer.

The paste-a-link tool is not deleted. It keeps a home (a dedicated route and/or a
section below the ecosystem hero) and Share Target keeps working — see §9.

**Revenue guardrail.** Ads must never be CSP-blocked (`lib/security/csp.test.ts`
pins this; a failing CSP test means revenue is about to break). Ad slots on
`/[downloader]` are untouched. Any change to ad placement on `/` is an owner
decision, not a design one, and is out of scope for Part 1.

---

## 3. The Reality Ledger — the rule that makes this honest

The spec names ~25 flagship products. I checked every one against the codebase.

**Real, shipped, has a product surface:** Messaging, Stories, Reels, Downloader,
Notifications, Search, Profiles, Friends, Explore, Saved/Collections, Create
(composer), Photo Editor.

**Partial / adjacent code only:** Communities (`features/app-shell/dashboard/
join-communities.tsx` — a dashboard module, not a platform).

**No implementation exists:** Marketplace, Professional Network, Business
Platform, Creator Platform, AI Studio, Video Editor, Cloud Storage, Live
Streaming, Music, Family Platform, Enterprise, Time Capsule™, Life Journey™,
Activity Rank™, Avatar Studio™.

That is 16 of 25 with nothing behind them.

### The rule

> **A pillar page ships only when a visitor can go use the thing it describes.**

A premium landing page for a product that doesn't exist is not premium — it is a
liability. It converts a visitor into a disappointed visitor, it invites Google to
classify the domain as thin/doorway content, and at billion-user scale it is a
consumer-protection problem, not a marketing one.

This is the same principle as the standing **no fake engagement** constraint,
which has been declined twice. Fabricated products are fabricated engagement with
extra steps.

**Three lanes, and every pillar is assigned one:**

| Lane | Meaning | Gets |
|---|---|---|
| `live` | Product exists and is reachable | Full pillar page, sitemap, schema, nav |
| `preview` | Genuinely being built, dated | A roadmap entry on `/roadmap`, honestly labelled. No standalone pillar, no `Product` schema |
| `concept` | Idea only | Nothing public |

The lane lives in the pillar config (§6), so the ledger is enforced by the type
system and a test, not by memory. `preview` pages carry `noindex` until they flip
to `live`.

### The fabricated stats already on the homepage

`components/landing/stats-counter.tsx` hardcodes `35_000_000` videos downloaded,
`8_000_000` community members, `120` countries and a `99.9%` success rate, and
animates them up from zero on scroll. None of these are measurements. They are
constants.

This is live right now and it violates the no-fake-engagement constraint. It also
undermines the exact "Trust Architecture" the spec is asking for: a visitor who
suspects one number is invented discounts every other claim on the page.

**Proposed:** replace with the honest-proof model in §8, which uses only claims we
can actually substantiate. **This needs an explicit owner call** — it is a
deliberate change to a live revenue-adjacent surface, and it is the one item in
this document I will not action without a yes.

---

## 4. The 2-second budget is an architectural constraint, not a checklist item

The landing page is the first thing a new visitor ever loads. The ≤2s cold-entry
ceiling matters more here than anywhere in the product.

### Finding: `/` is dynamically rendered on every request

`app/page.tsx:49-63` awaits `cookies()` to detect a session and redirect signed-in
users to `/home`. Reading cookies opts the route out of static generation. So the
single most important page in the product is an SSR render per visitor instead of
a static document served from the edge.

The code is already trying to limit the damage — it only pays for `getUser()` when
an auth cookie is present, so anonymous visitors skip the round trip. But the
route is still dynamic, which means no full-page CDN cache, and every cold visitor
waits on our origin in `cdg1` (Paris) from an Africa-primary audience.

**The redirect is the only thing forcing this.** And it doesn't need to be there:

- `middleware.ts` already matches `/` (its matcher excludes only static assets),
  so the signed-in → `/home` redirect can move there and run at the edge.
- The auth-dependent *chrome* is already client-rendered — `site-header.tsx` is
  `"use client"` and resolves the user through `useUser()`. So the page's
  personalized parts never depended on server auth in the first place.

Moving the redirect to middleware lets `/` be statically generated and CDN-cached.
This is very likely the largest single lever on landing cold-entry time, it is
independent of everything else in this document, and it is small.

**Verification (per the standing rule — measure the layer the user waits on):**
`curl -I` the deployed `/` and confirm the response is a cache hit rather than a
per-visitor render, then measure from a throttled connection. Do not quote a local
timing as production; local→origin RTT will drown the signal.

### The static-vs-personalization tension

The spec wants Journey Mapping AI™ to adapt the page per visitor. A page that
adapts per visitor on the server cannot be one cached document. That is a direct
collision with the ≤2s rule.

**Resolution — the first frame is identical for everyone.**

```
Static document (CDN, identical bytes for every visitor)
        │  paints immediately — hero, narrative, nav, footer
        ▼
Hydration
        │
        ▼
Journey layer (client only, post-paint)
        └─ reorders "explore next", swaps CTA copy, ranks related pillars
```

The adaptive layer never blocks, never shifts layout above the fold, and never
changes the first painted frame. It reorders and recommends *below* the fold and
*after* paint. With JS disabled it degrades to a sensible static default, which is
also what crawlers index — so we never serve Google a personalized page.

This satisfies the spec's own words ("gently adapt recommendations **without
changing the core experience**") and the 2s rule simultaneously. They are only in
conflict if personalization is done on the server.

---

## 5. The five engines

Each engine is a real module with a real file, not a brand name over a folder.

### Landing Experience Engine™ — `config/pillars.ts` + one dynamic route

Pillar pages are **data, not files**. One typed config module describes every
pillar; one route renders them all through a section registry.

```ts
interface Pillar {
  id: string;
  slug: string;
  lane: "live" | "preview" | "concept";   // §3 — enforced, not remembered
  cluster: ClusterId;                      // §7
  productHref?: string;                    // must exist when lane === "live"
  narrative: NarrativeBeat[];              // §8 — ordered arc
  sections: SectionSpec[];                 // registry keys + props
  related: PillarId[];                     // §6 — typed graph edges
  faqs: { q: string; a: string }[];
  seo: { title, description, primaryKeyword, secondaryKeywords };
}
```

Rendered by `app/(marketing)/[pillar]/page.tsx` with `generateStaticParams()` —
every pillar is statically generated at build time. This mirrors the pattern
`config/seoPages.ts` → `app/[downloader]/page.tsx` already proves in this repo,
which is why it's the right shape: adding a pillar is a config edit, and routing,
sitemap, internal links, breadcrumbs and schema all update automatically.

**Why not 40 hand-written page files:** they drift. Copy diverges, a page gets
orphaned from the sitemap, schema goes stale on one page and not another. The
existing SEO engine already avoids this at ~100+ pages; the pillar system inherits
the property.

**Section registry** — a map of key → component (`Hero`, `InteractiveDemo`,
`Benefits`, `Scenarios`, `Proof`, `Faq`, `RelatedPillars`, `Cta`). Sections are
composed per pillar from a shared vocabulary, so the ecosystem looks like one
system rather than 40 bespoke pages. This is what makes it feel premium: not
variety, consistency.

### Discovery Architecture™ — `config/graph.ts`

A typed semantic graph. Nodes are pillars, clusters, blog posts, docs, downloader
pages, legal pages. Edges are typed: `parent`, `sibling`, `supports`, `mentions`.

One graph, derived into everything:

- internal link modules (`RelatedPillars`, breadcrumbs)
- `app/sitemap.ts` (see gap below)
- JSON-LD `isPartOf` / `about` / `mentions` relationships
- header + footer nav

**Invariants, enforced by test:**
1. No orphans — every node reachable from `/`.
2. No dangling edges — every `related` id resolves.
3. Every `live` pillar reachable in ≤2 clicks from `/`.
4. Reciprocity — if A lists B as related, B lists A. One-way link graphs are how
   PageRank pools in dead ends.
5. No `live` pillar without a resolvable `productHref`.

**Sitemap gap found:** `app/sitemap.ts` currently omits `/pricing`,
`/developers`, and `/welcome`. Deriving the sitemap from the graph fixes this
class of bug permanently rather than one-off.

### Topic Cluster Intelligence™ — extends `config/seoPages.ts`

Five clusters, each a pillar + supporting pages that link bidirectionally:

| Cluster | Pillars (lane) |
|---|---|
| **Communication** | Messaging `live` · Stories `live` · Reels `live` · Notifications `live` · Communities `preview` |
| **Creation** | Photo Editor `live` · Create/Composer `live` · AI Studio `concept` · Video Editor `concept` · Music `concept` |
| **Business** | Marketplace `concept` · Professional Network `concept` · Business Platform `concept` · Enterprise `concept` |
| **Identity** | Profiles `live` · Friends `live` · Avatar Studio `concept` · Activity Rank `concept` · Life Journey `concept` · Time Capsule `concept` |
| **Infrastructure** | Security `live` · Privacy `live` · Developers `live` · Downloader `live` |

Read that table honestly: **Communication and Infrastructure are shippable now.
Creation is half. Business and Identity are almost entirely concept.** The cluster
strategy is real for two clusters and aspirational for two. Build the real ones
first — a cluster with one live pillar and four `noindex` roadmap entries has no
topical authority to contribute.

The existing `SeoCluster`/`SeoModifier` shape is reused directly. A pillar is a
cluster head; blog posts and help articles are supporting nodes that link up to
it; the pillar links back down. That reciprocal structure is what produces the
authority effect the spec is describing.

### Journey Mapping AI™ — client-only, session-scoped, explainable

**Not** an ML model, and deliberately so. It is a small, legible ranking function
over signals we already have. Calling a heuristic "AI" in the config would be its
own kind of fabrication; the branding can live in marketing copy, the code stays
honest.

Signals: referrer class, UTM params, entry pillar, pillars viewed this session,
scroll depth. Inference: map signals → audience (Creator, Business, Professional,
Student, Family, Developer, Casual, Media, Investor, Recruiter). Output: rank the
"explore next" rail, swap CTA copy, reorder related pillars.

**Privacy-by-design, and this is a real engineering choice with real consequences:**

- `sessionStorage` only — not cookies, not localStorage. Dies with the tab.
- No PII, no fingerprinting, no cross-site tracking, no network calls.
- **Because it's session-scoped and non-identifying, it needs no consent banner** —
  which is itself a conversion win, and the honest kind.
- **Explainable by default.** Any adapted module can say *why*: "Because you came
  from a design community." The spec asks for explainable AI; this is what that
  actually means at this layer.
- Never adapts above the fold. Never blocks paint. See §4.

### Brand Narrative Engine™ — `config/narrative.ts`

The arc, enforced structurally:

```
Problem → Vision → Solution → Innovation → Human Stories → Trust → Proof → Invitation
```

Each pillar declares which beats it carries; a shared `<NarrativeSection>` family
renders them in canonical order. Shared copy tokens (the problem statement, the
vision line) live in one module, so every page tells a consistent story rather
than 40 pages each restating the brand from scratch.

**Emotional journey → beat → section**, so the mapping is concrete rather than
poetic:

| Feeling | Beat | Rendered as |
|---|---|---|
| Curiosity | Problem | Hero tension line |
| Discovery | Vision / Solution | Interactive demo |
| Confidence | Innovation | How-it-works |
| Excitement | Human Stories | Scenarios |
| Trust | Trust | Privacy/security module (§8) |
| Belonging | Proof | Honest proof (§8) |
| Action | Invitation | CTA |

---

## 6. Information architecture

```
/                                    ecosystem pillar (static, CDN)
├── /download                        the paste-a-link tool + Share Target
├── /[downloader]                    ~100+ generated SEO pages — UNTOUCHED
├── /messaging   /stories   /reels   /notifications      Communication (live)
├── /photo-editor   /create                              Creation (live)
├── /profiles   /friends                                 Identity (live)
├── /security   /privacy   /developers                   Infrastructure (live)
├── /roadmap                         every `preview` pillar, honestly labelled
├── /pricing   /about   /blog   /contact
└── /terms   /privacy   /dmca
```

**Navigation hierarchy.** The current header nav (`Home / Features / Community /
News / Download`) is downloader-era and points `Features` at an anchor (`/#platforms`).
Post-decision it becomes cluster-led: a **Products** menu grouped by the five
clusters (live pillars only), then Pricing, Blog, Company. The footer becomes the
graph's full link surface — its downloader column stays exactly as-is.

**Depth rule:** every `live` pillar ≤2 clicks from `/`, enforced by the §5 graph
test.

---

## 7. SEO architecture

**Structured data.** `Organization` + `WebSite` on `/`; `Product`/`SoftwareApplication`
per `live` pillar; `BreadcrumbList` from the graph; `FAQPage` from pillar FAQs;
`Article` on blog. All serialized through the existing `lib/seo/json-ld.ts`, which
already escapes `<`/`>`/`&` to prevent the stored-XSS class of bug — every new
schema call site must go through it, no exceptions, no hand-rolled
`JSON.stringify` into a `<script>`.

**No `Product` schema for `preview`/`concept` pillars.** Structured data asserting
a product exists, when it doesn't, is a manual-action risk and a lie in a machine-
readable format — the worst place to put one, because it's the one a crawler
believes without a human reading it.

**Canonicals + hreflang.** Every pillar self-canonicals via `SITE_URL` from
`lib/site.ts` (already the single source of truth). i18n is designed for now and
built later: pillar copy is already data (§5), so locale is a key on the config,
not a fork of the pages. `hreflang` derives from the graph.

**AI search / LLM retrieval.** This is where the "future search technologies"
requirement gets concrete rather than hand-wavy. AI answer engines extract claims,
not vibes. What actually helps: semantic HTML with real heading hierarchy, FAQs as
`FAQPage`, one unambiguous definitional sentence per pillar near the top, factual
claims that survive extraction without surrounding context. Every pillar carries a
one-sentence definition designed to be quoted verbatim. **And this is a second,
independent reason the Reality Ledger matters — an answer engine will confidently
tell a user we have a Marketplace, and they will come looking for it.**

**Mobile-first indexing.** Parity is structural: one responsive render, no
`m.` split, no content hidden from mobile that desktop shows.

---

## 8. Trust, honestly

The spec wants Testimonials and Proof. We have neither, and inventing them is
declined twice over.

**Honest proof — claims we can actually substantiate:**

- **Engineering facts, verified:** real Core Web Vitals from field data; the ≤2s
  budget stated as a public commitment; the actual CSP; the actual privacy
  posture. These are checkable, which is what makes them persuasive.
- **Product truth:** what the app genuinely does, shown by real interactive demos
  running the real components — not a screenshot of a mock.
- **Transparency as the differentiator:** a public roadmap with honest lanes says
  more about trustworthiness than "8M+ members" ever did. Nobody believes the
  number anyway.
- **Testimonials: deferred until real ones exist**, with consent. A quote from a
  real user with a real handle, or nothing.

**On the existing stats band:** the four fabricated constants come out, or become
real measurements wired to real data. Owner call (§3).

If we later want a metrics band, the honest version reads from actual counters —
real downloads served, real registered accounts. Smaller numbers. Considerably
more credible, and they grow on their own.

---

## 9. Integration

**Share Target.** `manifest.ts` posts shared links to `/` as a GET with
`url`/`text`, handled by `extractSharedUrl()` in `app/page.tsx`, which validates
through `sourceUrlSchema` before anything touches the client. If `/` goes static,
**this handoff must move with the tool** — most likely to `/download`, with the
manifest's `share_target.action` updated to match. This is a real migration step
with a real failure mode: get it wrong and every share-into-Frenz breaks silently.
It must be verified against a real share, not a unit test.

**Auth.** Header/CTA state stays client-side via `useUser()` — already the case.
Login copy stays *"login or create account to access all features"* (owner,
2026-07-16).

**Ads.** Untouched on `/[downloader]`. CSP test stays green — a failing CSP test
means revenue is about to break.

**Product surfaces.** Each `live` pillar's `productHref` deep-links to the real
route (`/messages`, `/reels`, …). The graph test fails the build if a `live`
pillar points nowhere — the ledger enforced mechanically.

---

## 10. Accessibility & performance

**Accessibility is a build gate, not a review step.** Semantic landmarks and real
heading order (the current hero's `<span className="text-gradient">` inside `<h1>`
is fine; decorative gradient blobs are already correctly `aria-hidden`). WCAG AA
contrast on both themes — the gradient CTA needs an actual measurement, not an
eyeball. Full keyboard reachability with visible focus. The global
`prefers-reduced-motion` guard in `globals.css` already neutralizes animation
app-wide; every new landing animation must inherit it, including the scroll-driven
counter pattern.

**Performance budget, per pillar:** static generation, no blocking data on the
critical path, images through `next/image` with explicit dimensions (undersized
images with no reserved height caused a real layout-shift bug in chat — the same
mistake on the landing page is the same bug), fonts already self-hosted via
`next/font` (Plus Jakarta Sans), interactive demos lazy and below the fold, zero
third-party JS above the fold.

**Design tokens.** Everything uses the existing system in `app/globals.css` —
Electric Blue `#0A84FF`, Royal Purple `#6C4DFF`, space-navy `#050816`, the motion
tokens, `.glass` / `.brand-glow` / `.text-gradient`. `.bg-brand` stays canonical
for CTAs. No ad-hoc colors, no emoji in product UI, brand is **Frenz** in all
visible copy — "FrenzSave" only in `<title>`/meta/structured data/OG site name.

---

## 11. Build order

Ordered by value-at-risk, not by spec order.

| # | Slice | Why first |
|---|---|---|
| 1 | Move the `/` auth redirect to middleware; make `/` static | Biggest 2s-budget lever. Independent of everything else. Ship alone. |
| 2 | Resolve the fabricated stats band | Live constraint violation. Owner call. |
| 3 | `config/pillars.ts` + `config/graph.ts` + tests | Foundation. Nothing else is safe without the invariants. |
| 4 | Rebuild `/` as the ecosystem pillar; move the tool to `/download` + migrate Share Target | The headline change. Verify a real share. |
| 5 | Communication cluster pillars (Messaging, Stories, Reels, Notifications) | The one cluster that is fully real today. |
| 6 | Infrastructure cluster (Security, Privacy, Developers) | Real, and it's the trust story. |
| 7 | Graph-derived sitemap + schema; fix the `/pricing`, `/developers`, `/welcome` omissions | Compounds once pillars exist. |
| 8 | Journey layer (client-only) | Needs pillars to rank before it can rank anything. |
| 9 | `/roadmap` for `preview` pillars | Honest home for what's coming. |
| 10 | Creation / Business / Identity pillars | **Gated on the products existing.** Not a landing-page task. |

Slices 1 and 2 are independently shippable today and don't depend on this
document being approved.

---

## 12. Open questions for the owner

1. **The stats band (§3, §8).** Remove, or wire to real counters? This is the one
   blocking item.
2. **Where does the paste-link tool live** — a dedicated `/download`, or a section
   below the ecosystem hero on `/`? Affects the Share Target migration (§9).
3. **Ads on `/`.** The ecosystem hero and a sticky bottom ad are in tension.
   `/[downloader]` ad revenue is untouched either way. Your call on `/`.
4. **`preview` lane.** Any product genuinely in flight that should get a dated
   roadmap entry rather than silence?
