import { DEFAULT_LOCALE, availableLocales, getLocale } from "./locales";

/**
 * hreflang alternates for a page.
 *
 * ── Why this returns almost nothing today, and why that is correct ────────────
 *
 * The obvious implementation emits an alternate for every DECLARED locale. That
 * would tell search engines a French version of this page exists at `/fr/...`,
 * which would then be crawled, found to be English (or a 404), and counted
 * against the site. Wrong hreflang is worse than absent hreflang: absent means
 * "no translations", wrong means "translations that do not work", and the second
 * costs ranking on the pages that currently earn all the traffic.
 *
 * So alternates come from `availableLocales()` — the same 90%-coverage gate the
 * switcher and content negotiation use. With one locale live this emits only the
 * `x-default`, which is exactly the honest signal. The moment a locale is
 * genuinely translated, every page that calls this gains a correct alternate
 * with no further work.
 *
 * ── The default locale is not prefixed ────────────────────────────────────────
 *
 * English lives at `/help`, not `/en/help`. Prefixing it would change every URL
 * on a site whose ~148 generated downloader pages hold the search traffic, in
 * exchange for symmetry nobody sees. Non-default locales get a prefix; the
 * default keeps the bare path.
 */
export function localeAlternates(path: string): {
  languages: Record<string, string>;
} {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const languages: Record<string, string> = {};

  for (const locale of availableLocales()) {
    const tag = getLocale(locale.code)?.bcp47 ?? locale.code;
    languages[tag] = locale.code === DEFAULT_LOCALE ? clean : `/${locale.code}${clean}`;
  }

  /*
    x-default points at the unprefixed path — where a visitor with no matching
    language should land. Emitted even with a single locale, because it is the
    one alternate that is true regardless of how many translations exist.
  */
  languages["x-default"] = clean;

  return { languages };
}

/**
 * Whether a language switcher has anything to offer.
 *
 * A control with one option is not a choice, it is furniture that implies a
 * capability the product does not have yet. Callers render nothing when this is
 * false — which is the case today, on purpose.
 */
export function switchableLocales() {
  const available = availableLocales();
  return available.length > 1 ? available : [];
}
