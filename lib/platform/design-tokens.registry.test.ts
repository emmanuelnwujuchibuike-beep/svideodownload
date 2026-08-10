import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, type Rgb } from "@/lib/a11y/contrast";

import {
  BRAND_TOKENS,
  COLOR_TOKENS,
  type ColorToken,
  renderTokenCss,
  SCALAR_TOKENS,
  TOKEN_MARKERS,
} from "./design-tokens";

const ROOT = path.resolve(__dirname, "../..");
const HSL = /^\d{1,3} \d{1,3}% \d{1,3}%$/;

function colorProblems(tokens: ColorToken[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t.name)) problems.push(`duplicate token: "${t.name}"`);
    seen.add(t.name);
    if (!HSL.test(t.light)) problems.push(`"${t.name}" light is not HSL channels: "${t.light}"`);
    if (!HSL.test(t.dark)) problems.push(`"${t.name}" dark is not HSL channels: "${t.dark}"`);
  }
  return problems;
}

describe("Design Token Registry — integrity", () => {
  it("colour + brand tokens are unique with valid light/dark HSL channels", () => {
    const problems = colorProblems([...COLOR_TOKENS, ...BRAND_TOKENS]);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("scalar token names are unique", () => {
    const names = SCALAR_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * Contrast, graded on the tokens themselves.
 *
 * ── Why this exists (axe on the live landing page, 2026-08-10) ────────────────
 *
 * `--primary` was `210 100% 50%` — #0080FF, which is 3.79:1 against white. AA
 * body text needs 4.5:1. Six separate elements on the landing page failed on
 * that one number: the download submit button (white on primary), two in-copy
 * links (primary on white), and the active label in the mobile tab bar.
 *
 * The failure is invisible from inside a component. Nobody writing
 * `text-primary` is choosing a contrast ratio — they are choosing a role, and
 * they are entitled to assume the role is legible. So the check belongs on the
 * palette, once, rather than on every place that spends it.
 *
 * Graded with the SAME `contrastRatio` used by the Accessibility Center (Part
 * 22) and by the brand-mark test, so a token and a brand glyph can never be
 * judged by two different sets of maths.
 *
 * Deliberately scoped to the LIGHT theme and to the pairs that are actually
 * rendered as text. Dark theme has its own genuine failure — white on
 * dark-theme `primary` is 3.1:1 — which is recorded on the token in
 * design-tokens.ts and is NOT silently asserted as passing here.
 */
const AA_TEXT = 4.5;

/** HSL channels ("210 100% 45%") → Rgb, so tokens can be graded as authored. */
function hslChannels(channels: string): Rgb {
  const m = channels.match(/^(\d{1,3}) (\d{1,3})% (\d{1,3})%$/);
  if (!m) throw new Error(`not HSL channels: "${channels}"`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return {
    r: Math.round((r + base) * 255),
    g: Math.round((g + base) * 255),
    b: Math.round((b + base) * 255),
  };
}

function lightValue(name: string): string {
  const token = [...COLOR_TOKENS, ...BRAND_TOKENS].find((t) => t.name === name);
  if (!token) throw new Error(`no such token: "${name}"`);
  return token.light;
}

function lightRatio(fg: string, bg: string): number {
  return contrastRatio(hslChannels(lightValue(fg)), hslChannels(lightValue(bg)));
}

describe("Design Token Registry — light-theme text contrast (WCAG AA)", () => {
  /** Every pair below is a combination the app actually renders as text. */
  const PAIRS: { fg: string; bg: string; usage: string }[] = [
    { fg: "foreground", bg: "background", usage: "body copy" },
    { fg: "muted-foreground", bg: "background", usage: "secondary copy, footer legal line" },
    { fg: "primary", bg: "background", usage: "text-primary links, active tab label" },
    { fg: "primary-foreground", bg: "primary", usage: "white type on the download button" },
    { fg: "accent", bg: "background", usage: "text-accent" },
    { fg: "accent-foreground", bg: "accent", usage: "white type on an accent surface" },
  ];

  it.each(PAIRS)("$fg on $bg is at least 4.5:1 ($usage)", ({ fg, bg }) => {
    const ratio = lightRatio(fg, bg);
    expect(
      ratio,
      `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, below the ${AA_TEXT}:1 AA minimum for body text. ` +
        `Adjust the LIGHTNESS channel in COLOR_TOKENS — hue and saturation can usually stay.`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("Design Token Registry — the contrast check has teeth", () => {
  it("rejects the exact value that shipped the failure (#0080FF on white)", () => {
    // `210 100% 50%` is what `--primary` was until 2026-08-10. If this ever
    // stops being under 4.5:1, the maths above has drifted, not the palette.
    const ratio = contrastRatio(hslChannels("210 100% 50%"), hslChannels("0 0% 100%"));
    expect(ratio).toBeLessThan(AA_TEXT);
    expect(ratio).toBeCloseTo(3.79, 1);
  });
});

describe("Design Token Registry — globals.css is generated from it (no drift)", () => {
  it("the marked block in app/globals.css equals the registry's rendered CSS", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const start = css.indexOf(TOKEN_MARKERS.start);
    const end = css.indexOf(TOKEN_MARKERS.end);
    expect(start, "design-tokens:start marker missing").toBeGreaterThanOrEqual(0);
    expect(end, "design-tokens:end marker missing").toBeGreaterThan(start);
    const between = css.slice(start + TOKEN_MARKERS.start.length, end).trim();
    expect(
      between,
      "app/globals.css design tokens are out of sync with the registry — run `npm run tokens:generate`.",
    ).toBe(renderTokenCss().trim());
  });
});

describe("Design Token Registry — the integrity check has teeth", () => {
  it("catches a malformed value and a duplicate", () => {
    const broken = [
      { name: "ok", light: "0 0% 100%", dark: "0 0% 0%" },
      { name: "bad", light: "#fff", dark: "0 0% 0%" },
      { name: "ok", light: "0 0% 100%", dark: "0 0% 0%" },
    ] as ColorToken[];
    const problems = colorProblems(broken);
    expect(problems.some((p) => p.includes("not HSL"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate"))).toBe(true);
  });
});
