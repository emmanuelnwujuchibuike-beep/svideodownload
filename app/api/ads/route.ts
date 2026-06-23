import { NextResponse } from "next/server";

import { getAdForZone, getAdsForZone } from "@/lib/monetization/ads";
import { getUserPlan } from "@/lib/monetization/plan";
import type { AdZone } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES: ReadonlySet<string> = new Set<AdZone>([
  "global",
  "homepage_top",
  "download_result_page",
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

  if (all) {
    return NextResponse.json(
      { ads: await getAdsForZone(zone) },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  }
  return NextResponse.json(
    { ad: await getAdForZone(zone) },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
