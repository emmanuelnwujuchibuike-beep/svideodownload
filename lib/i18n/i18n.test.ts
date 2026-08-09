import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCALE_ROUTING_BUILT, localeAlternates, switchableLocales } from "./alternates";
import { CATALOGUES, MESSAGE_KEYS, catalogueCoverage, isReviewed, translate } from "./messages";

import {
  formatBytes,
  formatCompact,
  formatDuration,
  formatList,
  formatNumber,
  formatRelative,
} from "./format";
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALES,
  availableLocales,
  coverage,
  getLocale,
  isRtl,
  localeAvailability,
  negotiate,
} from "./locales";

/**
 * Global Experience Platform gates.
 *
 * The headline risk is the same one the Reality Ledger addresses elsewhere:
 * offering a language we have not translated. A switcher that lists Swahili and
 * then serves English is worse than no switcher — it spends a visitor's choice
 * and breaks a stated promise.
 */

describe("locale registry", () => {
  it("has unique codes and BCP 47 tags", () => {
    expect(new Set(LOCALES.map((l) => l.code)).size).toBe(LOCALES.length);
    expect(new Set(LOCALES.map((l) => l.bcp47)).size).toBe(LOCALES.length);
  });

  it("gives every locale an endonym", () => {
    // A switcher must name a language the way its own speakers write it —
    // "Français", not "French". Listing only English names makes the switcher
    // unusable by exactly the people it exists for.
    for (const l of LOCALES) {
      expect(l.endonym.trim().length, `${l.code} has no endonym`).toBeGreaterThan(0);
    }
  });

  it("includes the default locale and marks it live", () => {
    expect(getLocale(DEFAULT_LOCALE)).toBeTruthy();
    expect(localeAvailability(DEFAULT_LOCALE)).toBe("live");
  });

  it("knows Arabic is right-to-left", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });
});

describe("locale availability — fail closed", () => {
  it("never offers a locale with no translations", () => {
    /*
     * THE test in this file. Declaring six locales is a routing plan; offering
     * them is a claim. An untranslated locale must never reach a switcher.
     */
    for (const l of LOCALES) {
      if (coverage(l.code) === 0) {
        expect(localeAvailability(l.code), `${l.code} has no strings but is offered`).toBe(
          "planned",
        );
      }
    }
  });

  it("treats a partially translated locale as unavailable below 90%", () => {
    // A 40%-translated locale switches language mid-sentence, which reads as
    // broken rather than partial.
    expect(availableLocales().every((l) => coverage(l.code) >= 0.9)).toBe(true);
  });

  it("offers only what is actually written today", () => {
    /*
      Updated 2026-08-09: all six catalogues were written on the owner's
      instruction, so all six are now offerable. This assertion did its job —
      it was designed to fail the moment translations landed, forcing the change
      to be deliberate rather than incidental.

      Note what it does NOT say: nothing here claims the translations have been
      reviewed by a native speaker. That is `TRANSLATION_REVIEW`, and it is
      false for all five — see the test below.
    */
    expect(availableLocales()).toHaveLength(LOCALE_CODES.length);
  });

  it("does not confuse 'translated' with 'reviewed'", () => {
    /*
      Coverage measures completeness; it cannot measure correctness. After
      2026-08-09 those diverge: every locale is 100% complete and none but the
      source language has been read by a native speaker. If this ever asserts
      the wrong thing, the risk is a product that reads as careless in five
      languages while every gauge shows green.
    */
    expect(isReviewed("en")).toBe(true);
    for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
      expect(isReviewed(code), `${code} marked reviewed — was it actually read by a speaker?`).toBe(false);
    }
  });
});

describe("content negotiation", () => {
  it("falls back to the default for an absent header", () => {
    expect(negotiate(null)).toBe(DEFAULT_LOCALE);
    expect(negotiate("")).toBe(DEFAULT_LOCALE);
  });

  it("negotiates to a locale that is genuinely written", () => {
    // Was "→ en" while French was empty. French exists now, so a French speaker
    // gets French — which is the whole point of having written it.
    expect(negotiate("fr-FR,fr;q=0.9")).toBe("fr");
  });

  it("never negotiates to an unavailable locale", () => {
    /*
      Icelandic is not a declared locale, so it must not be reachable however
      strongly the browser asks for it.

      This assertion used Japanese until 2026-08-09, when Japanese became a real
      locale — which is why it is worth stating what the test is FOR: it guards
      the fail-closed path, not any particular language. If `is` is ever added,
      swap it for another undeclared code rather than deleting the test.
    */
    expect(LOCALE_CODES as readonly string[]).not.toContain("is");
    expect(negotiate("is-IS,is;q=0.9")).toBe("en");
  });

  it("matches a regional tag to its language", () => {
    expect(negotiate("en-GB,en;q=0.9")).toBe("en");
    expect(negotiate("pt-BR,pt;q=0.9")).toBe("pt");
  });

  it("respects quality ordering", () => {
    // The browser is expressing a preference order; ignoring it is how sites end
    // up serving people their third choice.
    expect(negotiate("fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiate("fr;q=0.4,en;q=0.8")).toBe("en");
  });

  it("survives a malformed header", () => {
    expect(negotiate(";;;")).toBe(DEFAULT_LOCALE);
    expect(negotiate("en;q=notanumber")).toBe(DEFAULT_LOCALE);
  });
});

describe("formatting", () => {
  it("formats numbers per locale", () => {
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    // The reason formatting ships before translation: this is the same number
    // written the way a French reader expects, and getting it wrong is silently
    // incorrect rather than obviously foreign.
    expect(formatNumber(1234.5, "fr")).not.toBe("1,234.5");
  });

  it("formats compact counts", () => {
    expect(formatCompact(1200, "en")).toBe("1.2K");
  });

  it("formats durations positionally", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("formats bytes in binary units", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1024, "en")).toBe("1 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
  });

  it("formats relative time with a natural unit", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    // "3 days ago", never "72 hours ago".
    expect(formatRelative(new Date("2026-07-16T12:00:00Z"), "en", now)).toContain("day");
    expect(formatRelative(new Date("2026-07-19T11:00:00Z"), "en", now)).toContain("hour");
  });

  it("formats lists with the locale's conjunction", () => {
    expect(formatList(["A", "B", "C"], "en")).toBe("A, B, and C");
  });
});

/* ---------------------------------- catalogue --------------------------------- */

describe("UI message catalogue", () => {
  it("declares a catalogue for every locale, empty rather than absent", () => {
    /*
     * An absent catalogue is indistinguishable from a locale nobody considered;
     * an empty one is a measured 0% that shows up in coverage and in the admin
     * view as work outstanding.
     */
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale.code], `${locale.code} has no catalogue`).toBeDefined();
    }
  });

  it("measures coverage instead of declaring it", () => {
    // The bug this replaced: a hand-maintained table saying `en: 1`, which would
    // have kept reporting 100% the first time anyone added an untranslated key.
    expect(coverage("en")).toBe(1);
    expect(catalogueCoverage("en")).toBe(coverage("en"));

    /*
      All six are complete as of 2026-08-09. The property worth asserting is no
      longer "the others are zero" but that coverage is MEASURED from the
      catalogue rather than asserted anywhere — so adding a key to `en` without
      translating it must immediately drop the others below 1.
    */
    for (const locale of LOCALES) {
      const measured =
        MESSAGE_KEYS.filter((k) => {
          const v = CATALOGUES[locale.code]?.[k];
          return typeof v === "string" && v.trim().length > 0;
        }).length / MESSAGE_KEYS.length;
      expect(coverage(locale.code), `${locale.code} coverage is not measured`).toBeCloseTo(measured);
    }
  });

  it("counts a partially filled catalogue honestly", () => {
    const total = MESSAGE_KEYS.length;
    expect(total).toBeGreaterThan(10);

    // Simulated rather than shipped: proves the arithmetic without inventing
    // translations to prove it with.
    const half = Math.floor(total / 2);
    const filled = Object.fromEntries(MESSAGE_KEYS.slice(0, half).map((k) => [k, "x"]));
    const measured = MESSAGE_KEYS.filter((k) => (filled as Record<string, string>)[k]).length / total;
    expect(measured).toBeCloseTo(half / total);
  });

  it("never renders a raw key", () => {
    /*
     * The failure that actually ships: a missing string resolves to its own key
     * and `footer.blurb` appears in the page. Falling back per KEY to English
     * keeps a half-translated locale legible instead of taking the page down.
     */
    for (const key of MESSAGE_KEYS) {
      for (const locale of LOCALES) {
        const value = translate(locale.code, key);
        expect(value, `${locale.code}/${key} resolved to the key`).not.toBe(key);
        expect(value.trim().length, `${locale.code}/${key} resolved to nothing`).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to English for an untranslated key", () => {
    /*
      Exercised through a locale with NO catalogue at all, because every declared
      one is complete as of 2026-08-09 — asserting `fr === en` now proves the
      opposite of what it used to (it would mean French had failed to translate).

      The per-key fallback still matters and still needs a test: the moment a new
      key is added to `en`, five catalogues are missing it, and the fallback is
      what keeps those pages legible instead of rendering `nav.newThing` at a
      visitor.
    */
    const unknown = "zz" as Parameters<typeof translate>[0];
    expect(translate(unknown, "nav.pricing")).toBe(translate("en", "nav.pricing"));
    // And a real locale returns its OWN string, not the English one.
    expect(translate("fr", "nav.pricing")).not.toBe(translate("en", "nav.pricing"));
  });

  it("interpolates named placeholders and leaves unknown ones visible", () => {
    // Named, not positional: word order moves between languages, and {0}/{1}
    // quietly forbids a translator from putting the value where grammar needs it.
    expect(translate("en", "footer.copyright", { year: 2026 })).toContain("2026");
    expect(translate("en", "footer.copyright")).toContain("{year}");
  });

  it("leaves no key unused by the interface", () => {
    /*
     * A catalogue that accumulates dead keys is a translation bill nobody is
     * paying for — every unused string is real work asked of a translator for a
     * screen that does not exist. This is the same dead-code check that caught
     * `lib/i18n` itself being imported by nothing.
     */
    const sources = [
      readFileSync("components/layout/site-header.tsx", "utf8"),
      readFileSync("components/layout/site-footer.tsx", "utf8"),
      readFileSync("lib/i18n/i18n.test.ts", "utf8"),
    ].join("\n");

    const unused = MESSAGE_KEYS.filter((key) => !sources.includes(key));
    expect(unused, `Keys nobody renders:\n  ${unused.join("\n  ")}`).toHaveLength(0);
  });
});

describe("the catalogue is actually wired in", () => {
  it("leaves no hardcoded nav label in the header", () => {
    /*
     * The finding this pins: `lib/i18n` shipped complete, tested, and imported by
     * ZERO files — a foundation nothing consumes looks done in the commit log and
     * is invisible to users. Asserting the consumer, not just the library.
     */
    const header = readFileSync("components/layout/site-header.tsx", "utf8");
    expect(header).toContain("@/lib/i18n/messages");
    expect(header).toMatch(/labelKey:\s*"nav\./);
    expect(header, "a nav label is still a literal").not.toMatch(/label:\s*"(Home|Pricing|Academy)"/);
  });

  it("drives <html lang/dir> from the registry", () => {
    // A stale `dir="ltr"` mis-renders every RTL page regardless of translation
    // quality, because it drives the browser's own bidi algorithm.
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("isRtl(");
    expect(layout, "lang is still a literal").not.toContain('<html lang="en" dir="ltr"');
  });
});

/* --------------------------------- alternates --------------------------------- */

describe("hreflang alternates", () => {
  it("emits no alternate for a locale with no ROUTE, however well translated", () => {
    /*
     * Wrong hreflang is worse than absent hreflang. Absent says "no
     * translations"; wrong says "translations that do not work", and search
     * engines act on the second by crawling a French URL, finding English, and
     * counting it against the pages that currently earn all the traffic.
     *
     * ── Why this test nearly stopped protecting anything (2026-08-09) ───────
     * It used to pass because the catalogues were empty, so `availableLocales()`
     * returned only English. The moment those were filled, this file began
     * advertising `/fr/help`, `/ar/help` and four more — none of which resolve,
     * because there is no `[locale]` segment anywhere in `app/`. The guard was
     * measuring translation when the thing that makes a URL claimable is
     * ROUTING. Hence `LOCALE_ROUTING_BUILT`.
     */
    expect(LOCALE_ROUTING_BUILT, "flip this only when /fr/... actually resolves").toBe(false);
    const { languages } = localeAlternates("/help");
    expect(Object.keys(languages).sort()).toEqual(["en", "x-default"]);
    expect(languages["/fr/help"]).toBeUndefined();
    // Every emitted target must be a path this app really serves.
    for (const href of Object.values(languages)) {
      expect(href, `${href} points at an unbuilt locale route`).not.toMatch(/^\/(fr|ar|sw|pt|ha)\//);
    }
  });

  it("keeps the default locale unprefixed", () => {
    // English lives at /help, not /en/help. Prefixing it would change every URL
    // on a site whose generated downloader pages hold the search traffic.
    const { languages } = localeAlternates("/help");
    expect(languages.en).toBe("/help");
    expect(languages["x-default"]).toBe("/help");
  });

  it("normalises a path without a leading slash", () => {
    expect(localeAlternates("help").languages["x-default"]).toBe("/help");
  });

  it("offers a switcher now that there is something to switch to", () => {
    /*
      Was `[]`: a control with one option is not a choice, it is furniture
      implying a capability the product does not have. Six translated locales
      is a real choice, so the switcher is real.

      Note this is about the CATALOGUES, not the routing tree — the header
      picker changes the language in place, it does not navigate to `/fr/...`.
      That is why `switchableLocales` gates on availability while
      `localeAlternates` gates on `LOCALE_ROUTING_BUILT`; the two answer
      different questions and conflating them is what nearly shipped broken
      hreflang.
    */
    expect(switchableLocales().length).toBeGreaterThan(1);
    expect(switchableLocales().map((l) => l.code)).toContain("en");
  });
});

/* ------------------------------ the pipeline ---------------------------------- */

describe("translation pipeline", () => {
  const script = readFileSync("scripts/i18n.mjs", "utf8");

  it("reads only the translation field, never the English source", () => {
    /*
     * The bug this pins, found by running the round trip rather than reading it:
     * the first version exported `{"nav.home": "Home"}` and accepted any
     * non-empty string, so importing an UNTOUCHED export reported the locale
     * 100% complete and flipped it to "offered" — in English. Every individual
     * step looked correct. The {en, translation} shape removes the ambiguity.
     */
    expect(script).toContain("entry.translation");
    expect(script).toContain("not in the {en, translation} shape");
  });

  it("refuses a translation that drops a placeholder", () => {
    // A dropped {year} produces a copyright line with no year: correct-looking,
    // wrong, and invisible until someone reads the footer in that language.
    expect(script).toContain("expects placeholders");
    expect(script).toContain("process.exit(1)");
  });

  it("has no machine-translation step", () => {
    /*
     * Deliberate. 0086 already encodes the position: `machine` is a status that
     * must be reviewed before it counts. An auto-filled catalogue would flip a
     * locale to 100%, switch the site into a language nobody has read, and look
     * identical in the coverage table to work a human actually did.
     */
    expect(script.toLowerCase()).not.toMatch(/\btranslate\s*\(|googletrans|deepl|openai/);
  });
});
