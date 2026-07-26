/**
 * The Enterprise Globalization Platform, described by itself.
 *
 * The brief asks for a Localization Service, Translation Service, Language
 * Detection Service, Regional Configuration, Currency Service, Timezone Service,
 * Formatting Service, a Localization Registry, analytics, monitoring and an admin
 * dashboard — spanning every current and future Frenzsave workspace, in every
 * language, currency and timezone. As with the eight platform maps before it
 * (Config, Design, Engineering, Data, Search, Media, Notifications, Commerce), the
 * honest starting point is that a real substrate ALREADY EXISTS and is smaller than
 * the brief — so this file maps what's live and marks the rest `planned`, never
 * implied as done.
 *
 * What EXISTS today (do not rebuild):
 *   - the locale registry with DERIVED availability + Accept-Language negotiation
 *     (`lib/i18n/locales.ts`),
 *   - the typed UI-string catalogue with per-key English fallback and MEASURED
 *     coverage (`lib/i18n/messages/*`),
 *   - Intl-based formatting for dates/times/numbers/currency/relative/lists
 *     (`lib/i18n/format.ts`),
 *   - honest hreflang, gated on real coverage (`lib/i18n/alternates.ts`),
 *   - the translation pipeline — status/export/import, NO machine step
 *     (`scripts/i18n.mjs`),
 *   - the content-translation data plane, modelled but not yet consumed
 *     (`supabase/migrations/0086_editorial_workflow.sql`).
 *
 * The heart of this platform is a single truth rule, the same one the Reality
 * Ledger enforces everywhere else: a switcher that offers a language we have not
 * translated is WORSE than no switcher — it spends a visitor's choice and breaks a
 * stated promise. So locales are DECLARED and their availability is DERIVED from
 * whether strings actually exist; nothing here can claim a translation it does not
 * have.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `globalization-platform.test.ts`: a `live`/`partial` row must point
 * at a file that exists; a `planned` row must not pretend to.
 */

import {
  LOCALES,
  coverage,
  localeAvailability,
  type Locale,
  type LocaleAvailability,
  type LocaleCode,
} from "../i18n/locales";

export type GlobalizationStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a subset of the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every source-backed catalogue row satisfies. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: GlobalizationStatus;
}

/* ─────────────────────────────── services ───────────────────────────────────
 * The brief's Backend Architecture list, mapped to the real provider of each
 * capability. Several rows point at the same i18n module because they are
 * genuinely distinct capabilities of it (a locale registry, a negotiator and a
 * regional-config resolver all live in `locales.ts`); the id is what must be
 * unique, not the source.
 */

export interface GlobalizationService extends CatalogueEntry {
  name: string;
  capability: string;
  note?: string;
}

export const GLOBALIZATION_SERVICES: GlobalizationService[] = [
  { id: "locale-registry", name: "Localization Registry", source: "lib/i18n/locales.ts", status: "live", capability: "Declares supported locales (code, English name, endonym, text direction, BCP-47) and derives availability from measured coverage — the single source a switcher, negotiation and hreflang all read." },
  { id: "localization", name: "Localization Service", source: "lib/i18n/messages/index.ts", status: "live", capability: "Resolves a UI string for a locale with per-key fallback to English; `translator(locale)` binds a locale so call sites stay `t(\"nav.pricing\")`.", note: "Falls back per KEY, not per locale, so one untranslated string degrades to English in place rather than taking a page down." },
  { id: "catalogue", name: "Translation Catalogue", source: "lib/i18n/messages/en.ts", status: "live", capability: "The English source of truth; defines the typed key space every other locale is type-checked against. UI strings compile from here, content translations from the DB." },
  { id: "translation-pipeline", name: "Translation Management", source: "scripts/i18n.mjs", status: "live", capability: "status / export / import — translators get {en, translation} JSON that compiles to typed TS; versioning is git; placeholder + unknown-key validation refuse a bad file.", note: "No machine-translation step, deliberately: 0086 treats `machine` as a status that must be human-reviewed before it counts." },
  { id: "content-translation", name: "Content Translation Service", source: "supabase/migrations/0086_editorial_workflow.sql", status: "partial", capability: "The `translations` table models the missing → machine → reviewed → approved workflow and staleness against `source_version`; the `locales` table mirrors the code registry.", note: "The data plane is applied, but no read path or authoring UI is wired yet — chrome translation is live via the pipeline; article translation is schema-only." },
  { id: "language-detection", name: "Language Detection Service", source: "lib/i18n/locales.ts", status: "live", capability: "Accept-Language content negotiation with quality-value ordering; `negotiate()` only ever returns an available locale, so it can never route someone to a language with no strings.", note: "Header-based detection is live; ML detection of a piece of content's language is in the AI layer, planned." },
  { id: "regional-config", name: "Regional Configuration Service", source: "lib/i18n/locales.ts", status: "partial", capability: "Each locale carries a BCP-47 region tag (fr-FR vs fr-CA disagree about dates) that drives formatting, kept separate from the language code so a region can be added without duplicating a language.", note: "Region tags + defaults exist; per-region overrides for units, addresses, phone formats, paper sizes and holidays are planned." },
  { id: "formatting", name: "Formatting Service", source: "lib/i18n/format.ts", status: "live", capability: "Intl-based dates, times, relative time, numbers, compact counts, currency, lists, bytes and duration — cached, keyed on the visitor's locale, zero bundle cost.", note: "Ships and pays off before any string is translated: a date read wrongly is silently incorrect, worse than a date in the wrong language." },
  { id: "currency", name: "Currency Service", source: "lib/i18n/format.ts", status: "partial", capability: "Locale-aware currency formatting (`formatCurrency`) with denomination as an explicit, un-inferred argument — a French speaker in Senegal is not paying in euros.", note: "Formatting is live; multi-currency conversion, regional tax and payout currencies are planned (revenue itself is owned by the Commerce Registry)." },
  { id: "timezone", name: "Timezone Service", source: "lib/social/notification-settings.ts", status: "partial", capability: "Time display is locale-aware via Intl; quiet-hours delivery windows are honored (`isWithinQuietHours`).", note: "Quiet hours are stored and compared in UTC hours, not a per-user timezone — automatic detection, a stored user/workspace tz and tz-aware scheduling are planned." },
  { id: "alternates", name: "Localization SEO (hreflang)", source: "lib/i18n/alternates.ts", status: "live", capability: "Emits hreflang alternates only for locales that pass the coverage gate; the default locale stays unprefixed. Wrong hreflang is worse than absent — it advertises translations that don't work.", note: "With one locale live this correctly emits only x-default; every page gains a real alternate automatically the moment a locale lands." },
  { id: "analytics", name: "Localization Analytics", source: "lib/i18n/messages/index.ts", status: "partial", capability: "Coverage is MEASURED from the real catalogue (`catalogueCoverage`) rather than declared, and surfaced per locale in the admin view.", note: "Completeness is live and honest; per-locale adoption, engagement and regional-growth analytics are planned." },
  { id: "monitoring", name: "Localization Monitoring", source: "lib/i18n/i18n.test.ts", status: "partial", capability: "Build-time gates: never offer an untranslated locale, never render a raw key, no unused key, hreflang honesty and a pipeline round-trip that catches a dropped placeholder.", note: "Correctness is monitored at build time; runtime coverage dashboards and drift alerts are planned." },
  { id: "admin", name: "Localization Administration", source: "features/admin/globalization-catalog.tsx", status: "live", capability: "The operator view — this registry rendered read-only, with locale coverage and the honest live/partial/planned status of every capability." },
  { id: "registry", name: "Globalization Platform Registry", source: "lib/platform/globalization-platform.ts", status: "live", capability: "This file — the catalogued map every workspace inherits: locales, services, regional formats, currency + timezone capabilities, localized surfaces and the AI layer." },
];

/* ─────────────────────────── supported locales ──────────────────────────────
 * A VIEW over the locale registry, not a second declaration. Availability is
 * derived from measured coverage, so this cannot drift into claiming a language
 * it has not translated — the honesty is structural, not maintained. This is why
 * it isn't a source-backed CatalogueEntry: its truth comes from the coverage
 * gate, not from pointing at a file.
 */

export interface SupportedLocale {
  code: LocaleCode;
  name: string;
  endonym: string;
  direction: Locale["direction"];
  bcp47: string;
  availability: LocaleAvailability;
  /** 0-100, measured from the catalogue. */
  coveragePct: number;
}

export function getSupportedLocales(): SupportedLocale[] {
  return LOCALES.map((l) => ({
    code: l.code,
    name: l.name,
    endonym: l.endonym,
    direction: l.direction,
    bcp47: l.bcp47,
    availability: localeAvailability(l.code),
    coveragePct: Math.round(coverage(l.code) * 100),
  }));
}

/* ─────────────────────────── regional formats ───────────────────────────────
 * The brief's Regionalization + localized-sorting/searching sections, mapped to
 * the real formatter that provides each — or honestly `planned`.
 */

export interface RegionalFormat extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const REGIONAL_FORMATS: RegionalFormat[] = [
  { id: "date", name: "Date formats", source: "lib/i18n/format.ts", status: "live", description: "`formatDate` — locale date styles via Intl, so 07/04 never means the wrong month." },
  { id: "time", name: "Time formats", source: "lib/i18n/format.ts", status: "live", description: "`formatTime` — 12- vs 24-hour is left to the locale, not second-guessed." },
  { id: "relative-time", name: "Relative time", source: "lib/i18n/format.ts", status: "live", description: "`formatRelative` — \"3 days ago\", choosing the largest natural unit." },
  { id: "number", name: "Number formats", source: "lib/i18n/format.ts", status: "live", description: "`formatNumber` — grouping and decimal separators per locale (1,234.5 vs 1.234,5)." },
  { id: "compact-number", name: "Compact numbers", source: "lib/i18n/format.ts", status: "live", description: "`formatCompact` — \"1.2K\", formatting a real count, never a rounded-up impression." },
  { id: "currency-format", name: "Currency display", source: "lib/i18n/format.ts", status: "live", description: "`formatCurrency` — locale placement + symbol; denomination is explicit, never inferred from locale." },
  { id: "list", name: "List formatting", source: "lib/i18n/format.ts", status: "live", description: "`formatList` — the locale's own conjunction and separators (Arabic uses a different comma entirely)." },
  { id: "bytes", name: "File sizes", source: "lib/i18n/format.ts", status: "live", description: "`formatBytes` — binary units, localised number." },
  { id: "duration", name: "Media duration", source: "lib/i18n/format.ts", status: "live", description: "`formatDuration` — positional h:mm:ss, needs no translation." },
  { id: "text-direction", name: "Text direction (RTL/LTR)", source: "lib/i18n/locales.ts", status: "live", description: "`isRtl` drives `<html dir>` in app/layout.tsx, so a stale dir can't mis-render an RTL page regardless of translation quality." },
  { id: "regional-defaults", name: "Regional defaults", source: "lib/i18n/locales.ts", status: "partial", description: "`negotiate()` resolves a starting locale from the browser; currency is never inferred from it, by design.", note: "Locale + region defaults are live; a full regional-defaults profile (units, first day of week, etc.) is planned." },
  { id: "collation", name: "Localized sorting (collation)", source: "", status: "planned", description: "Intl.Collator-based ordering so lists sort the way each language expects." },
  { id: "search-i18n", name: "Localized searching", source: "", status: "planned", description: "Locale-aware stemming/normalisation in the search index (owned by the Search & Discovery Registry).", note: "The index is live and English-tuned today; multilingual analysis is planned there." },
  { id: "units", name: "Measurement units", source: "", status: "planned", description: "Metric/imperial unit formatting via Intl unit styles." },
  { id: "address", name: "Address formats", source: "", status: "planned", description: "Per-country address field order and labels." },
  { id: "phone", name: "Phone number formats", source: "", status: "planned", description: "E.164 parsing + national display formatting." },
  { id: "paper", name: "Paper sizes", source: "", status: "planned", description: "A4 vs Letter defaults for any print/PDF output." },
  { id: "holidays", name: "Holiday calendars", source: "", status: "planned", description: "Regional holiday awareness where a feature needs it." },
];

/* ─────────────────────────── currency capabilities ──────────────────────────
 * The brief's Multi-Currency section, through the globalization lens. The revenue
 * mechanics themselves are owned by the Commerce Registry; this catalogue is about
 * DISPLAYING and DENOMINATING money correctly across regions.
 */

export interface CurrencyCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const CURRENCY_CAPABILITIES: CurrencyCapability[] = [
  { id: "currency-display", name: "Currency formatting", source: "lib/i18n/format.ts", status: "live", description: "Locale-correct symbol placement and grouping for any ISO currency." },
  { id: "display-pricing", name: "Display pricing", source: "lib/monetization/pricing.ts", status: "partial", description: "Admin-set price strings per tier, including the currency symbol, changeable without a redeploy.", note: "A single denomination is shown today; per-region price sets are planned." },
  { id: "subscription-currency", name: "Subscription billing currency", source: "lib/paystack/paystack.ts", status: "partial", description: "Subscriptions are charged in the currency configured on the Paystack plan.", note: "The provider handles the charge currency; in-app multi-currency selection is planned." },
  { id: "multi-currency-display", name: "Multiple display currencies", source: "", status: "planned", description: "Let a visitor see prices in their own currency." },
  { id: "fx", name: "Currency conversion (FX)", source: "", status: "planned", description: "Live rates + rounding rules to convert a base price for display or settlement." },
  { id: "payout-currency", name: "Payout currencies", source: "", status: "planned", description: "Creator/seller payouts in local currency (Commerce Registry: payouts are concept-stage)." },
  { id: "regional-tax", name: "Regional tax calculation", source: "", status: "planned", description: "VAT/GST/sales-tax computation by billing region." },
  { id: "multi-currency-invoice", name: "Multi-currency invoices", source: "", status: "planned", description: "Formal invoices denominated per region (Commerce Registry: invoicing is planned)." },
];

/* ─────────────────────────── timezone capabilities ──────────────────────────
 * The brief's Time Zones section. Time DISPLAY is locale-aware today; genuine
 * per-user timezone AWARENESS (detection, storage, scheduling) is mostly planned,
 * and this catalogue is careful not to overstate the UTC-window quiet hours as
 * true timezone support.
 */

export interface TimezoneCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const TIMEZONE_CAPABILITIES: TimezoneCapability[] = [
  { id: "time-display", name: "Locale-aware time display", source: "lib/i18n/format.ts", status: "live", description: "Times and relative times render in the visitor's locale conventions via Intl." },
  { id: "quiet-hours", name: "Quiet-hours delivery windows", source: "lib/social/notification-settings.ts", status: "partial", description: "Notifications honour a quiet-hours window before pushing.", note: "The window is stored/compared in UTC hours, not the recipient's timezone — accurate for a fixed schedule, not for a traveller." },
  { id: "auto-detection", name: "Automatic timezone detection", source: "", status: "planned", description: "Resolve the visitor's IANA zone from the browser (Intl.DateTimeFormat().resolvedOptions().timeZone)." },
  { id: "manual-selection", name: "Manual timezone selection", source: "", status: "planned", description: "Let a user pick and store their zone." },
  { id: "user-preference", name: "Per-user timezone preference", source: "", status: "planned", description: "A stored zone that drives every timestamp shown to that user." },
  { id: "workspace-preference", name: "Workspace / organization timezone", source: "", status: "planned", description: "A shared default zone for a team's schedules and reports." },
  { id: "tz-scheduling", name: "Timezone-aware scheduling", source: "", status: "planned", description: "Schedules that fire at a local wall-clock time (content_schedules store UTC today)." },
  { id: "calendar", name: "Calendar integration", source: "", status: "planned", description: "Export/sync events with correct zone information." },
  { id: "ai-scheduling", name: "AI scheduling awareness", source: "", status: "planned", description: "Assistant picks send/publish times aware of the recipient's zone." },
];

/* ─────────────────────────── localization surfaces ──────────────────────────
 * The brief's Localization workspace list — every surface that should eventually
 * read the catalogue. This is the localization FRONTIER: which surfaces are wired
 * to the i18n substrate today, and which are not. It is deliberately honest that
 * almost everything is still English-only — the value is showing exactly where the
 * next translation work connects.
 */

export interface LocalizationSurface {
  id: string;
  label: string;
  /** How its chrome reaches the catalogue today. Empty ONLY when `planned`. */
  source: string;
  status: GlobalizationStatus;
  note?: string;
}

export const LOCALIZATION_SURFACES: LocalizationSurface[] = [
  { id: "website", label: "Website (marketing)", source: "components/layout/site-header.tsx", status: "partial", note: "Header + footer chrome read the catalogue (labelKey/translator); the rest of the marketing copy is English-only." },
  { id: "help-center", label: "Help Center", source: "app/(marketing)/help/page.tsx", status: "partial", note: "Wired for hreflang alternates; article bodies are English (content plane is schema-only)." },
  { id: "seo", label: "SEO / structured data", source: "lib/i18n/alternates.ts", status: "partial", note: "hreflang derives from real availability across pages that call it." },
  { id: "web-app", label: "Web App", source: "", status: "planned" },
  { id: "pwa", label: "PWA", source: "", status: "planned", note: "Shares the web chrome; a localised manifest/install flow is not built." },
  { id: "native-ios", label: "Native iOS", source: "", status: "planned", note: "No native app exists — Frenz is a Next.js PWA." },
  { id: "native-android", label: "Native Android", source: "", status: "planned", note: "No native app exists — Frenz is a Next.js PWA." },
  { id: "downloader", label: "Downloader", source: "", status: "planned", note: "The generated downloader pages hold the search traffic and are English." },
  { id: "messaging", label: "Messaging", source: "", status: "planned" },
  { id: "communities", label: "Communities", source: "", status: "planned" },
  { id: "marketplace", label: "Marketplace", source: "", status: "planned", note: "Concept-stage product." },
  { id: "cloud", label: "Cloud", source: "", status: "planned" },
  { id: "ai-studio", label: "AI Studio", source: "", status: "planned" },
  { id: "business", label: "Business", source: "", status: "planned" },
  { id: "professional", label: "Professional", source: "", status: "planned" },
  { id: "developer", label: "Developer Platform", source: "", status: "planned" },
  { id: "admin-platform", label: "Administrative Platform", source: "", status: "planned", note: "Operator-only, English by policy for now." },
  { id: "documentation", label: "Documentation", source: "", status: "planned" },
  { id: "future", label: "Future workspaces", source: "", status: "planned", note: "Inherit the platform automatically the moment their chrome reads the catalogue." },
];

/* ─────────────────────────── AI (Localization Intelligence) ──────────────────
 * The brief's AI Platform Integration. None built — and the absence of the first
 * row is a DELIBERATE product position, not a gap: the pipeline has no machine
 * translation because 0086 treats `machine` as a status requiring human review,
 * and an auto-filled catalogue is indistinguishable in the coverage table from
 * human work while reading as careless in five languages. Each row is `planned`.
 */

export interface GlobalizationAiCapability extends CatalogueEntry {
  name: string;
  description: string;
}

export const GLOBALIZATION_AI: GlobalizationAiCapability[] = [
  { id: "translation-assist", name: "AI translation assistance", source: "", status: "planned", description: "Suggested drafts a human reviews before they count — never an auto-published `machine` status." },
  { id: "localization-qa", name: "Localization quality checks", source: "", status: "planned", description: "Flags mistranslations, dropped placeholders and tone drift." },
  { id: "language-detection-ai", name: "Content language detection", source: "", status: "planned", description: "ML detection of the language of a piece of content (header negotiation is live, this is not)." },
  { id: "regional-recs", name: "Regional recommendations", source: "", status: "planned", description: "Suggests locale/currency/format defaults from signals." },
  { id: "content-adaptation", name: "Content adaptation", source: "", status: "planned", description: "Culturally adapts examples, imagery and phrasing per region." },
  { id: "a11y-improvements", name: "Accessibility improvements", source: "", status: "planned", description: "Localised alt text and reading-level adjustments per language." },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getGlobalizationServices(): GlobalizationService[] {
  return GLOBALIZATION_SERVICES;
}
export function getRegionalFormats(): RegionalFormat[] {
  return REGIONAL_FORMATS;
}
export function getCurrencyCapabilities(): CurrencyCapability[] {
  return CURRENCY_CAPABILITIES;
}
export function getTimezoneCapabilities(): TimezoneCapability[] {
  return TIMEZONE_CAPABILITIES;
}
export function getLocalizationSurfaces(): LocalizationSurface[] {
  return LOCALIZATION_SURFACES;
}
export function getGlobalizationAi(): GlobalizationAiCapability[] {
  return GLOBALIZATION_AI;
}

/** Every source-backed row, for the platform-health summary + teeth. */
export function globalizationPlatformEntries(): CatalogueEntry[] {
  return [
    ...GLOBALIZATION_SERVICES,
    ...REGIONAL_FORMATS,
    ...CURRENCY_CAPABILITIES,
    ...TIMEZONE_CAPABILITIES,
    ...LOCALIZATION_SURFACES,
    ...GLOBALIZATION_AI,
  ];
}
