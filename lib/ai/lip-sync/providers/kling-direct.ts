import "server-only";

import { KLING_LIP_SYNC_PATH } from "@/lib/ai/kling/config";
import { klingConfigured } from "@/lib/ai/kling/client";
import { klingLipSyncPipeline } from "@/lib/ai/kling/pipelines/lip-sync";
import { submitKlingPipeline } from "@/lib/ai/kling/pipelines/submit";
import type { LipSyncCapabilities } from "@/lib/ai/lip-sync/config";
import { LipSyncCapabilityError, type LipSyncProProvider, type LipSyncProRequest, type LipSyncProSubmission } from "@/lib/ai/lip-sync/providers/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC ON THE DIRECT KLING ENDPOINT (Part 5 §11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Lip Sync must NOT remain on the old Replicate implementation… The intended
 * architecture is: Lip Sync → Direct Kling Lip Sync API."
 *
 * 🔴 NOT TO BE CONFUSED WITH `kling-lipsync.ts` NEXT DOOR. That file is
 * `kwaivgi/kling-lip-sync` — a Kling MODEL reached through **Replicate**,
 * which is precisely the arrangement §11 forbids. This one talks to Kling's
 * own `/v1/videos/lip-sync`, with Kling's own credential, and no third party
 * in between.
 *
 * ── A SHIM, NOT A SECOND PIPELINE (§2) ────────────────────────────────────
 *
 * This adapter holds no request-building logic. `createPrediction` hands the
 * job straight to `lib/ai/kling/pipelines/lip-sync.ts`, which owns the
 * validation, the body and the endpoint. What lives here is only the shape the
 * EXISTING Lip Sync Pro flow expects — capabilities, a model name, a
 * configured check — so that flow keeps working unchanged: same job rows, same
 * prepare step, same finalizer, same notifications.
 *
 * Writing it this way rather than branching inside `submitLipSyncJob` keeps one
 * submission path: the transition, the job event and the provider-run ledger
 * entry are recorded once, for every vendor, in the same place.
 */

/**
 * ✅ VERIFIED against the live endpoint, and deliberately narrow.
 *
 * 🔴 `supports_text: false`. Kling HAS a native `text2video` mode, but it needs
 * a `voice_id` and the direct API publishes no way to enumerate the voice
 * catalogue — an unknown id answers "Voice id not found". Claiming text support
 * without a voice to name would be faking it (§37), and the member would meet
 * the failure after being charged.
 *
 * Declaring it false is what makes `planSpeechPath` choose the `tts` path, so
 * typed text becomes audio in the worker's existing prepare step BEFORE this
 * adapter is reached, and this endpoint only ever receives `audio2video`.
 *
 * ⚠️ That prepare step is ElevenLabs. It is the Lip Sync tool's own long-
 * standing behaviour and it happens in OUR worker, not inside the Kling
 * request — but §11's "must not secretly trigger ElevenLabs TTS" is pointed at
 * exactly this, and the honest resolution is the one §3 describes: audio should
 * be its own billed operation. Recorded here rather than quietly kept; see the
 * Part 6 report.
 */
export const KLING_DIRECT_LIP_SYNC_CAPABILITIES: LipSyncCapabilities = {
  supports_text: false,
  supports_audio: true,
  supports_voice_selection: false,
  supports_language: false,
  supports_speed: false,
  supports_active_speaker: false,
  supports_temperature: false,
  supports_duration_control: false,
  /*
    ✅ The vendor's own refusals, both of which cost ZERO units:
      "The video height should not be less than 512px and larger than 2160px."
      "The model did not detect a human"
    Encoded so a member is refused before the charge rather than after it.
  */
  video: { minDurationMs: null, maxDurationMs: null, minEdgePx: 512, maxEdgePx: 2160, maxBytes: null },
  audio: { maxBytes: null, containers: ["mp3", "wav", "m4a", "aac", "ogg"] },
};

/** The model name carried on the job row and shown in the admin. The request names no model. */
export const KLING_DIRECT_LIP_SYNC_MODEL = "kling-lip-sync";

export function klingDirectLipSyncProvider(): LipSyncProProvider {
  return {
    id: "kling",
    model: KLING_DIRECT_LIP_SYNC_MODEL,
    version: "",
    capabilities: KLING_DIRECT_LIP_SYNC_CAPABILITIES,
    /* The voice catalogue is not discoverable on this surface — see the note above. */
    nativeVoices: null,

    isConfigured() {
      return klingConfigured();
    },

    /**
     * What WOULD be sent, for the operator's record and for a test.
     *
     * Built by the PIPELINE, so this can never drift from what is actually
     * submitted — the whole reason the pipeline owns `buildRequest`.
     */
    buildInput(req) {
      if (req.speech.kind !== "audio") {
        throw new LipSyncCapabilityError("the direct Kling lip-sync endpoint takes audio, never text");
      }
      return klingLipSyncPipeline.buildRequest({ mode: "audio2video", videoUrl: req.videoUrl, audioUrl: req.speech.audioUrl });
    },

    async createPrediction(req: LipSyncProRequest): Promise<LipSyncProSubmission> {
      if (req.speech.kind !== "audio") {
        // The router should never send this here; the adapter is the last line, not the only one.
        throw new LipSyncCapabilityError("the direct Kling lip-sync endpoint takes audio, never text");
      }
      const submitted = await submitKlingPipeline({
        feature: "lip_sync",
        input: {
          mode: "audio2video",
          videoUrl: req.videoUrl,
          audioUrl: req.speech.audioUrl,
          // Measured by our worker on the prepared file — never claimed by a browser.
          ...(req.facts?.durationMs ? { sourceSeconds: req.facts.durationMs / 1000 } : {}),
        },
        jobId: req.jobId,
        callbackUrl: req.webhookUrl,
      });
      return {
        reference: submitted.taskId,
        status: "processing",
        model: KLING_DIRECT_LIP_SYNC_MODEL,
        modelVersion: null,
        // No URLs, no text — the operator's record, not the payload.
        settings: { endpoint: KLING_LIP_SYNC_PATH, mode: "audio2video" },
      };
    },
  };
}
