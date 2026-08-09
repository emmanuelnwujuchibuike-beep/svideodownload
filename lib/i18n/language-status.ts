import { LOCALES, localeAvailability, type LocaleCode } from "./locales";

/**
 * What picking a language in the header switcher will actually DO.
 *
 * ── Why this exists (owner, 2026-08-09: "the language selections still doesn't
 *    work") ────────────────────────────────────────────────────────────────────
 *
 * It doesn't, and nothing on screen admitted it. Measured on 2026-08-09:
 *
 *   • the picker offers 53 languages (`./languages`)
 *   • the app declares 6 locales (`./locales`)
 *   • exactly 1 of those has any strings written — `fr`, `ar`, `sw`, `pt` and
 *     `ha` are all `{}` in `./messages`
 *   • `useLocale` only accepts those 6 codes, so choosing any of the other 47
 *     set a cookie that no consumer would ever match
 *
 * So every pick produced a checkmark and an English page. `locales.ts` opens by
 * naming that exact outcome "worse than no switcher, because it wastes a choice
 * and breaks a stated commitment" — the picker had simply been built against the
 * 53-language wishlist instead of against `availableLocales()`.
 *
 * The fix is not to hide the list. It is to say which is which, DERIVED from the
 * catalogues so it can never drift: a language reads "live" the moment it is
 * genuinely translated, with nobody remembering to update a table.
 */
export type LanguageStatus =
  /** Rendered in this language today. */
  | "live"
  /** A declared locale with no strings yet — the choice is saved for when there are. */
  | "saved"
  /** Not one of the declared locales. Remembered as a preference; nothing scheduled. */
  | "unplanned";

const DECLARED = new Set<string>(LOCALES.map((l) => l.code));

export function languageStatus(code: string): LanguageStatus {
  if (!DECLARED.has(code)) return "unplanned";
  return localeAvailability(code as LocaleCode) === "planned" ? "saved" : "live";
}

/** The one-line truth shown under a language in the picker. Null when it just works. */
export function languageNote(code: string): string | null {
  switch (languageStatus(code)) {
    case "live":
      return null;
    case "saved":
      return "Being translated — shows English for now";
    case "unplanned":
      return "Not translated yet — shows English";
  }
}

/** Codes the app can genuinely render in. Used by the picker's "Available now" group. */
export function liveLanguageCodes(): string[] {
  return LOCALES.filter((l) => localeAvailability(l.code) !== "planned").map((l) => l.code);
}
