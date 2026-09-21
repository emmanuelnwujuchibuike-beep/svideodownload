import type { CharacterReplaceQualityId } from "@/lib/ai/character-replace/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WAN 2.2 ANIMATE REPLACE — the model, pinned, and its input, built here only
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §1): "Use the official Replicate model:
 * wan-video/wan-2.2-animate-replace… Use only inputs actually supported by
 * the current model schema. Do NOT invent unsupported parameters."
 *
 * Read from the live schema on 2026-09-14 (GET /v1/models/wan-video/
 * wan-2.2-animate-replace, latest version 33ec6b98…, 2026-01-28):
 *
 *   video               string (uri)    the video whose character is replaced
 *   character_image     string (uri)    the new character
 *   resolution          "480" | "720"   default "720"
 *   go_fast             boolean         default false
 *   merge_audio         boolean         default true — "Merge audio from input
 *                                       video into output."
 *   seed                integer         optional
 *   refert_num          1 | 5           DEPRECATED — "will always be set to 1"
 *   frames_per_second   integer         DEPRECATED — "will always be set to 30"
 *   output              string (uri)    one video
 *
 * `buildWanAnimateReplaceInput` sends exactly the five fields the product
 * uses and nothing else — no `seed` (we do not offer determinism), and never
 * the two deprecated fields (§9: "do not create unnecessary transcoding
 * work"). Nothing here is built from a request; every value is the
 * server's, after validation.
 *
 * ── The pin is in code ──────────────────────────────────────────────────────
 *
 * Same rule as the AI Clean pin: a committed constant puts the model that
 * ran in git beside the caller. `REPLICATE_WAN_ANIMATE_REPLACE_VERSION`
 * overrides it for a rollback without a deploy.
 */
export const WAN_ANIMATE_REPLACE = {
  model: "wan-video/wan-2.2-animate-replace",
  version: process.env.REPLICATE_WAN_ANIMATE_REPLACE_VERSION?.trim() || "33ec6b986ba9010eee4cd812be67d25e72150fad7d2b11d3abed66a9c7ac1ba1",
} as const;

/** The resolutions the model documents. A quality outside this map is REFUSED, never mapped down (§7). */
export const WAN_RESOLUTIONS: Partial<Record<CharacterReplaceQualityId, "480" | "720">> = {
  "480p": "480",
  "720p": "720",
};

export function wanResolutionFor(quality: CharacterReplaceQualityId): "480" | "720" | null {
  return WAN_RESOLUTIONS[quality] ?? null;
}

export interface WanAnimateReplaceInput {
  video: string;
  character_image: string;
  resolution: "480" | "720";
  go_fast: boolean;
  merge_audio: boolean;
}

/**
 * The provider payload (§36), from validated server-side values. `mergeAudio`
 * is the caller's decision — true when the source HAS audio and the member
 * kept the original voice — so a silent source never asks the model to merge
 * a track that is not there.
 */
export function buildWanAnimateReplaceInput(opts: {
  videoUrl: string;
  characterImageUrl: string;
  resolution: "480" | "720";
  goFast: boolean;
  mergeAudio: boolean;
}): WanAnimateReplaceInput {
  if (!/^https:\/\//.test(opts.videoUrl) || !/^https:\/\//.test(opts.characterImageUrl)) {
    throw new Error("provider inputs must be https urls");
  }
  return {
    video: opts.videoUrl,
    character_image: opts.characterImageUrl,
    resolution: opts.resolution,
    go_fast: opts.goFast === true,
    merge_audio: opts.mergeAudio === true,
  };
}

/** The fields the input may carry — a test walks the built object against this. */
export const WAN_INPUT_FIELDS = ["video", "character_image", "resolution", "go_fast", "merge_audio"] as const;

/**
 * Where a provider output may be fetched FROM (§40, SSRF). The URL arrives in
 * a signature-verified webhook or a poll of the provider's own API, so it is
 * the provider's; this is defence in depth — the worker will not follow a
 * recorded output URL to any host but Replicate's delivery domains.
 */
export function isTrustedProviderOutputUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "replicate.delivery" || host.endsWith(".replicate.delivery") || host === "replicate.com" || host.endsWith(".replicate.com")) return true;
    // 2026-09-21: fal.ai delivers from fal.media (v3.fal.media, v3b.fal.media, …).
    return host === "fal.media" || host.endsWith(".fal.media");
  } catch {
    return false;
  }
}
