import { NextResponse } from "next/server";

import { getMonetizationSettings } from "@/lib/monetization/settings";
import { getRecommendedTools, PLACEMENTS, type Placement } from "@/lib/monetization/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public recommended-tools feed for client-rendered surfaces (e.g. the live
 * download-result card). Returns [] when the global toggle is off or nothing
 * targets the placement.
 */
export async function GET(request: Request) {
  const placement = new URL(request.url).searchParams.get("placement") ?? "";
  if (!PLACEMENTS.includes(placement as Placement)) {
    return NextResponse.json({ tools: [] }, { status: 400 });
  }

  const settings = await getMonetizationSettings();
  if (!settings.recommendedTools) return NextResponse.json({ tools: [] });

  const tools = await getRecommendedTools(placement as Placement, 6);
  return NextResponse.json({ tools }, { headers: { "Cache-Control": "private, max-age=60" } });
}
