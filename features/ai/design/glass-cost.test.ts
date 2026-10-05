import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 §11 — THE GLASS MAY NOT GET EXPENSIVE AGAIN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `AiGlassCard` is what every AI screen is built from, so its backdrop-filter
 * is the largest compositor cost in AI Studio: measured on a production build
 * at 390×844 it covers 68% of the viewport on /ai/text-to-video and 83% on
 * /ai/image-to-video, and with its siblings those pages carried MORE THAN ONE
 * FULL VIEWPORT of blur.
 *
 * It ran at `backdrop-blur-xl` (24px). Diffing real rendered pixels against
 * that baseline, the share differing by more than 8/255 was:
 *
 *     16px → 0.20%    12px → 0.27%    8px → 0.16%     (noise; identical)
 *      4px → 1.9%      0px → 2.2%                     (visibly different)
 *
 * The visible contribution SATURATES at 8px, because the fill is `bg-white/70`
 * and what little shows through is the low-frequency `ai-wash` gradient.
 *
 * This test exists because the regression is INVISIBLE in review: putting
 * `-xl` back looks like a taste choice in a diff and costs three times the
 * kernel over most of the screen. §74.3 — "do not allow the UI to become slow
 * because of glass effects" — is the rule it defends. If a wider blur is ever
 * genuinely wanted, re-run the pixel diff and bring a number.
 */

const DESIGN_DIR = join(process.cwd(), "features", "ai", "design");

/** Tailwind's backdrop-blur scale, in px. */
const RADIUS: Record<string, number> = {
  "backdrop-blur-none": 0,
  "backdrop-blur-sm": 4,
  "backdrop-blur": 8,
  "backdrop-blur-md": 12,
  "backdrop-blur-lg": 16,
  "backdrop-blur-xl": 24,
  "backdrop-blur-2xl": 40,
  "backdrop-blur-3xl": 64,
};

const MAX_RADIUS_PX = 8;

/**
 * Class occurrences in real markup, with comments stripped — the measurement
 * is written up in a comment that names `backdrop-blur-xl`, and a guard that
 * trips over its own documentation is a guard nobody keeps.
 */
function blurClassesIn(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // Longest-first so `backdrop-blur-xl` is never read as `backdrop-blur`.
  const names = Object.keys(RADIUS).sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const name of names) {
    const re = new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "g");
    const hits = code.match(re);
    if (hits) found.push(...hits);
  }
  return found;
}

function designFiles(): string[] {
  return readdirSync(DESIGN_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(DESIGN_DIR, f));
}

describe("Part 7 §11 — AI Studio glass cost", () => {
  it("has design-system files to check (the guard is not vacuous)", () => {
    const files = designFiles();
    expect(files.length).toBeGreaterThan(0);
    // At least one of them must actually use a backdrop-blur, or this suite
    // would pass by finding nothing at all.
    const anyBlur = files.some((f) => blurClassesIn(readFileSync(f, "utf8")).length > 0);
    expect(anyBlur).toBe(true);
  });

  it(`no AI design surface blurs wider than ${MAX_RADIUS_PX}px`, () => {
    const offenders: string[] = [];
    for (const file of designFiles()) {
      for (const cls of blurClassesIn(readFileSync(file, "utf8"))) {
        const px = RADIUS[cls]!;
        if (px > MAX_RADIUS_PX) {
          offenders.push(`${file.split(/[\\/]/).pop()}: ${cls} (${px}px)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AiGlassCard — the panel that covers most of the screen — is still 8px", () => {
    const src = readFileSync(join(DESIGN_DIR, "ai-surface.tsx"), "utf8");
    const card = /relative overflow-hidden rounded-\[1\.75rem\] bg-white\/70 (backdrop-blur[\w-]*)/.exec(src);
    expect(card, "AiGlassCard's panel classes changed shape — re-point this test").not.toBeNull();
    expect(RADIUS[card![1]!]).toBeLessThanOrEqual(MAX_RADIUS_PX);
  });

  it("TEETH: the scale is read exactly, so -xl is never mistaken for the 8px token", () => {
    // `backdrop-blur` is a prefix of `backdrop-blur-xl`. A naive `includes`
    // check would read the 24px class as the 8px one and pass while the
    // expensive blur shipped — which is precisely the regression this file
    // exists to catch.
    expect(blurClassesIn(`<div className="backdrop-blur-xl" />`)).toEqual(["backdrop-blur-xl"]);
    expect(blurClassesIn(`<div className="backdrop-blur" />`)).toEqual(["backdrop-blur"]);
    expect(RADIUS[blurClassesIn(`<div className="backdrop-blur-2xl" />`)[0]!]).toBe(40);
  });

  it("TEETH: a reinstated 24px blur in the design system fails the rule", () => {
    const bad = `<div className="rounded-[1.75rem] bg-white/70 backdrop-blur-xl" />`;
    const radii = blurClassesIn(bad).map((c) => RADIUS[c]!);
    expect(radii.some((px) => px > MAX_RADIUS_PX)).toBe(true);
  });

  it("ignores the measurement write-up in comments", () => {
    const commented = `
      /* backdrop-blur-xl was 24px and measured identical at 8px. */
      // backdrop-blur-2xl would be worse still.
      <div className="backdrop-blur" />
    `;
    expect(blurClassesIn(commented)).toEqual(["backdrop-blur"]);
  });
});
