import { NextResponse } from "next/server";

import { getMonetizationSettings, normalizeSkipSeconds } from "@/lib/monetization/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, non-user-specific ad behaviour config the client needs before an ad
 * fills — currently just the admin-set interstitial skip delay. Kept off the
 * per-zone `/api/ads` response because it is global, not per-slot, and the
 * interstitial needs it whether or not a creative ends up filling. Cached
 * briefly so it costs about nothing.
 */
/**
 * Clamp an admin-set countdown.
 *
 * A stored value outside the sane range — hand-edited, or written by an older
 * build — must not become a 10-minute ad the visitor cannot escape. Falls back
 * to the default rather than to zero: zero would silently give the feature away
 * for free, which is the opposite of what the setting is for.
 */
function clampSeconds(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(0, Math.round(raw)));
}

export async function GET() {
  const settings = await getMonetizationSettings();
  return NextResponse.json(
    {
      interstitialSkipSeconds: normalizeSkipSeconds(settings.interstitialSkipSeconds),
      // The per-moment switches (wallpaper downloads, history video watches).
      // Public and non-user-specific, like the skip delay — the client needs
      // them before an ad fills to know whether to arm the trigger at all.
      interstitialWallpaper: settings.interstitialWallpaper === true,
      interstitialHistoryVideo: settings.interstitialHistoryVideo === true,
      // Batch downloads: free, paid for by an ad before and a short one after.
      interstitialBatchDownload: settings.interstitialBatchDownload === true,
      batchGateSeconds: clampSeconds(settings.batchGateSeconds, 30, 60),
      batchCompleteSeconds: clampSeconds(settings.batchCompleteSeconds, 5, 30),
      // Reward-ad quality tier — see lib/monetization/reward-policy.ts.
      rewardTopTierCount: clampSeconds(settings.rewardTopTierCount, 2, 10),
      rewardVideoTopTierSeconds: clampSeconds(settings.rewardVideoTopTierSeconds, 30, 60),
      rewardImageAudioTopTierSeconds: clampSeconds(settings.rewardImageAudioTopTierSeconds, 5, 30),
      rewardImageAudioSkipAfterSeconds: clampSeconds(settings.rewardImageAudioSkipAfterSeconds, 5, 30),
      // Server-verified reward-session gate (lib/monetization/reward-sessions.ts).
      // Daily limits stay server-only; the client only needs to know whether to
      // arm the flow at all.
      rewardDownloadHdEnabled: settings.rewardDownloadHdEnabled !== false,
      rewardDownloadBatchEnabled: settings.rewardDownloadBatchEnabled !== false,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
