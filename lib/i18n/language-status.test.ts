import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LANGUAGES } from "./languages";
import { languageNote, languageStatus, liveLanguageCodes } from "./language-status";
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

  it("marks a DECLARED but untranslated locale as saved, not live", () => {
    // fr/ar/sw/pt/ha are declared in locales.ts with `{}` catalogues.
    expect(languageStatus("fr")).toBe("saved");
    expect(languageNote("fr")).toMatch(/English/i);
  });

  it("marks a language that is only on the 53-item wishlist as unplanned", () => {
    // Spanish is in LANGUAGES but is not a declared locale — this is the pick
    // that used to set a cookie no consumer would ever match.
    expect(LANGUAGES.some((l) => l.code === "es")).toBe(true);
    // Widened to string on purpose: the whole point is that "es" is NOT a
    // LocaleCode, which is exactly what makes the narrow comparison a type error.
    expect((LOCALES as { code: string }[]).some((l) => l.code === "es")).toBe(false);
    expect(languageStatus("es")).toBe("unplanned");
    expect(languageNote("es")).toMatch(/English/i);
  });

  it("gives every offered language an honest caption unless it truly works", () => {
    for (const l of LANGUAGES) {
      const note = languageNote(l.code);
      if (languageStatus(l.code) === "live") expect(note).toBeNull();
      else expect(note, `${l.code} silently promises a translation`).toBeTruthy();
    }
  });

  it("reports only genuinely translated locales as live", () => {
    // Today that is English alone. This assertion is meant to CHANGE when a
    // catalogue is actually written — it is not a claim that English is enough.
    expect(liveLanguageCodes()).toEqual(["en"]);
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
