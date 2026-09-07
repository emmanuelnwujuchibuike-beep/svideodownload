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
  model: "hjunior29/video-text-remover",
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
  method: "hybrid",
  /** original | 1080p | 720p | 480p | 360p. 720p is the cost/quality balance. */
  resolution: "720p",
  /** 0-1. Lower finds more text and more false positives. */
  confidence: 0.25,
  /** Overlap threshold when merging detections. */
  iou: 0.45,
  /** Pixels of padding around a detected box, 0-20. */
  margin: 5,
  /** Detect every Nth frame and interpolate between, 0-100. */
  detectionInterval: 5,
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
