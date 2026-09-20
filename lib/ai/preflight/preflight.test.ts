import { beforeAll, describe, expect, it } from "vitest";

import { MEDIA_VALIDATION_CONFIG, PREFLIGHT_ERROR_CODES, VALIDATION_THRESHOLDS } from "./config";
import { ambiguityTargets, decidePreflight, type PreflightMediaInput, type VisionJudgement } from "./decision";
import { bodyVisibilityOf, frameFacts, primaryFace, type FaceDetection, type FrameMeasurement, type PersonDetection } from "./measure";
import { preflightChecklist, preflightHeadline, preflightIssues } from "./messages";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the decision engine, on measurements shaped like real ones
 * ═══════════════════════════════════════════════════════════════════════════
 * The fixtures are the numbers the detectors gave on real uploads on
 * 2026-09-20 (scripts/_preflight-proto.tmp.mjs): a phone portrait, an
 * interview frame, a full-body frame — so a threshold that moves is caught
 * against what members actually send.
 */

/** A frame with one face of `faceH` px and a person box of `personH` px starting at the face's top. */
function frame(opts: { w?: number; h?: number; faceH?: number | null; faceScore?: number; personH?: number | null; personScore?: number; sharp?: number; position?: number | null; extraFaceH?: number; landmarksOut?: number }): FrameMeasurement {
  const w = opts.w ?? 1080;
  const h = opts.h ?? 1920;
  const faces: FaceDetection[] = [];
  if (opts.faceH) {
    const fh = opts.faceH;
    const fw = fh * 0.78;
    const x = (w - fw) / 2;
    const y = h * 0.15;
    const inside: [number, number][] = [
      [x + fw * 0.3, y + fh * 0.4],
      [x + fw * 0.7, y + fh * 0.4],
      [x + fw * 0.5, y + fh * 0.6],
      [x + fw * 0.35, y + fh * 0.8],
      [x + fw * 0.65, y + fh * 0.8],
    ];
    const landmarks = inside.map((p, i) => (i < (opts.landmarksOut ?? 0) ? ([-100, -100] as [number, number]) : p));
    faces.push({ score: opts.faceScore ?? 0.93, box: { x, y, w: fw, h: fh }, landmarks });
    if (opts.extraFaceH) faces.push({ score: 0.9, box: { x: 10, y: 10, w: opts.extraFaceH * 0.78, h: opts.extraFaceH }, landmarks: inside });
  }
  const people: PersonDetection[] = [];
  if (opts.personH && opts.faceH) people.push({ score: opts.personScore ?? 0.9, box: { x: w * 0.1, y: h * 0.15, w: w * 0.8, h: opts.personH } });
  return { width: w, height: h, faces, people, sharpness: opts.sharp ?? 80, position: opts.position ?? null };
}

/** Real shapes: the portrait photo (face 29 % of the frame, half body) and a full-body shot (face 8 %, whole body in frame). */
const PORTRAIT = () => frame({ w: 1080, h: 1440, faceH: 414, personH: 1198 });
const SELFIE = () => frame({ w: 1080, h: 1440, faceH: 620, personH: 1200 });
const FULL_BODY = () => frame({ w: 1080, h: 1920, faceH: 150, personH: 1120 });
const INTERVIEW = (position: number) => frame({ w: 720, h: 900, faceH: 394, personH: 838, position });
const WIDE = (position: number) => frame({ w: 1080, h: 1920, faceH: 140, personH: 1040, position });
const video = { width: 1080, height: 1920, durationMs: 10_000 };

describe("measure — what the boxes mean", () => {
  it("the primary face is the largest confident one; body visibility is the person box against 7.5 face heights", () => {
    const m = PORTRAIT();
    const face = primaryFace(m)!;
    expect(face.box.h).toBe(414);
    const body = bodyVisibilityOf(m, face, m.people[0]!);
    // 1198 visible of 7.5 × 414 = 3105 expected → ~0.39, and the person runs off the bottom
    expect(body.ratio).toBeCloseTo(0.39, 1);
    expect(body.croppedBelow).toBe(true);
    const facts = frameFacts(m);
    expect(facts.faceHeightFrac).toBeCloseTo(0.2875, 3);
    expect(facts.faceVisibility).toBe(1);
    expect(facts.competingFaces).toBe(0);
  });
  it("a face below the detector's confidence is not a face; a person without a face gives no body figure", () => {
    expect(primaryFace(frame({ faceH: 300, faceScore: 0.5 }))).toBeNull();
    const facts = frameFacts(frame({ faceH: null }));
    expect(facts.faceDetected).toBe(false);
    expect(facts.bodyVisibility).toBeNull();
  });
  it("a full-body frame reads as one", () => {
    const facts = frameFacts(FULL_BODY());
    expect(facts.faceHeightFrac).toBeCloseTo(0.078, 2);
    expect(facts.bodyVisibility!).toBeGreaterThan(0.9);
    expect(facts.bodyCroppedBelow).toBe(false);
  });
});

describe("decide — Face Only", () => {
  it("a portrait photo and an interview video pass; the result is structured as the brief shows", () => {
    const r = decidePreflight({ image: PORTRAIT(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(INTERVIEW), video }, "face_only");
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.referenceImage).toMatchObject({ valid: true, faceDetected: true, bodyVisibility: null });
    expect(r.referenceImage.faceConfidence).toBeCloseTo(0.93, 2);
    expect(r.video).toMatchObject({ valid: true, usableFrames: 6, sampledFrames: 6, bodyVisibility: null });
    expect(r.compatibility.valid).toBe(true);
    expect(r.compatibility.confidence).toBeCloseTo(0.93, 2);
  });
  it("no face in the photo → reference_face_not_detected, and nothing else is guessed", () => {
    const r = decidePreflight({ image: frame({ faceH: null }), frames: [INTERVIEW(0.5)], video }, "face_only");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("reference_face_not_detected");
    expect(r.referenceImage.faceDetected).toBe(false);
  });
  it("a tiny face, an obstructed face, two competing faces, a blurred photo — each names itself", () => {
    expect(decidePreflight({ image: frame({ faceH: 60 }), frames: [INTERVIEW(0.5)], video }, "face_only").errors).toContain("reference_face_too_small");
    expect(decidePreflight({ image: frame({ faceH: 400, landmarksOut: 2 }), frames: [INTERVIEW(0.5)], video }, "face_only").errors).toContain("reference_face_obstructed");
    expect(decidePreflight({ image: frame({ faceH: 400, extraFaceH: 380 }), frames: [INTERVIEW(0.5)], video }, "face_only").errors).toContain("reference_multiple_faces");
    expect(decidePreflight({ image: frame({ faceH: 400, sharp: 4 }), frames: [INTERVIEW(0.5)], video }, "face_only").errors).toContain("reference_too_blurry");
    // a much smaller second face is not a competitor — a warning at most
    const r = decidePreflight({ image: frame({ faceH: 400, extraFaceH: 90 }), frames: [INTERVIEW(0.5)], video }, "face_only");
    expect(r.valid).toBe(true);
    expect(r.warnings).toContain("reference_extra_faces");
  });
  it("🔴 one bad frame never fails a video (brief §22): five of six usable passes with a warning; two of six fails and names the reason", () => {
    const frames = [INTERVIEW(0.02), INTERVIEW(0.2), INTERVIEW(0.4), frame({ w: 720, h: 900, faceH: null, position: 0.6 }), INTERVIEW(0.8), INTERVIEW(0.95)];
    const r = decidePreflight({ image: PORTRAIT(), frames, video }, "face_only");
    expect(r.valid).toBe(true);
    expect(r.video.usableFrames).toBe(5);
    expect(r.warnings).toContain("video_face_sometimes_hidden");
    const mostlyGone = [INTERVIEW(0.02), INTERVIEW(0.2), ...[0.4, 0.6, 0.8, 0.95].map((p) => frame({ w: 720, h: 900, faceH: null, position: p }))];
    const bad = decidePreflight({ image: PORTRAIT(), frames: mostlyGone, video }, "face_only");
    expect(bad.valid).toBe(false);
    expect(bad.errors).toContain("video_subject_leaves_frame");
  });
  it("an unreadable file is said plainly", () => {
    expect(decidePreflight({ image: null, frames: [], video: null }, "face_only").errors).toEqual(expect.arrayContaining(["reference_unreadable", "video_unreadable"]));
    expect(decidePreflight({ image: PORTRAIT(), frames: [], video }, "face_only").errors).toContain("video_no_frames");
    expect(decidePreflight({ image: frame({ w: 200, h: 200, faceH: 80 }), frames: [INTERVIEW(0.5)], video }, "face_only").errors).toContain("reference_too_small");
  });
});

describe("decide — Full Character: a selfie must NOT pass (brief §3)", () => {
  it("a close-up selfie is refused as a close-up; a half-body portrait as not enough body", () => {
    const selfie = decidePreflight({ image: SELFIE(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character");
    expect(selfie.valid).toBe(false);
    expect(selfie.errors).toContain("reference_close_up");
    expect(selfie.referenceImage.bodyVisibility).not.toBeNull();
    const portrait = decidePreflight({ image: PORTRAIT(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character");
    expect(portrait.valid).toBe(false);
    // 0.39 sits in the ambiguous band (0.40–0.55)? no — just under it: a plain refusal
    expect(portrait.errors).toContain("reference_body_not_visible");
  });
  it("a full-body photo and wide footage pass, with the body figures reported", () => {
    const r = decidePreflight({ image: FULL_BODY(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character");
    expect(r.valid).toBe(true);
    expect(r.referenceImage.bodyVisibility!).toBeGreaterThan(0.55);
    expect(r.video.bodyVisibility!).toBeGreaterThan(0.5);
  });
  it("wide footage for a full-body photo, but an interview video → the video is refused, and the pairing named", () => {
    const r = decidePreflight({ image: FULL_BODY(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(INTERVIEW), video }, "full_character");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("video_close_up");
  });
  it("the same portrait passes Face Only and Skin + Face — the mode decides, not the file", () => {
    const frames = [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(INTERVIEW);
    expect(decidePreflight({ image: PORTRAIT(), frames, video }, "face_only").valid).toBe(true);
    expect(decidePreflight({ image: PORTRAIT(), frames, video }, "skin_face").valid).toBe(true);
    expect(decidePreflight({ image: PORTRAIT(), frames, video }, "full_character").valid).toBe(false);
  });
});

describe("decide — the ambiguous band and the vision layer (brief §19–§20)", () => {
  // body visibility ≈ 0.47: between Full Character's ambiguous floor (0.40) and its bar (0.55)
  const borderline = () => frame({ w: 1080, h: 1920, faceH: 240, personH: 850 });
  // a hips-up video (body visibility ~0.6): passes Full Character on its own, and is what a borderline photo can carry
  const HIPS_UP = (position: number) => frame({ w: 1080, h: 1920, faceH: 200, personH: 900, position });
  const say = (usable: boolean, confidence = 0.9): VisionJudgement => ({ usable, confidence, subjectType: usable ? "full_body" : "half_body", faceVisibility: "clear", bodyVisibility: usable ? "sufficient" : "partial", obstruction: "low", recommendation: usable ? "pass" : "reject" });
  it("names the side that needs the vision layer, and only that side", () => {
    expect(ambiguityTargets({ image: borderline(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character")).toEqual(["reference"]);
    expect(ambiguityTargets({ image: FULL_BODY(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character")).toEqual([]);
    expect(ambiguityTargets({ image: borderline(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "face_only")).toEqual([]);
  });
  it("🔴 the model's word is an input, never the verdict: a confident pass passes, a reject rejects, a low-confidence answer is ignored and the rules refuse", () => {
    const input: PreflightMediaInput = { image: borderline(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(HIPS_UP), video };
    const withoutVision = decidePreflight(input, "full_character");
    expect(withoutVision.valid).toBe(false);
    expect(withoutVision.ambiguous).toBe(true);
    expect(withoutVision.visionUsed).toBe(false);
    const passed = decidePreflight({ ...input, vision: { reference: say(true), video: null } }, "full_character");
    expect(passed.valid).toBe(true);
    expect(passed.visionUsed).toBe(true);
    expect(passed.warnings).toContain("vision_layer_used");
    const rejected = decidePreflight({ ...input, vision: { reference: say(false), video: null } }, "full_character");
    expect(rejected.valid).toBe(false);
    expect(rejected.errors).toContain("reference_body_not_visible");
    const unsure = decidePreflight({ ...input, vision: { reference: say(true, 0.4), video: null } }, "full_character");
    expect(unsure.valid).toBe(false);
    expect(unsure.visionUsed).toBe(false);
  });
  it("compatibility is directional: a borderline photo passed by the vision layer cannot carry a whole-body video; a full-body photo with a hips-up video is fine", () => {
    const wide = decidePreflight({ image: borderline(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video, vision: { reference: say(true), video: null } }, "full_character");
    expect(wide.valid).toBe(false);
    expect(wide.errors).toEqual(["incompatible_framing"]);
    expect(wide.compatibility.valid).toBe(false);
    const generous = decidePreflight({ image: FULL_BODY(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(HIPS_UP), video }, "full_character");
    expect(generous.valid).toBe(true);
    expect(preflightChecklist(wide).find((c) => c.key === "compatibility")?.state).toBe("fail");
  });
});

describe("the words", () => {
  it("every error code has a sentence, a target and a headline per mode; the checklist follows the result", () => {
    for (const code of PREFLIGHT_ERROR_CODES) {
      const issue = preflightIssues({ ...decidePreflight({ image: null, frames: [], video: null }, "face_only"), errors: [code] })[0]!;
      expect(issue.title.length).toBeGreaterThan(5);
      expect(issue.body).not.toMatch(/threshold|ratio|_/);
      expect(["reference", "video", "both"]).toContain(issue.target);
    }
    for (const mode of ["face_only", "skin_face", "full_character"] as const) expect(preflightHeadline(mode).title).toContain("isn't suitable");
    const pass = preflightChecklist(decidePreflight({ image: FULL_BODY(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character"));
    expect(pass.every((c) => c.state === "pass")).toBe(true);
    const faceOnlyPass = preflightChecklist(decidePreflight({ image: PORTRAIT(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(INTERVIEW), video }, "face_only"));
    expect(faceOnlyPass.find((c) => c.key === "body")?.state).toBe("skip");
    const selfie = preflightChecklist(decidePreflight({ image: SELFIE(), frames: [0.02, 0.2, 0.4, 0.6, 0.8, 0.95].map(WIDE), video }, "full_character"));
    expect(selfie.find((c) => c.key === "body")?.state).toBe("fail");
  });
  it("the mode table and the thresholds are the one place the rules live", () => {
    expect(MEDIA_VALIDATION_CONFIG.full_character.requiresFullBody).toBe(true);
    expect(MEDIA_VALIDATION_CONFIG.face_only.requiresBody).toBe(false);
    expect(VALIDATION_THRESHOLDS.image.full_character.minBodyVisibility!).toBeGreaterThan(VALIDATION_THRESHOLDS.image.skin_face.minBodyVisibility!);
    expect(VALIDATION_THRESHOLDS.videoSamplePositions).toHaveLength(6);
  });
});

describe("the token and the gate (server-only, signed with the quote key)", () => {
  let token: typeof import("./token");
  let gate: typeof import("./gate");
  beforeAll(async () => {
    process.env.AI_QUOTE_SIGNING_SECRET = "test-signing-key";
    token = await import("./token");
    gate = await import("./gate");
  });
  const objects = { reference: { size: 96_859, mimeType: "image/jpeg", etag: '"abc"' }, video: { size: 3_575_924, mimeType: "video/mp4", etag: '"def"' } };
  const claims = () => ({ jobId: "job-1", userId: "user-1", mode: "face_only" as const, reference: token.objectFingerprint(objects.reference), video: token.objectFingerprint(objects.video) });
  it("a signed pass verifies for the same job, member, mode and files — and for nothing else", () => {
    const { token: t } = token.signPreflightToken(claims());
    expect(token.verifyPreflightToken(t, claims()).ok).toBe(true);
    expect(token.verifyPreflightToken(t, { ...claims(), mode: "full_character" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(token.verifyPreflightToken(t, { ...claims(), video: "1:x" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(token.verifyPreflightToken(t, { ...claims(), userId: "user-2" })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(token.verifyPreflightToken(t.slice(0, -2) + "zz", claims())).toMatchObject({ ok: false, reason: "signature" });
    expect(token.verifyPreflightToken("nonsense", claims())).toMatchObject({ ok: false, reason: "malformed" });
    const { token: old } = token.signPreflightToken({ ...claims(), expiresAt: Date.now() - 1 });
    expect(token.verifyPreflightToken(old, claims())).toMatchObject({ ok: false, reason: "expired" });
  });
  it("🔴 Start's gate: no record, a failed record, other files, or a missing/forged token — each refused; the real pass goes through", () => {
    const record = (valid: boolean, media = { reference: token.objectFingerprint(objects.reference), video: token.objectFingerprint(objects.video) }) => ({
      preflight: { version: 1, mode: "face_only", checkedAt: new Date().toISOString(), durationMs: 1, media, hashes: null, result: { ...decidePreflight({ image: PORTRAIT(), frames: [INTERVIEW(0.5)], video }, "face_only"), valid }, measurements: null },
    });
    const { token: t } = token.signPreflightToken(claims());
    const base = { jobId: "job-1", userId: "user-1", mode: "face_only" as const, reference: objects.reference, video: objects.video };
    expect(gate.preflightGate({ ...base, metadata: {}, token: t }).ok).toBe(false);
    expect(gate.preflightGate({ ...base, metadata: record(false), token: t }).ok).toBe(false);
    expect(gate.preflightGate({ ...base, metadata: record(true, { reference: "9:other", video: "9:other" }), token: t }).ok).toBe(false);
    expect(gate.preflightGate({ ...base, metadata: record(true), token: undefined }).ok).toBe(false);
    expect(gate.preflightGate({ ...base, metadata: record(true), token: t + "x" }).ok).toBe(false);
    expect(gate.preflightGate({ ...base, metadata: record(true), token: t }).ok).toBe(true);
    // a replaced video: the object's fingerprint moved, the stored record no longer matches
    expect(gate.preflightGate({ ...base, video: { ...objects.video, etag: '"changed"' }, metadata: record(true), token: t }).ok).toBe(false);
  });
});
