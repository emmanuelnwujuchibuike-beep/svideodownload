import { KLING_LIP_SYNC_PATH } from "@/lib/ai/kling/config";
import { klingLipSync, type KlingLipSyncInput } from "@/lib/ai/kling/features/lip-sync";
import { quoteKling, type KlingPricingConfig, type KlingQuote } from "@/lib/ai/kling/pricing";
import type { KlingSupportedPipeline } from "@/lib/ai/kling/pipelines/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIP SYNC — its OWN Kling endpoint, its OWN pipeline (§11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner §11: "Lip Sync must NOT remain on the old Replicate implementation…
 * The intended architecture is: Lip Sync → Direct Kling Lip Sync API."
 *
 * ✅ VERIFIED END TO END: an `audio2video` run PRESERVED THE SOURCE VIDEO
 * exactly — same person, clothing, background and framing — and drove only the
 * mouth. 0.5 units.
 *
 *     POST /v1/videos/lip-sync
 *     { input: { mode, video_url|video_id, audio_type, audio_url | text… } }
 *
 * 🔴 A DIFFERENT ENDPOINT AND A DIFFERENT MODEL from every other pipeline here.
 * That is exactly why the endpoint is a property of the pipeline: a shared
 * submitter would have had to branch on the feature to pick a path, which is the
 * shared-execution §2 forbids.
 *
 * ── What it must never invoke (§3, §11) ────────────────────────────────────
 *
 * Not ElevenLabs, not voice cloning, not Character Replace, not Text-to-Video,
 * not Image-to-Video, not Replicate, not fal.ai. `audio2video` takes speech the
 * caller ALREADY has — which, if it came from Text to Audio, was its own job with
 * its own charge. Generating speech inside this pipeline would be the silent
 * chaining the brief spends three sections forbidding.
 *
 * ⚠️ `text2video` mode is Kling making the speech itself, in ONE request — which
 * is not chaining, it is a single provider capability. It is constrained to
 * English and Chinese by the vendor, and the handler refuses anything else with a
 * sentence that names the real alternative.
 *
 * ── Quality (§19, §20) ─────────────────────────────────────────────────────
 *
 * The source video is passed as a URL and never re-encoded by us. Kling itself
 * enforces 512–2160 px height and the presence of a person, and BOTH of those
 * failures cost zero units — so refusing late at the vendor is not expensive, and
 * transcoding "just in case" would be pure quality loss for no benefit.
 */
export const klingLipSyncPipeline: KlingSupportedPipeline<KlingLipSyncInput> = {
  feature: "lip_sync",
  supported: true,
  label: "Lip Sync",
  aiFeature: "ai_lip_sync",
  endpoint: KLING_LIP_SYNC_PATH,
  model: klingLipSync.model,
  pricedAs: "lip_sync",

  validate: (input) => klingLipSync.validate(input),
  buildRequest: (input) => klingLipSync.buildRequest(input),

  quote(input, pricing: KlingPricingConfig): KlingQuote {
    /*
      🔴 Lip Sync is billed on the SOURCE video's measured length — the only
      length that exists, because the output is the source with its mouth
      changed. `sourceSeconds` is measured by our worker, never claimed by a
      browser (§26: the client is never trusted for duration billing).

      The resolution argument is ignored by the matrix for this feature — Lip Sync
      has a single tier, because the member chooses no resolution: the output
      carries the source's own.
    */
    const seconds = input.sourceSeconds ?? 0;
    return quoteKling(pricing, { feature: "lip_sync", resolution: "720p", seconds });
  },
};
