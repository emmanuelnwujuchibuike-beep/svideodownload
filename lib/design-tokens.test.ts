import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Colour tokens that do not exist emit no CSS, and nothing fails.
 *
 * ── The bug this was written for ──────────────────────────────────────────────
 *
 * The Academy course self-check styled wrong answers with `border-destructive/60`
 * and `text-destructive`. This project has no `destructive` token — its palette
 * is Electric Blue / Royal Purple with a small semantic set, not stock shadcn.
 * Tailwind emitted nothing for those classes, so an incorrect answer rendered
 * identically to an untouched one, distinguishable only by its icon.
 *
 * `tsc --noEmit` passed. `next lint` passed. Every unit test passed. The build
 * succeeded. The only thing that caught it was looking at a screenshot — which
 * is exactly the failure mode this repo has hit before and the reason the
 * "visually verify before shipping" rule exists.
 *
 * ── Why an allowlist of ABSENT names rather than a general scan ───────────────
 *
 * Trying to validate every `bg-*` class means distinguishing design tokens from
 * Tailwind's built-in palette, arbitrary values, and dynamic class names — a
 * check with false positives that someone eventually deletes. The realistic
 * failure is narrow and worth naming precisely: this palette is shadcn-SHAPED
 * but omits several of shadcn's standard tokens, so anyone porting a snippet
 * (or any model generating one) reaches for a name that looks right and is not
 * defined here. Those specific names are what this guards.
 */

const ROOT = path.resolve(__dirname, "..");
const CSS = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");

/**
 * shadcn/ui palette names that this project does NOT define. Each is a name a
 * developer or a code generator will plausibly reach for by habit.
 *
 * If one of these is ever genuinely added to `globals.css`, this test starts
 * passing for it automatically — the check is "defined, or unused", never
 * "banned".
 */
const SHADCN_TOKENS = [
  "destructive",
  "popover",
  "sidebar",
  "warning",
  "success",
  "info",
] as const;

/** Utilities that resolve a colour token, i.e. where a missing name is silent. */
const COLOUR_UTILITIES =
  "bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|caret|divide|placeholder|shadow|accent";

const SCAN_DIRS = ["app", "components", "features"];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")
      ? [rel]
      : [];
  });
}

const FILES = walk(SCAN_DIRS[0]!).concat(...SCAN_DIRS.slice(1).map(walk));

function tokenIsDefined(token: string): boolean {
  return new RegExp(`--${token}\\s*:`).test(CSS);
}

describe("Design tokens", () => {
  it("scans a non-empty set of component files", () => {
    // Without this the suite below passes vacuously if the dirs ever move.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("defines the semantic tokens the palette is built on", () => {
    // A sanity check on the parser itself: if these stop resolving, the
    // `tokenIsDefined` regex has broken and every result below is meaningless.
    for (const token of ["background", "foreground", "primary", "border", "muted", "accent"]) {
      expect(tokenIsDefined(token), `--${token} is missing from globals.css`).toBe(true);
    }
  });

  it("never references a shadcn token this palette does not define", () => {
    const missing = SHADCN_TOKENS.filter((t) => !tokenIsDefined(t));
    const pattern = new RegExp(`\\b(?:${COLOUR_UTILITIES})-(?:${missing.join("|")})\\b`, "g");

    const offences = FILES.flatMap((file) => {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      return src.split("\n").flatMap((line, i) => {
        const hits = line.match(pattern);
        return hits ? hits.map((hit) => `${file}:${i + 1}  ${hit}`) : [];
      });
    });

    expect(
      offences,
      `Undefined colour tokens — these emit NO CSS and fail silently:\n  ${offences.join("\n  ")}\n\n` +
        `Either add the token to app/globals.css or use a literal palette colour ` +
        `(the house convention for error states is rose-500).`,
    ).toHaveLength(0);
  });
});
