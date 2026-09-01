import { NextResponse } from "next/server";

import {
  getNetworkCapabilities,
  getRewardNetworks,
} from "@/lib/monetization/reward-networks-store";
import { parseExoClickSticky } from "@/lib/monetization/exoclick-sticky";
import { parseHilltopTag } from "@/lib/monetization/hilltop";
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
      /*
        🔴 THE LOSER OF THE SWITCH, KEPT AS A SEQUENTIAL FALLBACK (owner,
        2026-09-01: "make the history above the grid to be able to use multi
        format when video outstream is not avalaible, when video outstream is
        available it should win and show, when it cap and want refresh the multi
        format should show, both shouldnt show at once cause now i dont see
        any").

        `exoclickHistory` above is still the ONE tag that slot starts with. This
        is the other one, and the client only asks for it after the first has
        had its chance and painted nothing — see `HistoryGridAd` in
        features/history/history-grid-ad.tsx. Sequential, never simultaneous:
        one `<ins>` is mounted at a time, so the two can never both show and can
        never collide in one batched request.

        Null when both sides resolve to the SAME zone id. Falling back from a
        zone to itself is a second ask for something that just declined, and a
        capped zone answers a re-ask exactly as it answered the first.
      */
      exoclickHistoryFallback: (() => {
        const multi = parseExoClickSticky(settings.exoclickMultiFormatSnippet);
        const outstream = parseExoClickSticky(settings.exoclickHistorySnippet);
        const primary = settings.exoclickHistoryUseMultiFormat ? (multi ?? outstream) : (outstream ?? multi);
        const other = settings.exoclickHistoryUseMultiFormat ? outstream : multi;
        if (!other || !primary) return null;
        return other.zoneId === primary.zoneId ? null : other;
      })(),
      /*
        The multi-format unit shown on our own overlay when the fullpage
        interstitial does not appear (owner, 2026-09-01: "put a slot in the admin
        dashboard for main exoclick interclick and fall back multi format used as
        interstilla").

        🔴 ITS OWN FIELD, NOT `exoclickMultiFormatSnippet`. This used to hand the
        fallback the same tag that serves above the History grid, which is one
        zone in two placements as soon as the fallback opens on /history — and
        the fallback builds its `<ins>` by hand rather than through
        `ExoClickSticky`, so the zone-claim never saw the clash. The payload key
        `exoclickMultiFormat` is gone with it: nothing else read it.
      */
      exoclickInterstitialFallback: parseExoClickSticky(settings.exoclickInterstitialFallbackSnippet),
      /*
        🔴 TWO IN-FEED PLACEMENTS, TWO TAGS, NO FALLBACK BETWEEN THEM.

        /history renders an in-feed slot after Yesterday and another after Last
        week. ExoClick batches every placement on a page into ONE request and
        will not serve the same zone twice in it — the API answers
        `{"zones":[null,null]}` — so these two MUST resolve to different zone
        ids, and the way to make that possible is to read two different fields.

        Note what is missing: `?? exoclickHistoryFeed` on the second one. The
        pairs elsewhere in this file (`exoclickHistory`) fall back to each other
        because they are two candidates for ONE slot, where duplication is
        impossible. Falling back here would put one zone in both placements and
        blank them both, which is the bug this split exists to fix.
      */
      exoclickHistoryFeed: parseExoClickSticky(settings.exoclickHistoryFeedSnippet),
      exoclickHistoryFeedLastWeek: parseExoClickSticky(settings.exoclickHistoryFeedLastWeekSnippet),
      exoclickLanding: parseExoClickSticky(settings.exoclickLandingSnippet),
      exoclickInterstitial: parseExoClickSticky(settings.exoclickInterstitialSnippet),
      exoclickBottomNav: parseExoClickSticky(settings.exoclickBottomNavSnippet),
      /*
        HILLTOPADS, parsed to a bare `https` loader URL and never as markup —
        the same rule as every other pasted snippet on this endpoint.

        `hilltopBanner` is a PLACED unit and may appear in several positions:
        their loader inserts the creative where its own script tag sits, so each
        placement is its own request. There is no batch and no placeholder, so
        none of the one-zone-per-placement machinery above applies to it.

        `hilltopVideoSlider` places ITSELF and is loaded once per page.
      */
      /*
        🔴 THE MASTER SWITCH IS APPLIED HERE, NOT IN THE CLIENT.

        Owner's brief: "HilltopAds = OFF must mean: Remove/disable only
        HilltopAds placements. All other networks continue normally."

        Resolving it server-side makes that literal — with the switch off the
        tags are not in the payload at all, so no HilltopAds URL reaches a
        browser and nothing on the page can load one even by mistake. A client
        that checked a flag would still be shipping the credentials to every
        visitor and relying on itself to not use them. Every other network's
        entry on this endpoint is untouched by it.
      */
      hilltop: settings.hilltop,
      hilltopBanner: settings.hilltop.enabled ? parseHilltopTag(settings.hilltopBannerSnippet) : null,
      hilltopVideoSlider: settings.hilltop.enabled
        ? parseHilltopTag(settings.hilltopVideoSliderSnippet)
        : null,
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
