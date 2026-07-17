# Feature 21 — Part 5: Live Experience Platform & Product Sandbox

**Part 5 deliverable: architecture and design. No implementation code.**
Status: awaiting owner review. Date: 2026-07-17.

Substrate is Parts 1–4 (pillars-as-data, lane gating, the graph, client-only
post-paint personalization, LCP-stays-text). This part covers the sandbox itself.

---

## 1. The premise is right, and it's already half-built

"Experience before commitment" is the strongest idea in the whole spec, and it is
the one Frenz is best positioned to deliver — for a reason the spec doesn't mention:

**The downloader is already a working try-before-you-join sandbox.** `/` and every
`/[downloader]` page let an anonymous visitor paste a real link and get a real file,
with no account. That's not a simulation. It is the product, working, for free,
before signup — the exact thing Part 5 is asking us to invent. It's also why the
domain ranks.

So the honest framing: we are not building an experience platform from zero. We are
**extending a proven one** from downloads into the rest of the app.

---

## 2. What can actually be sandboxed

Part 5 lists 16 products to sandbox. Applying the ledger (Part 1 §3):

| Sandbox | Reality |
|---|---|
| **Downloader** | **Already live and real.** Not a demo — the actual product. |
| **Reels / Stories / Feed** | Real components + real public content. Genuinely demoable. |
| **Messaging** | Real components. Demoable against fixtures (§4). |
| **Photo Editor** | Real, client-side. **The single best sandbox candidate** (§5). |
| **Search** | Real, but the marketing index is separate (Part 2 §3). |
| **Notifications** | Real components; simulate arrival. |
| Marketplace, AI Studio, Video Editor, Cloud, Creator Platform, Business Platform, Communities, Activity Rank, Time Capsule, Live | **Do not exist.** |

**Ten of sixteen sandboxes would be simulations of products that do not exist.**

And this is where the Reality Ledger stops being a content-honesty rule and becomes a
**consumer-protection** one. A static claim is a claim. An *interactive simulation* is
a demonstration — the visitor doesn't read that Frenz has a Marketplace, they **use**
it. They complete a checkout. They see an order confirm. Then they sign up for a
product that has no marketplace at all.

That is not aspirational marketing. It's a deceptive demo of a nonexistent service,
and it is the most legally exposed thing proposed in five parts. The spec's own
"Zero-Risk Demonstrations™" heading is about risk to *the visitor's data*. The real
risk here is to the visitor's *decision*.

**Rule: a sandbox may only simulate a product that exists.** A sandbox is a promise
the product can keep.

**What's left is still excellent:** *download a real video · edit a real photo ·
scroll real reels · try real messaging*. Four sandboxes, all real, one of them
already the best-converting thing on the site.

---

## 3. Architecture: the sandbox is a data layer swap, not a copy of the app

The naive build is a parallel demo app — duplicate components, duplicate screens,
guaranteed drift. Six months in, the demo shows a product that no longer exists.

**Design: one component tree, two data sources.**

```
   Real app                          Sandbox
   ────────                          ───────
   <FeedPostCard post={…} />         <FeedPostCard post={…} />   ← same component
        │                                  │
   real query                         fixture
        │                                  │
   Supabase (RLS)                     in-memory store
```

A `SandboxProvider` supplies a fixture-backed store and no-op mutations. Components
don't know they're in a sandbox — which is the point: **the demo cannot drift from
the product, because it IS the product**, running on different data. Same argument
as Part 3 §5 and Part 4 §3; this is the third time it lands, which is a sign it's the
right spine.

**Isolation, concretely.** The spec asks for "isolated demo environments" and
"no production systems", implying infrastructure. It needs none, and that's better:

- **No network. No API routes. No demo database. No demo tenant.** The sandbox is
  client-side state over a static fixture. There is no production system to isolate
  *from*, because nothing is called.
- **Therefore no auth surface, no RLS to get wrong, no rate limit to abuse, no
  egress.** The strongest isolation is not a sandboxed environment — it's the
  absence of one.
- **No PII, ever.** Fixtures are authored, not scraped from real users. **Note the
  existing pattern to avoid:** `meet-people.tsx`'s `SAMPLE_PEOPLE` are invented
  people presented as real profiles. Sandbox fixtures must read as *demo* content,
  not as strangers.
- **Mutations are no-ops with local echo.** Sending a demo message updates local
  state and nothing else.
- **This also protects the RLS work.** A demo that touched real tables would be a new
  read path over `is_hidden`/`is_suspended`/blocks — exactly where a self-referential
  policy once silently broke every authenticated read. The sandbox never queries, so
  it can never leak.

**The one real risk to design against: the sandbox must never be mistaken for the
app.** Persistent "Demo" affordance, `noindex` on nothing (these pages *should* rank),
but a visitor must always know which they're in.

---

## 4. Messaging sandbox — where "feels real" fights the 2s budget

The spec wants typing indicators, reactions, voice messages, video-call previews,
live comment streams — "everything feels real."

`conversation-room.tsx` is ~39kB of route JS and the most delicate component in the
codebase (iOS keyboard pinning, scroll-to-bottom layout effects, appearance
providers, a still-open duplicate-key bug). **Mounting it on a marketing page would
put the app's heaviest, most fragile surface on the site's conversion path.**

Design:
- **Not the real room.** A `<SandboxThread>` reusing the real *bubble* and
  *composer* primitives, not the room's orchestration. Bubbles are what visitors
  recognize; keyboard pinning is not.
- **Scripted, not simulated.** A `SimSpec` timeline (Part 4 §3) — one shared runtime,
  poster-first, animate on intent, **max one concurrent animation globally**.
- **Below the fold, lazy, IO-gated.** Never on the hero's critical path.
- **Voice messages and video calls: not simulated.** Faking a call UI for a feature
  we don't ship is §2's rule. Voice notes exist — a real waveform on a real fixture is
  fine.

---

## 5. Photo Editor — ship this one first

`features/create/photo-editor.tsx` is real, and it is the ideal sandbox:

- **Client-side already.** Canvas work, no server round trip. Zero egress — which
  matters given the cap has been blown once and media still serves from a
  rate-limited `pub-*.r2.dev`.
- **Instant value.** Upload a photo, edit it, see it. The "aha" lands in seconds.
- **A conversion moment that is honest and earned**: *"Save your edit — create an
  account."* The visitor has already got value. Nothing was faked.
- **A real SEO page**: `/try/photo-editor` targets "free online photo editor" —
  genuine search intent, a real tool behind it, and the exact programmatic-SEO
  pattern `config/seoPages.ts` already proves.

**Constraint: the visitor's photo never leaves the browser.** No upload, no temp
bucket, no server. Say so on the page — it's a real privacy claim we can actually
make, and per Part 1 §8 the checkable claims are the persuasive ones.

---

## 6. Guided Experience Intelligence™ — a scripted tour, honestly named

Not an AI assistant. A **scripted tour** with a curated step list per sandbox, and
Freedom Mode™ is simply "dismiss the tour" (dismissal persisted in `sessionStorage`,
per Part 1's journey layer — no cookies, no PII, no consent banner).

Calling a step list "AI" in the code would be the same small fabrication flagged in
Parts 2 and 4. Marketing can brand it; the module stays legible. A scripted tour is
also *better* here: deterministic, reviewable, instantly responsive, free, and it
can't hallucinate a feature we don't ship — which, given §2, is the failure mode that
actually matters.

---

## 7. Conversion, SEO, accessibility, performance

**Smart Conversion Moments™** — the invitation appears *after* value, tied to a real
boundary the sandbox genuinely can't cross: *save this edit*, *keep this
conversation*, *publish this reel*. That's not a growth trick; it's true. The account
is what persists it. Copy stays the owner's *"login or create account to access all
features"*. No interstitials, no exit-intent popups.

**SEO** — every sandbox gets an indexable page (`/try/photo-editor`,
`/try/downloader`, …) via the Part 1 pillar config, `lane === "live"` only. `WebApplication`
schema through `lib/seo/json-ld.ts`. **No `Product`/`WebApplication` schema for a
sandbox of a product that doesn't exist** — a machine-readable lie is the worst kind
(Part 2 §4), and AI answer engines will confidently tell users they can try our
Marketplace.

**Accessibility** — Part 4 §7's rule holds and matters more here: *the sandbox is
never the only path to the information.* Each `/try/*` page is a real semantic
document — heading, prose, link — that works with zero JS. The interactive canvas is
an enhancement layered on top. A screen-reader user must never have to complete a
simulated flow to learn what a product does. The Photo Editor sandbox needs real
keyboard operation, not just pointer. Reduced motion → no auto-advancing tour.
**"Luxury haptics" don't exist on iOS Safari** (no Vibration API) — a no-op for every
iPhone visitor; don't build it.

**Performance** — the sandbox bundle is lazy and **never in the landing bundle**.
Route-split per `/try/*`, loaded on intent. Fixtures are static JSON, edge-cached,
offline-capable via the existing SW. Nothing here may touch the hero's LCP.

---

## 8. Build order

| # | Slice | Why |
|---|---|---|
| 1 | `/try/photo-editor` — real editor, real fixture, honest CTA (§5) | Real, client-side, zero egress, instant value |
| 2 | `/try/downloader` — formalize what already works (§1) | Already the best sandbox; give it a page and schema |
| 3 | `SandboxProvider` + fixture store (§3) | The spine everything else needs |
| 4 | `<SandboxThread>` on the Part 4 preview runtime (§4) | Reuses Part 4; no new engine |
| 5 | Reels/Stories sandbox — real public content | Real components, real data |
| 6 | Scripted tour + Freedom Mode (§6) | Needs sandboxes to tour |
| 7 | Everything else | **Gated on the products existing.** Not a landing task. |

---

## 9. Open questions

**Blocking since Part 1:**
1. **The fabricated stats band.** Remove, or wire to real counters?
2. **`meet-people.tsx`'s `SAMPLE_PEOPLE`** — four invented people (Sarah, James,
   Maria, Daniel, with invented locations) shown to every landing visitor as if real.
   Same category as the stats band; surfaced while making `/` static.

**Still open:** 3. Tool → `/download` or a section on `/`? 4. Ads on `/`? 5. Any
`preview`-lane product? 6. Primary nav: 5 items vs 9? 7. Solutions with only
Creators + Developers? 8. Hero copy direction.

**New in Part 5:**
9. **Confirm sandboxes are `live`-lane only.** This is the sharpest version of the
   ledger — an interactive fake checkout is materially different from a static claim,
   and it's the one I'd most want you to agree with in writing.
