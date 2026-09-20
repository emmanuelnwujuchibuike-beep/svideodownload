/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — what a member reads (brief §9, §10, §17)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Never a code, never a threshold. "This media may produce a poor result
 * with Full Character" — a help, not a verdict on the file. Every sentence
 * names what to change; every list is something a phone can do now.
 */

import { REPLACEMENT_MODE_COPY, type ReplacementMode } from "@/lib/ai/character-replace/modes";

import type { PreflightErrorCode, PreflightWarningCode } from "./config";
import type { PreflightResult } from "./decision";

export interface PreflightIssue {
  code: PreflightErrorCode;
  /** Which file to change. */
  target: "reference" | "video" | "both";
  title: string;
  body: string;
}

const ISSUE: Record<PreflightErrorCode, Omit<PreflightIssue, "code">> = {
  reference_unreadable: { target: "reference", title: "We couldn't read the photo", body: "The file opened, but no image came out of it. Choose the photo again, or a different one." },
  reference_too_small: { target: "reference", title: "The photo is very small", body: "A tiny photo gives the model too little to work with. Use one at least a few hundred pixels on its short side." },
  reference_face_not_detected: { target: "reference", title: "No face found in the photo", body: "Use a clear photo of the person's face — a well-lit selfie or portrait usually works best." },
  reference_face_too_small: { target: "reference", title: "The face is very small in the photo", body: "Move closer or crop in so the face fills more of the frame." },
  reference_face_obstructed: { target: "reference", title: "Part of the face is hidden", body: "Eyes, nose and mouth should all be visible — no sunglasses, hands or heavy shadow across them." },
  reference_multiple_faces: { target: "reference", title: "More than one face in the photo", body: "We can't tell which person you mean. Use a photo with just the one person." },
  reference_too_blurry: { target: "reference", title: "The photo is too blurry", body: "A sharp photo carries the detail the face needs. Use one taken in good light, held still." },
  reference_body_not_visible: { target: "reference", title: "Not enough of the body is visible", body: "This mode needs more than the face. Use a photo where the body is visible — ideally from the head down to at least the hips." },
  reference_close_up: { target: "reference", title: "The photo is a close-up", body: "Full Character needs the whole person. A face-only photo can't tell the model what the body looks like — use a full-body or near-full-body photo." },
  video_unreadable: { target: "video", title: "We couldn't read the video", body: "The file opened, but no frames came out of it. Choose the video again, or try a different one." },
  video_no_frames: { target: "video", title: "We couldn't read the video", body: "No frames could be taken from it. Choose the video again, or try a different one." },
  video_face_not_detected: { target: "video", title: "No face found in the video", body: "The person's face needs to be visible on screen. Use a video where they face the camera for most of it." },
  video_face_too_small: { target: "video", title: "The face is very small in the video", body: "From this far away there isn't enough face to replace. Use a video shot closer to the person, or trim to the part where they are nearer." },
  video_face_obstructed: { target: "video", title: "The face is often hidden in the video", body: "Eyes, nose and mouth need to be visible for most of it — no hands, masks or heavy shadow across the face." },
  video_subject_leaves_frame: { target: "video", title: "The person keeps leaving the frame", body: "The face is missing for too much of the video. Trim to the part where they stay in view, or use a steadier video." },
  video_too_blurry: { target: "video", title: "The video is too blurry", body: "Most of the sampled frames are soft. Use a sharper video, or one with less motion." },
  video_body_not_visible: { target: "video", title: "Not enough of the body is visible in the video", body: "This mode needs more than the face. Use a video where most of the person stays in view." },
  video_close_up: { target: "video", title: "The video is a close-up", body: "Full Character needs the whole person on screen. A face-only video can't carry a full-body character — use footage shot further back." },
  incompatible_framing: { target: "reference", title: "The photo shows less of the person than the video does", body: "The video shows the whole body, but the photo stops higher up — the rest would have to be invented. For Full Character, use a photo that shows about as much of the person as the video does." },
  validator_unavailable: { target: "both", title: "We couldn't check your media just now", body: "Nothing was charged. Try again in a moment." },
};

const WARNING: Record<PreflightWarningCode, string> = {
  reference_face_angled: "The face is turned quite far from the camera — a front-facing photo usually gives a closer likeness.",
  reference_soft: "The photo is a little soft; a sharper one may give more detail.",
  video_face_sometimes_hidden: "The face is hidden for part of the video — those moments may look less convincing.",
  video_soft: "Some of the video is soft; the result will match it.",
  vision_layer_used: "The framing was borderline, so we looked at it more closely before saying yes.",
  reference_extra_faces: "Other, smaller faces are in the photo — the largest one is used.",
};

/** Brief §10: what to try, per mode, per file. */
export const PREFLIGHT_TIPS: Record<ReplacementMode, { reference: readonly string[]; video: readonly string[] }> = {
  face_only: {
    reference: ["A clear, well-lit photo of the face", "Looking towards the camera", "No sunglasses or hands over the face", "Just the one person"],
    video: ["The face stays visible for most of the video", "Not too far from the camera", "Steady, in reasonable light"],
  },
  skin_face: {
    reference: ["A clear face, with some neck and shoulders visible", "Good light, looking towards the camera", "Just the one person"],
    video: ["The face and upper body stay in view", "Not too far from the camera", "Reasonable light and a steady shot"],
  },
  upper_body: {
    reference: ["Chest or waist up, facing the camera, the top you wear clearly visible", "Good light, no hat or sunglasses", "Just the one person"],
    video: ["Framed from the waist up, the person in view throughout", "Not too far from the camera", "Reasonable light and a steady shot"],
  },
  full_character: {
    reference: ["A full-body or near-full-body photo", "Head and body both visible", "Avoid tight crops and close-up selfies", "Good light, the person large in the frame"],
    video: ["Most of the person stays in view", "Shot far enough back to show the body", "Not heavily obstructed"],
  },
};

/** The headline sentence of a failed preflight for a mode (brief §9). */
export function preflightHeadline(mode: ReplacementMode): { title: string; body: string } {
  const label = REPLACEMENT_MODE_COPY[mode].label;
  switch (mode) {
    case "face_only":
      return { title: `Your media isn't suitable for ${label} yet`, body: "Use a clear reference photo showing the person's face and a video where the face stays clearly visible. A well-lit selfie or portrait usually works best." };
    case "skin_face":
      return { title: `Your media isn't suitable for ${label} yet`, body: "The face and the head aren't visible clearly enough. Try a clearer head-and-shoulders reference photo and a video with the person's face and head in view." };
    case "upper_body":
      return { title: `Your media isn't suitable for ${label} yet`, body: "The face and the upper body aren't visible clearly enough. Use a chest- or waist-up reference photo and a video framed from the waist up with the person in view." };
    case "full_character":
      return { title: `Your media isn't suitable for ${label} yet`, body: "The person needs to be clearly visible beyond the face. Use a full-body or near-full-body reference photo and a video where most of the character stays in view." };
  }
}

export function preflightIssues(result: PreflightResult): PreflightIssue[] {
  return result.errors.map((code) => ({ code, ...ISSUE[code] }));
}

export function preflightWarnings(result: PreflightResult): string[] {
  return result.warnings.map((w) => WARNING[w]);
}

/** The checklist the interface draws (brief §11), from the result alone. */
export interface PreflightCheck {
  key: "reference" | "face" | "body" | "video" | "subject" | "compatibility";
  label: string;
  state: "pass" | "fail" | "skip";
}

export function preflightChecklist(result: PreflightResult): PreflightCheck[] {
  const needsBody = result.mode !== "face_only";
  const e = new Set(result.errors);
  const refRead = !e.has("reference_unreadable") && !e.has("reference_too_small");
  const vidRead = !e.has("video_unreadable") && !e.has("video_no_frames");
  const faceIssue = [...e].some((c) => /face|multiple|blurry|close_up/.test(c) && c.startsWith("reference"));
  const bodyIssue = e.has("reference_body_not_visible") || e.has("reference_close_up") || e.has("video_body_not_visible") || e.has("video_close_up");
  const subjectIssue = [...e].some((c) => c.startsWith("video_") && c !== "video_unreadable" && c !== "video_no_frames" && c !== "video_too_blurry");
  return [
    { key: "reference", label: "Reference photo", state: refRead ? "pass" : "fail" },
    { key: "face", label: "Face detected", state: !refRead ? "skip" : faceIssue ? "fail" : "pass" },
    { key: "body", label: "Body visibility", state: !needsBody ? "skip" : !refRead && !vidRead ? "skip" : bodyIssue ? "fail" : "pass" },
    { key: "video", label: "Video quality", state: vidRead ? (e.has("video_too_blurry") ? "fail" : "pass") : "fail" },
    { key: "subject", label: "Subject visibility", state: !vidRead ? "skip" : subjectIssue ? "fail" : "pass" },
    { key: "compatibility", label: "Model compatibility", state: result.valid ? "pass" : e.has("incompatible_framing") ? "fail" : result.referenceImage.valid && result.video.valid ? "pass" : "skip" },
  ];
}
