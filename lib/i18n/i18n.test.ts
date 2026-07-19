import { describe, expect, it } from "vitest";

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
    // Honest snapshot: English only. This will change when translations land, and
    // changing it should be a deliberate act with strings behind it.
    expect(availableLocales().map((l) => l.code)).toEqual(["en"]);
  });
});

describe("content negotiation", () => {
  it("falls back to the default for an absent header", () => {
    expect(negotiate(null)).toBe(DEFAULT_LOCALE);
    expect(negotiate("")).toBe(DEFAULT_LOCALE);
  });

  it("never negotiates to an unavailable locale", () => {
    // A French speaker gets English because French is not written yet — not a
    // French URL that serves English content.
    expect(negotiate("fr-FR,fr;q=0.9")).toBe("en");
  });

  it("matches a regional tag to its language", () => {
    expect(negotiate("en-GB,en;q=0.9")).toBe("en");
  });

  it("respects quality ordering", () => {
    // The browser is expressing a preference order; ignoring it is how sites end
    // up serving people their third choice.
    expect(negotiate("fr;q=0.9,en;q=0.8")).toBe("en");
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
