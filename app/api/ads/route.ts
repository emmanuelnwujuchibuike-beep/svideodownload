import { NextResponse } from "next/server";

import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { getAdsForZone } from "@/lib/monetization/ads";
import { getUserPlan } from "@/lib/monetization/plan";
import { getMonetizationSettings } from "@/lib/monetization/settings";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Derived, never re-listed.

  This was a hand-maintained copy of the zone list, and it silently rejected
  every placement added after it was written — `/api/ads?zone=under_download`
  returned nothing, so the new units could never fill no matter what was seeded.
  `/api/track` had the same copy with the same gap, which would have lost their
  impressions too. Three lists, one of them right.
*/
const ZONES: ReadonlySet<string> = new Set<string>(AD_ZONES);

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

  /*
    Respect the global network/format toggles so an admin can disable a whole
    network or unit type without editing every row.

    The `popunder` switch is gone along with the format — `isServableFormat` in
    the data layer now refuses those rows outright, which is a stronger
    guarantee than a toggle that defaulted to ON.
  */
  const settings = await getMonetizationSettings();
  const allowed = (a: AdSlotData): boolean => {
    const net = a.network.toLowerCase();
    if (!settings.adsense && net.includes("adsense")) return false;
    if (!settings.adsterra && net.includes("adsterra")) return false;
    if (!settings.propellerads && net.includes("propeller")) return false;
    if (!settings.interstitial && a.format === "video") return false;
    return true;
  };

  const ads = (await getAdsForZone(zone)).filter(allowed);
  const headers = { "Cache-Control": "private, max-age=30" };
  if (all) return NextResponse.json({ ads }, { headers });
  return NextResponse.json({ ad: ads[0] ?? null }, { headers });
}
