# Enterprise Globalization Platform

One globalization layer — localization, internationalization, regionalization,
multi-currency, timezones and cultural adaptation — across every current and future
Frenzsave workspace. This document is the human-readable companion to the
machine-readable registry in
[`lib/platform/globalization-platform.ts`](../lib/platform/globalization-platform.ts),
kept honest by
[`globalization-platform.test.ts`](../lib/platform/globalization-platform.test.ts).

## The one rule that governs everything here

**A switcher that offers a language we have not translated is worse than no
switcher.** It spends a visitor's choice and breaks a stated promise, sending them
to a page that is still in English having said otherwise. So this platform is built
on a single invariant, the same one the Reality Ledger enforces sitewide:

> Locales are **declared** as a routing plan; their availability is **derived** from
> whether translations actually exist. Coverage is **measured** from the catalogue,
> never hand-declared.

Nothing in this platform can claim a translation, a currency or a timezone it does
not actually have — and a test fails the build if it tries.

## Position: honest about what exists

The globalization *substrate* is real and well-built, and it is smaller than the
brief. The registry says so rather than papering over it. What runs today is the
internationalization foundation; most *localized surfaces* are still English-only,
and that is shown plainly as the localization frontier.

## What runs today

| Layer | Reality | Anchor |
|---|---|---|
| Locale registry | 6 declared locales (Africa-primary), availability derived from measured coverage | `lib/i18n/locales.ts` |
| Language detection | Accept-Language negotiation with quality-value ordering; never routes to an unavailable locale | `lib/i18n/locales.ts` |
| Localization service | Per-key fallback to English; `translator(locale)` binds a locale | `lib/i18n/messages/index.ts` |
| Translation catalogue | Typed English key space every locale is checked against | `lib/i18n/messages/en.ts` |
| Formatting | Intl dates/times/numbers/currency/relative/lists/bytes, cached, per locale | `lib/i18n/format.ts` |
| Text direction | `isRtl` drives `<html dir>`, so RTL can't mis-render | `lib/i18n/locales.ts` → `app/layout.tsx` |
| hreflang | Emitted only for locales past the coverage gate; default unprefixed | `lib/i18n/alternates.ts` |
| Translation pipeline | status / export / import; `{en, translation}` JSON → typed TS; **no machine step** | `scripts/i18n.mjs` |
| Coverage analytics | Measured from the real catalogue, surfaced per locale | `lib/i18n/messages/index.ts` |
| Admin | This registry rendered read-only, with locale coverage | `features/admin/globalization-catalog.tsx` |

## Why formatting ships before translation

Formatting and translation are independent, and conflating them is why sites show
`07/04` to someone who reads it as the seventh of April. A date read wrongly is
*silently incorrect* — worse than a date in the wrong language, which is at least
obviously foreign. So `lib/i18n/format.ts` is fully live and keyed on the visitor's
locale with zero translated strings required. It is built on `Intl` (already in
every runtime, carries CLDR, costs no bundle bytes) rather than a formatting
library that would ship locale tables the platform already has.

## Currency

Currency **formatting** is live and locale-correct, with denomination as an
explicit, un-inferred argument — a French speaker in Senegal is not paying in euros,
and guessing wrong on a price is worse than showing a currency code. Display pricing
is admin-set per tier (`lib/monetization/pricing.ts`). Multi-currency display, live
FX conversion, payout currencies and regional tax are `planned`; the revenue
mechanics themselves are owned by the **Commerce Registry**.

## Time zones

Time **display** is locale-aware today. Quiet-hours delivery windows are honoured —
but stored and compared in **UTC hours**, not the recipient's zone, so the registry
marks quiet hours `partial` and does not overstate it as timezone support. Automatic
detection, a stored per-user/workspace timezone, timezone-aware scheduling, calendar
integration and AI scheduling awareness are `planned`.

## The localized-surface frontier

The brief lists ~19 workspaces to localize. Today only the marketing header/footer
chrome, the Help Center's hreflang and the SEO alternates are wired to the catalogue
(`partial`); the web app, PWA, downloader pages, messaging, communities, marketplace,
cloud, AI Studio, business/professional/developer/admin surfaces and documentation
are `planned`. **Native iOS and Android are `planned` and noted as non-existent —
Frenz is a Next.js PWA, not a native app.** Every future workspace inherits this
platform automatically the moment its chrome reads the catalogue.

## Honestly planned

Named by the brief, not built — marked `planned` (or `partial` where only a subset
is real) in the registry:

- **Content translation** — the `translations`/`locales` tables in migration
  `0086` model the `missing → machine → reviewed → approved` workflow and staleness
  against `source_version`, but nothing reads them yet, so the service is `partial`
  (data plane only), not live.
- **Regional formats** — localized collation (sorting), locale-aware searching,
  measurement units, address/phone formats, paper sizes and holiday calendars.
- **Localization Intelligence (AI)** — translation assistance, localization QA,
  content-language detection, regional recommendations, content adaptation and
  accessibility improvements. The absence of AI *machine translation* is a
  **deliberate** position, not a gap: `0086` treats `machine` as a status a human
  must review before it counts, and an auto-filled catalogue would flip a locale to
  100%, switch the site into a language nobody has read, and look identical in the
  coverage table to work a human actually did.

## Accessibility & inclusivity

Right-to-left layout is live (driven from the registry, not a hardcoded list), and
the motion system already honours `prefers-reduced-motion`. Localized screen-reader
labels, dynamic text scaling and localized voice/keyboard interfaces are `planned`;
the component-level a11y contracts are owned by the **Component Registry**.

## The locale routing tree is deliberately not built

Restructuring the ~200 routes under `/[locale]` today would prerender ~200 pages of
English at French URLs — the gate belongs *before* the routes. It gets built when a
locale actually passes the 90% coverage gate, at which point hreflang, the switcher
and content negotiation all light up with no further work because they already read
`availableLocales()`.

## Governance

The registry is subject to the constitution's truth rule
([`docs/CONSTITUTION.md`](./CONSTITUTION.md), Article I.3): a `live`/`partial` row
must point at a file that exists, and a `planned` row must name none. The fail-closed
locale rule is asserted too — English is live, and any locale with zero strings is
`planned`, never offerable. The operator view is the admin **Globalization** section
(under System).
