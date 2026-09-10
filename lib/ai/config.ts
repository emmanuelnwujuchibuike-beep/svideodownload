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
   * ── 🔴 THE RESOLUTION CEILING, AND WHERE IT CAN HONESTLY BE APPLIED ───────
   *
   * Owner, 2026-09-09 (the AdSense hardening brief): "Enforce… Maximum
   * resolution where appropriate."
   *
   * 8,294,400 is 3840x2160. Above that a job is not a member cleaning a phone
   * video; it is either a mistake or an attempt to spend our provider budget,
   * and both are better refused than run.
   *
   * ⚠️ "Where appropriate" is doing real work in that sentence, and this is the
   * honest account of it: a resolution is only knowable from a PROBE, and
   * ffprobe exists on the Docker worker and nowhere else — Vercel's runtime has
   * no binaries. So:
   *
   *   · a LINK job is probed by the worker before anything is submitted, so
   *     this ceiling is applied before a single provider second is billed;
   *   · an UPLOAD job reaches a probe only on the worker, at finalization. It
   *     is still refused there — before the GPU stage, which is the expensive
   *     half — but the detector has already run.
   *
   * What bounds an upload BEFORE submission is `maxFileSize`, checked at
   * /start against what storage actually reports rather than what the browser
   * claimed. That is a weaker bound on pixels than on bytes and it is the
   * strongest one available at that point in the flow.
   */
  maxPixels: envInt("AI_CLEAN_MAX_PIXELS", 3840 * 2160),
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

/**
 * The temporal remover's methods.
 *
 * 🔴 These are the DISCRIMINATOR between the two model families, not just a
 * setting. `video-subtitle-remover` takes `{video, mode, subtitle_area}` and
 * `hjunior29/video-text-remover` takes six entirely different fields — send
 * either model the other's body and Replicate answers 422 before anything runs.
 *
 * Keying off the method name means one environment variable switches both the
 * model and the shape of its input, so the two can never be set to disagree.
 */
const TEMPORAL_METHODS = new Set(["sttn", "propainter", "lama"]);

/** True when the configured method belongs to the temporal remover. */
export function usesTemporalRemover(): boolean {
  return TEMPORAL_METHODS.has(AI_CLEAN_CONFIG.method);
}

/**
 * Exactly the body the model expects, built in one place.
 *
 * ── 🔴 TWO MODELS, TWO SCHEMAS ───────────────────────────────────────────────
 *
 * The classical remover was measured on 2026-09-08 producing a smeared grey
 * blob with the caption still readable through it — it fills with
 * `cv2.inpaint`, which averages the surrounding pixels because it has only ever
 * seen one frame. The temporal one recovers the region from frames where it was
 * not covered, which is what "removing" actually requires.
 *
 * The temporal model also finds the text itself, so the detection knobs
 * (confidence, iou, margin, interval) have nothing to tune and are deliberately
 * NOT sent — passing ignored fields to a strict schema is how a working
 * deployment breaks on somebody else's next release.
 */
export function buildAiCleanInput(
  videoUrl: string,
  /** Resolved by the caller and recorded on the job; see AiProviderSubmission. */
  engine: AiCleanEngine = aiCleanEngine(),
): Record<string, string | number> {
  if (usesTemporalRemover()) {
    return {
      video: videoUrl,
      mode: AI_CLEAN_CONFIG.method,
      // Empty means "find and remove all text", which is what this product
      // promises. A band is only worth sending when a member picks one.
      subtitle_area: process.env.AI_CLEAN_SUBTITLE_AREA?.trim() || "",
    };
  }

  return {
    video: videoUrl,
    /*
      🔴 ON THE PROPAINTER ENGINE THIS PASS IS A DETECTOR, NOT A CLEANER.

      `black` fills every detected caption region with pure black, which is the
      only way this model will tell us where the text is — it has no mask
      output. The worker then recovers the mask by thresholding, and the actual
      reconstruction is done by ProPainter. See lib/ai/propainter.ts.

      Measured 2026-09-09: run in `black` mode it paints a solid merged
      RECTANGLE over the whole caption block, which is also how we learned that
      its inpainting rewrites ~100,000 px where the glyphs occupy ~20,000.
    */
    method: engine === "propainter" ? "black" : AI_CLEAN_CONFIG.method,
    resolution: AI_CLEAN_CONFIG.resolution,
    conf_threshold: AI_CLEAN_CONFIG.confidence,
    iou_threshold: AI_CLEAN_CONFIG.iou,
    margin: AI_CLEAN_CONFIG.margin,
    detection_interval: AI_CLEAN_CONFIG.detectionInterval,
  };
}

/* ─────────────────────────── the inpainting engine ────────────────────────── */

export type AiCleanEngine = "classical" | "propainter";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH THING ACTUALLY RECONSTRUCTS THE BACKGROUND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `classical`   hjunior29 does detection AND fill. One call. What ships today.
 * `propainter`  hjunior29 does detection only (`black`); the worker derives the
 *               mask with ffmpeg and ProPainter does the reconstruction.
 *
 * ── 🔴 WHY THE SECOND ENGINE EXISTS ─────────────────────────────────────────
 *
 * Measured on the owner's own video, 2026-09-09, five configurations of the
 * classical model on one pinned source:
 *
 *     hybrid m=5   inpaint m=5   inpaint_ns m=5   hybrid m=0   hybrid m=14
 *
 * All five produced the SAME smeared band — including `margin: 0`, the tightest
 * mask the model can make. That is what rules out the mask as the cause and
 * indicts the fill: all three of its algorithms are OpenCV single-frame
 * diffusion, which has no information about what is behind the text and can
 * only average the surrounding pixels.
 *
 * ProPainter is temporal — it recovers the region from frames where it was not
 * covered. On the same clip it reconstructed sky, horizon, sea and animal
 * texture with no rectangular edge, where the classical model left a visible
 * box.
 *
 * ⚠️ DEFAULTS TO `classical`. The second engine costs a GPU call on top of a
 * CPU one and roughly 210s of inference, so it is an operator decision, not a
 * silent upgrade. It also has a genuine weakness: a caption that never moves
 * over a background that never moves gives a temporal model nothing to borrow
 * from, and it will hallucinate rather than reconstruct.
 */
export function aiCleanEngine(): AiCleanEngine {
  return process.env.AI_CLEAN_ENGINE?.trim().toLowerCase() === "propainter" ? "propainter" : "classical";
}

/**
 * The reconstruction model, when the ProPainter engine is on.
 *
 * Version pinned in committed code for the same reason the classical one is:
 * the model that ran is recorded in git beside the code that called it.
 * `e5ea7ae0…` was read from the Replicate API on 2026-09-09 and is the model's
 * own `latest_version`; the model is public with ~195k runs.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SECOND DETECTOR — `datalab-to/ocr` (Surya)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "fix the detector and wire it. Do this once and for all."
 *
 * ── 🔴 IT AUGMENTS THE MASK. IT DOES NOT REPLACE THE PIPELINE ───────────────
 *
 * The tempting move was to drop `hjunior29/video-text-remover` entirely: Surya
 * is a better text detector by every measurement taken, and removing a model
 * would save its ~68 seconds. It was the wrong move, for a reason that has
 * nothing to do with quality.
 *
 * hjunior29 is not just a detector here — it is the PROVIDER whose webhook
 * drives the whole job lifecycle. `/start` submits to it, Replicate calls back,
 * and that callback is what moves the row to `finalizing` and wakes the worker.
 * Replacing it means rebuilding job creation, the webhook, the idempotency and
 * the stall guard, all at once, to fix a mask.
 *
 * So Surya runs INSIDE finalization, on frames the worker already has on disk,
 * and its boxes are unioned into the mask hjunior29's output produced. The
 * pipeline is unchanged; the mask is better. If Surya fails, times out, or is
 * switched off, the mask is exactly what it was yesterday.
 *
 * ── The measurement ─────────────────────────────────────────────────────────
 *
 * On the owner's 1080x1920 clip, hjunior29 removed a caption but left "Bus" and
 * 'S"' standing at either end of it — at conf 0.25, 0.15 AND 0.08, so a
 * capability limit rather than a threshold. Surya, given the same frame,
 * returned both with pixel-accurate boxes in 13.4 seconds.
 */
export const AI_CLEAN_DETECTOR = {
  model: process.env.REPLICATE_TEXT_DETECT_MODEL?.trim() || "datalab-to/ocr",
  /**
   * 🔴 PINNED, like every other model here. Read from the model's API tab on
   * 2026-09-09 and confirmed by a real prediction against a real frame.
   */
  version:
    process.env.REPLICATE_TEXT_DETECT_VERSION?.trim() ||
    "3e6db0d5311d6fdc232eea333c1e26055ba4e542180043f12acb2967e5c77f4a",
  /**
   * ── 🔴 OFF UNTIL AN OPERATOR TURNS IT ON ──────────────────────────────────
   *
   * Every frame is a billed prediction, so this multiplies the per-job cost by
   * a number the owner has not agreed to yet. A safety improvement that
   * silently changes somebody's provider bill is not a safety improvement.
   *
   * It is also the switch that makes this reversible without a deploy: if the
   * augmented mask ever removes something it should not, one environment
   * variable puts the pipeline back to exactly its previous behaviour.
   */
  enabled: ["1", "true", "yes"].includes((process.env.AI_CLEAN_TEXT_DETECT || "").toLowerCase()),
  /**
   * How many frames to sample.
   *
   * Six is the number where the marginal frame stops finding new text on the
   * clips measured here. Captions in social video are static for seconds at a
   * time, so samples are highly redundant — and each one is a billed call.
   */
  frames: envInt("AI_CLEAN_TEXT_DETECT_FRAMES", 6),
  /**
   * 🔴 A PER-FRAME deadline. Frames are detected in PARALLEL, so one hung call
   * would otherwise hold the whole stage — and therefore the job — open until
   * the worker's own timeout. Losing one sample is a fair price. A measured
   * run is 13.4s; 90s is generous even for a cold container.
   */
  frameTimeoutMs: envInt("AI_CLEAN_TEXT_DETECT_TIMEOUT_MS", 90_000),
  pollMs: envInt("AI_CLEAN_TEXT_DETECT_POLL_MS", 2_000),
  /** Surya is confident about real text and hesitant about compression noise. */
  minConfidence: Number(process.env.AI_CLEAN_TEXT_DETECT_MIN_CONF || "0.4") || 0.4,
  /**
   * 🔴 A CEILING ON WHAT THIS MAY ADD. If the detector's boxes would cover more
   * than this fraction of the frame, they are DISCARDED and the mask is left as
   * the primary detector made it.
   *
   * The failure this guards against is a video that is mostly text — a slide, a
   * screen recording, a lyric video. Repainting 60% of every frame is not a
   * clean, it is an invented video, and it is exactly the case where an OCR
   * model does its job perfectly and the result is worst.
   */
  maxAddedCoverage: Number(process.env.AI_CLEAN_TEXT_DETECT_MAX_COVERAGE || "0.25") || 0.25,
} as const;

export const AI_CLEAN_PROPAINTER = {
  model: process.env.REPLICATE_PROPAINTER_MODEL?.trim() || "jd7h/propainter",
  version:
    process.env.REPLICATE_PROPAINTER_VERSION?.trim() ||
    "e5ea7ae04e97c96a0e14c70d8e4cb899abdf326a377c01f1c10966ccd6c6bae4",
  /**
   * 🔴 0, deliberately, and this is the knob the owner asked about.
   *
   * ProPainter's own default is 4. Ours is 0 because the mask the worker builds
   * has ALREADY been closed with six dilations to fill the holes left by the
   * caption's black outline — dilating again would grow the repainted area for
   * no benefit, and the owner's specific concern was oversized masks.
   */
  maskDilation: Number(process.env.AI_CLEAN_PROPAINTER_DILATION ?? "0") || 0,
  /**
   * ── 🔴 THE SETTINGS THAT STOP IT RUNNING OUT OF GPU MEMORY ───────────────
   *
   * Measured 2026-09-09 on the owner's 720x1280 / 286-frame video, with
   * ProPainter's own defaults (subvideo_length 80, neighbor 10, ref_stride 10):
   *
   *     CUDA out of memory. Tried to allocate 9.89 GiB (44.39 GiB capacity)
   *
   * On a 44 GiB card. ProPainter holds a whole sub-video of optical flow and
   * every neighbour frame resident, so peak memory scales with
   * subvideo_length x width x height — and a portrait 720x1280 clip is already
   * near the edge before anything is asked of it.
   *
   * That failure was INVISIBLE in production: the reconstruction returned
   * nothing and the job fell back (shipping the detector intermediate) or, once
   * the fallback was closed, failed outright. The owner saw a smear and a
   * "didn't finish", never an out-of-memory.
   *
   * 🔴 These reduce MEMORY, not resolution.  stays 1 and
   * width/height stay -1, so the video is inpainted at its native size — the
   * chunk is simply smaller. Verified: the same clip that OOM'd completed in
   * 191s at full 720x1280 x 286 with these values.
   */
  /**
   * ── 🔴 THE PIXEL BUDGET, WHICH IS THE ONE THAT ACTUALLY STOPPED THE OOM ───
   *
   * The three values below bound the INPAINTING chunk. They fixed the first
   * out-of-memory and could never have fixed the second, because the second
   * happened in RAFT optical flow — which ProPainter computes across the clip
   * BEFORE it inpaints, and which costs area SQUARED. See the long note on
   * `propainterResizeRatio` in lib/ai/propainter.ts for the arithmetic and the
   * three failed predictions it was derived from.
   *
   * 409,920 is 480x854: the area of a run that is known to have succeeded on
   * this account, rather than a round number. A 720x1280 job scales to 0.66 and
   * is put back to its exact source size afterwards by
   * `buildResizeToSourceArgs`.
   */
  /**
   * ── 🔴 RAISED 409,920 → 614,400 (2026-09-09) ──────────────────────────────
   *
   * Owner: "The text area is still showing darker than the main picture."
   *
   * The repaired patch is genuinely lower resolution than the picture around
   * it. `propainter_resized = 480x848->1080x1920` on every 1080p job: the
   * reconstruction happens at 480p and is upscaled 2.25x into a full-res
   * frame, so it is softer and slightly different in tone. Feathering the seam
   * hides the EDGE; only more pixels fix the patch itself.
   *
   * 614,400 is 640x960 — 1.5x the area, so 1.22x the linear resolution. RAFT's
   * correlation volume is quadratic in area, so this is 2.25x the memory of the
   * old budget: against the ~3 GiB the 480x854 runs used, roughly 7 GiB on a
   * 44 GiB card. The failures that set the original number were asking for
   * 15.64 GiB at full 1080p, so this sits well inside the gap between what
   * worked and what did not.
   *
   * ⚠️ NOT raised to 720p (921,600). That is 5x the old memory — close enough
   * to the number that actually OOM'd that a busier card would fail, and a
   * failed job is a far worse outcome than a slightly soft patch. The env var
   * is there to try it deliberately.
   */
  maxPixels: envInt("AI_CLEAN_PROPAINTER_MAX_PIXELS", 614_400),
  subvideoLength: envInt("AI_CLEAN_PROPAINTER_SUBVIDEO", 40),
  /** Local frames each output frame may borrow from. 10 -> 6 for memory. */
  neighborLength: envInt("AI_CLEAN_PROPAINTER_NEIGHBOR", 6),
  /** Stride between global reference frames. Wider = fewer frames resident. */
  refStride: envInt("AI_CLEAN_PROPAINTER_REF_STRIDE", 12),
  /** Half precision. Materially faster, and no visible difference on video. */
  fp16: process.env.AI_CLEAN_PROPAINTER_FP32?.trim() !== "1",
  /** How long the worker will wait for the GPU before giving up and failing honestly. */
  timeoutMs: envInt("AI_CLEAN_PROPAINTER_TIMEOUT_MS", 15 * 60_000),
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE GPU TIER (owner, 2026-09-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "wire the route and pipeline so pro users and business users and any higher
 * plan yet to come to use gpu while free use cpu."
 *
 * ── 🔴 BOTH VALUES ARE ENVIRONMENT, AND THAT IS DELIBERATE ──────────────────
 *
 * The CPU model's version is a committed constant, because pinning it in git
 * beside its caller is the stronger form of pinning. This one is NOT, for one
 * reason: THE GPU MODEL DOES NOT EXIST YET. The version published on
 * 2026-09-08 was disabled by Replicate — "consistently fails to complete
 * setup" — and the pipeline stayed on CPU because a feature that returns a
 * mediocre result beats one that never returns at all.
 *
 * So the routing ships now and the model is configuration. The day a GPU model
 * boots, it is two dashboard values and no deploy; until then both are unset,
 * `aiCleanGpuConfigured()` is false, and EVERY audience runs on CPU exactly as
 * it does today.
 *
 * ⚠️ Set BOTH or neither. A model without a version is a floating reference,
 * which is the thing `AI_CLEAN_CONFIG.version` exists to prevent — so a
 * half-configured pair reports itself unconfigured rather than guessing.
 */
export const AI_CLEAN_GPU = {
  model: process.env.REPLICATE_AI_CLEAN_GPU_MODEL?.trim() || "",
  version: process.env.REPLICATE_AI_CLEAN_GPU_VERSION?.trim() || "",
} as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BRIA — the Max AI model (owner, 2026-09-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "max ai will use BRIA model... while pro and business uses just gpu and not
 * BRIA."
 *
 * Environment for the same reason the GPU pair is: no BRIA model is published
 * under this account yet, and a committed constant pointing at nothing would be
 * a pin on a thing that does not exist. Both values or neither.
 */
export const AI_CLEAN_BRIA = {
  model: process.env.REPLICATE_AI_CLEAN_BRIA_MODEL?.trim() || "",
  version: process.env.REPLICATE_AI_CLEAN_BRIA_VERSION?.trim() || "",
} as const;

/** True only when a COMPLETE BRIA model reference is configured. */
export function aiCleanBriaConfigured(): boolean {
  return !!AI_CLEAN_BRIA.model && !!AI_CLEAN_BRIA.version;
}

/** True only when a COMPLETE GPU model reference is configured. */
export function aiCleanGpuConfigured(): boolean {
  return !!AI_CLEAN_GPU.model && !!AI_CLEAN_GPU.version;
}

/**
 * The model and version a job should run on, given its hardware tier.
 *
 * 🔴 One place decides this, and it is not the route and not the browser. A
 * request that could name its own model could point the owner's credentials at
 * an arbitrary one and bill them for it — the same rule that has governed
 * `AI_CLEAN_CONFIG` since Part 2, extended rather than loosened.
 *
 * Falls back to CPU whenever the GPU pair is incomplete, so a misconfiguration
 * is a slower job rather than a broken one.
 */
export function aiCleanModelFor(tier: "standard" | "gpu" | "bria"): { model: string; version: string } {
  if (tier === "bria" && aiCleanBriaConfigured()) {
    return { model: AI_CLEAN_BRIA.model, version: AI_CLEAN_BRIA.version };
  }
  if ((tier === "gpu" || tier === "bria") && aiCleanGpuConfigured()) {
    // 🔴 A Max AI member on a deployment with no BRIA model still gets the
    // FASTER model rather than dropping all the way to CPU. Falling to the next
    // rung down beats falling to the bottom for somebody on the top plan.
    return { model: AI_CLEAN_GPU.model, version: AI_CLEAN_GPU.version };
  }
  return { model: AI_CLEAN_CONFIG.model, version: AI_CLEAN_CONFIG.version };
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

  /*
    🔴 THE MODEL AND THE METHOD MUST BE THE SAME FAMILY.

    They are set by THREE separate environment variables that have to move
    together, because the method name is what selects the request body. Set
    `AI_CLEAN_METHOD=sttn` while the model is still the classical one and every
    prediction is rejected 422 before a frame is read — after the upload, after
    a quota reservation, with the member watching a progress bar for a job that
    was dead on submission.

    This is not hypothetical. On 2026-09-08 the owner was handed exactly those
    three values to paste into Vercel, and pasting two of the three would have
    produced that outcome silently.

    Refusing here turns it into the feature reporting itself unavailable, which
    is honest and costs nobody an upload. It fails CLOSED, like the entitlement
    path. The detail string is operator-facing only — `AiJobError.detail` is
    never returned to a client (lib/ai/errors.ts).

    Only a model we RECOGNISE can be judged. An unknown slug — a fork, a rename,
    somebody's experiment — returns null and is allowed through, because
    disabling the tool over a name we have merely not seen is worse than the
    thing being guarded against.
  */
  const family = knownModelFamily(AI_CLEAN_CONFIG.model);
  const wanted = usesTemporalRemover() ? "temporal" : "classical";
  if (family && family !== wanted) {
    return (
      `AI_CLEAN_METHOD="${AI_CLEAN_CONFIG.method}" is a ${wanted} method but ` +
      `REPLICATE_AI_CLEAN_MODEL="${AI_CLEAN_CONFIG.model}" is the ${family} model; ` +
      "their input schemas differ, so every prediction would be rejected 422"
    );
  }

  return null;
}

/**
 * The family of a model we ship against, or null for anything else.
 *
 * Matched on the SLUG rather than the owner, because the same code published
 * under a different account is still the same schema — which is exactly the
 * migration in progress: `hjunior29/video-text-remover` (classical) to a
 * self-published `video-subtitle-remover` (temporal).
 */
function knownModelFamily(model: string): "temporal" | "classical" | null {
  const slug = (model.split("/").pop() ?? "").toLowerCase();
  if (slug.includes("video-subtitle-remover")) return "temporal";
  if (slug.includes("video-text-remover")) return "classical";
  return null;
}
