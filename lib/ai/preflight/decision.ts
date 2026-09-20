/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the decision engine (brief §20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   fast file checks → computer vision → mode requirements → clear pass?
 *   → yes: PASS · no: ambiguous? → yes: the vision layer's judgement →
 *   FrenzSave's own final decision (never the model's alone).
 *
 * Pure and total: measurements in, a structured result out. The worker
 * feeds it; the interface prints it; the start route trusts only a stored
 * copy of it. Every number it compares against comes from config.ts.
 */

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";

import { MEDIA_VALIDATION_CONFIG, VALIDATION_THRESHOLDS, type ModeThresholds, type PreflightErrorCode, type PreflightWarningCode } from "./config";
import { frameFacts, type FrameFacts, type FrameMeasurement } from "./measure";

/** What the vision layer answered for the ambiguous cases (brief §19 layer 3) — structured, never free text. */
export interface VisionJudgement {
  usable: boolean;
  confidence: number;
  subjectType: "face_close_up" | "half_body" | "full_body" | "no_person" | "unclear";
  faceVisibility: "clear" | "partial" | "hidden";
  bodyVisibility: "sufficient" | "partial" | "insufficient";
  obstruction: "low" | "medium" | "high";
  recommendation: "pass" | "reject";
}

export interface PreflightMediaInput {
  /** Null when the file could not be read at all. */
  image: FrameMeasurement | null;
  /** The sampled frames; empty when the video could not be read. */
  frames: readonly FrameMeasurement[];
  /** The video's measured size, for the "too small" gate when no frame decoded. */
  video: { width: number; height: number; durationMs: number } | null;
  /** The vision layer's answers, when it was asked (reference, then video). */
  vision?: { reference: VisionJudgement | null; video: VisionJudgement | null } | null;
}

export interface PreflightResult {
  valid: boolean;
  mode: ReplacementMode;
  referenceImage: {
    valid: boolean;
    faceDetected: boolean;
    faceConfidence: number | null;
    faceVisibility: number | null;
    bodyVisibility: number | null;
    faceHeightFrac: number | null;
    sharpness: number | null;
  };
  video: {
    valid: boolean;
    usableFrames: number;
    sampledFrames: number;
    faceVisibility: number | null;
    bodyVisibility: number | null;
    faceHeightFrac: number | null;
  };
  compatibility: { valid: boolean; confidence: number | null };
  errors: PreflightErrorCode[];
  warnings: PreflightWarningCode[];
  /** True when the rules could not decide alone and the vision layer's judgement was (or would be) needed. */
  ambiguous: boolean;
  /** True when a vision judgement was applied to reach the answer. */
  visionUsed: boolean;
}

/** What a caller must ask the vision layer about before a final answer can be given. */
export type AmbiguityTarget = "reference" | "video";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

type Verdict = "pass" | "ambiguous" | "fail";

/** One frame (or the image) against one mode's bar. The `errors` explain a fail; `ambiguous` says the vision layer could help. */
function judgeFrame(f: FrameFacts, mode: ReplacementMode, t: ModeThresholds, kind: "reference" | "video", minSharpness: number): { verdict: Verdict; errors: PreflightErrorCode[]; warnings: PreflightWarningCode[] } {
  const need = MEDIA_VALIDATION_CONFIG[mode];
  const errors: PreflightErrorCode[] = [];
  const warnings: PreflightWarningCode[] = [];
  const pre = kind === "reference" ? "reference" : "video";
  if (need.requiresFace) {
    if (!f.faceDetected) return { verdict: "fail", errors: [`${pre}_face_not_detected`], warnings };
    if ((f.faceHeightFrac ?? 0) < t.minFaceHeightFrac) errors.push(`${pre}_face_too_small`);
    if ((f.faceVisibility ?? 0) * 5 < VALIDATION_THRESHOLDS.minVisibleLandmarks) errors.push(`${pre}_face_obstructed`);
    if (kind === "reference" && f.competingFaces > 0) errors.push("reference_multiple_faces");
    if (kind === "reference" && f.faceTurn !== null && Math.abs(f.faceTurn) > 0.6) warnings.push("reference_face_angled");
  }
  if (f.sharpness < minSharpness) errors.push(`${pre}_too_blurry`);
  else if (f.sharpness < minSharpness * 2) warnings.push(kind === "reference" ? "reference_soft" : "video_soft");

  let ambiguous = false;
  if (need.requiresBody && t.minBodyVisibility !== null) {
    const bv = f.bodyVisibility ?? 0;
    // a close-up is a close-up whatever the person detector says
    if (t.maxFaceHeightFrac !== null && (f.faceHeightFrac ?? 0) > t.maxFaceHeightFrac) errors.push(`${pre}_close_up`);
    else if (bv < t.minBodyVisibility) {
      if (t.ambiguousBodyVisibility !== null && bv >= t.ambiguousBodyVisibility) ambiguous = true;
      else errors.push(`${pre}_body_not_visible`);
    }
  }
  if (errors.length) return { verdict: "fail", errors, warnings };
  return { verdict: ambiguous ? "ambiguous" : "pass", errors, warnings };
}

/** Which side (if any) still needs the vision layer before a decision. Empty = the rules decided alone. */
export function ambiguityTargets(input: PreflightMediaInput, mode: ReplacementMode): AmbiguityTarget[] {
  const out: AmbiguityTarget[] = [];
  if (input.image) {
    const j = judgeFrame(frameFacts(input.image), mode, VALIDATION_THRESHOLDS.image[mode], "reference", VALIDATION_THRESHOLDS.minSharpness.image);
    if (j.verdict === "ambiguous") out.push("reference");
  }
  if (input.frames.length) {
    const t = VALIDATION_THRESHOLDS.video[mode];
    const judged = input.frames.map((m) => judgeFrame(frameFacts(m), mode, t, "video", VALIDATION_THRESHOLDS.minSharpness.frame));
    const pass = judged.filter((j) => j.verdict === "pass").length;
    const amb = judged.filter((j) => j.verdict === "ambiguous").length;
    if (pass / judged.length < t.minUsableFrameRatio && (pass + amb) / judged.length >= t.minUsableFrameRatio) out.push("video");
  }
  return out;
}

function visionSays(v: VisionJudgement | null | undefined): boolean | null {
  if (!v || v.confidence < VALIDATION_THRESHOLDS.ambiguousVision) return null;
  return v.usable && v.recommendation === "pass";
}

export function decidePreflight(input: PreflightMediaInput, mode: ReplacementMode): PreflightResult {
  const errors = new Set<PreflightErrorCode>();
  const warnings = new Set<PreflightWarningCode>();
  let ambiguous = false;
  let visionUsed = false;

  /* ── the reference image ────────────────────────────────────────────── */
  const tImage = VALIDATION_THRESHOLDS.image[mode];
  let refFacts: FrameFacts | null = null;
  let refValid = false;
  if (!input.image) errors.add("reference_unreadable");
  else if (Math.min(input.image.width, input.image.height) < VALIDATION_THRESHOLDS.minImageShortEdge) errors.add("reference_too_small");
  else {
    refFacts = frameFacts(input.image);
    const j = judgeFrame(refFacts, mode, tImage, "reference", VALIDATION_THRESHOLDS.minSharpness.image);
    for (const w of j.warnings) warnings.add(w);
    if (j.verdict === "pass") refValid = true;
    else if (j.verdict === "ambiguous") {
      ambiguous = true;
      const says = visionSays(input.vision?.reference);
      if (says === null) errors.add("reference_body_not_visible");
      else {
        visionUsed = true;
        warnings.add("vision_layer_used");
        if (says) refValid = true;
        else errors.add("reference_body_not_visible");
      }
    } else for (const e of j.errors) errors.add(e);
    if (refFacts.competingFaces === 0 && input.image.faces.length > 1) warnings.add("reference_extra_faces");
  }

  /* ── the video, frame by frame, then in aggregate ─────────────────────── */
  const tVideo = VALIDATION_THRESHOLDS.video[mode];
  const frames = input.frames.map((m) => ({ facts: frameFacts(m), judged: judgeFrame(frameFacts(m), mode, tVideo, "video", VALIDATION_THRESHOLDS.minSharpness.frame) }));
  let videoValid = false;
  let usableFrames = 0;
  if (!input.video) errors.add("video_unreadable");
  else if (frames.length === 0) errors.add("video_no_frames");
  else {
    let passing = frames.filter((f) => f.judged.verdict === "pass").length;
    const ambiguousFrames = frames.filter((f) => f.judged.verdict === "ambiguous").length;
    const needed = tVideo.minUsableFrameRatio;
    if (passing / frames.length < needed && (passing + ambiguousFrames) / frames.length >= needed) {
      ambiguous = true;
      const says = visionSays(input.vision?.video);
      if (says !== null) {
        visionUsed = true;
        warnings.add("vision_layer_used");
        if (says) passing += ambiguousFrames;
      }
    }
    usableFrames = passing;
    if (passing / frames.length >= needed) {
      videoValid = true;
      if (passing < frames.length) warnings.add("video_face_sometimes_hidden");
    } else {
      // name the dominant reason across the failing frames, so the member hears one clear thing
      const tally = new Map<PreflightErrorCode, number>();
      for (const f of frames) if (f.judged.verdict !== "pass") for (const e of f.judged.errors) tally.set(e, (tally.get(e) ?? 0) + 1);
      if (ambiguousFrames && !visionUsed) tally.set("video_body_not_visible", (tally.get("video_body_not_visible") ?? 0) + ambiguousFrames);
      // a face that IS there in some frames and gone in too many others is a subject leaving the frame, not "no face"
      const failingNoFace = frames.filter((f) => !f.facts.faceDetected).length;
      if (failingNoFace > 0 && failingNoFace < frames.length && failingNoFace / frames.length > 1 - needed) {
        tally.delete("video_face_not_detected");
        tally.set("video_subject_leaves_frame", failingNoFace);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      errors.add(top ? top[0] : "video_face_not_detected");
    }
  }

  /* ── compatibility: is the pairing technically appropriate for the mode? ── */
  const need = MEDIA_VALIDATION_CONFIG[mode];
  const frameFaceConf = median(frames.map((f) => f.facts.faceConfidence).filter((n): n is number => n !== null));
  const compatConfidence = refValid && videoValid ? Math.min(refFacts?.faceConfidence ?? 0, frameFaceConf ?? 0) : null;
  let compatValid = refValid && videoValid;
  if (compatValid && need.requiresFullBody && tImage.minBodyVisibility !== null) {
    /*
      Directional, on purpose (brief §23 — no false positives): a full-body
      photo with a hips-up video is fine, the model has more than it needs.
      The other way round is not: a photo that only just passed, through the
      vision layer, cannot carry a video that shows the whole body — every
      frame's lower half would be invented.
    */
    const refBody = refFacts?.bodyVisibility ?? 0;
    const vidBody = median(frames.filter((f) => f.judged.verdict === "pass").map((f) => f.facts.bodyVisibility ?? 0)) ?? 0;
    if (refBody < tImage.minBodyVisibility && vidBody >= VALIDATION_THRESHOLDS.wholeBodyVideo) {
      compatValid = false;
      errors.add("incompatible_framing");
    }
  }

  return {
    valid: refValid && videoValid && compatValid && errors.size === 0,
    mode,
    referenceImage: {
      valid: refValid,
      faceDetected: refFacts?.faceDetected ?? false,
      faceConfidence: refFacts?.faceConfidence ?? null,
      faceVisibility: refFacts?.faceVisibility ?? null,
      bodyVisibility: need.requiresBody ? (refFacts?.bodyVisibility ?? null) : null,
      faceHeightFrac: refFacts?.faceHeightFrac ?? null,
      sharpness: refFacts?.sharpness ?? null,
    },
    video: {
      valid: videoValid,
      usableFrames,
      sampledFrames: frames.length,
      faceVisibility: median(frames.map((f) => f.facts.faceVisibility).filter((n): n is number => n !== null)),
      bodyVisibility: need.requiresBody ? median(frames.map((f) => f.facts.bodyVisibility).filter((n): n is number => n !== null)) : null,
      faceHeightFrac: median(frames.map((f) => f.facts.faceHeightFrac).filter((n): n is number => n !== null)),
    },
    compatibility: { valid: compatValid, confidence: compatConfidence },
    errors: [...errors],
    warnings: [...warnings],
    ambiguous,
    visionUsed,
  };
}
