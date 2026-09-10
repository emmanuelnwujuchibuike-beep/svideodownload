import { describe, expect, it } from "vitest";

import { AI_CLEAN_PROPAINTER } from "@/lib/ai/config";
import { propainterResizeRatio } from "@/lib/ai/propainter-plan";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SECOND CUDA OOM — the one the chunk settings could not prevent
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three consecutive predictions on 2026-09-09 (17:35, 17:40, 17:49) failed
 * with, verbatim:
 *
 *     CUDA out of memory. Tried to allocate 15.64 GiB (GPU 0; 44.39 GiB total
 *     capacity; 26.79 GiB already allocated; 359.31 MiB free)
 *
 * …with `subvideo_length: 40`, `neighbor_length: 6`, `ref_stride: 12` already
 * in the request. Those three fixed the FIRST out-of-memory and are irrelevant
 * to this one: the traceback lands in `RAFT/corr.py`, and ProPainter estimates
 * optical flow across the whole clip BEFORE the chunked inpainting begins.
 *
 * RAFT's correlation volume is all-pairs over the 1/8-scale feature map, so it
 * costs (W/8 x H/8)^2 per frame pair — QUADRATIC IN AREA. 720x1280 gives
 * 14,400 positions, 14,400^2 x 4 bytes = 829 MB a pair, and ~19 pairs is the
 * 15.64 GiB it asked for. Resolution is the only lever that touches it.
 *
 * 🔴 These are regression tests for a failure that is INVISIBLE from our side:
 * a job that OOMs comes back as a declined reconstruction, and the member sees
 * "didn't finish" with no hint that the cause was a number in a config file.
 */
describe("propainterResizeRatio", () => {
  const budget = 614_400; // 640x960 — see the note on AI_CLEAN_PROPAINTER.maxPixels.

  it("leaves a clip that already fits completely alone", () => {
    // The owner's Snapchat clip, which is exactly the budget.
    expect(propainterResizeRatio(480, 854, budget)).toBe(1);
    // And anything smaller.
    expect(propainterResizeRatio(360, 640, budget)).toBe(1);
  });

  /*
    🔴 THE CASE THAT FAILED THREE TIMES. A 720x1280 portrait clip is 921,600 px
    against a 409,920 budget, so it must come down — and to roughly two thirds,
    which is a fifth of the memory because the cost is quadratic.
  */
  it("brings the 1080x1920 clip that OOM'd under budget", () => {
    const ratio = propainterResizeRatio(1080, 1920, budget);
    expect(ratio).toBeCloseTo(0.54, 2);
    expect(1080 * ratio * (1920 * ratio)).toBeLessThanOrEqual(budget);
  });

  /*
    🔴 A 720p clip now keeps 81% of its linear resolution, where the old budget
    cut it to 66%. That is the point of the raise: the repaired patch is closer
    to the resolution of the picture it sits in.
  */
  it("reduces a 720x1280 clip far less than the old budget did", () => {
    const ratio = propainterResizeRatio(720, 1280, budget);
    expect(ratio).toBeCloseTo(0.81, 2);
    expect(720 * ratio * (1280 * ratio)).toBeLessThanOrEqual(budget);
  });

  it("never lets a reduced clip land back over budget", () => {
    for (const [w, h] of [
      [720, 1280],
      [1080, 1920],
      [1920, 1080],
      [1280, 720],
      [540, 960],
      [640, 640],
      [411, 1000],
    ] as const) {
      const ratio = propainterResizeRatio(w, h, budget);
      expect(w * ratio * (h * ratio), `${w}x${h}`).toBeLessThanOrEqual(budget);
    }
  });

  /*
    🔴 AN UNKNOWN SIZE IS NOT A LARGE SIZE. A probe that could not read the
    header is not evidence about the video, and shrinking every clip whose
    dimensions we failed to parse would degrade ones that never needed it —
    silently, and with no path back, since the reduction happens before the
    only run the member pays for.
  */
  it("does not shrink a video whose size could not be read", () => {
    expect(propainterResizeRatio(null, null, budget)).toBe(1);
    expect(propainterResizeRatio(undefined, 1280, budget)).toBe(1);
    expect(propainterResizeRatio(0, 0, budget)).toBe(1);
    expect(propainterResizeRatio(-720, 1280, budget)).toBe(1);
  });

  /*
    A floor, so an absurd input cannot produce a ratio that rounds to zero and
    hands ProPainter a video with no pixels in it.
  */
  it("never returns a ratio that would collapse the frame", () => {
    expect(propainterResizeRatio(20_000, 20_000, budget)).toBeGreaterThanOrEqual(0.1);
  });

  it("the shipped budget is the area that was measured, not a round number", () => {
    // 640x960 — see the long note on `maxPixels`. The budget moved up once the
    // seam feather made clear that the PATCH resolution, not the edge, was the
    // remaining complaint.
    expect(AI_CLEAN_PROPAINTER.maxPixels).toBe(640 * 960);
  });
});
