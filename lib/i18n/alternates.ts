import { DEFAULT_LOCALE, availableLocales, getLocale } from "./locales";

/**
 * Whether URLs like `/fr/help` actually resolve.
 *
 * ── This is the gate, and translation is NOT the gate (2026-08-09) ───────────
 *
 * They used to be the same question, and on 2026-08-09 they stopped being. The
 * five non-English catalogues were filled on the owner's instruction, which
 * immediately made `availableLocales()` return all six — and this file emitted
 * hreflang alternates at `/fr/help`, `/ar/help` and so on.
 *
 * **No such route exists.** There is no `[locale]` segment anywhere in `app/`;
 * the locale routing tree has never been built (it is a known open item). So
 * every one of those alternates pointed at a 404, on the three pages that call
 * this.
 *
 * That is precisely the failure the original note in this file described —
 * "wrong hreflang is worse than absent hreflang… it costs ranking on the pages
 * that currently earn all the traffic" — and the guard it relied on turned out
 * to be measuring the wrong thing. Having strings for a language does not give
 * that language a URL.
 *
 * Flip this to `true` in the SAME commit that ships the routing tree, and every
 * page calling `localeAlternates` gains correct alternates with no further work.
 * A test asserts the two stay consistent.
 */
export const LOCALE_ROUTING_BUILT = false;

/**
 * hreflang alternates for a page.
 *
 * ── Why this returns almost nothing today, and why that is correct ────────────
 *
 * The obvious implementation emits an alternate for every DECLARED locale. That
 * would tell search engines a French version of this page exists at `/fr/...`,
 * which would then be crawled, found to be English (or a 404), and counted
 * against the site.
 *
 * Alternates therefore require BOTH a translated catalogue (`availableLocales()`)
 * and a route that resolves (`LOCALE_ROUTING_BUILT`). Today the second is false,
 * so this emits only `x-default` — the honest signal, and the same output it has
 * always produced.
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
    // A prefixed URL is only claimable once the routing tree serves one.
    if (locale.code !== DEFAULT_LOCALE && !LOCALE_ROUTING_BUILT) continue;
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
