import { KLING_AUDIO_FOR_VIDEO_INPUT, KLING_OMNI, KLING_OMNI_MODEL_NAME, KLING_VIDEO_RESOLUTIONS, type KlingVideoResolution } from "@/lib/ai/kling/features/capabilities";
import { buildPersonReplacePrompt, describePeople, sanitizePersonDescription, type DetectedPerson } from "@/lib/ai/kling/features/person-replace-prompt";
import { contentItem, promptItem, settingsField, validateMediaUrl, validateReferenceVideoFacts, type KlingVideoFacts } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingFeatureHandler, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE on Kling 3.0 Omni — one or two chosen people, swapped
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The member's group video is sent as Omni's `base_video` (the video to EDIT:
 * its scene, motion and camera kept), each chosen person's photos as
 * `refer_image`, and a server-written instruction that names who to replace
 * (person-replace-prompt.ts). One request, one model, no other vendor.
 *
 *     POST /omni-video/kling-v3-omni
 *     { contents: [ prompt, refer_image × N, base_video ],
 *       settings: { resolution?, audio: original|off, multi_shot: false } }
 *
 * ── WHAT IS PROVEN, AND WHAT IS NOT ────────────────────────────────────────
 *
 * ✅ The request SHAPE was run on this account: base_video + refer_image +
 *    "Replace the woman in <<<video_1>>> with the man in <<<image_1>>>" came
 *    back with that woman replaced in the same scene (task 936598991629459463,
 *    4.5 units for 5 s). The audio rule (`original`) was proven by generation
 *    too (936753170905833539).
 * ⚠️ THIS handler's exact prompt, a group video and a TWO-person replacement
 *    have NOT been run — so `verification` is "fields", not "generation", and
 *    the feature's pricing tiers ship switched OFF (lib/ai/kling/pricing.ts)
 *    until the owner runs the approved paid test.
 *
 * ── THE DOCUMENTED LIMITS THIS ENFORCES (Kling 3.0 Omni API reference) ─────
 *
 *   · one reference video; with it, reference images + multi-image elements
 *     ≤ 4 — so at most 4 photos across both people;
 *   · base video: no first/last frame, no multi-shot, audio never `native`;
 *   · the video's own frame, rate, length and container limits — on facts the
 *     worker measured (`validateReferenceVideoFacts`).
 *
 * Elements are NOT used here: creating one is documented
 * (`POST /v1/general/advanced-custom-elements`, lib/ai/kling/elements.ts) but
 * its cost and latency have never been measured, so it cannot be priced or
 * waited on honestly inside a member's paid request. A single photo per person
 * as `refer_image` is the proven path.
 */

export const PERSON_REPLACE = {
  maxTargets: 2,
  minImagesPerTarget: 1,
  /** "With a reference video + only multi-image elements: reference images + elements ≤ 4." */
  maxImagesTotal: KLING_OMNI.images.maxWithReferenceVideo,
  /** More detected people than this is a crowd; the positional words stop meaning anything. */
  maxPeople: 8,
} as const;

/** The most photos one person may have, given how many people are being replaced. */
export function maxImagesPerTarget(targetCount: number): number {
  return Math.max(PERSON_REPLACE.minImagesPerTarget, Math.floor(PERSON_REPLACE.maxImagesTotal / Math.max(1, targetCount)));
}

export interface KlingPersonReplaceTarget {
  /** The detected person this replaces — an id from `people`. */
  personId: string;
  /** Optional words that tell this person apart ("the man in the blue shirt"). Required when position alone is ambiguous. */
  description?: string;
  /** This person's replacement photos, as URLs Kling can fetch (our own signed storage links). */
  referenceImageUrls: string[];
}

/**
 * 🔴 Every field here is SERVER-TRUSTED by the time a handler sees it: the
 * video URL is re-signed from the inspection token's storage path, the facts
 * and the people come from the worker's signed inspection, and the photo URLs
 * are signed from paths whose ownership was checked (lib/ai/video/resolve-input.ts).
 */
export interface KlingPersonReplaceInput {
  videoUrl: string;
  video: KlingVideoFacts;
  /** Everybody the detector found on the inspection frame. */
  people: DetectedPerson[];
  /** When the inspection frame was taken. */
  frameMs: number;
  targets: KlingPersonReplaceTarget[];
  /** Optional extra changes from Text to Video's prompt box. Placed after the replacement rules, sanitised. */
  instructions?: string;
  options?: {
    resolution?: KlingVideoResolution;
    /** An edit keeps its own sound or has none — never generated sound (Kling's base_video rule). */
    audio?: "original" | "off";
  };
}

const inUnit = (n: number) => Number.isFinite(n) && n >= -0.001 && n <= 1.001;

function validatePeople(people: readonly DetectedPerson[]): KlingValidation {
  if (!Array.isArray(people) || people.length === 0) return invalid("No people were found in this video. Try a clip where everyone is clearly visible.");
  if (people.length > PERSON_REPLACE.maxPeople) return invalid(`This video has too many people to tell apart (${people.length}). Use a clip with ${PERSON_REPLACE.maxPeople} people or fewer.`);
  const ids = new Set<string>();
  for (const p of people) {
    if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id)) return invalid("The people in this video couldn't be read. Check the video again.");
    ids.add(p.id);
    const b = p.box;
    if (!b || !inUnit(b.x) || !inUnit(b.y) || !(b.w > 0) || !(b.h > 0) || !inUnit(b.x + b.w) || !inUnit(b.y + b.h)) return invalid("The people in this video couldn't be read. Check the video again.");
  }
  return ok;
}

export const klingPersonReplace: KlingFeatureHandler<KlingPersonReplaceInput> = {
  id: "full_character",
  label: "Character Replace",
  available: true,
  unavailableReason: null,
  verification: "fields",
  model: KLING_OMNI_MODEL_NAME,

  validate(input) {
    const url = validateMediaUrl(input.videoUrl, "The video");
    if (!url.ok) return url;
    if (!input.video) return invalid("This video needs to be checked before it can be used. Choose it again.");
    const facts = validateReferenceVideoFacts(input.video);
    if (!facts.ok) return facts;
    const people = validatePeople(input.people);
    if (!people.ok) return people;

    const targets = input.targets ?? [];
    if (targets.length === 0) return invalid("Tap the person you want to replace.");
    if (targets.length > PERSON_REPLACE.maxTargets) return invalid(`You can replace up to ${PERSON_REPLACE.maxTargets} people in one video.`);

    const known = new Set(input.people.map((p) => p.id));
    const descriptors = describePeople(input.people);
    const chosen = new Set<string>();
    const urls = new Set<string>();
    let total = 0;
    const perTarget = maxImagesPerTarget(targets.length);
    for (const [i, t] of targets.entries()) {
      const name = targets.length > 1 ? `Person ${i === 0 ? "A" : "B"}` : "The person you chose";
      if (!t || !known.has(t.personId)) return invalid("That person isn't in this video any more. Choose them again.");
      if (chosen.has(t.personId)) return invalid("The same person was chosen twice.");
      chosen.add(t.personId);
      const images = Array.isArray(t.referenceImageUrls) ? t.referenceImageUrls : [];
      if (images.length < PERSON_REPLACE.minImagesPerTarget) return invalid(`${name} needs a photo of who should replace them.`);
      if (images.length > perTarget) return invalid(`${name} can have up to ${perTarget} photo${perTarget === 1 ? "" : "s"}.`);
      for (const u of images) {
        const v = validateMediaUrl(u, `A photo for ${name.toLowerCase()}`);
        if (!v.ok) return v;
        // one photo cannot be two people — and a repeated photo is a wasted slot
        if (urls.has(u)) return invalid("The same photo is attached more than once. Each person needs their own photos.");
        urls.add(u);
      }
      total += images.length;
      /*
        🔴 Position is the only thing the model is told about WHICH person. Two
        people standing in the same place cannot be told apart by it, so the
        member's own words become required — otherwise the swap is a coin flip.
      */
      if (descriptors.get(t.personId)?.ambiguous && !sanitizePersonDescription(t.description)) {
        return invalid(`${name} is standing very close to someone else. Add a short description (for example "the man in the blue shirt") so the right person is replaced.`);
      }
    }
    if (total > PERSON_REPLACE.maxImagesTotal) return invalid(`A video can take up to ${PERSON_REPLACE.maxImagesTotal} photos in all.`);
    if (typeof input.instructions === "string" && input.instructions.length > KLING_OMNI.prompt.maxChars) return invalid(`The description is longer than ${KLING_OMNI.prompt.maxChars} characters.`);

    const o = input.options;
    if (o?.resolution !== undefined && !(KLING_VIDEO_RESOLUTIONS as readonly string[]).includes(o.resolution)) return invalid("That quality isn't one this engine offers.");
    if (o?.audio !== undefined && !(KLING_AUDIO_FOR_VIDEO_INPUT.base as readonly string[]).includes(o.audio)) return invalid("Generated sound can't be added when editing a video. Keep the video's sound, or choose No sound.");
    return ok;
  },

  buildRequest(input) {
    const prompt = buildPersonReplacePrompt({
      people: input.people,
      frameMs: input.frameMs,
      targets: input.targets.map((t) => ({ personId: t.personId, description: t.description ?? null, imageCount: t.referenceImageUrls.length })),
      instructions: input.instructions ?? null,
    });
    /*
      🔴 Target A's photos, then target B's — exactly the order `referenceLayout`
      numbers them in the prompt (<<<image_1>>> is the first refer_image sent).
      person-replace.test.ts asserts the two agree.
    */
    const contents: Record<string, unknown>[] = [promptItem(prompt)];
    for (const t of input.targets) for (const url of t.referenceImageUrls) contents.push(contentItem("refer_image", { url }));
    contents.push(contentItem("base_video", { url: input.videoUrl }));

    // no duration (an edit is the clip's own length) and no aspect ratio (the video defines it)
    const settings = settingsField({ resolution: input.options?.resolution, audio: input.options?.audio });
    // "It does not support generating multi-shot videos" — and the model defaults it on
    settings.multi_shot = false;
    return { contents, settings };
  },
};
