import { describe, expect, it } from "vitest";

import { contrastRatio, parseColor } from "@/lib/a11y/contrast";

import { BRAND_ICONS, BRAND_MARKS, BRAND_TILE_BG, FLAGSHIP_IDS } from "./platform-icons";

/**
 * The brand strip must be READABLE, not merely colourful.
 *
 * ── The trap this exists for ─────────────────────────────────────────────────
 * The row was painted one flat near-black and the owner asked for the
 * reference's full-colour treatment. Reaching for each brand's official hex is
 * the obvious way to do that and it has one landmine in it: Snapchat's colour
 * is #FFFC00, and yellow ink on a white tile is a contrast ratio of about 1.07.
 * The logo would be effectively invisible, the build would be green, and the
 * only way to find out is for someone to look at it on a screen that is not
 * the one it was designed on.
 *
 * So every pair is graded by the same WCAG maths the Accessibility Center uses
 * (Part 22), against 3:1 — SC 1.4.11, the minimum for non-text content that
 * carries meaning. These logos carry meaning: they are the answer to "does this
 * handle my link".
 *
 * A gradient has no single luminance, so those declare `bgTest` — the lightest
 * stop, which is the worst case for the white ink sitting on it.
 */

const NON_TEXT_MIN = 3;

describe("brand marks", () => {
  it("has a mark for every platform that has a logo", () => {
    // A logo with no treatment falls back to inheriting whatever colour it
    // lands in, which is the flat monochrome row this replaced.
    for (const id of Object.keys(BRAND_ICONS)) {
      expect(BRAND_MARKS[id as keyof typeof BRAND_MARKS], `${id} has an icon but no mark`).toBeTruthy();
    }
  });

  it("covers every flagship platform", () => {
    for (const id of FLAGSHIP_IDS) expect(BRAND_MARKS[id], `${id} is a flagship with no mark`).toBeTruthy();
  });

  it("parses every colour it declares", () => {
    // A typo'd hex silently becomes "no colour" in CSS — the glyph inherits and
    // the row goes quietly monochrome again.
    for (const [id, mark] of Object.entries(BRAND_MARKS)) {
      expect(parseColor(mark!.fg), `${id} fg is not a colour: ${mark!.fg}`).toBeTruthy();
      if (mark!.bgTest) {
        expect(parseColor(mark!.bgTest), `${id} bgTest is not a colour`).toBeTruthy();
      }
    }
  });

  it("keeps every glyph at 3:1 or better against its own tile", () => {
    const failures: string[] = [];
    for (const [id, mark] of Object.entries(BRAND_MARKS)) {
      const fg = parseColor(mark!.fg);
      const bg = parseColor(mark!.bgTest ?? BRAND_TILE_BG);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < NON_TEXT_MIN) failures.push(`${id}: ${ratio.toFixed(2)}:1 (${mark!.fg} on ${mark!.bgTest ?? BRAND_TILE_BG})`);
    }
    expect(
      failures,
      `Brand marks below the 3:1 non-text minimum:\n  ${failures.join("\n  ")}\n\n` +
        `If the brand's colour is its SURFACE rather than its ink (Snapchat, Instagram), ` +
        `give the mark a bg and put the glyph on top of it.`,
    ).toHaveLength(0);
  });

  it("would fail if a brand's own colour were used as ink on white", () => {
    /*
      Proves the rule can go red, using the exact case that motivated it.
      Without this the check that matters most here is one nobody has seen fail.
    */
    const snapYellow = parseColor("#FFFC00")!;
    const white = parseColor(BRAND_TILE_BG)!;
    expect(contrastRatio(snapYellow, white)).toBeLessThan(NON_TEXT_MIN);
  });
});
