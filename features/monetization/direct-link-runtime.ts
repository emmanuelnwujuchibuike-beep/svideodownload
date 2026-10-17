import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
import { allowWindowOpen } from "@/lib/monetization/popunder-guard";
import { directLinkRollWins, isValidDirectLinkUrl, type DirectLinkSpot } from "@/lib/monetization/direct-link";

/**
 * The direct link's tap logic, in its own chunk (useDirectLink imports it after
 * mount) so the routes that carry the hook pay a few bytes, not the policy.
 * Resolves to the opener for one spot, or null when the admin has not set one.
 */
export async function loadDirectLinkOpener(spot: DirectLinkSpot): Promise<(() => void) | null> {
  const d = (await loadAdsConfig()) as Record<string, unknown> | null;
  const c = d?.monetagDirectLink as { url: string; spots: string[]; chancePercent: number } | null | undefined;
  if (!c || !c.spots?.includes(spot) || !isValidDirectLinkUrl(c.url)) return null;
  // Synchronous: browsers only open a new tab inside the tap itself.
  return () => {
    /*
      2026-10-16 (owner: "Direct link works only once, it should show everytime the selected area
      i told you is tapped"): no once-per-session lock any more. Every tap at an enabled spot rolls
      the admin's chance — at 100% that is every tap.
    */
    if (!directLinkRollWins(c.chancePercent, Math.random())) return;
    /*
      2026-10-16 (owner: "it should open another tab so users can still return where they stop"):
      always a NEW tab, never this one. And announced first: where the pop-under guard is installed
      (pages carrying the Hilltop slider) an unannounced window.open is refused, so the direct link
      silently did nothing there.
    */
    allowWindowOpen();
    window.open(c.url, "_blank", "noopener,noreferrer");
  };
}
