import type { LocaleCode } from "../locales";
import { MESSAGE_KEYS, en, type MessageKey, type Messages } from "./en";

/**
 * Global Experience Platform™ — the UI string catalogue.
 *
 * ── Partial catalogues are the normal case, not an error ──────────────────────
 *
 * Translation arrives a screen at a time. A registry that demanded complete
 * catalogues would force a translator's first fifty strings to sit in a branch
 * until all of them were done, which is how localisation stalls. So a catalogue
 * is `Partial<Messages>`, coverage is MEASURED from what it actually contains,
 * and `localeAvailability` decides whether that is enough to offer — the same
 * declare-then-derive shape as school availability and Gateway destinations.
 *
 * ── Falling back per KEY, not per locale ──────────────────────────────────────
 *
 * A missing string resolves to English rather than rendering `nav.pricing` at a
 * user. Both failures are visible; only one is legible. This also means an
 * untranslated key added late cannot break a locale that is otherwise complete —
 * it degrades to English in one spot instead of taking the page down.
 *
 * That per-key fallback is exactly why availability is gated at 90% rather than
 * "has any strings": fallback makes a half-translated page *work*, and a page
 * that switches language mid-sentence reads as broken, not partial.
 */

/**
 * Every locale's catalogue.
 *
 * The five non-English entries are deliberately empty rather than absent. An
 * empty catalogue is a measured 0% — it appears in coverage reports, in the admin
 * view, and in tests, as a language we intend to ship and have not written. A
 * missing key in this map would instead be indistinguishable from a locale nobody
 * has considered.
 *
 * NOTHING here is machine-translated. Filling these with an automatic translation
 * would produce a switcher that works and a product that reads as careless in
 * five languages, and the `translations` workflow in migration 0086 already says
 * how this project treats that: `machine` is a status that must be reviewed
 * before it counts as done. The same standard applies to chrome.
 */
export const CATALOGUES: Record<LocaleCode, Partial<Messages>> = {
  en,
  fr: {},
  ar: {},
  sw: {},
  pt: {},
  ha: {},
};

/* --------------------------------- coverage ---------------------------------- */

/** Keys with a non-empty string in this locale. */
export function translatedKeys(locale: LocaleCode): MessageKey[] {
  const catalogue = CATALOGUES[locale] ?? {};
  return MESSAGE_KEYS.filter((key) => {
    const value = catalogue[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/** Keys still to translate, for the admin view and for coverage reporting. */
export function missingKeys(locale: LocaleCode): MessageKey[] {
  const done = new Set(translatedKeys(locale));
  return MESSAGE_KEYS.filter((key) => !done.has(key));
}

/**
 * Fraction of the key space translated, 0 to 1.
 *
 * Measured, never declared. This replaced a hand-maintained coverage table whose
 * only real property was that it would be wrong the first time somebody added a
 * string — a number that has to be remembered is a number that drifts.
 *
 * Note that a translation identical to the English is counted as translated:
 * "Frenz" is "Frenz" in every language on the list, and treating an intentional
 * passthrough as missing would make 100% unreachable.
 */
export function catalogueCoverage(locale: LocaleCode): number {
  if (MESSAGE_KEYS.length === 0) return 0;
  return translatedKeys(locale).length / MESSAGE_KEYS.length;
}

/* -------------------------------- resolution --------------------------------- */

/**
 * Interpolates `{name}` placeholders.
 *
 * Named rather than positional because word order is the first thing that moves
 * between languages: a translator must be able to put the year, the count or the
 * name wherever their grammar needs it, and `{0}`/`{1}` quietly forbids that.
 *
 * An unsupplied placeholder is left in the string rather than blanked. A visible
 * `{year}` is a bug report; a silent gap is a mystery.
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Resolve one message.
 *
 * Always returns a real string: the locale's own translation, else English. The
 * key itself is never rendered — leaking `footer.blurb` into a page is worse than
 * showing the English, and it is the failure mode people actually ship.
 */
export function translate(
  locale: LocaleCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const value = CATALOGUES[locale]?.[key];
  const template = typeof value === "string" && value.length > 0 ? value : en[key];
  return interpolate(template, vars);
}

/**
 * A bound translator for one locale — `const t = translator(locale)`.
 *
 * Keeps call sites to `t("nav.pricing")` instead of threading the locale through
 * every one, which is what makes migrating an existing component to the catalogue
 * a small edit rather than a rewrite.
 */
export function translator(locale: LocaleCode) {
  return (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
}

export type { MessageKey, Messages };
export { MESSAGE_KEYS };
