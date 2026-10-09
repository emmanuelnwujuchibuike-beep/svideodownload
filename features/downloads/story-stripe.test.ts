import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PLAYER = "features/downloads/download-player.tsx";

/**
 * The history viewer's progress stripe.
 *
 * Reported three times ("this history doesn't have a progress stripe bar like
 * WhatsApp and yet you keep ignoring it") and fixed wrongly three times, because
 * each earlier attempt repaired something real that was not the cause.
 *
 * 🔴 THE CAUSE: `media-gallery.tsx` opens the player with the WHOLE sorted
 * history, so `total` is every download the member has. One `flex-1` segment per
 * item with a 4px gap gives, on a 406px row with sixty items, segments of 2.8px
 * separated by gaps wider than themselves. It was rendering the entire time — as
 * a row of near-invisible dashes.
 */

/** The width one segment actually gets, in px, for a queue of n on a given row. */
function segmentWidth(n: number, rowPx = 406, gapPx = 4): number {
  return (rowPx - gapPx * (n - 1)) / n;
}

describe("the stripe is legible at every queue length", () => {
  it("proves the arithmetic that made it invisible", () => {
    // What shipped before the cap: a segment per history item.
    expect(segmentWidth(60)).toBeLessThan(3);
    expect(segmentWidth(30)).toBeLessThan(10);
    // …against a 4px gap. The gaps were wider than the segments.
    expect(segmentWidth(60)).toBeLessThan(4);
  });

  it("keeps every drawn segment comfortably visible under the cap", () => {
    const CAP = 12;
    // At the cap, on the narrowest phone this app supports (320px - 24px padding).
    expect(segmentWidth(CAP, 296)).toBeGreaterThan(20);
    expect(segmentWidth(CAP, 406)).toBeGreaterThan(29);
  });

  it("caps the segment count in the player", () => {
    const body = code(PLAYER);
    expect(body).toMatch(/const MAX_SEGMENTS = 12;/);
    expect(body).toMatch(/const segmented = total > 1 && total <= MAX_SEGMENTS;/);
    expect(body).toMatch(/const segments = segmented \? total : 1;/);
  });

  it("tracks the current clip when it falls back to one bar", () => {
    /*
      With a single bar there is no earlier segment to fill, so the offset has to
      collapse to zero — otherwise a member forty clips into their history would
      see a bar that is already full, or a seek that lands in the wrong place.
    */
    const body = code(PLAYER);
    expect(body).toMatch(/const filledBefore = segmented \? index : 0;/);
    // the seek maths and the fill both use it, so they cannot disagree
    expect(body).toMatch(/left = rect\.left \+ filledBefore \*/);
    expect(body).toMatch(/i < filledBefore \? 100 : i === filledBefore/);
  });
});

describe("the top chrome is positioned once, not per element", () => {
  it("puts the stripe and the header in one flow container", () => {
    /*
      Both were `absolute` with their own `top: calc(<n>rem + var(--frenz-safe-top))`,
      which meant the safe area was computed twice and the two rows could drift
      into each other. One positioned stack owns the inset; the children are in
      ordinary flow, stripe first.
    */
    const body = code(PLAYER);
    expect(body).toMatch(/absolute inset-x-0 top-0 z-30 px-3 pt-\[calc\(0\.55rem\+var\(--frenz-safe-top\)\)\]/);
    // neither child positions itself any more
    expect(body).not.toMatch(/top-\[calc\(1\.9rem\+var\(--frenz-safe-top\)\)\]/);
    expect(body).not.toMatch(/top-\[calc\(0\.55rem\+var\(--frenz-safe-top\)\)\] z-40/);
  });

  it("lets taps through the gap between the two rows", () => {
    // The stack spans the width; without this the space beside the title would
    // swallow taps meant for the video.
    const body = code(PLAYER);
    expect(body).toMatch(/pointer-events-none absolute inset-x-0 top-0/);
    expect(body).toMatch(/pointer-events-auto/);
  });
});

describe("a drag down moves the whole viewer", () => {
  it("applies the transform to the dialog, not to the media element", () => {
    const body = code(PLAYER);
    expect(body).not.toMatch(/mediaDragStyle/);
    expect(body).toMatch(/const el = dialogRef\.current;[\s\S]{0,200}el\.style\.transform = y \?/);
  });

  // owner, 2026-10-09: "Sliding down a media from history lags"
  it("never re-renders React per pointer move — one rAF paint per frame", () => {
    const body = code(PLAYER);
    expect(body).not.toMatch(/setDragY/);
    expect(body).toMatch(/dragFrame\.current = requestAnimationFrame\(/);
    expect(body).toMatch(/if \(dragFrame\.current !== null\) return; \/\/ one paint per frame/);
    // a render mid-drag must not reset the transform: style names no drag props
    expect(body).toMatch(/style=\{\{ zIndex: 2147483646 \}\}/);
    // a quick flick closes too
    expect(body).toMatch(/const flick = dy > 40 && dy \/ Math\.max\(1, dt\) > 0\.5;/);
  });
});
