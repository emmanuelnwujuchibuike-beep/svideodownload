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

import { LANGUAGES } from "./languages";
import { catalogueCoverage } from "./messages";

/**
 * Every locale the app ships strings for (owner, 2026-08-09: "configure all
 * languages in the language selector").
 *
 * ── Why this is a code list and not 50 hand-written objects ──────────────────
 * `./languages` already holds the code, the English name and the endonym for
 * each of these — it is the table the picker renders. Repeating all of that
 * here would be a second copy of 50 rows, and the two would disagree within a
 * month. This declares only what `languages.ts` does NOT know: which codes are
 * locales we translate, their text direction, and their `Intl` tag.
 *
 * Order matters only for the switcher; the picker sorts by availability anyway.
 */
export const LOCALE_CODES = [
  "en", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur",
  "id", "de", "ja", "sw", "mr", "te", "tr", "ta", "vi", "ko",
  "it", "th", "gu", "fa", "pl", "uk", "ms", "kn", "pa", "ro",
  "nl", "yo", "ig", "ha", "am", "zu", "fil", "el", "cs", "sv",
  "hu", "he", "da", "fi", "no", "sk", "sr", "hr", "bg", "ne",
] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

/**
 * Right-to-left scripts. Getting this wrong is not cosmetic: the browser's bidi
 * algorithm reorders the line, so an RTL language rendered LTR puts punctuation
 * on the wrong end and scrambles any line mixing it with Latin text or digits.
 */
const RTL: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

/**
 * BCP 47 tags that differ from the bare language code.
 *
 * Only the ones where `Intl` needs the difference — `no` resolves badly in some
 * runtimes and `nb` (Bokmål) is the written standard; `zh` needs a script
 * subtag to pick Simplified; `fil` is the standardised form of Tagalog.
 * Everything else formats correctly from its plain code.
 */
const BCP47: Readonly<Record<string, string>> = {
  no: "nb",
  zh: "zh-Hans",
  fil: "fil-PH",
  pt: "pt-PT",
};

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

/**
 * Built by joining `LOCALE_CODES` with the names in `./languages`.
 *
 * A code with no row there would be a locale the picker cannot even label, so
 * it is dropped rather than rendered as a bare code — and `i18n.test.ts`
 * asserts every declared code resolves, so the drop can never happen silently.
 */
export const LOCALES: Locale[] = LOCALE_CODES.flatMap((code) => {
  const meta = LANGUAGES.find((l) => l.code === code);
  if (!meta) return [];
  return [
    {
      code,
      name: meta.name,
      endonym: meta.native,
      direction: (RTL.has(code) ? "rtl" : "ltr") as TextDirection,
      bcp47: BCP47[code] ?? code,
    },
  ];
});

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
 * Fraction of strings translated, 0 to 1 — MEASURED from the catalogue.
 *
 * This used to be a hand-maintained table declaring `en: 1`, with a note saying
 * it was a placeholder for a measurement. It has been replaced by the
 * measurement. A coverage number that has to be remembered is wrong the first
 * time anyone adds a string, and it is wrong in the dangerous direction: it
 * reports a locale as complete while new keys quietly fall back to English.
 *
 * Counting the real catalogue means a locale becomes offerable the moment it is
 * genuinely translated and stops being offerable the moment the key space grows
 * past it, with nobody having to notice either event.
 */
export function coverage(code: LocaleCode): number {
  return catalogueCoverage(code);
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
