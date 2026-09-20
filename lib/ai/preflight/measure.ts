/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the measurements one frame yields, and the derived facts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure. The worker's detectors (server/preflight/detectors.ts) produce a
 * `FrameMeasurement` per image or sampled frame; everything the decision
 * engine reasons about is derived HERE from boxes and scores, so the rules
 * can be tested without a model in the room.
 */

import { BODY_HEIGHTS_PER_FACE, VALIDATION_THRESHOLDS } from "./config";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceDetection {
  score: number;
  box: Box;
  /** The five YuNet landmarks — right eye, left eye, nose, right mouth corner, left mouth corner — in frame pixels. */
  landmarks: readonly [number, number][];
}

export interface PersonDetection {
  score: number;
  box: Box;
}

export interface FrameMeasurement {
  width: number;
  height: number;
  faces: readonly FaceDetection[];
  people: readonly PersonDetection[];
  /** Variance of the Laplacian on a 256px grey render. */
  sharpness: number;
  /** Where in the video this frame was taken (0–1); null for an image. */
  position: number | null;
}

/** What the decision engine reads for one frame. */
export interface FrameFacts {
  width: number;
  height: number;
  faceDetected: boolean;
  faceConfidence: number | null;
  /** Primary face height ÷ frame height. */
  faceHeightFrac: number | null;
  /** 0–1: landmarks inside the frame and inside the box, of five. */
  faceVisibility: number | null;
  /** A second face large enough to compete for "the subject". */
  competingFaces: number;
  /** The face's yaw as a rough sign: the nose's horizontal offset from the eye midpoint, ÷ the inter-eye distance. |x| > 0.6 ≈ strongly turned. */
  faceTurn: number | null;
  personDetected: boolean;
  personConfidence: number | null;
  /** Visible person height ÷ expected whole-body height (BODY_HEIGHTS_PER_FACE × face height), 0–1. Null without a face. */
  bodyVisibility: number | null;
  /** The person box runs off the bottom of the frame (the body continues below it). */
  bodyCroppedBelow: boolean;
  sharpness: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The face the member means: the largest confident one. */
export function primaryFace(m: FrameMeasurement): FaceDetection | null {
  const confident = m.faces.filter((f) => f.score >= VALIDATION_THRESHOLDS.faceDetection);
  if (confident.length === 0) return null;
  return confident.reduce((best, f) => (f.box.h * f.box.w > best.box.h * best.box.w ? f : best));
}

/** The person box that contains (or overlaps) the primary face; else the largest confident person. */
export function primaryPerson(m: FrameMeasurement, face: FaceDetection | null): PersonDetection | null {
  const confident = m.people.filter((p) => p.score >= VALIDATION_THRESHOLDS.bodyDetection);
  if (confident.length === 0) return null;
  if (face) {
    const around = confident.filter((p) => overlaps(p.box, face.box));
    if (around.length) return around.reduce((best, p) => (p.box.h > best.box.h ? p : best));
  }
  return confident.reduce((best, p) => (p.box.h * p.box.w > best.box.h * best.box.w ? p : best));
}

function landmarksVisible(face: FaceDetection, width: number, height: number): number {
  const b = face.box;
  const pad = Math.max(4, b.w * 0.15);
  let n = 0;
  for (const [x, y] of face.landmarks) {
    if (x < 0 || y < 0 || x > width || y > height) continue;
    if (x < b.x - pad || x > b.x + b.w + pad || y < b.y - pad || y > b.y + b.h + pad) continue;
    n++;
  }
  return n;
}

function faceTurn(face: FaceDetection): number | null {
  const [re, le, nose] = face.landmarks;
  if (!re || !le || !nose) return null;
  const midX = (re[0] + le[0]) / 2;
  const eyeDist = Math.abs(le[0] - re[0]);
  if (eyeDist < 1) return null;
  return (nose[0] - midX) / eyeDist;
}

/**
 * Body visibility: how much of a whole body the frame shows, from the person
 * box clipped to the frame against the height a whole body would have.
 * Without a person box but with a face, the frame below the face is the
 * upper bound of what could be visible — counted at a discount, because a
 * detector that saw a face and no person is usually looking at a close-up.
 */
export function bodyVisibilityOf(m: FrameMeasurement, face: FaceDetection | null, person: PersonDetection | null): { ratio: number | null; croppedBelow: boolean } {
  if (!face) return { ratio: null, croppedBelow: false };
  const expected = face.box.h * BODY_HEIGHTS_PER_FACE;
  if (person) {
    const top = Math.max(0, Math.min(person.box.y, face.box.y));
    const bottom = Math.min(m.height, person.box.y + person.box.h);
    const visible = Math.max(0, bottom - top);
    const croppedBelow = person.box.y + person.box.h >= m.height * 0.97;
    return { ratio: clamp01(visible / expected), croppedBelow };
  }
  const visible = Math.max(0, m.height - face.box.y);
  return { ratio: clamp01((visible / expected) * 0.6), croppedBelow: true };
}

export function frameFacts(m: FrameMeasurement): FrameFacts {
  const face = primaryFace(m);
  const person = primaryPerson(m, face);
  const body = bodyVisibilityOf(m, face, person);
  const competing = face ? m.faces.filter((f) => f !== face && f.score >= VALIDATION_THRESHOLDS.faceDetection && f.box.h >= face.box.h * VALIDATION_THRESHOLDS.competingFaceRatio).length : 0;
  return {
    width: m.width,
    height: m.height,
    faceDetected: face !== null,
    faceConfidence: face ? face.score : null,
    faceHeightFrac: face ? face.box.h / m.height : null,
    faceVisibility: face ? landmarksVisible(face, m.width, m.height) / 5 : null,
    competingFaces: competing,
    faceTurn: face ? faceTurn(face) : null,
    personDetected: person !== null,
    personConfidence: person ? person.score : null,
    bodyVisibility: body.ratio,
    bodyCroppedBelow: body.croppedBelow,
    sharpness: m.sharpness,
  };
}
