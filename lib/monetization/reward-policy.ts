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
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUALITY-TIER GATE, ADDED (owner, 2026-08-16)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "image and audio download shouldn't show 30 seconds reward ad to download
 * the top 2 highest quality only a 5 sec ad that can be skipped after 5sec…
 * All videos must show a 30 seconds ad to download the top 2 highest quality
 * videos" — both admin-configurable (`rewardTopTierCount`,
 * `rewardVideoTopTierSeconds`, `rewardImageAudioTopTierSeconds`,
 * `rewardImageAudioSkipAfterSeconds` in lib/monetization/settings.ts).
 *
 * A format's quality RANK is its 0-based position in the already best-first
 * sorted list for its kind (see quality-ladder.ts's own note: "Extractors
 * already sort best-first") — `qualityRank: 0` is the single best option,
 * `1` the second-best, and so on. The caller (the quality picker) is the one
 * place that actually has that sorted list, so it computes and passes the
 * rank rather than this function re-deriving it from a bare format.
 *
 * ── Video: ALONGSIDE the size rule, not instead of it (owner-confirmed) ────
 * The size rule exists specifically so a large file can't download free just
 * because it happens to rank 3rd — reverting to a pure rank-based rule would
 * reintroduce precisely the bug the size rule was built to fix (see the note
 * above: a 1 GB non-top format used to be free). So for video, the two rules
 * are combined with OR: a top-tier format ALWAYS gets at least the first ad
 * even under 100 MB, and a large file still gets the size rule's ads even
 * outside the top tier or if it's a top-tier file that's also huge — the
 * two never stack into extra ads beyond what the size rule already produces.
 *
 * ── Image/audio: REPLACES the old "always gated" rule ──────────────────────
 * Only a top-tier image/audio option is gated now; anything past
 * `rewardTopTierCount` downloads free. This is a deliberate narrowing from
 * "every image, every time" to "only the options worth protecting."
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
  kind?: "video" | "audio" | "image";
  /**
   * 0-based position of the chosen format in its kind's best-first sorted
   * list (0 = the single best option). Undefined/null when the caller
   * couldn't determine rank — treated as "not top tier."
   */
  qualityRank?: number | null;
  /** Admin-configured quality-tier gate — see the module doc above. Omitted
   *  fields fall back to the settings module's own defaults. */
  tierConfig?: {
    topTierCount?: number;
    videoTopTierSeconds?: number;
    imageAudioTopTierSeconds?: number;
    imageAudioSkipAfterSeconds?: number;
  };
}

const DEFAULT_TOP_TIER_COUNT = 2;
const DEFAULT_VIDEO_TOP_TIER_SECONDS = 30;
const DEFAULT_IMAGE_AUDIO_TOP_TIER_SECONDS = 5;
const DEFAULT_IMAGE_AUDIO_SKIP_AFTER_SECONDS = 5;

/**
 * The ads a download must watch, in order. An empty array means no gate.
 */
export function rewardAdsFor({ filesize, showAds, kind, qualityRank, tierConfig }: RewardPolicyInput): RewardAd[] {
  // Paying viewers, always. This is checked first so no size/tier rule can
  // ever override it — an ad shown to someone who paid not to see ads is the
  // single worst outcome available here.
  if (!showAds) return [];

  const topTierCount = tierConfig?.topTierCount ?? DEFAULT_TOP_TIER_COUNT;
  const isTopTier = topTierCount > 0 && typeof qualityRank === "number" && qualityRank >= 0 && qualityRank < topTierCount;

  if (kind === "image" || kind === "audio") {
    /*
      Replaces the old "every image, every time" rule. Only a top-tier
      option is gated now — the admin-configured duration/skip pair applies
      to BOTH image and audio, per the owner's ask, with audio newly joining
      a gate it never had before (it used to follow the byte-size rule
      video does, below).
    */
    if (!isTopTier) return [];
    const durationSec = tierConfig?.imageAudioTopTierSeconds ?? DEFAULT_IMAGE_AUDIO_TOP_TIER_SECONDS;
    const skipAfterSec = tierConfig?.imageAudioSkipAfterSeconds ?? DEFAULT_IMAGE_AUDIO_SKIP_AFTER_SECONDS;
    if (durationSec <= 0) return [];
    return [{ durationSec, skipAfterSec: skipAfterSec > 0 ? skipAfterSec : null }];
  }

  // Video: the size rule (unchanged) OR the quality-tier rule — whichever
  // asks for more. See the module doc for why these are combined with OR
  // rather than one replacing the other.
  const sizeAds: RewardAd[] =
    typeof filesize === "number" && Number.isFinite(filesize) && filesize > 0
      ? filesize > DOUBLE_REWARD_THRESHOLD_BYTES
        ? [
            { durationSec: REWARD_AD_SECONDS, skipAfterSec: null },
            { durationSec: REWARD_AD_SECONDS, skipAfterSec: SECOND_AD_SKIP_AFTER_SECONDS },
          ]
        : filesize > REWARD_THRESHOLD_BYTES
          ? [{ durationSec: REWARD_AD_SECONDS, skipAfterSec: null }]
          : []
      : []; // unknown size fails OPEN — see the note above

  if (sizeAds.length > 0) return sizeAds;

  if (isTopTier) {
    const durationSec = tierConfig?.videoTopTierSeconds ?? DEFAULT_VIDEO_TOP_TIER_SECONDS;
    if (durationSec > 0) return [{ durationSec, skipAfterSec: null }];
  }

  return [];
}
