import { describe, expect, it } from "vitest";

import {
  boxCoverage,
  buildBoxMaskArgs,
  mergeBoxes,
  parseSuryaBoxes,
  sampleTimestamps,
} from "@/lib/ai/text-detect";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DETECTOR THAT ACTUALLY SEES THE TEXT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "fix the detector and wire it. Do this once and for all."
 *
 * `hjunior29/video-text-remover` missed a caption at conf 0.25, 0.15 and 0.08 —
 * three thresholds, same miss — and left "Bus" and 'S"' standing at either end
 * of a line it had otherwise removed. `datalab-to/ocr` was handed the SAME
 * frame and returned both in 13.4s.
 *
 * 🔴 The fixture below is that real response, trimmed. Not an invented shape:
 * a parser tested against made-up JSON is a parser tested against the author's
 * assumptions, and the fields that matter here (`bbox_valid: false` placeholder
 * chars, polygons alongside bboxes) are exactly the ones nobody would think to
 * invent.
 */
const REAL_SURYA_OUTPUT = {
  page_count: 1,
  pages: [
    {
      image_bbox: [0, 0, 1080, 1920],
      page: 1,
      text_lines: [
        {
          bbox: [173, 1191, 313, 1298],
          confidence: 0.89375901222229,
          polygon: [
            [173, 1191],
            [313, 1191],
            [313, 1298],
            [173, 1298],
          ],
          text: "Bus",
        },
        {
          bbox: [821, 1205, 904, 1275],
          confidence: 0.9157768189907074,
          polygon: [
            [821, 1205],
            [904, 1205],
            [904, 1275],
            [821, 1275],
          ],
          text: 'S"',
        },
      ],
    },
  ],
  text: 'Bus\nS"',
};

const FRAME = { width: 1080, height: 1920 };

describe("parseSuryaBoxes", () => {
  it("finds both fragments the old detector missed", () => {
    const boxes = parseSuryaBoxes(REAL_SURYA_OUTPUT);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ x: 173, y: 1191, w: 140, h: 107 });
    expect(boxes[1]).toEqual({ x: 821, y: 1205, w: 83, h: 70 });
  });

  /*
    🔴 A RESPONSE WE CANNOT READ YIELDS NO BOXES, NEVER A GUESS. Every number
    here becomes a region painted over somebody's video, so a malformed field
    must produce nothing rather than a box in the wrong place. The caller reads
    "no boxes" as "nothing to remove".
  */
  it("returns nothing rather than guessing, on anything malformed", () => {
    for (const bad of [null, undefined, {}, { pages: null }, { pages: [{}] }, { pages: [{ text_lines: "x" }] }]) {
      expect(parseSuryaBoxes(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  it("drops the 1x1 placeholder entries Surya emits for invalid chars", () => {
    const boxes = parseSuryaBoxes({
      pages: [{ text_lines: [{ bbox: [173, 1191, 174, 1192], confidence: 0.9 }] }],
    });
    expect(boxes).toEqual([]);
  });

  it("ignores a line below the confidence floor", () => {
    const low = { pages: [{ text_lines: [{ bbox: [10, 10, 100, 60], confidence: 0.1 }] }] };
    expect(parseSuryaBoxes(low)).toEqual([]);
    expect(parseSuryaBoxes(low, { minConfidence: 0.05 })).toHaveLength(1);
  });

  it("treats a missing confidence as certain rather than as zero", () => {
    // Absent is not "unconfident" — a model that omits the field has not told
    // us it doubts the line, and dropping it would silently lose real text.
    expect(parseSuryaBoxes({ pages: [{ text_lines: [{ bbox: [10, 10, 100, 60] }] }] })).toHaveLength(1);
  });

  it("reads a rotated line from its polygon, not just its bbox", () => {
    const boxes = parseSuryaBoxes({
      pages: [
        {
          text_lines: [
            {
              confidence: 0.9,
              polygon: [
                [100, 100],
                [200, 120],
                [190, 180],
                [90, 160],
              ],
            },
          ],
        },
      ],
    });
    expect(boxes[0]).toEqual({ x: 90, y: 100, w: 110, h: 80 });
  });
});

describe("mergeBoxes", () => {
  /*
    ── 🔴 THE MARGIN IS WHAT REMOVES THE SHADOW ──────────────────────────────

    An OCR box hugs the glyphs. A caption is readable because of its drop
    shadow / dark outline / pill, none of which is inside that box — so
    repainting the letters exactly leaves a ghost of the caption behind.
  */
  it("grows each box in proportion to its own text height", () => {
    const [box] = mergeBoxes([{ x: 500, y: 500, w: 100, h: 100 }], FRAME, { marginRatio: 0.35 });
    // 35 px of skirt on every side.
    expect(box).toEqual({ x: 465, y: 465, w: 170, h: 170 });
  });

  it("never lets a grown box leave the frame", () => {
    const boxes = mergeBoxes(
      [
        { x: 2, y: 2, w: 40, h: 40 },
        { x: 1040, y: 1880, w: 40, h: 40 },
      ],
      FRAME,
    );
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(FRAME.width);
      expect(b.y + b.h).toBeLessThanOrEqual(FRAME.height);
    }
  });

  /*
    🔴 MERGING RUNS TO A FIXED POINT. A caption's words arrive as separate
    boxes; A may not touch C until A has absorbed B. A single pass would leave
    strips of untouched background — still carrying the caption's shadow —
    between the words of one sentence.
  */
  it("collapses a chain of words into one line", () => {
    const words = [
      { x: 100, y: 500, w: 60, h: 40 },
      { x: 175, y: 500, w: 60, h: 40 },
      { x: 250, y: 500, w: 60, h: 40 },
      { x: 325, y: 500, w: 60, h: 40 },
    ];
    const merged = mergeBoxes(words, FRAME, { marginRatio: 0.35 });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.w).toBeGreaterThan(280);
  });

  it("leaves genuinely separate captions separate", () => {
    const merged = mergeBoxes(
      [
        { x: 100, y: 200, w: 80, h: 40 },
        { x: 100, y: 1500, w: 80, h: 40 },
      ],
      FRAME,
    );
    expect(merged).toHaveLength(2);
  });

  it("handles the real pair without merging them", () => {
    // "Bus" and 'S"' sit at opposite ends of the frame — 500px apart — so they
    // must stay two regions rather than becoming one band across the picture.
    const merged = mergeBoxes(parseSuryaBoxes(REAL_SURYA_OUTPUT), FRAME);
    expect(merged).toHaveLength(2);
  });

  it("is empty in and empty out", () => {
    expect(mergeBoxes([], FRAME)).toEqual([]);
  });
});

describe("boxCoverage", () => {
  it("reports the fraction of the frame the boxes cover", () => {
    expect(boxCoverage([{ x: 0, y: 0, w: 540, h: 960 }], FRAME)).toBeCloseTo(0.25, 3);
    expect(boxCoverage([], FRAME)).toBe(0);
  });

  /*
    🔴 It may OVER-report, and that is the safe direction. The caller uses it
    only to refuse an implausibly large mask, so over-reporting refuses a little
    sooner rather than shipping a frame that has been mostly invented.
  */
  it("never exceeds 1, however much the boxes overlap", () => {
    const huge = Array.from({ length: 20 }, () => ({ x: 0, y: 0, w: 1080, h: 1920 }));
    expect(boxCoverage(huge, FRAME)).toBe(1);
  });
});

describe("buildBoxMaskArgs", () => {
  const args = buildBoxMaskArgs({
    boxes: [{ x: 173, y: 1191, w: 140, h: 107 }],
    outPath: "/tmp/mask.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 9.1,
  });

  /*
    🔴 GENERATED, NOT FILTERED. The mask depends only on the source's geometry,
    never on its pixels — so it is drawn from `color=black` and ffmpeg decodes
    not one frame of the member's video to make it.
  */
  it("draws from a generated colour source rather than the video", () => {
    expect(args).toContain("lavfi");
    expect(args.join(" ")).toContain("color=c=black:s=1080x1920:r=30");
    expect(args.join(" ")).not.toContain("source.mp4");
  });

  it("fills each box white rather than outlining it", () => {
    const vf = args[args.indexOf("-vf") + 1] ?? "";
    expect(vf).toContain("drawbox=x=173:y=1191:w=140:h=107:color=white@1:t=fill");
  });

  /*
    ⚠️ LOSSLESS. A lossy encode softens the box edge into a grey ramp, and both
    ProPainter and the maskedmerge composite read grey as a partial blend —
    which is a ghost of the caption showing through its own repair.
  */
  it("encodes losslessly", () => {
    expect(args[args.indexOf("-qp") + 1]).toBe("0");
  });

  it("produces a valid all-black mask when nothing was detected", () => {
    const empty = buildBoxMaskArgs({
      boxes: [],
      outPath: "/tmp/mask.mp4",
      width: 720,
      height: 1280,
      fps: 30,
      durationSeconds: 5,
    });
    const vf = empty[empty.indexOf("-vf") + 1] ?? "";
    // No drawbox, no trailing comma, still a valid graph.
    expect(vf).toBe("format=yuv420p");
  });
});

describe("sampleTimestamps", () => {
  /*
    🔴 NEVER THE FIRST OR LAST FRAME. Social video opens on a fade, a logo card
    or black, and ends the same way — the two frames least likely to carry the
    caption, and each one sampled there is a provider call that learns nothing.
  */
  it("samples the interior, never the endpoints", () => {
    const t = sampleTimestamps(10, 4);
    expect(t).toHaveLength(4);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(10);
    expect(t).toEqual([2, 4, 6, 8]);
  });

  it("takes the middle when only one sample is affordable", () => {
    expect(sampleTimestamps(10, 1)).toEqual([5]);
  });

  it("caps the count, because eighty calls is a bill", () => {
    expect(sampleTimestamps(600, 500)).toHaveLength(16);
  });

  it("survives an unknown duration rather than throwing", () => {
    expect(sampleTimestamps(0, 6)).toEqual([0]);
    expect(sampleTimestamps(Number.NaN, 6)).toEqual([0]);
  });
});
