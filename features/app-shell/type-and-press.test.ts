import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-07 (screenshots): the installed app rendered pages in a SERIF;
 * and "make the button interact well and bounce on click".
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("🔴 an undefined font variable can never fall back to Times", () => {
  it("every var() in a font stack carries its own fallback", () => {
    const tw = code("tailwind.config.ts");
    expect(tw).toContain('"var(--font-sans, -apple-system)"');
    const css = code("app/globals.css");
    // teeth: a bare var(--font-…) with no fallback anywhere in a font-family is the bug
    const families = css.match(/font-family:[^;]*;/g) ?? [];
    for (const f of families) expect(f, f).not.toMatch(/var\(--font-[a-z]+\)/);
  });
});

describe("every button answers a tap", () => {
  const css = code("app/globals.css");
  it("press feedback through the independent scale property (never transform — positioned buttons stay put)", () => {
    expect(css).toMatch(/:where\(button, \[role="button"\], a\.ai-btn, a\.ai-strip-cta, summary\):not\(:disabled\):not\(\[aria-disabled="true"\]\):active \{\n  scale: 0\.95;/);
  });
  it("a disabled button does not move, and reduced motion drops the movement", () => {
    expect(css).toContain(':where(html[data-a11y-motion="reduce"]) :where(button, [role="button"], a.ai-btn, a.ai-strip-cta, summary):active {\n  scale: none;');
  });
  it("the profile cover's floating controls share one glass recipe", () => {
    const c = code("features/profile/profile-cover-controls.tsx");
    expect(c.match(/\$\{GLASS\}/g)?.length).toBe(3);
    expect(c).not.toContain("rounded-xl bg-black/40");
  });
});
