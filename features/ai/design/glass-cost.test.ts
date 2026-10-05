import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { glassTierFor } from "@/features/ai/design/glass-tier";

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

/**
 * Every AI component, not only the design folder. The 24px blur that survived
 * the first pass lived in `features/ai/video/generation-progress-card.tsx` — a
 * FIXED element, so it re-blurred on every scroll frame — and the folder-only
 * scope could not see it.
 */
const AI_DIR = join(process.cwd(), "features", "ai");
function aiFiles(): string[] {
  return (readdirSync(AI_DIR, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(AI_DIR, f));
}

describe("Part 7 §11 — AI Studio glass cost", () => {
  it("has AI files to check (the guard is not vacuous)", () => {
    const files = aiFiles();
    expect(files.length).toBeGreaterThan(20);
    // At least one must use a backdrop-blur utility, or this suite would pass
    // by finding nothing at all. (The design system itself now goes through
    // `.ai-glass`, which the §57 suite below measures in the CSS.)
    const anyBlur = files.some((f) => blurClassesIn(readFileSync(f, "utf8")).length > 0);
    expect(anyBlur).toBe(true);
    expect(designFiles().some((f) => /(?<![\w-])ai-glass(?![\w-])/.test(readFileSync(f, "utf8")))).toBe(true);
  });

  it(`no AI surface blurs wider than ${MAX_RADIUS_PX}px`, () => {
    const offenders: string[] = [];
    for (const file of aiFiles()) {
      for (const cls of blurClassesIn(readFileSync(file, "utf8"))) {
        const px = RADIUS[cls]!;
        if (px > MAX_RADIUS_PX) {
          offenders.push(`${file.split(/[\\/]/).pop()}: ${cls} (${px}px)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AiGlassCard — the panel that covers most of the screen — is the shared .ai-glass class", () => {
    const src = readFileSync(join(DESIGN_DIR, "ai-surface.tsx"), "utf8");
    expect(src, "AiGlassCard's panel classes changed shape — re-point this test").toMatch(
      /"ai-glass relative overflow-hidden rounded-\[1\.75rem\]"/,
    );
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

/* ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 §57 / §39 — THE FALLBACK HIERARCHY
 *  Full glass → Reduced glass → Translucent → Solid, all in globals.css.
 * ═══════════════════════════════════════════════════════════════════════════ */

const GLOBALS = join(process.cwd(), "app", "globals.css");

/** Every px radius the `.ai-glass` rules can resolve to. */
function aiGlassRadii(css: string): number[] {
  const out: number[] = [];
  const rule = /([^{}]*\.ai-glass[^{}]*)\{([^{}]*)\}/g;
  for (const m of css.matchAll(rule)) {
    const body = m[2]!;
    for (const v of body.matchAll(/--ai-glass-blur:\s*(\d+(?:\.\d+)?)px/g)) out.push(Number(v[1]));
    for (const v of body.matchAll(/blur\((\d+(?:\.\d+)?)px\)/g)) out.push(Number(v[1]));
  }
  return out;
}

/**
 * The tiers in source order. Every tier selector has the specificity of
 * `.ai-glass` (the html part is inside `:where()`), so the LAST matching tier
 * wins — the order IS the hierarchy.
 */
const TIER_MARKERS = [
  [".ai-glass {", "full"],
  [':where(html:not([data-a11y-motion="full"])) .ai-glass', "reduced (OS motion)"],
  [':where(html[data-a11y-motion="reduce"], html[data-glass="reduced"]) .ai-glass', "reduced (in-app / device)"],
  ["@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))", "translucent"],
  ["@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)", "solid (OS)"],
  [':where(html[data-a11y-transparency="reduce"], html[data-a11y-contrast="high"]) .ai-glass', "solid (in-app)"],
] as const;

function tierOrderProblems(css: string): string[] {
  const problems: string[] = [];
  let last = -1;
  for (const [marker, name] of TIER_MARKERS) {
    const at = css.indexOf(marker);
    if (at < 0) problems.push(`missing tier: ${name}`);
    else if (at < last) problems.push(`out of order: ${name}`);
    else last = at;
  }
  return problems;
}

/** The body of the rule a marker opens (for the at-rules, the first inner rule). */
function tierBody(css: string, marker: string): string {
  const at = css.indexOf(marker);
  const open = css.indexOf("{", css.indexOf(".ai-glass", at));
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("Part 7 §57 — AI glass fallback hierarchy", () => {
  const css = readFileSync(GLOBALS, "utf8");

  it("every .ai-glass radius is within the budget (and there is one to check)", () => {
    const radii = aiGlassRadii(css);
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((px) => px > MAX_RADIUS_PX)).toEqual([]);
  });

  it("all four tiers exist, in hierarchy order", () => {
    expect(tierOrderProblems(css)).toEqual([]);
  });

  it("the solid tier is opaque and blur-free — what 'reduce transparency' promises", () => {
    for (const marker of [TIER_MARKERS[4][0], TIER_MARKERS[5][0]]) {
      const body = tierBody(css, marker);
      expect(body).toMatch(/--ai-glass-fill:\s*1;/);
      expect(body).toMatch(/(?<!-)backdrop-filter:\s*none/);
    }
  });

  it("the translucent tier is MORE opaque than full glass, and the reduced tier blurs less", () => {
    const fill = (body: string) => Number(/--ai-glass-fill:\s*([\d.]+)/.exec(body)?.[1]);
    const blur = (body: string) => Number(/--ai-glass-blur:\s*([\d.]+)px/.exec(body)?.[1]);
    const full = tierBody(css, TIER_MARKERS[0][0]);
    const reduced = tierBody(css, TIER_MARKERS[2][0]);
    const translucent = tierBody(css, TIER_MARKERS[3][0]);
    expect(fill(translucent)).toBeGreaterThan(fill(full));
    expect(fill(reduced)).toBeGreaterThan(fill(full));
    expect(blur(reduced)).toBeLessThan(blur(full));
  });

  it("the fill is never computed with math (an invalid alpha would make the fallback transparent)", () => {
    const full = tierBody(css, TIER_MARKERS[0][0]);
    expect(full).toMatch(/background-color:\s*rgb\(255 255 255 \/ var\(--ai-glass-fill\)\)/);
    for (const m of css.matchAll(/--ai-glass-fill:\s*([^;]+);/g)) {
      expect(m[1]!.trim()).toMatch(/^[\d.]+$/);
    }
  });

  it("no AI design surface hand-rolls a translucent fill + blur that bypasses the tiers", () => {
    const offenders: string[] = [];
    for (const file of designFiles()) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const line of code.split("\n")) {
        if (/(?<![\w-])backdrop-blur/.test(line) && /bg-white\/\d+/.test(line)) {
          offenders.push(`${file.split(/[\/]/).pop()}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("TEETH: a reordered, a missing, and a widened tier are all caught", () => {
    // Solid moved ABOVE translucent: a browser without backdrop-filter whose
    // member asked for reduced transparency would get 0.90, not opaque.
    const swapped = css
      .replace(TIER_MARKERS[3][0], "@@T@@")
      .replace(TIER_MARKERS[4][0], TIER_MARKERS[3][0])
      .replace("@@T@@", TIER_MARKERS[4][0]);
    expect(tierOrderProblems(swapped).length).toBeGreaterThan(0);
    expect(tierOrderProblems(css.replace(TIER_MARKERS[3][0], "@supports (display: grid)"))).toContain(
      "missing tier: translucent",
    );
    const wide = css.replace("--ai-glass-blur: 8px;", "--ai-glass-blur: 24px;");
    expect(aiGlassRadii(wide).some((px) => px > MAX_RADIUS_PX)).toBe(true);
  });
});

describe("Part 7 §57 — the device input", () => {
  it("only genuinely constrained hardware gets reduced glass", () => {
    expect(glassTierFor(2, 8)).toBe("reduced");
    expect(glassTierFor(1, undefined)).toBe("reduced");
    expect(glassTierFor(undefined, 2)).toBe("reduced");
    expect(glassTierFor(8, 8)).toBe("full");
    // A mainstream 4-core machine keeps full glass — measured: the first,
    // looser rule (cores <= 4) downgraded an ordinary desktop.
    expect(glassTierFor(undefined, 4)).toBe("full");
    expect(glassTierFor(4, 4)).toBe("full");
    // Safari reports neither hint — unknown is NOT weak. Zero = "not reported".
    expect(glassTierFor(undefined, undefined)).toBe("full");
    expect(glassTierFor(0, 0)).toBe("full");
  });
});
