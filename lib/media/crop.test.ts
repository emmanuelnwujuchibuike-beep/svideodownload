import { describe, expect, it } from "vitest";

import { clampOffset, coverScale, outputSize, sourceRect } from "./crop";

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
