import { describe, expect, it } from "vitest";

import {
  buildMaskCoverageArgs,
  buildTextMaskArgs,
  MASK_REFINE_MIN_RATIO,
  parseMaskCoverage,
} from "@/lib/ai/ffmpeg-plan";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MASK IS NOT THE DETECTOR'S RECTANGLE ANY MORE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: the removed region "becomes blurry, smeared, stretched, or
 * visibly distorted".
 *
 * Measured on their video: hjunior29 in `black` mode paints a solid 588x200
 * block over the whole caption — 12.70% of a 720x1280 frame, 117,006 px — and
 * that block was being used as the mask. Refining it to the glyphs took it to
 * 8.07% / 74,411 px, and ProPainter then reconstructed the scene cleanly where
 * it had smeared before.
 */

const plan = {
  sourcePath: "/tmp/source.mp4",
  blackPath: "/tmp/detection.mp4",
  outPath: "/tmp/mask.mp4",
  fps: 30,
};

const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1] ?? "";

describe("the refined mask", () => {
  const refined = graphOf(buildTextMaskArgs({ ...plan, refine: true }));

  it("is the default — nothing has to ask for it", () => {
    expect(graphOf(buildTextMaskArgs(plan))).toBe(refined);
  });

  it("still starts from the detector's rectangle", () => {
    expect(refined).toContain("lt(A,16)");
    expect(refined).toContain("gt(B,16)");
  });

  /*
    🔴 The whole fix in one assertion: the rectangle is INTERSECTED with a
    contrast test, so mid-tone background inside it is left alone.
  */
  it("intersects the rectangle with a brightness/darkness test", () => {
    expect(refined).toContain("[rect]");
    expect(refined).toContain("[glyph]");
    // AND, not OR — both must be true for a pixel to be repainted.
    expect(refined).toContain("if(gt(A,127)*gt(B,127),255,0)");
  });

  it("reads the SOURCE for contrast, never the blackened detection output", () => {
    // `[0]` is the source; `[1]` is the detector's output. Segmenting the
    // blackened video would find the block again and change nothing.
    expect(refined).toMatch(/\[0\]format=gray,geq=lum=/);
  });

  it("grows the glyphs only slightly, to catch their antialiased edge", () => {
    const glyphStage = refined.slice(refined.indexOf("if(gt(A,127)*gt(B,127)"));
    const dilations = (glyphStage.match(/dilation/g) ?? []).length;
    expect(dilations).toBeGreaterThan(0);
    // 🔴 Conservative. This is the step that would undo the fix if somebody
    // "improved" coverage by dilating hard — the point is a tight mask.
    expect(dilations).toBeLessThanOrEqual(4);
  });

  it("encodes LOSSLESS, or the threshold it just computed gets blurred away", () => {
    const args = buildTextMaskArgs({ ...plan, refine: true });
    expect(args[args.indexOf("-qp") + 1]).toBe("0");
  });
});

describe("the rectangle fallback", () => {
  const rect = graphOf(buildTextMaskArgs({ ...plan, refine: false }));

  it("is the plain block, with no contrast test at all", () => {
    expect(rect).not.toContain("[glyph]");
    expect(rect).not.toContain("geq=lum=");
    expect(rect).toContain("lt(A,16)");
  });

  /*
    🔴 It has to stay reachable. The refinement is a heuristic about how
    captions are drawn; a caption it cannot see segments to nothing, and a mask
    that removes nothing is a worse failure than one that removes too much.
  */
  it("keeps a sane threshold for when to prefer it", () => {
    expect(MASK_REFINE_MIN_RATIO).toBeGreaterThan(0);
    expect(MASK_REFINE_MIN_RATIO).toBeLessThan(0.5);
  });
});

describe("measuring what was actually built", () => {
  it("asks ffprobe for per-frame mean luminance", () => {
    const args = buildMaskCoverageArgs("/tmp/mask.mp4");
    expect(args.join(" ")).toContain("signalstats");
    expect(args.join(" ")).toContain("lavfi.signalstats.YAVG");
  });

  /*
    🔴 The path is interpolated into a lavfi graph, where `:` is syntax. Always
    a temp path this codebase built — but escaped anyway, because the day that
    stops being true is not the day to find out.
  */
  it("escapes a Windows drive colon so the graph cannot be split", () => {
    const args = buildMaskCoverageArgs("C:\\tmp\\mask.mp4");
    const graph = args.find((a) => a.startsWith("movie="))!;
    expect(graph).toContain("C\\:");
    expect(graph).not.toContain("\\\\");
  });

  it("turns mean luminance into a coverage fraction", () => {
    // A binary mask is 0 or 255, so YAVG/255 IS the covered fraction.
    expect(parseMaskCoverage("255\n255\n255")).toBeCloseTo(1, 5);
    expect(parseMaskCoverage("0\n0")).toBe(0);
    expect(parseMaskCoverage("25.5")).toBeCloseTo(0.1, 5);
  });

  it("averages across frames rather than trusting one", () => {
    expect(parseMaskCoverage("0\n255")).toBeCloseTo(0.5, 5);
  });

  /*
    🔴 NULL IS "UNKNOWN", NOT "EMPTY". An ffprobe that fails to start must not
    make a healthy mask look like a failed one and trigger the fallback.
  */
  it("returns null when nothing usable came back", () => {
    expect(parseMaskCoverage("")).toBeNull();
    expect(parseMaskCoverage("N/A\nnonsense")).toBeNull();
  });

  it("ignores values outside a luminance range", () => {
    expect(parseMaskCoverage("999\n-5\n255")).toBeCloseTo(1, 5);
  });
});
