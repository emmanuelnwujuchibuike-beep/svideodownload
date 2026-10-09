import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-09: "a genuinely floating Instagram/WhatsApp-inspired glass
 * bottom navigation with visible left and right margins … The navigation MUST
 * NOT extend from the left edge to the right edge of the screen … Do not attach
 * a full-width opaque background behind it."
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// Comments stripped: the file DOCUMENTS the bar and the pulse it replaced.
const nav = code("features/app-shell/mobile-nav.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const css = code("app/globals.css");

/** The floating-pill rules as a function of the nav's source, so the teeth can run them on a broken copy. */
function floats(src: string): boolean {
  const wrapper = src.match(/"pointer-events-none fixed [^"]*"/)?.[0] ?? "";
  return (
    // inset from both edges, centred, capped — never edge to edge
    /\binset-x-0\b/.test(wrapper) &&
    /\bmx-auto\b/.test(wrapper) &&
    /\bw-\[calc\(100%-1\.75rem\)\]/.test(wrapper) &&
    /\bmax-w-\[560px\]/.test(wrapper) &&
    !/\bw-full\b/.test(wrapper) &&
    // above the home indicator, by the shared gap
    /\bbottom-\[var\(--frenz-nav-gap\)\]/.test(wrapper) &&
    // the pill: glass, rounded, a fixed height every page can reserve
    /"frenz-nav-glass pointer-events-auto relative flex h-\[var\(--frenz-nav-height\)\][^"]*rounded-\[1\.75rem\]/.test(src) &&
    // no opaque full-width slab left behind
    !/border-t border-border bg-background/.test(src) &&
    // nothing loops on the bar
    !/attract-loop|attract=/.test(src)
  );
}

describe("the floating glass bottom nav", () => {
  it("floats: inset from both edges, centred, capped at 560px, above the safe area", () => {
    expect(floats(nav)).toBe(true);
  });

  it("teeth: a full-width bar, an opaque slab, or the pulse coming back fails", () => {
    expect(floats(nav.replace("w-[calc(100%-1.75rem)]", "w-full"))).toBe(false);
    expect(floats(nav.replace("frenz-nav-glass pointer-events-auto", "border-t border-border bg-background pointer-events-auto"))).toBe(false);
    expect(floats(nav.replace("active={pathname === \"/home\"", "attract={true}\n            active={pathname === \"/home\""))).toBe(false);
  });

  it("is real glass with the .ai-glass fallback tiers, and nothing on it transitions", () => {
    const rule = css.match(/\.frenz-nav-glass \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    expect(rule).toMatch(/backdrop-filter: blur\(var\(--nav-glass-blur\)\)/);
    expect(rule).toMatch(/background-color: rgb\(var\(--nav-glass-rgb\) \/ var\(--nav-glass-fill\)\)/);
    expect(rule).not.toMatch(/transition|animation/);
    // reduced device / motion, no support, reduced transparency
    expect(css).toMatch(/html\[data-glass="reduced"\]\) \.frenz-nav-glass/);
    // Inside the SAME tier blocks as .ai-glass (one hierarchy, one source order).
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\n {4}\.ai-glass \{[^}]*\}\n {4}\.frenz-nav-glass \{\n {6}--nav-glass-fill: 0\.94;/);
    expect(css).toMatch(/prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{\n {4}\.ai-glass \{[^}]*\}\n {4}\.frenz-nav-glass \{\n {6}--nav-glass-fill: 1;/);
    // the base rule comes BEFORE every tier, so the tiers win by source order
    expect(css.indexOf(".frenz-nav-glass {")).toBeLessThan(css.indexOf('html[data-glass="reduced"]) .frenz-nav-glass'));
    // the dark theme must not set the fill, or it would out-rank the tiers
    const dark = css.match(/\.dark \.frenz-nav-glass \{[\s\S]*?\}/)?.[0] ?? "";
    expect(dark).not.toMatch(/--nav-glass-fill/);
  });

  it("every surface reserves the same clearance the pill is built from", () => {
    expect(css).toMatch(/--frenz-nav-clearance: calc\(var\(--frenz-nav-height\) \+ var\(--frenz-nav-gap\)\);/);
    // low, but clear of the home indicator (owner: "it shouldn't float much too high")
    expect(css).toMatch(/--frenz-nav-gap: max\(0\.5rem, calc\(env\(safe-area-inset-bottom\) - 0\.75rem\)\);/);
    expect(code("features/app-shell/app-content.tsx")).toContain("pb-[calc(var(--frenz-nav-clearance)+1.5rem)]");
    expect(code("app/(app)/messages/layout.tsx")).toContain("h-[calc(100dvh-var(--frenz-nav-clearance))]");
    expect(code("app/(marketing)/layout.tsx")).toContain("h-[calc(var(--frenz-nav-clearance)+0.75rem)] lg:hidden");
  });

  it("the reel scrubber still sits above the pill (they are a pair)", () => {
    // nav top = 3.875rem + max(0.5rem, inset - 0.75rem) <= 4.75rem + inset
    expect(code("features/feed/reel-viewer.tsx")).toContain('"!bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:!bottom-4"');
    expect(css).toMatch(/--frenz-nav-height: 3\.875rem;/);
  });
});

describe("Support lives in the profile menu for members (owner, 2026-10-09)", () => {
  /** Support sits in the menu's footer row, beside the Dark / Light / System toggle. */
  function supportBesideTheme(src: string): boolean {
    const footer = src.slice(src.indexOf("{/* Footer — theme"));
    return /<ThemeToggle \/>[\s\S]{0,700}?href="\/support"[\s\S]{0,400}?Support\n/.test(footer);
  }
  const menu = code("features/profile/profile-menu-panel.tsx");
  it("the footer carries Support next to the theme toggle", () => {
    expect(supportBesideTheme(menu)).toBe(true);
  });
  it("teeth: Support missing from the footer fails", () => {
    expect(supportBesideTheme(menu.replace('href="/support"', 'href="/help"'))).toBe(false);
  });
  it("members' bottom nav keeps Chats; guests keep Support there", () => {
    expect(nav).toMatch(/\{handle \? \(\s*<NavTab label="Chats" href="\/messages"[\s\S]*?\) : \(\s*<NavTab label="Support" href="\/support"/);
  });
});
