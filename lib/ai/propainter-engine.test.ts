import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildTextMaskArgs, parseProbeOutput } from "./ffmpeg-plan";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROPAINTER ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Why a second engine exists at all, measured on the owner's own video on
 * 2026-09-09 — five configurations of the classical model on one pinned source:
 *
 *     hybrid m=5 · inpaint m=5 · inpaint_ns m=5 · hybrid m=0 · hybrid m=14
 *
 * All five produced the same smeared band, INCLUDING `margin: 0`. That is what
 * rules out the mask as the cause: shrinking it to the tightest the model can
 * make changes nothing. All three of its fill algorithms are OpenCV
 * single-frame diffusion and none of them can know what is behind the text.
 *
 * These tests pin the parts that are pure and would fail silently: the mask
 * filter graph, and the frame-rate parsing that stops a 30fps video being
 * resampled to 24.
 */

describe("the mask filter graph", () => {
  const args = buildTextMaskArgs({
    sourcePath: "/tmp/source.bin",
    blackPath: "/tmp/cleaned.bin",
    outPath: "/tmp/mask.mp4",
    fps: 30,
  });
  const graph = args[args.indexOf("-filter_complex") + 1] ?? "";

  it("🔴 excludes regions that are black in BOTH inputs", () => {
    /*
      The letterbox bars are black in the source AND in the detector's output.
      Without `gt(B,16)` they are masked and handed to the GPU to "reconstruct"
      — a quarter of the frame repainted for nothing. Measured: 12.7–13.1% of
      the frame white with the guard, the entire frame without it.
    */
    expect(graph).toContain("lt(A,16)");
    expect(graph).toContain("gt(B,16)");
  });

  /*
    ── 🔴 THIS TEST USED TO ENSHRINE THE BUG ─────────────────────────────────

    It asserted `erosion ×2, dilation ×6` and its own name said that closed the
    holes. It does not. Erode-then-dilate is an OPENING: it removes speckle and
    returns the boundary to where it started. Only dilate-then-erode — a
    CLOSING — fills a hole, and the holes here are the pixels `gt(B,16)` vetoes
    for being dark in the original, which is exactly where a dark caption pill
    or a black glyph outline lives.

    Measured on the owner's clip against the real detector output: the old
    chain left 12.1% of the detected text uncovered and ProPainter faithfully
    preserved it; the new one leaves 0.7%, in a mask that is SMALLER.

    So the assertions now describe the shape that actually works, and the
    counts are checked so a well-meaning "simplify the filter chain" cannot
    quietly turn the closing back into an opening.
  */
  it("opens to drop speckle, then CLOSES to fill the holes gt(B,16) punches", () => {
    // Annotated: `match()` returns `RegExpMatchArray | null`, and the union
    // with a bare `[]` narrows the element type to `never` — which makes
    // `indexOf("dilation")` a compile error that only `tsc` sees. `next build`
    // does not typecheck test files and vitest does not typecheck at all.
    const ops: string[] = graph.match(/erosion|dilation/g) ?? [];
    // Opening first: the two erosions lead.
    expect(ops[0]).toBe("erosion");
    expect(ops[1]).toBe("erosion");

    // Then a real closing: a run of dilations followed by a run of erosions.
    const firstDilation = ops.indexOf("dilation");
    const closingErosions = ops.slice(firstDilation).filter((o) => o === "erosion").length;
    const dilations = ops.filter((o) => o === "dilation").length;
    expect(firstDilation).toBe(2);
    expect(dilations).toBeGreaterThanOrEqual(18);
    expect(closingErosions).toBeGreaterThanOrEqual(12);

    // 🔴 The closing must not be achieved by simply inflating the mask: the
    // dilations exceed the trailing erosions by only a few pixels, which is
    // the same net growth the original chain had.
    const netGrowth = dilations - closingErosions - 2;
    expect(netGrowth).toBeGreaterThanOrEqual(0);
    expect(netGrowth).toBeLessThanOrEqual(6);
  });

  it("🔴 encodes the mask LOSSLESS", () => {
    // A lossy encode blurs the hard threshold this graph just computed and
    // hands the model a grey, ambiguous mask.
    expect(args).toContain("-qp");
    expect(args[args.indexOf("-qp") + 1]).toBe("0");
  });

  it("pins the output frame rate to the source", () => {
    expect(args[args.indexOf("-r") + 1]).toBe("30");
  });

  it("is a fixed argument ARRAY with no shell string anywhere", () => {
    // Same rule as the mux: nothing a member supplies can reach ffmpeg.
    for (const a of args) expect(typeof a).toBe("string");
    expect(args.filter((a) => a.includes("&&") || a.includes(";" + " rm"))).toHaveLength(0);
  });
});

describe("frame rate, because save_fps defaults to 24", () => {
  const probe = (r: string) =>
    parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264", width: 720, height: 1280, r_frame_rate: r }],
        format: { duration: "9.5", size: "1000" },
      }),
    );

  it("reads a ratio", () => {
    expect(probe("30/1")?.frameRate).toBe(30);
    expect(probe("24/1")?.frameRate).toBe(24);
  });

  it("reads NTSC rates without rounding them away", () => {
    expect(probe("30000/1001")?.frameRate).toBeCloseTo(29.97, 2);
  });

  it("🔴 answers null for a malformed rate rather than 0", () => {
    /*
      A 0/0 from a broken file must read as "unknown" so the caller falls back
      to a safe default. Reporting 0fps would be passed to `save_fps` and would
      produce a video with no frames at all.
    */
    expect(probe("0/0")?.frameRate).toBeNull();
    expect(probe("")?.frameRate).toBeNull();
  });

  it("rejects an absurd rate", () => {
    expect(probe("100000/1")?.frameRate).toBeNull();
  });

  it("falls back to avg_frame_rate when r_frame_rate is missing", () => {
    const p = parseProbeOutput(
      JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264", avg_frame_rate: "25/1" }],
        format: { duration: "9.5" },
      }),
    );
    expect(p?.frameRate).toBe(25);
  });
});

describe("the engine switch", () => {
  const src = readFileSync(join(process.cwd(), "lib/ai/config.ts"), "utf8");

  it("🔴 defaults to the classical engine", () => {
    // The second engine costs a GPU call on top of a CPU one. It is an operator
    // decision, never a silent upgrade.
    expect(src).toMatch(/=== "propainter" \? "propainter" : "classical"/);
  });

  it("🔴 sends method=black on the propainter engine", () => {
    /*
      That pass is a DETECTOR, not a cleaner: `black` paints the detected boxes
      solid so the worker can recover the mask by thresholding. Sending `hybrid`
      here would smear the picture first and then reconstruct the smear.
    */
    expect(src).toContain('engine === "propainter" ? "black" : AI_CLEAN_CONFIG.method');
  });

  it("🔴 takes the engine as an ARGUMENT, so a job cannot change engine mid-flight", () => {
    /*
      The value is resolved once at submit time, written to the job, and read
      back by the worker. If this function called `aiCleanEngine()` itself, an
      operator flipping the admin switch between a job's two stages would leave
      it detected with the classical FILL — already smeared — and then
      "reconstructed" from that smear, which is worse than either engine alone.
    */
    expect(src).toMatch(/engine: AiCleanEngine = aiCleanEngine\(\),/);

    const body = src.slice(src.indexOf("export function buildAiCleanInput"), src.indexOf("/* ───"));
    // exactly one reference, and it is the default-parameter fallback
    expect(body.match(/aiCleanEngine\(\)/g)).toHaveLength(1);
  });

  it("records the engine on the job, and the worker reads it back from there", () => {
    const start = readFileSync(join(process.cwd(), "app/api/ai/jobs/[id]/start/route.ts"), "utf8");
    const finalize = readFileSync(join(process.cwd(), "server/services/ai-finalize-service.ts"), "utf8");
    expect(start).toContain("engine: frenzAiEngine,");
    expect(start).toMatch(/metadata: \{ \.\.\.\(job\.metadata \?\? \{\}\), engine: frenzAiEngine \}/);
    expect(finalize).toContain("job.metadata?.engine");
    expect(finalize).toContain('if (jobEngine === "propainter")');
  });

  it("🔴 the admin API validates the engine, or the switch controls nothing", () => {
    /*
      A field the panel POSTs that the route does not validate is stripped
      silently. This codebase has had six admin switches that were read by
      nothing; this test is the cheapest way to keep this from being the
      seventh.
    */
    const route = readFileSync(join(process.cwd(), "app/api/admin/landing/route.ts"), "utf8");
    expect(route).toContain('frenzAiEngine: z.enum(["classical", "propainter"]).optional()');
  });

  it("does not dilate a mask that has already been closed", () => {
    // ProPainter's own default is 4; ours is 0 because the worker already
    // dilated six times to close the outline holes.
    expect(src).toMatch(/maskDilation: Number\(process\.env\.AI_CLEAN_PROPAINTER_DILATION \?\? "0"\)/);
  });
});

describe("the reconstruction never costs a member their result", () => {
  const src = readFileSync(join(process.cwd(), "server/services/ai-finalize-service.ts"), "utf8");

  it("🔴 falls back to the detection output on every failure path", () => {
    /*
      A member who waited three minutes should not be told "nothing for you"
      because a second provider had a bad afternoon. The detector's output is a
      finished, watchable video.
    */
    for (const path of ["mask-build-failed", "mask-upload-failed", "unreadable-output"]) {
      expect(src, path).toContain(path);
    }
    expect(src).toContain("return null;");
  });

  it("records every fallback on the job, so the rate is measurable", () => {
    expect(src).toMatch(/noteJobDiagnostic\(jobId, \{ propainter:/);
  });

  it("removes the mask it uploaded", () => {
    // It is worthless after the run and counts against the same storage
    // ceiling the member's own files do.
    expect(src).toContain("} finally {");
    expect(src).toMatch(/remove\(\[maskKey\]\)/);
  });

  it("muxes the RECONSTRUCTED picture, not the detection output", () => {
    // The retry path and the duration check must follow the same file, or a
    // stream-copy failure would silently fall back to the black-boxed video.
    expect(src).toContain("cleanedPath: pictureFile,");
    expect(src).toContain("cleanedDuration: picture.durationSeconds,");
    expect(src).not.toContain("cleanedDuration: cleanedProbe.durationSeconds,");
  });
});
