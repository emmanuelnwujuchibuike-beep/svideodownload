import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
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
  const seenKey = `frenz:direct-link:${spot}`;
  // Synchronous: browsers only open a new tab inside the tap itself.
  return () => {
    try {
      if (sessionStorage.getItem(seenKey)) return;
    } catch {
      /* Storage blocked: fall through — the roll still keeps it occasional. */
    }
    if (!directLinkRollWins(c.chancePercent, Math.random())) return;
    try {
      sessionStorage.setItem(seenKey, "1");
    } catch {
      /* ignore */
    }
    window.open(c.url, "_blank", "noopener,noreferrer");
  };
}
