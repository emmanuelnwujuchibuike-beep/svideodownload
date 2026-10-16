import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Exclusive glass (owner directive 2026-10-16: "native iOS glass, lightweight") may not get
 * expensive, and may not start moving on its own. The regressions this catches are invisible in
 * review — a wider blur or an ambient keyframe looks like a taste choice in a diff and costs the
 * compositor on every frame. Same budget as features/ai/design/glass-cost.test.ts (8px).
 */

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
// from the opening of the block's header comment, so the comment is stripped like any other
const start = css.lastIndexOf("/*", css.indexOf("── FRENZ EXCLUSIVE GLASS"));
const end = css.indexOf("  .ai-cta {", start);
const block = css.slice(start, end);
const rule = (sel: string) => {
  const i = block.indexOf(`${sel} {`);
  return i < 0 ? "" : block.slice(i, block.indexOf("}", i));
};
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Exclusive glass stays lightweight", () => {
  it("the block exists where the other glass tiers live", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("no blur wider than the 8px budget, anywhere in the block", () => {
    const radii = [...strip(block).matchAll(/--ex-blur:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(r).toBeLessThanOrEqual(8);
    expect(strip(block)).not.toMatch(/blur\(\s*(9|[1-9]\d)\s*px/);
  });

  it("cards carry NO backdrop-filter (only the few floating surfaces blur)", () => {
    expect(rule(".ex-card")).not.toMatch(/backdrop-filter/);
    expect(rule(".dark .ex-card")).not.toMatch(/backdrop-filter/);
    expect(rule(".ex-glass")).toMatch(/backdrop-filter/);
  });

  it("nothing animates on its own: no keyframes, no animation, no blur/shadow/filter transition", () => {
    const b = strip(block);
    expect(b).not.toMatch(/@keyframes|animation\s*:/);
    for (const m of b.matchAll(/transition\s*:([^;]+);/g)) {
      const props = m[1]!;
      if (/^\s*none\s*$/.test(props)) continue;
      expect(props, props).not.toMatch(/filter|box-shadow|blur|all\b|width|height|top|left/);
    }
    expect(b).not.toMatch(/background-attachment\s*:\s*fixed/);
  });

  it("every tier is present: reduced motion, no backdrop-filter, solid for less transparency", () => {
    const b = strip(block);
    // written differently from the AI glass's own tier text on purpose (glass-cost.test.ts finds its tiers by exact text)
    expect(b).toMatch(/@media screen and \(prefers-reduced-motion: reduce\)[\s\S]*\.ex-glass/);
    expect(b).toMatch(/@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)[\s\S]*\.ex-glass/);
    expect(b).toMatch(/prefers-contrast: more\), \(prefers-reduced-transparency: reduce\)[\s\S]*--ex-fill: 1/);
    // reduced motion also stops the press and slide transitions
    expect(b).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*ex-seg__thumb[\s\S]*transition: none/);
  });

  it("buttons and icon buttons are 44px touch targets", () => {
    expect(rule(".ex-btn")).toMatch(/min-height:\s*2\.75rem/);
    expect(rule(".ex-icon-btn")).toMatch(/height:\s*2\.75rem/);
    expect(rule(".ex-icon-btn")).toMatch(/width:\s*2\.75rem/);
  });

  it("Exclusive components don't hand-roll wide blurs or timers for effects", () => {
    const dir = join(process.cwd(), "features", "sub");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
      const src = strip(readFileSync(join(dir, f), "utf8"));
      expect(src, f).not.toMatch(/backdrop-blur-(md|lg|xl|2xl|3xl)\b/);
      expect(src, f).not.toMatch(/requestAnimationFrame\(/);
    }
  });

  it("a screen-reader table is never `table.sr-only` (a table ignores the 1px width and grows the page sideways)", () => {
    const dir = join(process.cwd(), "features", "sub");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/<table[^>]*className="[^"]*sr-only/);
  });
});
