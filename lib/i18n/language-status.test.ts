import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LANGUAGES } from "./languages";
import { isRtlCode, languageNote, languageStatus, liveLanguageCodes } from "./language-status";
import { LOCALES } from "./locales";

/**
 * The language switcher (owner, 2026-08-09: "the language selections still
 * doesn't work").
 *
 * This suite pins the three separate defects that produced that, so none of them
 * can come back quietly:
 *
 *  1. the picker offered languages the app cannot render, with no indication;
 *  2. `useLocale` kept its OWN hand-copied list of locale codes, which could
 *     drift from the registry without anything failing;
 *  3. a locale with an empty catalogue reported as usable.
 */

describe("languageStatus — derived from the catalogues, never declared", () => {
  it("marks English live", () => {
    expect(languageStatus("en")).toBe("live");
  });

  it("marks a translated locale live, with no apology under it", () => {
    // fr/ar/sw/pt/ha were `{}` until 2026-08-09 and read "saved". They are
    // written now, so they must read as working — the caption existed only to
    // stop the picker silently promising something it could not do.
    for (const code of ["fr", "ar", "sw", "pt", "ha"]) {
      expect(languageStatus(code), `${code}`).toBe("live");
      expect(languageNote(code), `${code} still apologises`).toBeNull();
    }
  });

  it("marks every language the picker offers as live", () => {
    /*
      As of 2026-08-09 the wishlist and the locale registry are the SAME set —
      the owner asked for every language in the selector to be configured, so
      each of the 50 has a catalogue. There is no longer an "unplanned" entry to
      test with, and that is the intended end state.

      The status function still distinguishes the three cases; this asserts the
      outcome, and the case-by-case behaviour is covered below with codes the
      picker does not offer.
    */
    for (const l of LANGUAGES) {
      expect(languageStatus(l.code), `${l.code} is offered but not live`).toBe("live");
    }
  });

  it("still refuses a code nobody declared", () => {
    // Icelandic is not offered and not declared — the fail-closed path.
    expect(LANGUAGES.some((l) => l.code === "is")).toBe(false);
    expect(languageStatus("is")).toBe("unplanned");
    expect(languageNote("is")).toMatch(/English/i);
  });

  it("gives every offered language an honest caption unless it truly works", () => {
    for (const l of LANGUAGES) {
      const note = languageNote(l.code);
      if (languageStatus(l.code) === "live") expect(note).toBeNull();
      else expect(note, `${l.code} silently promises a translation`).toBeTruthy();
    }
  });

  it("reports every declared locale as live", () => {
    // Still DERIVED from coverage, never declared — emptying a catalogue must
    // drop that language straight back out of this list.
    expect(liveLanguageCodes().sort()).toEqual(LOCALES.map((l) => l.code).sort());
    expect(liveLanguageCodes()).toHaveLength(LANGUAGES.length);
  });
});

describe("right-to-left is applied, not just translated", () => {
  /*
    Arabic text inside a left-to-right document is WORSE than English:
    punctuation lands on the wrong side, and any line mixing Arabic with the
    brand name or a number renders in an order nobody can read.

    `app/layout.tsx` sets `dir` from `DEFAULT_LOCALE`, a constant — so before
    2026-08-09 translating `ar` would have shipped exactly that page. The fix is
    a `<head>` script, NOT a root-layout client component, because those have
    silently broken App Router prefetch on this project before.
  */
  const boot = fs.readFileSync(path.join(process.cwd(), "components/i18n/locale-boot-script.tsx"), "utf8");

  it("sets dir=rtl for Arabic before first paint", () => {
    expect(boot).toMatch(/rtl/);
    expect(boot).toMatch(/setAttribute\('dir'/);
  });

  it("runs as a bare inline script, never a client component", () => {
    // "use client" here would put a component in the root layout — the exact
    // shape that has broken prefetch before.
    expect(boot).not.toContain('"use client"');
    expect(boot).toContain("dangerouslySetInnerHTML");
  });

  it("is mounted in <head>, above the boot splash", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(layout).toContain("<LocaleBootScript />");
  });

  it("knows RTL languages beyond the six declared locales", () => {
    // The picker can offer Urdu or Hebrew; those need direction too, even with
    // no strings, because the visitor's own device is about to translate the page.
    expect(isRtlCode("ar")).toBe(true);
    expect(isRtlCode("ur")).toBe(true);
    expect(isRtlCode("he")).toBe(true);
    expect(isRtlCode("fr")).toBe(false);
    expect(isRtlCode("en-GB")).toBe(false);
  });
});

describe("useLocale's inline code list", () => {
  /*
    `use-locale.ts` deliberately inlines the locale codes instead of importing
    them: importing `availableLocales()` reaches `catalogueCoverage`, which pulls
    every message catalogue into the LANDING bundle and breaks the cold-entry
    ceiling on its own. The comment there explains it and the reasoning is sound.

    The cost of that shortcut is a second copy of the truth, and a second copy
    that nothing checks is a copy that drifts. This reads the file and pins the
    two together — the check the shortcut was missing.
  */
  it("matches the locale registry exactly", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/i18n/use-locale.ts"), "utf8");
    const literal = src.match(/const CODES:\s*readonly LocaleCode\[\]\s*=\s*\[([^\]]+)\]/);
    expect(literal, "the CODES literal moved — update this test").toBeTruthy();

    const inlined = [...literal![1]!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect([...inlined].sort()).toEqual(LOCALES.map((l) => l.code).sort());
  });
});
