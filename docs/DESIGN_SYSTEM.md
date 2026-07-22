# Frenz — Enterprise Design System

The permanent visual and interaction foundation every Frenz surface inherits —
web, PWA, admin, and whatever ships next. This is the governing document; the
**code registries are the source of truth**, and this file explains and links
them. Nothing here is aspirational unless the Gap Ledger says so.

> **Truth rule (shared with `docs/CONSTITUTION.md`, Article I.3):** a `live`
> entry points at a file that exists. Tests enforce it, so this system can't
> drift into describing tokens, components, motion or themes that aren't wired.

---

## 1. Philosophy

Premium, minimal, fast, accessible, consistent — and honest. A component earns
its place by being reused; anything decorative pays for itself in clarity or it
comes out. The 2-second cold-entry budget (`docs/…`, the owner's #1 rule)
outranks visual richness on every public surface.

## 2. Principles

The ten principles are data, in `lib/platform/design-system.ts`
(`DESIGN_PRINCIPLES`), so the admin surface and this doc read the same list:
clarity · consistency · hierarchy · readability · touch-comfort · accessibility ·
performance · motion-purpose · responsiveness · discoverability. Each names how
it is enforced, not just asserted.

## 3. Design tokens — one typed source, generated CSS

`lib/platform/design-tokens.ts` is the **single source of truth** for colour,
radius and motion tokens. The CSS custom properties in `app/globals.css` are
**generated** from it (`npm run tokens:generate`) between the `design-tokens`
markers, and `npm run tokens:check` (plus `design-tokens.registry.test.ts`) fails
the build if the two ever drift. Code that needs a real value (theme-color meta,
OG images, chart palettes) reads `tokenValues()` instead of hardcoding a hex.

- Brand: Electric Blue `#0A84FF` (primary) · Royal Purple `#6C4DFF` (accent).
- Radius: `--radius: 0.875rem`. Motion: `--dur-fast/dur/dur-slow`,
  `--ease-out/ease-spring`.

## 4. Component Registry

`lib/platform/component-registry.ts` catalogues every reusable building block
with its **source file, accessibility contract and motion behaviour**. Three
honest statuses:

- **live** — a real shared component (e.g. `Skeleton`, `Toast`, `Switch`,
  `QuotaGate`, the command centre, the floating download card).
- **convention** — a utility-class pattern on the tokens, not a wrapper
  component. Button, text input and card are `convention`: this app composes them
  from Tailwind on the tokens rather than shipping a `<Button>`. Saying so keeps
  the catalogue truthful.
- **planned** — named by the brief, not built (a data-grid, a date picker, an
  ARIA-complete Tabs primitive). Honest placeholders.

`component-registry.test.ts` asserts every live source exists, every entry states
an a11y + motion contract, and the archetypes are labelled honestly.

## 5. Motion language (Motion Intelligence)

`MOTION_PATTERNS` in `design-system.ts` catalogues each animation pattern, the
token/spring it uses, and — critically — **how it degrades under
`prefers-reduced-motion`**. The enforcement point is app-wide: `app/layout.tsx`
sets Framer Motion's `MotionConfig reducedMotion="user"`, and CSS keyframes are
gated behind `motion-safe:`. Nothing animates idle (battery rule). Shared spring:
`lib/motion/springs.ts`; haptics: `lib/motion/haptics.ts`; page transitions:
`features/app-shell/page-transition.tsx`.

## 6. Accessibility

`A11Y_STANDARDS` (design-system.ts) is the contract every component is held to:
WCAG AA contrast, visible `focus-visible` rings, screen-reader names on icon
controls, `role=status/alert` + `aria-live` on async feedback, keyboard-operable
dialogs (Escape + focus trap), reduced-motion, and dynamic-text resilience. Per
component, the exact requirement lives in its registry entry.

## 7. Theming

Light is the **default** (not "system") — see the theme-system decision. Dark is
a full token override; auto follows the OS via `next-themes` and the choice
persists (`components/theme-provider.tsx`). The token architecture is theme-ready:
adding a palette is a new token set + selector.

## 8. Brand

Logo/wordmark: `components/brand/frenz-logo.tsx`. Icons are **bare glyphs, no
background** (`components/icons/*`, the icon-system decision) — the wrapping
control owns the accessible name. Gradients and glows derive from `BRAND_TOKENS`,
never a one-off hex.

## 9. Design Intelligence (adoption)

`npm run design:adoption` walks the source tree and reports, per registered
component, how many distinct files import it — by its `@/…` alias or a sibling
relative path. The counting core (`lib/platform/design-adoption.ts`) is pure and
unit-tested; **no number is fabricated** — a component nobody imports reads 0.
It is a CLI/build analytic (the request-time admin page has no source tree), so
the admin **Design system** panel shows the real registry composition and names
this command rather than printing an invented figure.

## 10. Admin surface

`/admin → Design system` (`features/admin/design-catalog.tsx`) renders the whole
system read-only from the registries: principles, the component registry grouped
by category with each a11y + motion contract, the motion language, accessibility
standards, themes and the token count.

---

## Gap Ledger (honest)

What the brief names that is **not** built, and why — never implied as done:

| Capability | Status | Note |
|---|---|---|
| Brand / seasonal themes | planned | Token architecture supports extra palettes; none authored yet. |
| RTL layouts | planned | Deferred until an RTL locale ships (i18n catalogue is ready). |
| Data-grid, date picker, Tabs primitive | planned | Lists/cards/inline tabs cover current needs; no ARIA-complete shared primitives yet. |
| Native app remote UI config | planned | No native apps in this repo (Next.js PWA). |
| Remote/admin-published token editing | partial | Tokens are code + generated CSS today (safer, reviewable); a live token editor is deliberately not built. |
| Adoption in the admin UI | by design | Adoption needs a source scan; surfaced via `design:adoption`, not fabricated at request time. |

Everything else in §§2–10 is live and tested.
