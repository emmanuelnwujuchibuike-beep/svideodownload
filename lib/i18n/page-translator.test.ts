import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { splitSpace, translatable } from "./page-translator";

/** Owner, 2026-10-15: "I want all language to change in everything that has text that is translatable". */
describe("what the page translator sends", () => {
  it("interface text goes; numbers, times, sizes, emoji, handles, tags, links and addresses stay", () => {
    for (const t of ["Download", "Log in", "Save to device", "  Today  ", "Ad"]) expect(translatable(t), t).toBe(true);
    for (const t of ["", " ", "3", "12:40", "4.2 MB", "🔥🔥", "@frenz", "#tiktok", "https://frenzsave.com/a", "www.x.com", "me@x.com", "frenzsave.com", "x", "12K", "1.5M", "30%"])
      expect(translatable(t), t).toBe(false);
  });

  it("a translation keeps the spacing it sat in", () => {
    expect(splitSpace("  Save now \n")).toEqual(["  ", "Save now", " \n"]);
    expect(splitSpace("Save")).toEqual(["", "Save", ""]);
  });
});

describe("what it leaves alone, and where it runs", () => {
  const src = readFileSync("lib/i18n/page-translator.ts", "utf8");

  it("the nearest translate attribute decides — people's own words (RichText) stay as written", () => {
    expect(src).toContain('if (el.closest("[translate]")?.getAttribute("translate") === "no") return true;');
    const rich = readFileSync("components/social/rich-text.tsx", "utf8");
    expect(rich).toContain('<span translate="no" className={cn("whitespace-pre-line", className)}>');
    // the phishing warning inside a caption is interface text, so it is translated
    expect(rich).toContain('role="note" translate="yes"');
  });

  it("only the page's English is the source: its own writes are recognised, not re-sent", () => {
    expect(src).toContain("if (textWritten.get(node) === current) return;");
    expect(src).toContain("if (attrWritten.get(el)?.[attr] === value) return;");
  });

  it("English visitors load none of it: the mount reads a cookie and imports the translator only for another language", () => {
    const mount = readFileSync("components/i18n/page-translation.tsx", "utf8");
    expect(mount).toContain('if (lang === "en" && !loaded) return;');
    expect(mount).toContain('void import("@/lib/i18n/page-translator")');
    expect(mount).not.toMatch(/^import .*page-translator/m);
    expect(readFileSync("features/app-shell/deferred-shell.tsx", "utf8")).toContain("<PageTranslation />");
  });
});

/**
 * 2026-10-31: while the server's engine had no key it answered in English, and the phone kept each answer as the
 * "translation" — so a phone that had tried a language stayed English after the fix, without asking again.
 */
describe("the device store never keeps English as a translation", () => {
  const src = readFileSync("lib/i18n/page-translator.ts", "utf8");
  it("drops the poisoned v1 store and keeps only answers that differ from their source", () => {
    expect(src).toContain('const STORE_PREFIX = "frenz:mt2:";');
    expect(src).toContain("localStorage.removeItem(OLD_STORE_PREFIX + lang);");
    // teeth: without this filter an English echo would be saved and reused forever
    expect(src).toContain(".filter(([src, t]) => t !== src)");
  });
});
