/**
 * Global Experience Platform™ — locale registry.
 *
 * ── The truth problem, again ──────────────────────────────────────────────────
 *
 * The obvious implementation declares twenty locales and ships a language
 * switcher. That would be the same fabrication the Reality Ledger exists to stop:
 * a switcher offering Swahili when no Swahili strings exist sends someone to a
 * page that is still in English, having promised otherwise. It is worse than no
 * switcher, because it wastes a choice and breaks a stated commitment.
 *
 * So locales are DECLARED here and their availability is DERIVED from whether
 * translations actually exist — the same mechanism as school availability and
 * Gateway destinations. A locale with no strings resolves to `planned` and is
 * never offered as something you can switch to today.
 *
 * ── Why these locales ─────────────────────────────────────────────────────────
 *
 * The audience is Africa-primary (the deploy region is cdg1/Paris specifically to
 * sit close to it). So the list leads with the languages that actually serve that
 * audience rather than the default European set a template would pick: French and
 * Arabic are the two largest non-English languages across the continent, Swahili
 * covers East Africa, Portuguese covers Angola and Mozambique, and Hausa covers
 * northern Nigeria and the Sahel.
 *
 * This is a declaration of INTENT and a routing plan. It is not a claim that any
 * of it is translated — see `localeAvailability`.
 */

export type LocaleCode = "en" | "fr" | "ar" | "sw" | "pt" | "ha";

export type TextDirection = "ltr" | "rtl";

export interface Locale {
  code: LocaleCode;
  /** English name, for admin and code. */
  name: string;
  /** The language's own name — what a switcher must show a speaker of it. */
  endonym: string;
  direction: TextDirection;
  /**
   * BCP 47 tag used for `Intl` formatting.
   *
   * Distinct from `code` because formatting is regional, not just linguistic:
   * `fr-FR` and `fr-CA` share a language and disagree about dates. Keeping them
   * separate means a locale can be added for a region without duplicating the
   * language.
   */
  bcp47: string;
}

export const LOCALES: Locale[] = [
  { code: "en", name: "English", endonym: "English", direction: "ltr", bcp47: "en" },
  { code: "fr", name: "French", endonym: "Français", direction: "ltr", bcp47: "fr" },
  { code: "ar", name: "Arabic", endonym: "العربية", direction: "rtl", bcp47: "ar" },
  { code: "sw", name: "Swahili", endonym: "Kiswahili", direction: "ltr", bcp47: "sw" },
  { code: "pt", name: "Portuguese", endonym: "Português", direction: "ltr", bcp47: "pt" },
  { code: "ha", name: "Hausa", endonym: "Hausa", direction: "ltr", bcp47: "ha" },
];

/**
 * The locale everything falls back to, and the only one currently written.
 *
 * `DEFAULT_LOCALE` is deliberately not "the site has no locale". Naming the
 * default as a real locale is what lets the rest of the system treat English as
 * one option among several rather than as an unmarked ground truth — which is the
 * assumption that makes retrofitting i18n painful later.
 */
export const DEFAULT_LOCALE: LocaleCode = "en";

/* -------------------------------- availability ------------------------------- */

export type LocaleAvailability = "live" | "partial" | "planned";

/**
 * Locales with translated strings, and how complete they are.
 *
 * Today this is English only, stated plainly rather than padded. When the
 * translation pipeline (0086 `locales`/`translations`) begins producing strings,
 * this is derived from coverage instead of declared — the declaration is a
 * placeholder for a measurement, and it is marked as such so nobody mistakes it
 * for a claim that six languages ship.
 */
const TRANSLATION_COVERAGE: Partial<Record<LocaleCode, number>> = {
  en: 1,
};

/** Fraction of strings translated, 0 to 1. */
export function coverage(code: LocaleCode): number {
  return TRANSLATION_COVERAGE[code] ?? 0;
}

/**
 * Whether a locale can be offered.
 *
 * Fail-closed, and the threshold is high on purpose. A locale that is 40%
 * translated produces pages that switch language mid-sentence, which reads as
 * broken rather than partial — so `partial` starts at 90%, and anything below
 * that is `planned` and never offered.
 */
export function localeAvailability(code: LocaleCode): LocaleAvailability {
  const done = coverage(code);
  if (done >= 1) return "live";
  if (done >= 0.9) return "partial";
  return "planned";
}

/** Locales a visitor may actually switch to. What a language switcher renders. */
export function availableLocales(): Locale[] {
  return LOCALES.filter((l) => localeAvailability(l.code) !== "planned");
}

/* ----------------------------------- reads ----------------------------------- */

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export function getLocale(code: string): Locale | undefined {
  return BY_CODE.get(code as LocaleCode);
}

export function isRtl(code: LocaleCode): boolean {
  return BY_CODE.get(code)?.direction === "rtl";
}

/**
 * Best supported locale for an `Accept-Language` header.
 *
 * Only ever returns something available, so content negotiation cannot route
 * someone to a locale that has no strings. Quality values are respected, because
 * a browser sending `fr;q=0.9, en;q=0.8` is expressing a genuine preference order
 * and ignoring it is how sites end up serving people their third choice.
 */
export function negotiate(acceptLanguage: string | null | undefined): LocaleCode {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const available = new Set(availableLocales().map((l) => l.code));

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return {
        // `fr-CA` should match the `fr` locale — compare on the primary subtag.
        code: tag!.trim().toLowerCase().split("-")[0]! as LocaleCode,
        q: q ? Number.parseFloat(q.split("=")[1] ?? "0") : 1,
      };
    })
    .filter((entry) => !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  return ranked.find((entry) => available.has(entry.code))?.code ?? DEFAULT_LOCALE;
}
