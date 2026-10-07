/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE COMPLIMENTARY VIDEO (owner, 2026-10-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "free account without credit complimentary video creation should be 3secs
 *  limit, 720 pixel and no reference video supported for free. And free only
 *  applies for one account with that device, block or fraud duplicate account
 *  to access free, free only applies once on a device."
 *
 * Text to Video and Image to Video take a complimentary creation from the SAME
 * pool as Lip Sync and the retired Character Replace (`ai_free_entitlements`,
 * granted per site plan in Admin → AI Plans & Credits), under the same device
 * rule (`grant_free_entitlement`: max free accounts per device, per network).
 *
 * A request is complimentary only when it fits ALL of the rules below — a
 * request that does not is simply priced and paid as usual (it never takes
 * the complimentary creation). Pure: the decision is made on the server in
 * lib/ai/video/create.ts; the page only displays it.
 */

export const FREE_VIDEO = {
  /** Exactly the shortest length Kling makes. */
  seconds: 3,
  resolution: "720p",
  /** A reference video bills its whole clip length (0.9 units/s) — never complimentary. */
  allowReferenceVideo: false,
} as const;

export interface FreeVideoRequest {
  options?: { durationSeconds?: unknown; resolution?: unknown } | null;
  referenceVideoUrl?: unknown;
}

export type FreeVideoVerdict = { ok: true } | { ok: false; reason: "duration" | "resolution" | "reference_video"; message: string };

export function freeVideoQualifies(input: FreeVideoRequest | null | undefined): FreeVideoVerdict {
  const seconds = input?.options?.durationSeconds;
  // an unset length is the pipeline's default (5 s) — longer than the complimentary 3
  if (seconds !== FREE_VIDEO.seconds) return { ok: false, reason: "duration", message: `The complimentary video is ${FREE_VIDEO.seconds} seconds long.` };
  // stated, never assumed: an unset resolution is sent to Kling unset, and Kling's own default is not ours to promise
  if (input?.options?.resolution !== FREE_VIDEO.resolution) return { ok: false, reason: "resolution", message: `The complimentary video is ${FREE_VIDEO.resolution}.` };
  if (!FREE_VIDEO.allowReferenceVideo && typeof input?.referenceVideoUrl === "string" && input.referenceVideoUrl) {
    return { ok: false, reason: "reference_video", message: "A reference video isn't included in the complimentary video." };
  }
  return { ok: true };
}

/** One line for the page, so the member can pick a request that qualifies. */
export const FREE_VIDEO_SUMMARY = `${FREE_VIDEO.seconds} s · ${FREE_VIDEO.resolution} · no reference video`;
