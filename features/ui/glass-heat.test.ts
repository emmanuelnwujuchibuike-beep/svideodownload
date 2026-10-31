import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const fg = readFileSync("features/ui/floating-glass.ts", "utf8");
const deck = readFileSync("features/friends/suggestion-deck.tsx", "utf8");

/*
  Owner, 2026-10-31: "scan the whole recent glass implementation for over heating". A backdrop-filter re-blurs whatever
  moves behind it on every frame. Live blur is allowed only on the few fixed bars (one layer each) — never on a control
  that sits inside one, never on a surface that scrolls with the page.
*/
const block = (c: string, sel: string) => {
  const i = c.indexOf(`  ${sel} {\n`);
  return i < 0 ? "" : c.slice(i, c.indexOf("}", i));
};
function cool(c: string, f: string, d: string): boolean {
  const noBlur = [".frenz-inbox-action", ".frenz-nav-profile-glass", ".frenz-install-glass", ".frenz-glass-tile", ".frenz-glass-pill", ".frenz-glass-card"];
  return (
    noBlur.every((s) => block(c, s) !== "" && !/backdrop-filter/.test(block(c, s))) &&
    /\n {2}\.frenz-nav-glass--static \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/.test(c) &&
    !/backdrop-blur/.test(f.match(/export const FROSTED_GLASS =\s*"[^"]*"/)?.[0] ?? "backdrop-blur") &&
    /"frenz-nav-glass frenz-nav-glass--static relative isolate/.test(d)
  );
}

describe("the glass does not overheat", () => {
  it("holds", () => {
    expect(cool(css, fg, deck)).toBe(true);
  });
  it("has teeth", () => {
    expect(cool(css.replace("  .frenz-glass-tile {\n", "  .frenz-glass-tile {\n    backdrop-filter: blur(20px);\n"), fg, deck)).toBe(false);
    expect(cool(css, fg.replace('export const FROSTED_GLASS =\n  "border', 'export const FROSTED_GLASS =\n  "backdrop-blur-[20px] border'), deck)).toBe(false);
    expect(cool(css, fg, deck.replace("frenz-nav-glass frenz-nav-glass--static relative", "frenz-nav-glass relative"))).toBe(false);
  });
});
