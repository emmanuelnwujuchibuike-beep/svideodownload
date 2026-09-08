import { AI_CLEAN_FORMATS, AI_CLEAN_MAX_BYTES } from "@/lib/ai/clean-media";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI CLEAN — the one place every number and model choice is decided
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 3): "Create a centralized configuration object… This
 * allows future tuning without changing multiple files", and "Do NOT scatter
 * hardcoded limits throughout the code."
 *
 * ── 🔴 THE VERSION IS PINNED, AND THAT IS NOT A PREFERENCE ───────────────────
 *
 * A floating model reference means the thing that ran yesterday is not
 * necessarily the thing that runs today. The output changes, the parameters a
 * new revision accepts change, and the first anyone hears about it is a member
 * saying the result got worse — with no way to tell whether the model moved,
 * because nothing recorded which one ran. `version` is therefore required
 * configuration with no default: if it is unset, AI Clean reports itself
 * unavailable rather than quietly running whatever is current.
 *
 * Every job also stores the version that ran it (`ai_jobs.model_version`), so
 * "did this change when the model changed?" stays answerable afterwards.
 *
 * ── Where the numbers come from ──────────────────────────────────────────────
 *
 * The processing parameters are the owner's specified configuration for
 * hjunior29/video-text-remover, and each is a real field in that model's input
 * schema — checked against the model's published schema rather than invented.
 * The limits default to the same constants the interface already enforces
 * (lib/ai/clean-media.ts), so with nothing configured the picker and the server
 * agree exactly; an env override moves the server's answer only.
 */

/** `1024`-style env reads, with the default kept honest when the value is junk. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * What AI Clean will accept. Env-overridable, defaulting to the interface's own
 * constants so the two sides never disagree unless somebody deliberately makes
 * them.
 */
export const AI_CLEAN_LIMITS = {
  /** Bytes. */
  maxFileSize: envInt("AI_CLEAN_MAX_FILE_SIZE", AI_CLEAN_MAX_BYTES),
  /** Seconds. Provider time is billed by the second, so this is a cost control. */
  maxDuration: envInt("AI_CLEAN_MAX_DURATION", 600),
  /**
   * Bytes. The ceiling on what comes BACK. A cleaned video is roughly the size
   * of its input, so this is deliberately generous — it exists to stop a
   * runaway or wrong output exhausting a serverless function's memory, not to
   * second-guess the model.
   */
  maxResultSize: envInt("AI_CLEAN_MAX_RESULT_SIZE", 400 * 1024 * 1024),
  allowedMimeTypes: (process.env.AI_CLEAN_ALLOWED_MIME_TYPES?.trim()
    ? process.env.AI_CLEAN_ALLOWED_MIME_TYPES.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : AI_CLEAN_FORMATS.flatMap((f) => f.mimeTypes)) as readonly string[],
} as const;

/**
 * The provider call, in full.
 *
 * `method: "hybrid"` and the two thresholds are the model's own defaults for a
 * reason — they are what its author tuned. They are written out explicitly
 * rather than omitted so that a future model revision changing its defaults
 * cannot silently change our output.
 */
export const AI_CLEAN_CONFIG = {
  provider: "replicate" as const,
  /**
   * Which published model runs the job.
   *
   * ── 🔴 OVERRIDABLE, BECAUSE THE UPSTREAM ONE IS ON CPU ──────────────────────
   *
   * Measured 2026-09-08: `hjunior29/video-text-remover` is published on CPU
   * hardware (`"hardware": {"arch": "cpu"}`, $0.0001/sec). Its own README says
   * "GPU is auto-detected and used if available (3-6x faster)" — the CUDA path
   * exists and is simply dormant, because `cog.yaml` ships `gpu: false` and
   * `requirements.txt` pins the CPU build of onnxruntime.
   *
   * The consequence is not academic: a 1.5 MB clip sat in `processing` for 41
   * minutes and was abandoned without a result, against a published typical
   * run of 124 seconds. Most of that is queue and cold boot on a shared CPU
   * pool nobody keeps warm.
   *
   * The model is MIT-licensed, so the fix is to publish the same code on GPU
   * hardware under our own account — see docs/replicate-gpu/. That changes the
   * OWNER and NAME, not just the version, which is why this is an environment
   * variable now. Swapping providers becomes a dashboard edit and a rollback
   * becomes instant, with no deploy in either direction.
   */
  model: process.env.REPLICATE_AI_CLEAN_MODEL?.trim() || "hjunior29/video-text-remover",
  /**
   * 🔴 THE PIN.
   *
   * `247c8385…` is the version marked Latest on the model's Versions page,
   * read there on 2026-09-07 and confirmed against the API tab's own example.
   *
   * It is a constant in committed code rather than a required environment
   * variable, and that is the stronger form of pinning: the exact model that
   * ran is recorded in git alongside the code that called it, it cannot be
   * forgotten during a deploy, and changing it is a reviewable one-line commit
   * rather than a dashboard edit nobody sees. The env var still overrides it,
   * so a bad version can be rolled back in seconds without waiting for a build.
   *
   * ⚠️ Do not "update to latest" casually. A new version can change the output,
   * the defaults, or the input schema — and old jobs record the version that
   * actually ran (`ai_jobs.model_version`) precisely so the difference stays
   * visible afterwards.
   */
  version:
    process.env.REPLICATE_AI_CLEAN_MODEL_VERSION?.trim() ||
    "247c8385f3c6c322110a6787bd2d257acc3a3d60b9ed7da1726a628f72a42c4d",

  /* ── The model's input parameters. Backend-controlled; never client-supplied. ── */

  /** hybrid | inpaint | inpaint_ns | blur | black | background. */
  method: process.env.AI_CLEAN_METHOD?.trim() || "hybrid",

  /**
   * original | 1080p | 720p | 480p | 360p.
   *
   * ── 🔴 "original", BECAUSE ANYTHING ELSE RESAMPLES THE WHOLE VIDEO ─────────
   *
   * This was "720p", chosen as a cost/quality balance before anyone had seen a
   * finished result. The first successful job showed what it actually does. The
   * owner's clip is 480x854, and the model's own log said:
   *
   *     - Upscaling output back to 480x854...
   *
   * Because `predict.py` only downscales when `height > target_height`, a 854px
   * tall video was reduced to ~404x720, inpainted, and then scaled back up.
   * That is a full round trip through a smaller raster: EVERY pixel is softened,
   * not just the region under the caption. The owner reported it as "the
   * removing affects the video", which is exactly right — the removal was fine
   * and the resampling around it was not.
   *
   * At original resolution nothing outside the patched boxes is touched at all.
   *
   * ⚠️ The cost is bounded by the input, not by this: `AI_CLEAN_LIMITS` already
   * caps file size and duration, and the model spent 3.8 seconds on this clip at
   * 720p. Overridable per-deploy if a very large video ever proves otherwise.
   */
  resolution: process.env.AI_CLEAN_RESOLUTION?.trim() || "original",

  /**
   * 0-1. Lower finds more text AND more false positives.
   *
   * A false positive is not a harmless miss here — it erases a region of real
   * picture. Kept at the model author's default; raise it if the owner reports
   * things being wiped that were never text.
   */
  confidence: Number(process.env.AI_CLEAN_CONFIDENCE) || 0.25,

  /** Overlap threshold when merging detections. */
  iou: Number(process.env.AI_CLEAN_IOU) || 0.45,

  /** Pixels of padding around a detected box, 0-20. */
  margin: Number(process.env.AI_CLEAN_MARGIN) || 5,

  /**
   * Detect every Nth frame; boxes are reused for the frames in between.
   *
   * 🔴 WAS 5, WHICH IS A SECOND ACCURACY BUG. Text that moves, or appears for
   * under five frames, gets a box computed somewhere it no longer is — so the
   * cleaner erases the wrong part of the picture and misses the actual caption.
   * On a 66-frame clip it detected on 14 frames and reused those boxes for the
   * other 52.
   *
   * 1 means every frame is looked at. Detection is the expensive stage, so this
   * is the one change here that genuinely costs time — and it is worth it: this
   * feature's entire value is that the result looks untouched.
   */
  detectionInterval: Number(process.env.AI_CLEAN_DETECTION_INTERVAL) || 1,
} as const;

/** Exactly the body the model expects, built in one place. */
export function buildAiCleanInput(videoUrl: string): Record<string, string | number> {
  return {
    video: videoUrl,
    method: AI_CLEAN_CONFIG.method,
    resolution: AI_CLEAN_CONFIG.resolution,
    conf_threshold: AI_CLEAN_CONFIG.confidence,
    iou_threshold: AI_CLEAN_CONFIG.iou,
    margin: AI_CLEAN_CONFIG.margin,
    detection_interval: AI_CLEAN_CONFIG.detectionInterval,
  };
}

/** Whether this deployment holds everything a real run needs. */
export function aiCleanConfigured(): boolean {
  return !!process.env.REPLICATE_API_TOKEN?.trim() && !!AI_CLEAN_CONFIG.version;
}

/**
 * What is missing, for an operator reading a log or an admin screen.
 *
 * Never shown to a member — they get "this tool isn't available yet", because
 * "REPLICATE_AI_CLEAN_MODEL_VERSION is unset" is not their problem to solve and
 * naming our environment to the public is not free.
 */
export function aiCleanMisconfiguration(): string | null {
  if (!process.env.REPLICATE_API_TOKEN?.trim()) return "REPLICATE_API_TOKEN is not set";
  if (!AI_CLEAN_CONFIG.version) return "REPLICATE_AI_CLEAN_MODEL_VERSION is not set";
  return null;
}
