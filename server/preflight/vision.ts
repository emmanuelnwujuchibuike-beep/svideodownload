import "server-only";

import { PREFLIGHT_VISION } from "@/lib/ai/preflight/config";
import type { VisionJudgement } from "@/lib/ai/preflight/decision";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREFLIGHT — the vision layer, for the AMBIGUOUS band only (brief §19 layer 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When the measurements land between "clearly enough" and "clearly not"
 * (config.ts `ambiguousBodyVisibility`…`minBodyVisibility`), a capable
 * vision model is shown the frame(s) and asked one structured question. It
 * answers JSON; FrenzSave's decision engine then decides (decision.ts) —
 * the model's "pass" is one input, never the verdict, and an answer below
 * `ambiguousVision` confidence is ignored.
 *
 * On Replicate (openai/gpt-4.1-nano, `image_input`), the same token as every
 * other model; synchronous with a hard timeout; never called when the rules
 * already decided (brief §24). The images are short-lived signed URLs of the
 * member's own uploads — no third party gets them otherwise.
 */

const ENDPOINT = `https://api.replicate.com/v1/models/${PREFLIGHT_VISION.model}/predictions`;

const SYSTEM = `You judge whether a photo or video frame gives an AI character-replacement model enough visual information. Answer ONLY a JSON object with these keys: usable (boolean), confidence (0-1), subjectType (one of "face_close_up","half_body","full_body","no_person","unclear"), faceVisibility ("clear","partial","hidden"), bodyVisibility ("sufficient","partial","insufficient"), obstruction ("low","medium","high"), recommendation ("pass","reject"). No prose.`;

function question(mode: ReplacementMode, target: "reference" | "video"): string {
  const what = target === "reference" ? "the reference photo" : "frames sampled from the source video";
  switch (mode) {
    case "full_character":
      return `Mode: Full Character (the whole person — face, body and clothes — is replaced). Looking at ${what}: is enough of the person's body visible (head to at least the hips, ideally the knees or below) for that, and is the person clearly the subject and not heavily obstructed? A close-up of a face or head-and-shoulders is NOT enough. Be strict about the body, lenient about pose, clothing, lighting and angle.`;
    case "upper_body":
      return `Mode: Upper Body (the face, head, torso and upper-body appearance are replaced; the scene stays). Looking at ${what}: is the face clearly visible and is the upper body (head to at least the chest, ideally the waist) in view and not heavily obstructed? A face crop alone is NOT enough; the legs are not required. Be lenient about pose, lighting and angle.`;
    case "skin_face":
      return `Mode: Face + Head (the face, identity and skin — the head's appearance — are replaced; the body and clothes stay). Looking at ${what}: is the face clearly visible and is there some visible skin or upper body (neck, shoulders, arms) to work with, without heavy obstruction? Be lenient about pose, clothing, lighting and angle.`;
    case "face_only":
      return `Mode: Face Only (only the face is replaced). Looking at ${what}: is a human face clearly visible, large enough and not heavily obstructed? Be lenient about everything else.`;
  }
}

export function parseVisionAnswer(text: string): VisionJudgement | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const one = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
    const subjectType = one(j.subjectType, ["face_close_up", "half_body", "full_body", "no_person", "unclear"] as const);
    const faceVisibility = one(j.faceVisibility, ["clear", "partial", "hidden"] as const);
    const bodyVisibility = one(j.bodyVisibility, ["sufficient", "partial", "insufficient"] as const);
    const obstruction = one(j.obstruction, ["low", "medium", "high"] as const);
    const recommendation = one(j.recommendation, ["pass", "reject"] as const);
    const confidence = typeof j.confidence === "number" && Number.isFinite(j.confidence) ? Math.max(0, Math.min(1, j.confidence)) : null;
    if (typeof j.usable !== "boolean" || confidence === null || !subjectType || !faceVisibility || !bodyVisibility || !obstruction || !recommendation) return null;
    return { usable: j.usable, confidence, subjectType, faceVisibility, bodyVisibility, obstruction, recommendation };
  } catch {
    return null;
  }
}

/** Null when the layer is off, unconfigured, timed out or answered nothing usable — the rules then decide without it. */
export async function askVision(opts: { mode: ReplacementMode; target: "reference" | "video"; imageUrls: string[] }): Promise<VisionJudgement | null> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!PREFLIGHT_VISION.enabled || !token || opts.imageUrls.length === 0) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: `wait=${Math.floor(PREFLIGHT_VISION.timeoutMs / 1000)}` },
      body: JSON.stringify({ input: { prompt: question(opts.mode, opts.target), system_prompt: SYSTEM, image_input: opts.imageUrls.slice(0, PREFLIGHT_VISION.maxFrames + 1), temperature: 0, max_completion_tokens: 200 } }),
      signal: AbortSignal.timeout(PREFLIGHT_VISION.timeoutMs + 5_000),
    });
    if (!res.ok) {
      console.warn("[preflight/vision] refused", { status: res.status, target: opts.target });
      return null;
    }
    const body = (await res.json()) as { status?: string; output?: unknown };
    const text = Array.isArray(body.output) ? body.output.join("") : typeof body.output === "string" ? body.output : "";
    if (body.status !== "succeeded" || !text) return null;
    return parseVisionAnswer(text);
  } catch (e) {
    console.warn("[preflight/vision] failed", { target: opts.target, error: String(e).slice(0, 160) });
    return null;
  }
}
