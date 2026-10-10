import { NextResponse } from "next/server";

import { computeReach } from "@/lib/ads-platform/reach";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/reach — each ad placement's MEASURED share of page views over
 * the last 30 days (lib/ads-platform/reach.ts). Aggregate and public: no user,
 * no campaign, nothing private. Cached at the CDN for an hour, so the whole
 * site costs at most one computation per region per hour.
 */
export async function GET() {
  try {
    const db = createAdminClient();
    const { data } = await db.from("ad_placements").select("code, page_scope").eq("enabled", true);
    const answer = await computeReach(db, (data ?? []) as { code: string; page_scope: string[] }[]);
    return NextResponse.json(answer, { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ windowDays: 30, placements: null, measuredAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } });
  }
}
