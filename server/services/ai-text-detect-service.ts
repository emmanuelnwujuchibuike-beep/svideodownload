import { spawn } from "node:child_process";
import path from "node:path";

import { AI_CLEAN_DETECTOR } from "@/lib/ai/config";
import { buildPosterArgs } from "@/lib/ai/ffmpeg-plan";
import { detectTextInFrame } from "@/lib/ai/surya";
import { boxCoverage, mergeBoxes, sampleTimestamps, type TextBox } from "@/lib/ai/text-detect";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SECOND DETECTION PASS — finding what the first one missed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "It not accurate, some parts shows and glitches… fix the
 * detector and wire it. Do this once and for all."
 *
 * Runs on the WORKER, inside finalization, on a video that is already on local
 * disk. It samples a handful of frames, asks `datalab-to/ocr` where the text
 * is, and hands back boxes for `buildTextMaskArgs` to union into the mask.
 *
 * ── 🔴 IT CANNOT FAIL A JOB. EVERY PATH RETURNS BOXES OR NONE ───────────────
 *
 * This is an IMPROVEMENT to a mask that already works. No provider error, no
 * timeout, no malformed response and no missing credential may turn a video
 * that would have been cleaned into one that was not. Every failure here
 * degrades to an empty list, which reproduces the previous behaviour exactly.
 *
 * ── The frames are cut with the poster builder ──────────────────────────────
 *
 * `buildPosterArgs` already does "seek, decode one frame, write a bounded JPEG"
 * — with `-ss` before `-i` so it seeks by keyframe rather than decoding from
 * zero, which on a three-minute clip is the difference between milliseconds and
 * most of a second PER SAMPLE. Reusing it means one implementation of that, and
 * the 480px cap it applies is a real saving on the request body too.
 *
 * ⚠️ And that cap is why the boxes are SCALED BACK. Surya reports coordinates
 * in the pixel space of the image it was given, and it is given a 480px-wide
 * frame from a 1080px video. Using those numbers directly would paint boxes at
 * 44% of the position and size they belong at — a hole punched in the wrong
 * part of somebody's video, which is the single most dangerous mistake this
 * file could make.
 */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

export interface TextDetectOutcome {
  boxes: TextBox[];
  /** For the job's diagnostics. Never shown to a member. */
  detail: string;
  framesSampled: number;
  framesAnswered: number;
  coverage: number;
}

const NONE = (detail: string): TextDetectOutcome => ({
  boxes: [],
  detail,
  framesSampled: 0,
  framesAnswered: 0,
  coverage: 0,
});

/**
 * Find text across a video, as boxes in SOURCE coordinates.
 *
 * `width`/`height` are the source's true dimensions, and they are required
 * rather than probed here so this stays a pure orchestration function over
 * facts the caller has already established.
 */
export async function detectTextBoxes(opts: {
  jobId: string;
  videoPath: string;
  dir: string;
  width: number;
  height: number;
  durationSeconds: number | null;
}): Promise<TextDetectOutcome> {
  if (!AI_CLEAN_DETECTOR.enabled) return NONE("disabled");
  if (!process.env.REPLICATE_API_TOKEN?.trim()) return NONE("no-token-on-worker");
  if (!opts.width || !opts.height) return NONE("unknown source size");

  const stamps = sampleTimestamps(opts.durationSeconds ?? 0, AI_CLEAN_DETECTOR.frames);

  /*
    Cut every sample first, sequentially. ffmpeg is CPU-bound and the worker
    shares its cores with a mux; six concurrent decodes would contend with each
    other for no gain, where six concurrent NETWORK calls below genuinely
    overlap.
  */
  const frames: { seconds: number; jpeg: Buffer }[] = [];
  for (const [i, seconds] of stamps.entries()) {
    const jpeg = await cutFrame(opts.videoPath, path.join(opts.dir, `detect-${i}.jpg`), seconds);
    if (jpeg) frames.push({ seconds, jpeg });
  }
  if (frames.length === 0) return NONE("no frames could be cut");

  /*
    🔴 IN PARALLEL, and this is where the time is. Six sequential calls at ~13s
    each is 80 seconds added to a job the owner already considers too slow; six
    concurrent ones cost about as long as the slowest. Each has its own deadline
    (see lib/ai/surya.ts), so one hung call cannot hold the rest.
  */
  const results = await Promise.all(frames.map((f) => detectTextInFrame(f.jpeg)));

  const answered = results.filter((r) => r.detail === "ok").length;
  if (answered === 0) {
    return {
      ...NONE(results[0]?.detail ?? "no answers"),
      framesSampled: frames.length,
    };
  }

  /*
    ── 🔴 BACK TO SOURCE COORDINATES ──────────────────────────────────────────

    The frames were cut at POSTER_MAX_EDGE on the long edge, so Surya's numbers
    are in that reduced space. The scale factor is derived from the frame we
    actually sent rather than assumed, because `buildPosterArgs` never scales UP
    — a source already under the cap comes back at its own size and a hard-coded
    ratio would then be wrong in the other direction.
  */
  const sampleSize = await probeJpegSize(path.join(opts.dir, "detect-0.jpg"));
  const scale = sampleSize?.width ? opts.width / sampleSize.width : 1;

  const raw = results
    .flatMap((r) => r.boxes)
    .map((b) => ({ x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale }));

  const merged = mergeBoxes(raw, { width: opts.width, height: opts.height });
  const coverage = boxCoverage(merged, { width: opts.width, height: opts.height });

  /*
    🔴 THE CEILING. A slide, a screen recording or a lyric video is mostly text,
    and on those the detector does its job perfectly and the result is worst:
    repainting most of every frame is an invented video, not a clean. Past the
    ceiling the boxes are DISCARDED and the mask is left as the primary detector
    made it — the honest outcome is "we did not remove this" rather than "we
    replaced your video".
  */
  if (coverage > AI_CLEAN_DETECTOR.maxAddedCoverage) {
    console.warn("[ai/detect] refusing an oversized text mask", {
      jobId: opts.jobId,
      coverage: Number((coverage * 100).toFixed(2)),
      boxes: merged.length,
    });
    return {
      boxes: [],
      detail: `refused: ${(coverage * 100).toFixed(1)}% coverage`,
      framesSampled: frames.length,
      framesAnswered: answered,
      coverage,
    };
  }

  return {
    boxes: merged,
    detail: "ok",
    framesSampled: frames.length,
    framesAnswered: answered,
    coverage,
  };
}

/** One JPEG from the clip, or null. Never throws. */
async function cutFrame(videoPath: string, outPath: string, seconds: number): Promise<Buffer | null> {
  const ok = await runFfmpeg(buildPosterArgs({ videoPath, outPath, seconds }), 15_000);
  if (!ok) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(outPath);
    return body.byteLength > 0 ? body : null;
  } catch {
    return null;
  }
}

/**
 * The dimensions of a frame we cut ourselves.
 *
 * 🔴 Read rather than calculated. `buildPosterArgs` caps the long edge and
 * never scales up, so the output size depends on the source in a way that is
 * easy to reason about wrongly — and a wrong scale factor here puts every box
 * in the wrong place. Asking the file is one cheap ffprobe against a guess that
 * would be silent when it failed.
 */
async function probeJpegSize(filePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        process.env.FFPROBE_PATH || "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
        { windowsHide: true },
      );
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (v: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 10_000);
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => finish(null));
    child.on("close", () => {
      const [w, h] = out.trim().split(",").map((n) => Number.parseInt(n, 10));
      finish(Number.isFinite(w) && Number.isFinite(h) && w! > 0 ? { width: w!, height: h! } : null);
    });
  });
}

/** Fixed argument array, bounded, resolves false rather than throwing. */
function runFfmpeg(args: string[], budgetMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(FFMPEG, args, { windowsHide: true });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      resolve(v);
    };
    const hard = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, budgetMs);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}
