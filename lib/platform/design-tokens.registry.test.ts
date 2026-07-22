import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
