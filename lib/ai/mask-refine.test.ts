import { describe, expect, it } from "vitest";

import {
  buildMaskCoverageArgs,
  buildMaskedCompositeArgs,
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE DECODE, TWO ANSWERS — the mask and its coverage together
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "the time in my replicate dashboard of each video is lower
 * than the time it actually takes, could it be it delays on our end?"
 *
 * It was. Job eff96da5 measured 347s wall clock against 191s of ProPainter, so
 * 156s of the wait was our own machine — and one of the four full passes over
 * the video existed only to average the luminance of a mask we had just
 * written. `statsPath` forks the filter output with `split` so both fall out of
 * a single decode.
 */
describe("buildTextMaskArgs — the folded coverage measurement", () => {
  const withStats = buildTextMaskArgs({ ...plan, statsPath: "/tmp/stats.txt" });
  const graph = withStats[withStats.indexOf("-filter_complex") + 1] ?? "";

  it("forks the finished mask rather than re-reading the file", () => {
    expect(graph).toContain("split=2[enc][stats]");
    expect(graph).toContain("[stats]signalstats,metadata=print:file=/tmp/stats.txt[nul]");
  });

  /*
    🔴 The encoder must be mapped EXPLICITLY once the graph has two outputs.
    Without `-map [enc]` ffmpeg picks a stream by its own rules, and the one it
    picks is not guaranteed to be the branch carrying the mask.
  */
  it("maps the encoder branch to the file and the stats branch to null", () => {
    expect(withStats).toContain("-map");
    const enc = withStats.indexOf("[enc]");
    const nul = withStats.indexOf("[nul]");
    expect(enc).toBeGreaterThan(-1);
    expect(nul).toBeGreaterThan(enc);
    expect(withStats.slice(nul)).toEqual(expect.arrayContaining(["-f", "null", "-"]));
    // The mask file still comes before the discarded second output.
    expect(withStats.indexOf(plan.outPath)).toBeLessThan(nul);
  });

  /*
    🔴 A path lands inside a filter argument, where `:` separates options and
    `\` escapes. A Windows temp path would otherwise split one option in two.
  */
  it("escapes a path that carries filtergraph syntax", () => {
    /*
      🔴 `\u005c` rather than a typed backslash. This project has already had a
      test file arrive with RAW CONTROL BYTES in it — `"C:\tmp"` written through
      a shell becomes C-colon-TAB-"mp", and the test then asserts something
      about a path nobody could ever pass. An explicit escape cannot be eaten by
      whatever wrote the file.
    */
    const winPath = "C:\u005ctmp\u005cfrenz\u005cstats.txt";
    const win = buildTextMaskArgs({ ...plan, statsPath: winPath });
    const g = win[win.indexOf("-filter_complex") + 1] ?? "";
    expect(g).toContain("file=C\u005c:/tmp/frenz/stats.txt");
  });

  it("emits none of it when no stats file was asked for", () => {
    const plain = buildTextMaskArgs(plan);
    expect(plain.join(" ")).not.toContain("signalstats");
    expect(plain.join(" ")).not.toContain("-f null");
    expect(plain).not.toContain("-map");
  });
});

describe("parseMaskCoverage — the metadata=print format", () => {
  /*
    What `metadata=print` actually writes, taken from a real run of the graph
    above rather than from the documentation.
  */
  const real = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.signalstats.YMIN=16",
    "lavfi.signalstats.YLOW=16",
    "lavfi.signalstats.YAVG=70.0165",
    "lavfi.signalstats.YHIGH=235",
    "lavfi.signalstats.YMAX=235",
    "frame:1    pts:1024    pts_time:0.042667",
    "lavfi.signalstats.YAVG=76.5",
  ].join("\n");

  it("reads the keyed values", () => {
    expect(parseMaskCoverage(real)).toBeCloseTo((70.0165 + 76.5) / 2 / 255, 5);
  });

  /*
    ── 🔴 THE FAILURE THIS TEST EXISTS FOR ───────────────────────────────────

    `metadata=print` also writes `frame:12 pts:12288 pts_time:0.512`. A parser
    that fell through to "any float on the line" would average PTS values —
    numbers in the thousands — into the coverage and report a mask hundreds of
    times denser than it is. That would sail past `MASK_REFINE_MIN_RATIO`,
    silently disable the sparse-mask fallback, and ship a video with its text
    still in it. Keyed lines must win outright, never merge.
  */
  it("never lets a pts value reach the average", () => {
    const coverage = parseMaskCoverage(real);
    expect(coverage).not.toBeNull();
    expect(coverage!).toBeLessThan(0.4);
  });

  it("still reads the ffprobe csv the second pass produces", () => {
    expect(parseMaskCoverage("25.5\n25.5")).toBeCloseTo(0.1, 5);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RECONSTRUCTION IS A PATCH, NOT THE PICTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09, on a 1080x1920 clip: "It not accurate, some parts shows
 * and glitches… the current result is poor, look into it why it glitches."
 *
 * The job row said why, in two fields:
 *
 *     propainter_resized = 480x848->1080x1920
 *     mask_coverage      = 8.2
 *
 * ProPainter clamps its own working resolution whatever we send, so a 1080p
 * video came back at 480p; we upscaled the whole frame 2.25x and shipped it.
 * 91.8% of that frame had no text in it and needed no repair, and every pixel
 * of it was replaced by a 480p upscale anyway.
 */
describe("buildMaskedCompositeArgs", () => {
  const plan = {
    sourcePath: "/tmp/source.mp4",
    reconstructedPath: "/tmp/reconstructed.mp4",
    maskPath: "/tmp/mask.mp4",
    outPath: "/tmp/out.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
  };
  const args = buildMaskedCompositeArgs(plan);
  const graph = args[args.indexOf("-filter_complex") + 1] ?? "";

  /*
    🔴 THE ORDER OF INPUTS IS THE WHOLE BEHAVIOUR. `maskedmerge` takes
    base, overlay, mask — and emits the BASE where the mask is black. Swap the
    first two and the filter silently does the exact opposite: it would keep the
    reconstruction everywhere and paste the original text back over the one
    region that was successfully repaired.
  */
  it("takes the member's original as the base and the reconstruction as the overlay", () => {
    expect(args.indexOf(plan.sourcePath)).toBeLessThan(args.indexOf(plan.reconstructedPath));
    expect(args.indexOf(plan.reconstructedPath)).toBeLessThan(args.indexOf(plan.maskPath));
    expect(graph).toContain("[base][fix][m]maskedmerge[out]");
    expect(graph).toContain("[0:v]");
    expect(graph).toContain("[1:v]");
    expect(graph).toContain("[2:v]");
  });

  /*
    🔴 The mask is THRESHOLDED, not merely scaled. `maskedmerge` blends
    proportionally, so a mid-grey pixel is a 50% mix — and a mask softened by
    resampling would ghost the original caption back through the repair at every
    glyph edge, which is precisely the artefact this change exists to remove.
  */
  it("forces the mask back to hard black and white", () => {
    expect(graph).toContain("format=gray");
    expect(graph).toMatch(/geq=lum='if\(gt\(p\(X.,Y\).,127\).,255.,0\)'/);
  });

  it("scales all three inputs to the source's exact size", () => {
    const scales = graph.match(/scale=1080x1920/g) ?? [];
    expect(scales.length).toBe(3);
  });

  /*
    🔴 NO AUDIO MAP. `buildRestoreArgs` is the one step that owns putting the
    member's sound back; a track carried through here would give it two
    candidates and no rule for choosing between them.
  */
  it("maps only the composited video", () => {
    expect(args).toContain("-map");
    expect(args[args.indexOf("-map") + 1]).toBe("[out]");
    expect(args.join(" ")).not.toContain("-c:a");
    expect(args.join(" ")).not.toContain("0:a");
  });

  it("encodes at visually lossless quality and holds the source frame rate", () => {
    expect(args[args.indexOf("-crf") + 1]).toBe("16");
    expect(args[args.indexOf("-r") + 1]).toBe("30");
  });

  /* Nothing a member supplies reaches this array — same rule as every other
     builder in this module. The only variables are temp paths and two integers. */
  it("passes a fixed argument array with no shell string anywhere", () => {
    expect(args.every((a) => typeof a === "string")).toBe(true);
    expect(args.some((a) => a.includes("&&") || a.includes(";" + "rm"))).toBe(false);
  });
});
