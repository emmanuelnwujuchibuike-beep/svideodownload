# Feature 21 — Part 3: The Hero Experience

**Part 3 deliverable: architecture and design. No implementation code.**
Status: awaiting owner review. Date: 2026-07-17.
Reads with `docs/FEATURE_21_LANDING.md` (Part 1) and `docs/FEATURE_21_NAVIGATION.md`
(Part 2). Part 1 §4 — first frame identical for everyone — is the constraint this
part has to resolve against.

---

## 1. The good news: today's hero is already LCP-shaped, and the spec would break it

Worth establishing before designing anything, because it inverts the usual advice.

`components/landing/phone-mockup.tsx` contains **no images**. The entire device — the
titanium frame, the Dynamic Island, the status bar, the reels tiles, the chat row —
is CSS gradients, divs and lucide icons. `hero-wave.tsx` is inline SVG with a
GPU-friendly `motion-safe:animate-drift-slow`. Fonts are self-hosted through
`next/font/google` (Plus Jakarta Sans, auto-preloaded, `swap` by default).

**So the hero's LCP element is almost certainly the `<h1>` text**, which paints as
soon as CSS and the font are ready. There is no hero image to download, no video to
buffer, no canvas to boot. That is a genuinely strong starting position and it was
not an accident.

**Every visual ask in Part 3 would regress it:** a video background, a particle
system, device photography, and a scroll-driven camera all add bytes, main-thread
work, or decode time to the exact element the LCP clock is measuring. The spec asks
for "LCP under 2 seconds" *and* for the things that prevent it, on the same page.

**Design rule, non-negotiable: the LCP element stays text.** Everything cinematic is
additive, composited, and arrives after the headline has already painted. The hero
gets more beautiful without the first frame getting slower — that's the whole
engineering problem, and it's solvable, but only if the H1 is never in a queue behind
media.

---

## 2. Personalized Hero™ vs. Part 1 — resolved, three ways

The spec wants the hero to adapt per visitor: "Creator visitor → Creator focused
Hero. Business visitor → Business Hero." Part 1 §4 committed to the opposite: the
first painted frame is identical bytes for everyone, from the CDN.

This is the sharpest conflict in the spec so far. It resolves against per-visitor
hero swapping for **three independent reasons** — any one of which would be
sufficient, and they happen to agree.

**1. Performance.** Server-side variant selection means the page can't be one static
CDN document. That's Part 1 §4, and it breaks the 2-second rule on the single page
where the rule matters most.

**2. It's the flash bug you already rejected.** Client-side swapping means the H1
paints, then *changes* after hydration. That is exactly the failure mode that got the
warm-thread preview reverted (`6178de3` → `82aa7bf`) — your words: *"when i enter a
chat it glitchs and show a wrong chat for 1 sec before showing the real chat."* Same
class of bug, on the first page a stranger ever sees, with a headline instead of a
chat. A swapping headline is also a layout shift, which is a Core Web Vital the spec
explicitly asks us to protect.

**3. SEO — and this is the one that should settle it.** A single URL ranks for a
single intent. Four hero variants on `/` means `/` ranks well for none of them.
Worse, serving materially different content to visitors than to Googlebot on the same
URL is cloaking-adjacent. **Separate pages rank; variants don't.**

**Resolution — Adaptive Hero Intelligence™ becomes campaign routing, not H1 swapping:**

- **Distinct static URLs per audience** — `/solutions/creators`, `/solutions/business`
  — each with its own H1, own schema, own copy, each independently rankable and
  independently cacheable. Campaign and ad traffic links *directly there*. This is
  Part 2's Solutions nav; the machinery already exists in the design.
- **`/`'s hero core is immutable.** H1, subhead, primary CTA: identical for every
  visitor, every time.
- **Adaptation lives below the fold and after paint** — ordering the "explore next"
  rail, per Part 1's journey layer (client-only, sessionStorage, no PII, no consent
  banner).

The spec's own wording sanctions this: *"without creating inconsistent branding."* A
hero that says something different to every visitor is the definition of inconsistent
branding. **Seasonal themes, feature launches and A/B tests are still fully supported**
— but as *deploys and variants of a static page*, not per-request rendering.

---

## 3. 🔴 The hero violates the no-emoji rule, live, right now

`phone-mockup.tsx` — the visual centrepiece of the landing page — contains **10 emoji
occurrences**: 😄 😎 🥳 as floating chips, 👩🏽 🧑🏻 👩🏼 🧑🏾 as the "People You May
Know" avatars, and 🔥 💬 👥 as section labels.

The standing rule is *never emoji in product UI* — "they look unprofessional and
inconsistent next to the premium/luxury design language."

**This is a missed spot in a sweep that already ran.** The 2026-07-07 emoji sweep
(`e0136a3`) fixed `meet-people.tsx`, replacing exactly this fake-avatar-emoji pattern
with initials-in-gradient-circles. I verified: `meet-people.tsx` now has **0** emoji.
`phone-mockup.tsx` has **10**, and `trending-today.tsx` has more. The sweep missed
them.

So the single most prominent visual on the site uses person emoji as fake avatars —
the precise pattern that was deliberately removed from the section directly below it,
where the replacement convention is already written and working.

**Fix: apply the established `meet-people.tsx` pattern.** Initials in gradient
circles for people, lucide icons for the 🔥/💬/👥 labels. This is a small, obvious,
low-risk change and it does more for "premium in three seconds" than any particle
system would.

---

## 4. No video background — and the reason is infrastructure, not taste

The spec asks for a cinematic video background: "ultra lightweight, adaptive quality,
edge streamed, battery optimized."

**On the highest-traffic page of a site whose media pipeline currently looks like
this, that is the most expensive possible decision:**

- **The Supabase 5GB egress cap was already exhausted once** (2026-07-03), and the
  symptom was silent — creator posts rendering as "no posts."
- **Media currently serves from `pub-*.r2.dev`, which is Cloudflare rate-limited and
  explicitly not for production** — it intermittently 429s under real traffic ("older
  videos/images suddenly disappear"). The custom-domain fix (`media.frenzsave.com`)
  is still outstanding, and production had a typo'd `R2_PUBLIC_BASE_URL`.
- **The CDN still isn't caching media at the edge** — `Cf-Cache-Status: DYNAMIC`,
  pending a Cloudflare Cache Rule that only you can add from the dashboard.

A hero video would therefore be the largest egress line item on the site, served from
an origin that 429s under load, uncached at the edge, to an audience on mobile data.
It would be the first thing every visitor loads and the first thing to fail.

**Design: cinematic without video.** The existing `hero-wave.tsx` SVG approach is
correct and should be extended — layered SVG/CSS gradient mesh, `transform`/`opacity`
only, no `filter` animation, `motion-safe:` gated. Bytes measured in kilobytes, not
megabytes. **Revisit video only after the Cache Rule lands and media is on a custom
domain**, and even then never as the LCP element.

**Particle systems** get the same answer: a canvas particle field is main-thread or
GPU work running forever on a mid-range Android in Africa, and the spec asks for it
alongside "minimal JavaScript" and "battery optimized." Pick the ambient SVG mesh.
Nobody has ever converted because of a particle.

---

## 5. Live demonstrations: render the real components

The spec says "instead of screenshots, use realistic simulations." We can go one
better, honestly and cheaply.

**Today's mockup is a hand-built replica** — a fake feed hand-coded in
`phone-mockup.tsx`, which drifts from the real app every time the real app changes.
It is already drifting: it advertises a "Community Chat" for a Communities product
that doesn't exist.

**Design: mount the real components inside the device frame.** The actual
`feed-post-card`, the actual chat bubble, the actual reel tile, fed by a small static
fixture. This is:

- **Honest** — it is literally the product, not an artist's impression.
- **More impressive than any mock** — it's real, and it reads as real.
- **Self-maintaining** — the mockup can't drift from the app, because it *is* the app.
- **Cheap** — the components exist and are already in the bundle for other pages.

**Constraints:** fixtures only, never live data (no queries on the critical path);
lazy and below the LCP element; a static poster frame first, interactivity on
intent; and **only for products in the `live` lane.** An *interactive simulation* of
Marketplace or AI Studio would be worse than a static false claim — it looks like
proof.

**Where the line sits, since Part 3 asks for a lot of illustrative UI:** a device
mockup depicting a real product surface with placeholder content is normal, honest
illustration. The current "3.2K plays / 128 comments" chips are fine in that frame.
What is not fine is fabricated *metrics presented as measurement* (the stats band,
Part 1 §3) or depicting a product that does not exist. Micro Story Cards™ saying
"Marketplace sale" or "AI completed your edit" fall on the wrong side of that line.
"Friend accepted" and "Video saved · 1080p · No watermark" are real things Frenz does.

---

## 6. The honest hero story is the stronger one

The spec's "first ten seconds" wants the hero to communicate Marketplace,
Professional Networking, Business, AI, Editing Studio, Cloud, Live Streaming, Life
Journey™, Activity Rank™ and Time Capsule™. **Ten of those don't exist** (Part 1 §3).

Set the honesty argument aside for a second, because the positioning argument is
better on its own terms:

*"Communication + Creativity + Marketplace + Professional + Business + AI + Cloud +
Live"* is what **every** large platform claims. It is the most generic thing a tech
company can say, and the spec explicitly forbids generic slogans. It is also
unfalsifiable, which is why visitors have learned to skim past it.

What's actually true and actually differentiated: **Frenz is a social platform with a
real, working downloader built into it.** Nobody else has that. It's the reason the
domain ranks. It's a specific, checkable, unusual claim — the opposite of "the future
of social media."

So the honest hero and the *good* hero are the same hero. The real ecosystem —
Messaging, Stories, Reels, Downloads, Notifications, Search, Profiles, Friends, Photo
Editor — is already a genuinely broad "more than social media" story, and every piece
of it survives a visitor clicking to check.

**Structure (final copy is an owner call, not mine):** one `<h1>` carrying the
category claim in plain text; `<h2>`-led sections beneath; the definitional sentence
from Part 1 §7 placed for AI-answer extraction; no keyword stuffing. The current H1
("Download. Discover. Connect.") is downloader-era and gets replaced with the
positioning change from Part 1 §2.

---

## 7. The five engines

**Hero Experience Engine™** — the hero is a variant of a typed config
(`config/hero.ts`), not a hand-built section: `{ id, h1, subhead, ctas[], showcase,
narrativeBeat }`. Seasonal themes, campaign variants, feature launches and A/B tests
are config entries chosen at **build time** (or by URL), never per request — which is
how §2's scalability asks survive contact with the 2s rule.

**Living Device Showcase™** — one device frame, real components inside (§5), rotating
between `live` surfaces on a timer that respects `prefers-reduced-motion`. Rotation is
`transform`/`opacity` cross-fade, GPU-composited, and **starts only after LCP** — the
first frame is a static poster. Devices: iPhone, Android, desktop. **Not "Future
Vision devices"** — we don't ship for hardware that doesn't exist, and a mockup on a
device we don't support is a claim we can't honour.

**Adaptive Hero Intelligence™** — §2. Campaign URLs + below-fold ordering. Never the
H1.

**Cinematic Scroll Engine™** — scroll-driven layer separation via CSS
`animation-timeline: view()` where supported, with a static fallback; never
JS-per-frame. **Nothing above the fold moves on scroll before LCP.** Fully neutralized
by the existing global `prefers-reduced-motion` guard in `globals.css`.

**Discovery Conversion Framework™** — four CTAs is three too many. The spec wants
Create Account + Watch Demo + Explore + Download App competing in one viewport;
that's a choice-paralysis pattern and it dilutes the click target that matters. One
primary (Create account — copy per the owner's *"login or create account to access
all features"*), one secondary (the demo, which is right there in the device frame).
Explore and Download live below the fold and in the nav. Measurement via the existing
analytics surface, not a new one.

---

## 8. Accessibility & performance

**Accessibility.** One `<h1>`, real `<h2>` hierarchy. The device showcase is
decorative and `aria-hidden` — a screen reader must never have to walk a fake phone
UI to reach the CTA; the real content is the headline and the buttons. Every animation
inherits the global reduced-motion guard. Dynamic Type support means the hero must
survive 200% text zoom without clipping — worth explicitly testing, since a
tightly-tuned hero is exactly where that breaks. **RTL:** hero layout uses logical
properties from the start (Part 2 §8 found the drawer already broken here). Note
`next/font` is configured `subsets: ["latin"]` — an Arabic or Cyrillic locale will
need its subset added; latin-only silently falls back today.

**Performance budget.**

| Element | Rule |
|---|---|
| LCP | The `<h1>`. Text. Never an image or video. §1. |
| CLS | Zero. Fixed hero height; no post-hydration copy swap (§2). |
| Background | SVG/CSS only. `transform`/`opacity`. Never animate `filter`/`backdrop-filter` (Part 2 §7). |
| Showcase | Static poster → animation starts post-LCP. Real components, static fixtures. |
| JS above fold | None required to paint. Hero renders without hydration. |
| Media | Zero bytes above the fold. §4. |
| Save-Data / reduced-motion | Static hero, no rotation, no drift. |

---

## 9. Build order

Slots into Part 1's order; slice 1 is independent and shippable now.

| # | Slice | Depends on |
|---|---|---|
| 1 | **Emoji fix** — `phone-mockup.tsx` + `trending-today.tsx`, using the `meet-people.tsx` pattern (§3) | — |
| 2 | `config/hero.ts` + hero as a config variant (§7) | Part 1 pillars |
| 3 | New H1/positioning copy (§6) | owner copy call |
| 4 | Device showcase → real components + static fixtures (§5) | 2 |
| 5 | Ambient SVG background upgrade, extending `hero-wave.tsx` (§4) | — |
| 6 | Scroll layer separation, `animation-timeline: view()` + fallback (§7) | 5 |
| 7 | `/solutions/*` campaign URLs (§2) | Part 2 Solutions |

---

## 10. Open questions

**Blocking, still unanswered from Part 1:**
1. **The fabricated stats band.** Remove, or wire to real counters? This one gates
   the honest-proof design in Part 1 §8 and now the hero's trust indicators too.

**Still open:** 2. Paste-link tool → `/download` or a section on `/`? 3. Ads on `/`?
4. Any `preview`-lane product in flight? 5. Primary nav: 5 items vs the spec's 9?
6. Solutions on day one with only Creators + Developers?

**New in Part 3:**
7. **Hero copy direction.** The H1 is the single highest-stakes string on the site
   and it's a brand call, not an engineering one. I can propose options, but you
   should pick. Recommend it leads with the real differentiator (§6).
8. **Emoji fix — can I just ship it?** It's a live violation of your own rule, the
   replacement pattern already exists one file over, and it's ~20 lines. §9 slice 1.
