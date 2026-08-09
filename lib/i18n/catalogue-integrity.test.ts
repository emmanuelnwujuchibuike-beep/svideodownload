import { describe, expect, it } from "vitest";

import { CATALOGUES, REVIEW_PRIORITY } from "./messages/catalogues";
import { MESSAGE_KEYS } from "./messages/en";
import { LOCALE_CODES, LOCALES } from "./locales";

/**
 * Machine checks over 49 hand-written catalogues (owner, 2026-08-09: "configure
 * all languages in the language selector").
 *
 * ── Why these specific checks ────────────────────────────────────────────────
 * Nobody reviewing this repository reads Amharic, Telugu and Igbo. So the
 * assertions here are the ones a machine CAN make about a language it does not
 * speak — completeness, script consistency, placeholder survival, brand
 * integrity. They cannot tell you a translation is good; they can tell you it is
 * not obviously broken, which is the class of error that actually ships.
 *
 * The check that caught a real bug on the day this was written: `zh` characters
 * had leaked into the Russian and Bulgarian strings mid-sentence. Both looked
 * completely plausible in a diff.
 */

const NON_EN = LOCALE_CODES.filter((c) => c !== "en");

/**
 * Unicode BLOCKS that must not appear in a language that does not use them.
 *
 * Written as explicit `\uXXXX` escapes, never as literal characters between
 * brackets. Pasting the glyphs is how the first version of this table got the
 * Devanagari range wrong and matched Bengali instead — a test that reports the
 * wrong language is worse than no test, and a range written in glyphs cannot be
 * checked by reading it.
 */
/*
  Codepoints as `\u` escapes, never as pasted glyphs — a range written in glyphs
  cannot be verified by reading it, which is how the first version of this table
  matched Bengali with the Devanagari range.

  ── The danda ────────────────────────────────────────────────────────────────
  U+0964 (।) and U+0965 (॥) sit in the DEVANAGARI block but are shared
  punctuation across Indic scripts — Bengali, Gurmukhi, Gujarati and others all
  end sentences with them legitimately. Including them made every Indic
  catalogue look contaminated. Devanagari is therefore checked as two ranges
  with that pair carved out.
*/
const BLOCKS = {
  han: "一-鿿",
  kana: "぀-ヿ",
  hangul: "가-힯",
  cyrillic: "Ѐ-ӿ",
  arabic: "؀-ۿ",
  hebrew: "֐-׿",
  devanagari: "ऀ-ॣ०-ॿ",
  bengali: "ঀ-৿",
  gurmukhi: "਀-੿",
  gujarati: "઀-૿",
  tamil: "஀-௿",
  telugu: "ఀ-౿",
  kannada: "ಀ-೿",
  thai: "฀-๿",
  ethiopic: "ሀ-፿",
  greek: "Ͱ-Ͽ",
} as const;

const block = (...names: (keyof typeof BLOCKS)[]) =>
  new RegExp(`[${names.map((n) => BLOCKS[n]).join("")}]`);

const SCRIPTS: { name: string; re: RegExp; usedBy: string[] }[] = [
  { name: "Han", re: block("han"), usedBy: ["zh", "ja"] },
  { name: "Kana", re: block("kana"), usedBy: ["ja"] },
  { name: "Hangul", re: block("hangul"), usedBy: ["ko"] },
  { name: "Cyrillic", re: block("cyrillic"), usedBy: ["ru", "uk", "bg", "sr"] },
  { name: "Arabic", re: block("arabic"), usedBy: ["ar", "fa", "ur"] },
  { name: "Hebrew", re: block("hebrew"), usedBy: ["he"] },
  { name: "Devanagari", re: block("devanagari"), usedBy: ["hi", "mr", "ne"] },
  { name: "Bengali", re: block("bengali"), usedBy: ["bn"] },
  { name: "Gurmukhi", re: block("gurmukhi"), usedBy: ["pa"] },
  { name: "Gujarati", re: block("gujarati"), usedBy: ["gu"] },
  { name: "Tamil", re: block("tamil"), usedBy: ["ta"] },
  { name: "Telugu", re: block("telugu"), usedBy: ["te"] },
  { name: "Kannada", re: block("kannada"), usedBy: ["kn"] },
  { name: "Thai", re: block("thai"), usedBy: ["th"] },
  { name: "Ethiopic", re: block("ethiopic"), usedBy: ["am"] },
  { name: "Greek", re: block("greek"), usedBy: ["el"] },
];

describe("every declared locale has a catalogue", () => {
  it("covers all declared locales except the source language", () => {
    for (const code of NON_EN) {
      expect(CATALOGUES[code], `${code} has no catalogue`).toBeDefined();
    }
  });

  it("has no catalogue for a locale that is not declared", () => {
    for (const code of Object.keys(CATALOGUES)) {
      expect(LOCALE_CODES as readonly string[], `${code} is orphaned`).toContain(code);
    }
  });

  it("gives every locale a name and an endonym from the language table", () => {
    // A locale whose code has no row in `languages.ts` is silently DROPPED from
    // LOCALES — this is what makes that drop impossible to miss.
    expect(LOCALES).toHaveLength(LOCALE_CODES.length);
    for (const l of LOCALES) {
      expect(l.endonym.trim().length, `${l.code} has no endonym`).toBeGreaterThan(0);
      expect(l.bcp47.trim().length, `${l.code} has no BCP 47 tag`).toBeGreaterThan(0);
    }
  });
});

describe("every string in every catalogue", () => {
  const entries = NON_EN.flatMap((code) =>
    MESSAGE_KEYS.map((key) => ({ code, key, value: CATALOGUES[code]?.[key] })),
  );

  it("exists and is non-empty", () => {
    for (const { code, key, value } of entries) {
      expect(typeof value, `${code}/${key} is not a string`).toBe("string");
      expect(value!.trim().length, `${code}/${key} is empty`).toBeGreaterThan(0);
    }
  });

  it("never renders a raw message key", () => {
    for (const { code, key, value } of entries) {
      expect(value, `${code}/${key} is the key itself`).not.toBe(key);
    }
  });

  it("keeps the brand name intact", () => {
    // "Frenz" must survive untranslated and untransliterated, or the site
    // becomes unfindable by its own name in that language.
    for (const code of NON_EN) {
      expect(CATALOGUES[code]!["footer.blurb"], `${code} lost the brand name`).toContain("Frenz");
      expect(CATALOGUES[code]!["footer.copyright"], `${code} lost the brand name`).toContain("Frenz");
    }
  });

  it("keeps the {year} placeholder, so the copyright is not frozen", () => {
    for (const code of NON_EN) {
      expect(CATALOGUES[code]!["footer.copyright"], `${code} dropped {year}`).toContain("{year}");
    }
  });

  it("invents no placeholder English does not have", () => {
    // A stray `{name}` would render literally at a visitor — `interpolate`
    // leaves unknown placeholders visible on purpose.
    for (const { code, key, value } of entries) {
      const theirs = [...value!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const allowed = key === "footer.copyright" ? ["year"] : [];
      expect(theirs, `${code}/${key} has unexpected placeholders`).toEqual(allowed);
    }
  });
});

describe("script consistency — the check that caught a real leak", () => {
  /*
    On the day these were written, Han characters had leaked into the Russian
    and Bulgarian strings mid-sentence (`для скачивания,创作,` and
    `оферти直接 на`). Both read as completely plausible in a diff, and no
    reviewer of this repository would have spotted them.
  */
  it.each(SCRIPTS)("$name appears only in the languages that use it", ({ re, usedBy }) => {
    for (const code of NON_EN) {
      if (usedBy.includes(code)) continue;
      for (const key of MESSAGE_KEYS) {
        const value = CATALOGUES[code]![key];
        expect(re.test(value), `${code}/${key} contains foreign script: ${value}`).toBe(false);
      }
    }
  });

  it("actually uses the expected script in each non-Latin language", () => {
    // The inverse: a language that should be in its own script but silently
    // shipped English would pass every other check here.
    const expected: Record<string, RegExp> = {
      zh: block("han"), ja: block("han", "kana"), ko: block("hangul"),
      ru: block("cyrillic"), uk: block("cyrillic"), bg: block("cyrillic"), sr: block("cyrillic"),
      ar: block("arabic"), fa: block("arabic"), ur: block("arabic"), he: block("hebrew"),
      hi: block("devanagari"), mr: block("devanagari"), ne: block("devanagari"),
      bn: block("bengali"), pa: block("gurmukhi"), gu: block("gujarati"),
      ta: block("tamil"), te: block("telugu"), kn: block("kannada"),
      th: block("thai"), am: block("ethiopic"), el: block("greek"),
    };
    for (const [code, re] of Object.entries(expected)) {
      expect(re.test(CATALOGUES[code as keyof typeof CATALOGUES]!["nav.home"]), `${code} nav.home is not in its own script`).toBe(true);
    }
  });
});

describe("the human review queue", () => {
  it("names only real locales", () => {
    for (const code of REVIEW_PRIORITY) {
      expect(LOCALE_CODES as readonly string[], `${code} is not a locale`).toContain(code);
    }
  });

  it("puts the core-audience African languages first", () => {
    /*
      Not decoration — this is the order a human should work through. These have
      the least localisation prior art to draw on AND serve the audience
      `locales.ts` says the product is built for, so a mistake there costs most.
    */
    expect(REVIEW_PRIORITY.slice(0, 6)).toEqual(["ha", "yo", "ig", "am", "zu", "sw"]);
  });
});
