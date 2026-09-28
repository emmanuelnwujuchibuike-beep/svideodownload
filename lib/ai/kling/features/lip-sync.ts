import { KLING_LIP_SYNC_PATH } from "@/lib/ai/kling/config";
import { KLING_LIP_SYNC, type KlingLipSyncVoiceLanguage } from "@/lib/ai/kling/features/capabilities";
import { validateMediaUrl } from "@/lib/ai/kling/features/shared";
import { invalid, ok, type KlingFeatureHandler, type KlingValidation } from "@/lib/ai/kling/features/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING LIP SYNC — its OWN endpoint, its OWN model, its OWN pipeline
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §6: "Do NOT interpret 'Lip Sync is not an Omni generation mode'
 * as 'Kling cannot provide Lip Sync.' Kling exposes Lip Sync as a separate API
 * capability."
 *
 * 🔴 **Part 3 got this wrong and the owner was right.** Part 3 put Lip Sync in
 * `unavailable.ts` on the grounds that "lip sync is not a documented mode of
 * Omni" — which is true, and exactly the inference §6 forbids. The endpoint
 * exists and validates every field:
 *
 *   POST /v1/videos/lip-sync  (NOT /omni-video/…, NOT the Omni model)
 *
 *   {"input":{}}                                → "input.mode: must not be null"
 *   {"input":{"mode":"audio"}}                  → "allowed values: text2video, audio2video"
 *   {"input":{"mode":"audio2video"}}            → "video_id or video_url is required"
 *   {"input":{"mode":"audio2video","video_url":…}} → "Audio type is null"
 *   {"input":{…,"audio_type":"bogus"}}          → "allowed values: file, url"
 *   {"input":{…,"audio_type":"url","audio_url":…}} → 200, task created
 *   {"input":{"mode":"text2video","video_url":…}}  → "text is required"
 *   {"input":{…,"text":"hello"}}                → "Voice language not found"
 *   {"input":{…,"voice_id":"bogus"}}            → "Voice id not found"
 *   {"input":{…,"voice_language":"bogus"}}      → "allowed values: zh, en"
 *   {"input":{…,"voice_speed":99}}              → "input.voiceSpeed: must be less than or equal to 2.0"
 *
 * Verified 2026-09-28 against the live API. `verification: "fields"` — an
 * `audio2video` task was accepted with reachable-looking inputs, but no completed
 * generation from real media has been made (contract document §7, run #4).
 *
 * ── 🔴 THIS IS NOT CHAINED TO ANYTHING (§3, §6) ─────────────────────────────
 *
 * One request, one capability. This handler does NOT generate speech, does NOT
 * call ElevenLabs, does NOT replace a character and does NOT route through Omni.
 * The owner's §3 is explicit that a feature must call only the provider
 * capability that feature needs, and that audio generation, where a feature needs
 * it, is "a clearly separate operation with its own billing and lifecycle rather
 * than silently becoming part of an unrelated video pipeline".
 *
 * So the two modes are two honest products:
 *
 *   audio2video  the caller already HAS speech (an upload, or an Audio Library
 *                asset that was generated and billed as its own Text to Audio
 *                job). This drives the mouth. Any language.
 *   text2video   Kling makes the speech itself, natively, in ONE request.
 *
 * ── 🔴 `text2video` IS A TWO-LANGUAGE FEATURE ───────────────────────────────
 *
 * ✅ `voice_language` allows **`zh` and `en` only**. Frenz AI's Text to Audio
 * offers far more through ElevenLabs. So `text2video` is not a general
 * replacement for "type your script": for anything outside Chinese and English
 * the honest path is a separate Text to Audio operation followed by
 * `audio2video`, which is two billed operations because it is two pieces of work.
 * Presenting `text2video` as language-neutral would be a refusal after the charge
 * for most of the world.
 *
 * ⚠️ `voice_id` values could not be enumerated: an unknown id answers "Voice id
 * not found" and no voice-catalogue endpoint was found on this surface. So a
 * caller must be GIVEN a valid id; this handler will not invent one, and
 * `text2video` therefore cannot be offered until the catalogue is known.
 */

export type KlingLipSyncInput =
  | {
      mode: "audio2video";
      /** The footage whose mouth is driven. */
      videoUrl?: string;
      /** A video already held at Kling, when the caller has one. */
      videoId?: string;
      /** The speech. Already generated and already billed as its own operation. */
      audioUrl: string;
    }
  | {
      mode: "text2video";
      videoUrl?: string;
      videoId?: string;
      /** What should be said. */
      text: string;
      /** A Kling voice id. There is no way to discover these from the API — see the note above. */
      voiceId: string;
      /** 🔴 `zh` or `en` ONLY. */
      voiceLanguage: KlingLipSyncVoiceLanguage;
      /** 0.8–2.0. */
      voiceSpeed?: number;
    };

/** ✅ "video_id or video_url is required" — one of the two, and this is the check. */
function validateVideoSource(input: { videoUrl?: string; videoId?: string }): KlingValidation {
  const hasUrl = !!input.videoUrl?.trim();
  const hasId = !!input.videoId?.trim();
  if (!hasUrl && !hasId) return invalid("Choose the video to lip-sync.");
  /*
    🔴 Refused rather than resolved. A request carrying both is a caller that does
    not know which it means, and picking one for them is how a member gets the
    wrong video back and is charged for it.
  */
  if (hasUrl && hasId) return invalid("Provide either a video URL or a stored video, not both.");
  if (hasUrl) return validateMediaUrl(input.videoUrl!, "The video");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.videoId!.trim())) return invalid("That stored video reference isn't valid.");
  return ok;
}

export const klingLipSync: KlingFeatureHandler<KlingLipSyncInput> = {
  id: "lip_sync",
  label: "Lip Sync",
  available: true,
  unavailableReason: null,
  verification: "fields",
  /*
    🔴 NOT the Omni model, and NOT the Omni path. Lip Sync is a different
    capability on a different endpoint, which is the entire point of §6. The
    model name is carried for the job row and the admin's model display; the
    request itself names no model.
  */
  model: "kling-lip-sync",
  path: KLING_LIP_SYNC_PATH,

  validate(input) {
    if (!KLING_LIP_SYNC.modes.includes(input.mode)) return invalid("That lip-sync mode isn't one this engine offers.");

    const video = validateVideoSource(input);
    if (!video.ok) return video;

    if (input.mode === "audio2video") {
      if (!input.audioUrl?.trim()) return invalid("Choose the speech to sync to.");
      return validateMediaUrl(input.audioUrl, "The audio");
    }

    // text2video
    if (!input.text?.trim()) return invalid("Type what should be said.");
    if (!input.voiceId?.trim()) return invalid("Choose a voice.");
    if (!KLING_LIP_SYNC.voiceLanguages.includes(input.voiceLanguage)) {
      /*
        🔴 The sentence names the real limit rather than saying "unsupported",
        because this is the one refusal a member is most likely to hit and the
        alternative (generate the speech first, then sync it) genuinely exists.
      */
      return invalid("Typed speech is only available in English and Chinese here. For another language, generate the audio first and then sync it.");
    }
    if (input.voiceSpeed !== undefined) {
      const s = input.voiceSpeed;
      if (!Number.isFinite(s)) return invalid("The speaking speed must be a number.");
      if (s < KLING_LIP_SYNC.voiceSpeed.min || s > KLING_LIP_SYNC.voiceSpeed.max) {
        return invalid(`The speaking speed must be between ${KLING_LIP_SYNC.voiceSpeed.min} and ${KLING_LIP_SYNC.voiceSpeed.max}.`);
      }
    }
    return ok;
  },

  buildRequest(input) {
    /*
      ✅ The verified shape: everything under `input`, snake_case. The vendor's
      own error named `voiceSpeed` internally while accepting `voice_speed`, which
      is evidence of a mapping layer — so exactly the snake_case names that were
      verified are sent, never the camelCase ones.
    */
    const source = input.videoUrl?.trim() ? { video_url: input.videoUrl.trim() } : { video_id: input.videoId!.trim() };

    if (input.mode === "audio2video") {
      return {
        input: {
          mode: "audio2video",
          ...source,
          // ✅ "allowed values: file, url" — we always hand over a URL, never bytes.
          audio_type: "url",
          audio_url: input.audioUrl.trim(),
        },
      };
    }

    return {
      input: {
        mode: "text2video",
        ...source,
        text: input.text.trim(),
        voice_id: input.voiceId.trim(),
        voice_language: input.voiceLanguage,
        ...(input.voiceSpeed === undefined ? {} : { voice_speed: input.voiceSpeed }),
      },
    };
  },
};
