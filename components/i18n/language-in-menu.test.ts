import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** Owner, 2026-10-15: "put the language button on the landing page inside the top side menu, the landing header is too crowded". */
const header = readFileSync("components/layout/site-header.tsx", "utf8");

describe("the language button on the landing", () => {
  it("leaves the landing header: the phone row never shows it there, the desktop row only when there is no menu", () => {
    expect(header).toContain("{landing ? null : <LanguageSelector />}");
    expect(header).toContain("{landing && !user ? null : <LanguageSelector />}");
    // teeth: no unconditional globe is left in either header row
    expect(header.match(/^\s*<LanguageSelector \/>$/gm)).toBeNull();
  });

  it("is a Language row in the side menu, beside Appearance", () => {
    const at = header.indexOf("Appearance</span>");
    expect(at).toBeGreaterThan(0);
    expect(header.indexOf('<LanguageSelector variant="row" />', at)).toBeGreaterThan(at);
  });

  it("its list opens above the menu sheet (z-70), not behind it", () => {
    const sel = readFileSync("components/i18n/language-selector.tsx", "utf8");
    expect(sel).toContain('elevated={variant === "row"}');
    const menu = readFileSync("components/i18n/language-menu.tsx", "utf8");
    expect(menu).toContain('elevated ? "z-[81]" : "z-[61]"');
    expect(header).toContain("z-[70]");
  });
});
