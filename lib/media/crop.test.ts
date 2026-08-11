import { describe, expect, it } from "vitest";

import { clampOffset, coverScale, frameSize, outputSize, sourceRect } from "./crop";
import { LANDING_IMAGE_ASPECT } from "@/lib/landing/settings";

/**
 * Crop geometry.
 *
 * The properties worth pinning are the ones a person would only discover after
 * their own face came out off-centre in a file they had already saved: the
 * frame is always covered, an untouched photo is centred, and the exported
 * region is the one that was under the mask.
 */

const SQUARE = { width: 264, height: 264 };
const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 1080, height: 1920 };

describe("coverScale", () => {
  it("covers rather than contains", () => {
    // The failure this prevents is transparent bars baked into an avatar file.
    for (const image of [LANDSCAPE, PORTRAIT]) {
      const s = coverScale(image, SQUARE);
      expect(image.width * s).toBeGreaterThanOrEqual(SQUARE.width - 0.001);
      expect(image.height * s).toBeGreaterThanOrEqual(SQUARE.height - 0.001);
    }
  });

  it("takes the larger ratio, so the short edge is what fits", () => {
    // A 4000x3000 into a 264 square is driven by the HEIGHT.
    expect(coverScale(LANDSCAPE, SQUARE)).toBeCloseTo(264 / 3000, 10);
    // A 1080x1920 is driven by the WIDTH.
    expect(coverScale(PORTRAIT, SQUARE)).toBeCloseTo(264 / 1080, 10);
  });

  it("never returns 0 or NaN for a degenerate image", () => {
    // A decode failure can yield 0x0; the UI must not divide by it.
    expect(coverScale({ width: 0, height: 0 }, SQUARE)).toBe(1);
  });
});

describe("clampOffset", () => {
  it("pins the axis that exactly fits", () => {
    /*
      At cover scale the tight axis has ZERO slack. A bound computed without
      the Math.max(0,…) floor would go negative and invert the clamp, letting
      the image slide off in the one direction it must not move.
    */
    const scale = coverScale(LANDSCAPE, SQUARE); // height-driven
    const out = clampOffset({ x: 0, y: 500 }, LANDSCAPE, SQUARE, scale);
    expect(out.y).toBe(0);
  });

  it("allows movement along the overflowing axis, up to the edge", () => {
    const scale = coverScale(LANDSCAPE, SQUARE);
    const maxX = (LANDSCAPE.width * scale - SQUARE.width) / 2;
    expect(clampOffset({ x: 1e6, y: 0 }, LANDSCAPE, SQUARE, scale).x).toBeCloseTo(maxX, 6);
    expect(clampOffset({ x: -1e6, y: 0 }, LANDSCAPE, SQUARE, scale).x).toBeCloseTo(-maxX, 6);
  });

  it("keeps the frame covered at every zoom level", () => {
    // The property that matters, asserted across the range rather than at a
    // hand-picked value.
    const base = coverScale(PORTRAIT, SQUARE);
    for (const zoom of [1, 1.37, 2, 3.5, 4]) {
      const scale = base * zoom;
      const o = clampOffset({ x: 99999, y: -99999 }, PORTRAIT, SQUARE, scale);
      const r = sourceRect(PORTRAIT, SQUARE, scale, o);
      expect(r.sx).toBeGreaterThanOrEqual(-0.001);
      expect(r.sy).toBeGreaterThanOrEqual(-0.001);
      expect(r.sx + r.sw).toBeLessThanOrEqual(PORTRAIT.width + 0.001);
      expect(r.sy + r.sh).toBeLessThanOrEqual(PORTRAIT.height + 0.001);
    }
  });
});

describe("sourceRect", () => {
  it("centres an untouched photo", () => {
    // Open the cropper, change nothing, press Use photo: you should get the
    // middle of your picture, not a corner.
    const scale = coverScale(LANDSCAPE, SQUARE);
    const r = sourceRect(LANDSCAPE, SQUARE, scale, { x: 0, y: 0 });
    expect(r.sx + r.sw / 2).toBeCloseTo(LANDSCAPE.width / 2, 6);
    expect(r.sy + r.sh / 2).toBeCloseTo(LANDSCAPE.height / 2, 6);
  });

  it("is square for a square frame", () => {
    const scale = coverScale(LANDSCAPE, SQUARE) * 2;
    const r = sourceRect(LANDSCAPE, SQUARE, scale, { x: 12, y: -30 });
    expect(r.sw).toBeCloseTo(r.sh, 6);
  });

  it("shrinks as you zoom in", () => {
    const base = coverScale(PORTRAIT, SQUARE);
    const wide = sourceRect(PORTRAIT, SQUARE, base, { x: 0, y: 0 });
    const tight = sourceRect(PORTRAIT, SQUARE, base * 3, { x: 0, y: 0 });
    expect(tight.sw).toBeLessThan(wide.sw);
  });

  it("moves the source window OPPOSITE the drag", () => {
    // Dragging the image right reveals what is further left in the source.
    const scale = coverScale(PORTRAIT, SQUARE) * 2;
    const left = sourceRect(PORTRAIT, SQUARE, scale, { x: 40, y: 0 });
    const centre = sourceRect(PORTRAIT, SQUARE, scale, { x: 0, y: 0 });
    expect(left.sx).toBeLessThan(centre.sx);
  });
});

describe("outputSize", () => {
  it("caps the long edge and keeps the ratio", () => {
    expect(outputSize({ width: 264, height: 264 }, 512)).toEqual({ width: 512, height: 512 });
    expect(outputSize({ width: 320, height: 180 }, 512)).toEqual({ width: 512, height: 288 });
    expect(outputSize({ width: 180, height: 320 }, 512)).toEqual({ width: 288, height: 512 });
  });
});

describe("frameSize", () => {
  it("keeps square and landscape frames exactly as they were", () => {
    expect(frameSize(1, 264)).toEqual({ width: 264, height: 264 });
    expect(frameSize(16 / 9, 264)).toEqual({ width: 264, height: 149 });
  });

  it("bounds a PORTRAIT frame on its height, not its width", () => {
    // `264 / 0.72` is 367px — taller than the dialog, which has no scroll, so
    // the Use photo button would sit off the bottom of a short screen.
    const f = frameSize(0.72, 264);
    expect(f.height).toBe(264);
    expect(f.width).toBe(190);
  });

  it("holds the requested ratio to within a rounded pixel", () => {
    for (const aspect of Object.values(LANDING_IMAGE_ASPECT)) {
      const f = frameSize(aspect, 264);
      expect(Math.max(f.width, f.height)).toBe(264);
      expect(f.width / f.height).toBeCloseTo(aspect, 2);
    }
  });
});

describe("LANDING_IMAGE_ASPECT", () => {
  /*
    🔴 These are MEASURED against the rendered boxes (see the note in
    lib/landing/settings.ts). A stale value here silently reintroduces exactly
    the bug it exists to fix: the operator frames a photo in one shape and the
    page shows it in another.
  */
  it("matches the boxes the images render in", () => {
    // components/landing/feed-grid-gallery.tsx — `aspect-[4/5]`, verified 0.800.
    expect(LANDING_IMAGE_ASPECT.feedGrid).toBeCloseTo(0.8, 3);
    // components/landing/phone-mockup.tsx — measured 265.6x367.4 at every width
    // (the frame is capped at max-w-[300px]).
    expect(LANDING_IMAGE_ASPECT.reelsPoster).toBeCloseTo(265.6 / 367.4, 2);
    // The wallpaper tile stretches to its sibling, so it has a RANGE (0.721 at
    // 360px, 1.057 at 430px). 7/8 is the value whose worst-case symmetric crop
    // across that range is smallest.
    const range = [0.721, 0.869, 1.057];
    const worst = Math.max(
      ...range.map((b) => 1 - Math.min(b, LANDING_IMAGE_ASPECT.wallpaperCta) / Math.max(b, LANDING_IMAGE_ASPECT.wallpaperCta)),
    );
    expect(worst).toBeLessThan(0.2);
  });
});
