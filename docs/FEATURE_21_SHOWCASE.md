# Feature 21 — Part 4: Product Showcase & Interactive Experience Engine

**Part 4 deliverable: architecture and design. No implementation code.**
Status: awaiting owner review. Date: 2026-07-17.

Substrate is Parts 1–3 and is not re-derived here: pillars are data
(`config/pillars.ts`), lanes gate what's public, the graph drives links and schema,
personalization is client-only and post-paint, and the LCP element is text. This
part covers what's actually new — **the preview engine, persona switching, the
visual product graph, and the depth ladder.**

---

## 1. What's in this section today

Two live components, and 412 lines of dead code.

**Live:** `feature-cards.tsx` renders four honest value props — Download, Trending,
Community, Chat — each linking somewhere real (`/#download`, `/explore`, `/messages`).
Its own comment reads *"what FrenzSave is beyond a downloader."* `platform-showcase.tsx`
renders `PLATFORMS` tiles — **the downloader source platforms (TikTok, Instagram, …),
not Frenz products.** So there is no Frenz product grid today at all; there's a
downloader-era feature strip.

**Dead — zero references anywhere:**

| File | Lines |
|---|---|
| `components/landing/features.tsx` | 69 |
| `components/landing/flagship-platforms.tsx` | 81 |
| `components/landing/tiktok-flagship.tsx` | 262 |
| | **412** |

(`features.tsx`'s apparent matches are all `@/features/…` path collisions.) These are
prior attempts at exactly the section Part 4 is specifying. They should be deleted
before a fourth attempt lands next to them — otherwise the next person inherits four
overlapping showcases and no way to tell which is real.

---

## 2. The grid: 22 cards, 9 real — and why this section is where it shows most

Same ledger as Part 1 §3; the application is what's new.

Of the 22 products in the Product Experience Grid™, **9 exist**: Messaging, Stories,
Reels, Downloader, Notifications, Search, Photo Editor, plus Profiles and Friends.
Thirteen don't.

**A grid is the worst possible place to fake it**, and worse than the mega menu, for a
different reason. A nav hides its length behind a hover. A grid is a *wall* — 22 tiles
in one viewport, 13 wearing "Coming soon" badges. That doesn't read as ambition; it
reads as vaporware, and it does it at a glance, before a single word is read. The
spec's own instruction is "show, don't tell." Thirteen tiles that can't show anything
are thirteen tiles telling.

**Nine cards is a good grid.** It's a clean 3×3, every tile opens into something real,
and every preview is a real product doing a real thing. That is a stronger page than
22 tiles where the majority are promises — and it grows into 22 on its own, one config
edit at a time, because the grid renders from `config/pillars.ts` filtered by lane.

---

## 3. Interactive Preview Engine™ — the genuinely hard problem

This is the real engineering content of Part 4, and it's the biggest performance
threat in the spec so far. "Each card becomes a miniature simulation" — typing
indicators, voice messages, purchase flows, analytics dashboards, object removal —
across a grid, all below the fold.

**The naive build is a disaster:** 9–22 bespoke React trees, each with its own timers
or `requestAnimationFrame` loop, all mounted and running whether or not anyone is
looking at them. On a mid-range Android that's a permanently pegged main thread, a
hot battery, and a scroll that stutters — while the spec asks, on the same page, for
"minimal JavaScript," "battery optimization," and "instant card loading."

**Design — four rules that make it cheap:**

1. **One shared runtime, not N simulations.** A single declarative `SimSpec` per
   product — a timeline of steps over real components — interpreted by one engine.
   Adding a product's preview is authoring data, not writing another animation.
2. **Static poster by default.** Every card server-renders the simulation's **first
   frame as real DOM**. That's what paints, what Googlebot indexes, and what a visitor
   who never hovers ever sees. Zero JS to look correct.
3. **Animate on intent, never on mount.** Hover/focus with a ~100ms delay, or tap on
   touch. Gated by IntersectionObserver so an offscreen card is never running.
4. **Exactly one animation at a time, globally.** Enforced by the engine. A grid can
   never cost more than a single preview, no matter how many cards ship. This is what
   makes "unlimited future products" true rather than aspirational.

Plus `content-visibility: auto` on offscreen cards, so the browser skips their layout
and paint entirely.

**Reuse, not reinvention — and there's fragmentation to fix first.** The repo has
**three** in-view mechanisms: `components/ui/reveal.tsx` (a real shared primitive —
IntersectionObserver + GPU `transform`/`opacity` + reduced-motion aware, used by 4
files); `features/data/use-in-view.ts` (**exported from the `features/data` barrel and
consumed by nothing**); and six hand-rolled IntersectionObservers (`stats-counter`,
`trending-reels`, `smart-feed`, `feed-image`, `feed-video`). The showcase should
consolidate on one — `Reveal`'s approach is already the house pattern and already
correct — rather than adding a fourth.

**The previews are the real components.** Same argument as Part 3 §5: mount the actual
chat bubble, the actual reel tile, on static fixtures. Honest, self-maintaining,
already in the bundle, and more convincing than any mock because it *is* the product.
And **`live` lane only** — an interactive simulation of a Marketplace purchase flow is
worse than a static false claim, because it looks like proof.

---

## 4. Persona switching — yes, and this is where personalization belongs

Contextual Demonstrations™ asks visitors to switch persona (Creator, Business,
Student, Family, Developer…) and have the showcase update.

**This one gets a yes**, and it's worth being explicit about why, since Part 3 rejected
the hero's version. Everything that made the personalized hero wrong is absent here:
it's **below the fold** (no LCP impact), **user-initiated** (a click, not an inference
— so nothing swaps under anyone), and **not the H1** (no ranking or cloaking
exposure). Part 1 §4 reserved exactly this space for adaptation. This is it.

**The design constraint that keeps it SEO-safe and cheap:**

> **A persona reorders and emphasizes one fixed set of cards. It never swaps their
> content.**

So the DOM is constant and complete — every product is always present and crawlable,
there's no per-persona content for Googlebot to miss, no cloaking surface, and no
7-personas × 22-cards DOM explosion. Switching persona is a CSS order change and a
highlight, which is free and instant. Deep-linkable via `?for=creator` for campaigns
(Part 3 §2's campaign URLs), defaulting to the canonical order — which is what
crawlers and first-time visitors get.

Personas are gated by the ledger too: a Business persona whose products don't exist
has nothing to reorder. **Creator and Developer work today.** That's Part 2 §6's
Solutions question, same answer.

---

## 5. Connected Product Graph™ — honest at 9 nodes

A visual of how products connect, rendered from `config/graph.ts` (Part 1 §5) — no new
data, just a view.

**The catch worth naming:** a network diagram of 22 products where 13 are fictional is
a picture of an ecosystem that doesn't exist, and a diagram is *more* persuasive than
a list precisely because it looks like architecture. At 9 real nodes the graph is
smaller and completely true — Messaging↔Stories↔Reels↔Notifications↔Profiles is a
real, dense, interesting cluster, and Downloader→Saved→Share-to-chat is a genuinely
unusual edge no competitor has.

**Engineering:** SVG, not canvas or WebGL. Precomputed layout at build time — never a
force-directed simulation running in the browser (that's a physics loop on a mid-range
phone to draw nine circles). Static by default, edges highlight on hover/focus, real
`<a>` links underneath so it's a navigable, crawlable link surface rather than a
picture. Under `prefers-reduced-motion`, it's simply static. Screen readers get the
adjacent list, not the diagram (§7).

---

## 6. Product Depth Levels™ — the ladder, and where it truncates today

The spec's ladder is good IA and maps cleanly onto what Parts 1–2 already designed:

| Depth | Surface | Exists? |
|---|---|---|
| Quick overview | Card in the grid | New (this part) |
| Interactive preview | §3 poster → sim | New (this part) |
| Expanded details | Card expansion | New (this part) |
| Dedicated landing page | Pillar page (Part 1 §5) | Designed |
| Documentation | `/developers` | Real, but API-only |
| Tutorials | — | **Doesn't exist** |
| Getting started | — | **Doesn't exist** |

**So the ladder truncates at the pillar page.** That's fine — a card → preview →
pillar → product ladder is already real depth, and every rung lands somewhere. But
Learning Center / Tutorials / Getting Started are pages that don't exist yet (Part 2
§1 flagged the same for Help Center, Status, Careers, Press). The grid must not link
to rungs that aren't built; the graph invariant from Part 2 §4 (every nav item
resolves to a real route, and its target is `live`) fails the build if it does.

---

## 7. Accessibility — the part the spec asks for and interactive demos usually break

"Every demonstration must have accessible alternatives" is the right requirement, and
it's the one an interactive showcase almost always fails.

**The rule: the simulation is decorative. It is never the only path to the
information.**

Each card is a real semantic unit — heading, description, link — that works with zero
JS, zero hover, and zero animation. The preview is `aria-hidden` and not focusable. A
screen-reader user must never have to traverse a fake purchase flow to learn what
Marketplace is; they read the card, exactly like everyone else, and the card says it.

This is also why §3's poster-first design matters beyond performance: the accessible
version, the no-JS version, the crawlable version, and the first-paint version are all
**the same DOM**. One artifact, four requirements. That's the whole trick — the
alternative isn't a fallback bolted on, it's the default that the animation decorates.

Keyboard: cards are links, personas are a real tab pattern (arrow keys, `aria-selected`),
focus visible throughout. Nothing animates on focus that doesn't animate on hover.
Reduced motion → posters only, everywhere. RTL → logical properties from the start
(Part 2 §8). Dynamic Type → cards must survive 200% zoom, which a fixed-height tile
grid will not; the grid has to be content-sized.

**One honesty note:** "soft haptics" doesn't exist on the web on iOS — Safari doesn't
support the Vibration API at all. On a marketing page it's a no-op for every iPhone
visitor. Not worth building.

---

## 8. Performance budget

| Element | Rule |
|---|---|
| Cards | Server-rendered DOM. Paint with zero JS. |
| Previews | Static poster → one shared runtime, intent-gated, **max 1 concurrent** (§3). |
| Offscreen | `content-visibility: auto`; IO-gated; nothing runs unseen. |
| Motion | `transform`/`opacity` only. Never animate `filter`/`backdrop-filter` (Part 2 §7). |
| Graph | Build-time layout. SVG. No runtime physics (§5). |
| Persona switch | CSS order + highlight. No refetch, no remount, no layout shift. |
| Media | Fixtures, not network. Nothing on the critical path. |
| Save-Data / reduced-motion | Posters only. |

The section is below the fold, so it must not compete with the hero's LCP: nothing
here is fetched, hydrated or animated until it's near the viewport.

---

## 9. Build order

| # | Slice | Depends on |
|---|---|---|
| 1 | **Delete the 412 lines of dead showcase code** (§1) | — |
| 2 | Consolidate on one in-view primitive (`Reveal`); drop the unused `useInView` (§3) | — |
| 3 | Product grid from `config/pillars.ts`, lane-filtered, posters only, zero JS (§2) | Part 1 pillars |
| 4 | Preview runtime: `SimSpec` + intent gating + 1-concurrent (§3) | 3 |
| 5 | Persona tabs — Creator + Developer (§4) | 3 |
| 6 | Connected graph view (§5) | Part 1 graph |
| 7 | Card expansion → pillar page (§6) | Part 1 pillars |

Slices 1 and 2 are independent, shippable now, and both are net deletions.

---

## 10. Open questions

**Blocking, unanswered since Part 1:**
1. **The fabricated stats band.** Remove, or wire to real counters?

**Still open:** 2. Paste-link tool → `/download` or a section on `/`? 3. Ads on `/`?
4. Any `preview`-lane product in flight? 5. Primary nav: 5 items vs 9? 6. Solutions
with only Creators + Developers? 7. Hero copy direction. 8. Can I ship the emoji fix?

**New in Part 4:**
9. **Can I delete the 412 lines of dead showcase code** (`features.tsx`,
   `flagship-platforms.tsx`, `tiktok-flagship.tsx`)? Zero references; they're previous
   attempts at this exact section. Low risk, but they're yours to keep if they're
   parked deliberately.
