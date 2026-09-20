/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — what each replacement mode needs to SEE, and the thresholds
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20 (the "Reference Image & Video Preflight Validation"
 * brief): before ANY media goes to a provider, inspect the reference photo,
 * the source video and the chosen mode, and refuse — with nothing charged —
 * what cannot produce a usable result. "Validate enough visual information
 * for the selected transformation before spending the user's money."
 *
 * This file is the ONE place the rules live (brief §16, §21: "do not scatter
 * arbitrary numbers"). Every number here is a starting value to be tuned
 * from real uploads (the preflight.completed audit events carry the
 * measurements — brief §26). Pure: read by the decision engine, the worker
 * and the interface.
 *
 * ── The vocabulary ─────────────────────────────────────────────────────────
 *   face height fraction   the primary face's box height ÷ the frame height.
 *                          A phone selfie is ~0.30–0.45; a half-body portrait
 *                          ~0.15–0.30; a full-body shot ~0.04–0.12.
 *   body visibility        visible person height ÷ the height a whole body
 *                          would have (≈ 7.5 face heights): 1.0 = head to
 *                          feet, ~0.5 = to the hips, ~0.3 = head and
 *                          shoulders. The brief's "visible_subject_area /
 *                          expected_subject_area", in one dimension.
 *   usable frame ratio     sampled video frames that meet the mode's bar ÷
 *                          frames sampled. One bad frame never fails a video
 *                          (brief §22).
 */

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";

/**
 * Bump when the rules, the models or the measurements change: a stored
 * result from an older validator is not reused (brief §24).
 */
export const PREFLIGHT_VALIDATOR_VERSION = 1;

/** How long a passed preflight may be used to start the job it was made for. */
export const PREFLIGHT_TOKEN_TTL_MS = 30 * 60 * 1000;

/** What each mode requires of the media (brief §16). */
export const MEDIA_VALIDATION_CONFIG: Record<ReplacementMode, { requiresFace: boolean; requiresBody: boolean; requiresFullBody: boolean }> = {
  face_only: { requiresFace: true, requiresBody: false, requiresFullBody: false },
  skin_face: { requiresFace: true, requiresBody: true, requiresFullBody: false },
  // Upper Body (2026-09-20): a face and an upper body in frame; the lower body is not required.
  upper_body: { requiresFace: true, requiresBody: true, requiresFullBody: false },
  full_character: { requiresFace: true, requiresBody: true, requiresFullBody: true },
};

/** A whole standing body is about this many face-box heights tall (the face box is roughly the head). */
export const BODY_HEIGHTS_PER_FACE = 7.5;

export interface ModeThresholds {
  /** The primary face must be at least this fraction of the frame height. */
  minFaceHeightFrac: number;
  /** …and at most this — beyond it the frame is a close-up with no body in it (Full Character only). */
  maxFaceHeightFrac: number | null;
  /** The body visibility the mode needs. Null when the mode does not look at the body. */
  minBodyVisibility: number | null;
  /** Below `minBodyVisibility` but at or above this, the picture is AMBIGUOUS and the vision layer may decide. */
  ambiguousBodyVisibility: number | null;
  /** The share of sampled video frames that must meet the bar. */
  minUsableFrameRatio: number;
}

/**
 * Brief §21: "a Full Character request should require stronger body
 * evidence than Face Only." The video bars are a little lower than the
 * image ones — a subject moves, turns, is briefly small (brief §22–§23).
 */
export const VALIDATION_THRESHOLDS = {
  /** Detector confidences below which a detection is not counted. */
  faceDetection: 0.8,
  bodyDetection: 0.6,
  /** The vision layer's own confidence, below which its answer is not trusted. */
  ambiguousVision: 0.7,
  /** A second face at least this size (relative to the primary) is a competing subject. */
  competingFaceRatio: 0.6,
  /** Variance of the Laplacian on a 256px grey render; lower is blur. Video frames are allowed softer. */
  minSharpness: { image: 25, frame: 12 },
  /** The shortest side of an image below which detection is not trusted. */
  minImageShortEdge: 240,
  /** Face landmarks (eyes, nose, mouth corners) inside the frame and the box: fewer = occluded / cut. */
  minVisibleLandmarks: 4,
  /**
   * Reference/video compatibility (Full Character): a reference that passed
   * only through the vision layer (below the mode's body bar) can carry a
   * hips-up video, not one whose median body visibility is at or above
   * this — the whole lower body would have to be invented.
   */
  wholeBodyVideo: 0.8,
  /** How many frames a video is sampled at (brief §6: beginning, 20 %, 40 %, 60 %, 80 %, near the end). */
  videoSamplePositions: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95] as readonly number[],
  image: {
    face_only: { minFaceHeightFrac: 0.06, maxFaceHeightFrac: null, minBodyVisibility: null, ambiguousBodyVisibility: null, minUsableFrameRatio: 1 },
    skin_face: { minFaceHeightFrac: 0.05, maxFaceHeightFrac: null, minBodyVisibility: 0.28, ambiguousBodyVisibility: 0.2, minUsableFrameRatio: 1 },
    upper_body: { minFaceHeightFrac: 0.04, maxFaceHeightFrac: 0.45, minBodyVisibility: 0.35, ambiguousBodyVisibility: 0.25, minUsableFrameRatio: 1 },
    full_character: { minFaceHeightFrac: 0.03, maxFaceHeightFrac: 0.3, minBodyVisibility: 0.55, ambiguousBodyVisibility: 0.4, minUsableFrameRatio: 1 },
  } satisfies Record<ReplacementMode, ModeThresholds>,
  video: {
    // 2026-09-20 (live): the model author's own Full Character demo — a dancing person, body cropped in half the sampled frames — was refused at 0.6 / 0.5. Wan handles partial bodies; half the sampled frames with the person usable is the bar, and the body band is lower so a cropped frame lands in the ambiguous band (the vision layer) rather than a hard fail.
    face_only: { minFaceHeightFrac: 0.04, maxFaceHeightFrac: null, minBodyVisibility: null, ambiguousBodyVisibility: null, minUsableFrameRatio: 0.5 },
    skin_face: { minFaceHeightFrac: 0.035, maxFaceHeightFrac: null, minBodyVisibility: 0.25, ambiguousBodyVisibility: 0.15, minUsableFrameRatio: 0.5 },
    upper_body: { minFaceHeightFrac: 0.03, maxFaceHeightFrac: null, minBodyVisibility: 0.3, ambiguousBodyVisibility: 0.18, minUsableFrameRatio: 0.5 },
    full_character: { minFaceHeightFrac: 0.025, maxFaceHeightFrac: 0.35, minBodyVisibility: 0.4, ambiguousBodyVisibility: 0.2, minUsableFrameRatio: 0.5 },
  } satisfies Record<ReplacementMode, ModeThresholds>,
} as const;

/** The vision layer (brief §19 layer 3): on Replicate, the same token as every other model; only for the ambiguous band. */
export const PREFLIGHT_VISION = {
  enabled: true,
  model: "openai/gpt-4.1-nano",
  /** Never more than this many sampled frames go to the vision model beside the reference. */
  maxFrames: 2,
  timeoutMs: 25_000,
} as const;

/** Member-facing rate: how many preflights one member may run per hour (brief §14). */
export const PREFLIGHT_RATE_PER_HOUR = 30;

/** The reasons a preflight can give (brief §8 — codes, never sentences, in the result). */
export const PREFLIGHT_ERROR_CODES = [
  "reference_unreadable",
  "reference_too_small",
  "reference_face_not_detected",
  "reference_face_too_small",
  "reference_face_obstructed",
  "reference_multiple_faces",
  "reference_too_blurry",
  "reference_body_not_visible",
  "reference_close_up",
  "video_unreadable",
  "video_no_frames",
  "video_face_not_detected",
  "video_face_too_small",
  "video_face_obstructed",
  "video_subject_leaves_frame",
  "video_too_blurry",
  "video_body_not_visible",
  "video_close_up",
  "incompatible_framing",
  "validator_unavailable",
] as const;
export type PreflightErrorCode = (typeof PREFLIGHT_ERROR_CODES)[number];

export const PREFLIGHT_WARNING_CODES = ["reference_face_angled", "reference_soft", "video_face_sometimes_hidden", "video_soft", "vision_layer_used", "reference_extra_faces"] as const;
export type PreflightWarningCode = (typeof PREFLIGHT_WARNING_CODES)[number];
