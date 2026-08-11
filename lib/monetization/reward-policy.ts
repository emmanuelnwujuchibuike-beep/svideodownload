/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHEN A DOWNLOAD HAS TO WATCH AN AD, AND HOW MANY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: "downloads above 100mb [should show a 30 sec reward ad],
 * more than 500mb should show a first 30 sec reward ad and after it finishes it
 * should show another 30 sec reward ad but can be skipable after 15 secs."
 *
 * ── 🔴 What this replaces, and why the old rule was wrong ─────────────────
 *
 * The gate used to be `kind === "image" || formatId === topVideoId` — the
 * highest-RANKED video format, with no reference to size at all. On the video
 * that prompted this (a 60-minute set) that produced exactly the wrong outcome
 * in both directions:
 *
 *   • 720p is 1.03 GB and is NOT the top format, so it was ungated — a gigabyte
 *     of egress for free.
 *   • On a 15-second clip the top format might be 4 MB and WAS gated — an ad in
 *     front of a trivial download.
 *
 * Cost scales with BYTES, so the gate is bytes.
 *
 * ── Why the second ad is skippable and the first is not ───────────────────
 *
 * A 500 MB+ file is worth two ads, but sixty uninterrupted seconds in front of a
 * download people are already waiting for is how a downloader gets abandoned.
 * Fifteen seconds of the second one is the honest middle: the impression is
 * still served and counted, and someone who has already watched a full thirty
 * seconds is not punished for the size of a file they did not choose.
 *
 * ── Unknown size is NOT gated ─────────────────────────────────────────────
 *
 * Some extractors report no `filesize` (progressive HLS, audio conversions). An
 * unknown size must fail OPEN: gating on a guess means showing ads for a 2 MB
 * audio file, and being wrong in that direction costs the user's goodwill for
 * nothing. The reverse — occasionally missing an ad on a large unmeasured file —
 * costs one impression.
 */

/** Bytes above which a single 30s reward ad is required. */
export const REWARD_THRESHOLD_BYTES = 100 * 1024 * 1024;
/** Bytes above which a SECOND ad follows the first. */
export const DOUBLE_REWARD_THRESHOLD_BYTES = 500 * 1024 * 1024;

export const REWARD_AD_SECONDS = 30;
/** The second ad may be dismissed after this long. The first may not. */
export const SECOND_AD_SKIP_AFTER_SECONDS = 15;

export interface RewardAd {
  durationSec: number;
  /** Seconds before a Skip control appears; null means it must be watched out. */
  skipAfterSec: number | null;
}

export interface RewardPolicyInput {
  /** Reported size of the chosen format, or null/undefined when unknown. */
  filesize?: number | null;
  /** False for premium/ad-free viewers — they are never gated. */
  showAds: boolean;
  /** Images stay gated regardless of size (they are always small). */
  kind?: "video" | "audio" | "image";
}

/**
 * The ads a download must watch, in order. An empty array means no gate.
 */
export function rewardAdsFor({ filesize, showAds, kind }: RewardPolicyInput): RewardAd[] {
  // Paying viewers, always. This is checked first so no size rule can ever
  // override it — an ad shown to someone who paid not to see ads is the single
  // worst outcome available here.
  if (!showAds) return [];

  /*
    Images keep their own gate, unchanged from the previous rule. They are the
    one kind where size is a bad proxy for value: a wallpaper is a few hundred
    KB and is the entire product of that download, so a byte threshold would
    make every image free while gating videos that are worth less.
  */
  if (kind === "image") return [{ durationSec: REWARD_AD_SECONDS, skipAfterSec: null }];

  // Unknown size fails OPEN — see the note above.
  if (typeof filesize !== "number" || !Number.isFinite(filesize) || filesize <= 0) return [];

  if (filesize > DOUBLE_REWARD_THRESHOLD_BYTES) {
    return [
      { durationSec: REWARD_AD_SECONDS, skipAfterSec: null },
      { durationSec: REWARD_AD_SECONDS, skipAfterSec: SECOND_AD_SKIP_AFTER_SECONDS },
    ];
  }

  if (filesize > REWARD_THRESHOLD_BYTES) {
    return [{ durationSec: REWARD_AD_SECONDS, skipAfterSec: null }];
  }

  return [];
}
