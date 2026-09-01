import { NextResponse } from "next/server";

import {
  getNetworkCapabilities,
  getRewardNetworks,
} from "@/lib/monetization/reward-networks-store";
import { parseExoClickSticky } from "@/lib/monetization/exoclick-sticky";
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
  const [settings, rewardNetworks, capabilities] = await Promise.all([
    getMonetizationSettings(),
    getRewardNetworks(),
    getNetworkCapabilities(),
  ]);
  return NextResponse.json(
    {
      /* The interstitial config the lazy client module reads once per page load.
         Public and non-user-specific, exactly like the skip delay beside it. */
      vastInterstitial: settings.vastInterstitial,
      /*
        The sticky banner as PARSED values, never the pasted snippet. Same
        rule as the verification tags and the Monetag units: admin free text
        must not travel to a browser as markup.
      */
      exoclickSticky: parseExoClickSticky(settings.exoclickStickySnippet),
      /*
        🔴 ONE SLOT ABOVE THE HISTORY GRID, RESOLVED HERE (owner, 2026-09-01:
        "put a switch in admin dashboard to turn off and on so one link can
        serve in one slot position in the history page").

        There is exactly ONE placement there and two candidate tags, so the
        choice is made SERVER-side and the client is handed a single value. It
        was briefly implicit precedence in the component — multi-format wins if
        present — which is unanswerable from the admin: with both pasted, an
        operator could not tell which was running, and the only way to switch was
        to delete a snippet they might want back.

        Resolving it here also makes the double-slot impossible rather than
        merely unlikely: the page is never given two tags for one position, which
        is what produced the stacked, wrong-shaped unit on 2026-08-30.

        Each side falls back to the other when its own snippet is empty, so
        flipping the switch with nothing pasted on that side cannot silently
        blank the slot.
      */
      exoclickHistory: (() => {
        const multi = parseExoClickSticky(settings.exoclickMultiFormatSnippet);
        const outstream = parseExoClickSticky(settings.exoclickHistorySnippet);
        return settings.exoclickHistoryUseMultiFormat ? (multi ?? outstream) : (outstream ?? multi);
      })(),
      exoclickInterstitial: parseExoClickSticky(settings.exoclickInterstitialSnippet),
      exoclickBottomNav: parseExoClickSticky(settings.exoclickBottomNavSnippet),
      /*
        Which network pays for which reward moment (owner, 2026-08-25), plus the
        one runtime fact the client cannot work out for itself.

        Public and non-user-specific, exactly like the skip delay beside it:
        knowing that the multi-link gate runs a GPT slot is not a secret — the
        GPT script is visible in the page anyway. Offerium's readiness arrives
        as a plain BOOLEAN and never its credentials; `offeriumConfigured`
        checks two server-only env secrets, and this endpoint is the seam
        precisely so the client never needs them.
      */
      rewardNetworks,
      offeriumConfigured: capabilities.offeriumConfigured,
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
