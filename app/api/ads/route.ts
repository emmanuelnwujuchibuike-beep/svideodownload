import { NextResponse } from "next/server";

import { getAdsForZone } from "@/lib/monetization/ads";
import { getUserPlan } from "@/lib/monetization/plan";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES: ReadonlySet<string> = new Set<AdZone>([
  "global",
  "homepage_top",
  "download_result_page",
  "result_top",
  "reward_video",
  "sidebar",
  "exit_intent_popup",
  "mobile_bottom_banner",
]);

/**
 * Returns the ad(s) to render for a zone, or null/empty for premium users.
 * `?all=1` returns every active ad in the zone (used for page-level `global`
 * scripts like pop-unders / social bars); otherwise a single weighted slot.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const zone = sp.get("zone") ?? "";
  const all = sp.get("all") === "1";
  if (!ZONES.has(zone)) {
    return NextResponse.json(all ? { ads: [] } : { ad: null }, { status: 400 });
  }

  // Premium users never see ads.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const plan = await getUserPlan(user?.id);
    if (plan !== "free") return NextResponse.json(all ? { ads: [] } : { ad: null });
  } catch {
    /* no session → treat as free */
  }

  // Respect the global network/format toggles so an admin can disable a whole
  // network (Adsterra / PropellerAds) or unit type (pop-under / interstitial).
  const settings = await getMonetizationSettings();
  const allowed = (a: AdSlotData): boolean => {
    const net = a.network.toLowerCase();
    if (!settings.adsterra && net.includes("adsterra")) return false;
    if (!settings.propellerads && net.includes("propeller")) return false;
    if (!settings.popunder && a.format === "pop") return false;
    if (!settings.interstitial && a.format === "video") return false;
    return true;
  };

  const ads = (await getAdsForZone(zone)).filter(allowed);
  const headers = { "Cache-Control": "private, max-age=30" };
  if (all) return NextResponse.json({ ads }, { headers });
  return NextResponse.json({ ad: ads[0] ?? null }, { headers });
}
