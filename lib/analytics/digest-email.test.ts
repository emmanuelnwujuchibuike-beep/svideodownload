import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  ── Dark mode, pinned ──────────────────────────────────────────────────────
  Owner, 2026-08-24: the Total downloads figure did not show when the mail
  client was switched to dark mode. Every other number was fine.

  The cause is a rule that is easy to break again without noticing, because it
  looks correct in every light-mode preview: dark-mode clients that auto-invert
  work from DECLARED COLORS. They invert `color` and `background-color`, but a
  gradient is a background IMAGE and is left alone. Text over a gradient-only
  panel therefore flips to pale while the panel stays pale, and the text
  disappears. The stat cards survived only because they sat on a solid white.

  These are source-level assertions rather than render assertions on purpose:
  the invariant is a property of how the template is WRITTEN, and building the
  ~16-key DigestData fixture would test the fixture more than the rule.
*/
const SRC = readFileSync("lib/analytics/digest-email.ts", "utf8");

describe("digest email — dark mode", () => {
  it("declares color-scheme so clients stop force-inverting", () => {
    expect(SRC).toContain('<meta name="color-scheme" content="light dark">');
    expect(SRC).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(SRC).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/);
  });

  it("🔴 never paints text over a gradient without a solid background-color", () => {
    /*
      THE BUG ITSELF. Each `background:linear-gradient(...)` must be followed
      by a `background-color`, so an inverting client has a solid colour to
      flip in step with the text — and a client with no gradient support still
      gets the right fill instead of white.
    */
    const gradients = SRC.match(/background:linear-gradient\([^)]*\)[^"]*/g) ?? [];
    expect(gradients.length, "no gradients found — did the template change shape?").toBeGreaterThan(0);
    for (const decl of gradients) {
      expect(decl, `gradient without a solid fallback: ${decl}`).toContain("background-color");
    }
  });

  it("gives the hero panel a solid background, not only a gradient", () => {
    // The specific element the owner reported.
    expect(SRC).toMatch(/class="fz-hero"[^>]*background-color:#eef2ff/);
    expect(SRC).toMatch(/class="fz-strong"[^>]*font-size:34px/);
  });

  it("defines a dark palette for every class the template hooks", () => {
    const dark = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n    \}/.exec(SRC)?.[1] ?? "";
    expect(dark, "dark-mode block not found").not.toBe("");
    for (const cls of ["fz-body", "fz-card", "fz-hero", "fz-stat", "fz-strong", "fz-eyebrow", "fz-muted", "fz-track"]) {
      expect(dark, `.${cls} has no dark-mode rule`).toContain(`.${cls}`);
      // Inline styles beat a stylesheet in email; without !important the
      // override silently does nothing.
      expect(SRC, `.${cls} is hooked but never used in the markup`).toContain(`class="${cls}"`);
    }
    const rules = dark.split("\n").filter((l) => l.includes("{"));
    for (const rule of rules) {
      expect(rule, `missing !important, so the inline style wins: ${rule.trim()}`).toContain("!important");
    }
  });

  it("keeps the reasoning in the source, not in the delivered email", () => {
    // An HTML comment inside the template literal would ship in every send —
    // and, since the template is a backtick string, a stray backtick in that
    // comment terminates it. Both are avoided by keeping the note in TS.
    const template = SRC.slice(SRC.indexOf("<!doctype html>"));
    expect(template).not.toContain("<!--");
  });
});
