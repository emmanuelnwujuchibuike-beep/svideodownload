import { NextResponse } from "next/server";

import { getMonetizationSettings } from "@/lib/monetization/settings";
import { getRecommendedTools, PLACEMENTS, type Placement } from "@/lib/monetization/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public recommended-tools feed for client-rendered surfaces (e.g. the live
 * download-result card). Returns [] when the global toggle is off or nothing
 * targets the placement.
 *
 * Part 9: the same answer for every visitor (service-role reads keyed only by
 * `placement`, which is in the URL), so the CDN serves it for a minute and
 * refreshes in the background instead of every result card reaching the DB.
 */
const SHARED = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };
export async function GET(request: Request) {
  const placement = new URL(request.url).searchParams.get("placement") ?? "";
  if (!PLACEMENTS.includes(placement as Placement)) {
    return NextResponse.json({ tools: [] }, { status: 400 });
  }

  const settings = await getMonetizationSettings();
  if (!settings.recommendedTools) return NextResponse.json({ tools: [] }, { headers: SHARED });

  const tools = await getRecommendedTools(placement as Placement, 6);
  return NextResponse.json({ tools }, { headers: SHARED });
}
