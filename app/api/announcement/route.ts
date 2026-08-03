import { NextResponse } from "next/server";

import { getPublicAnnouncement } from "@/lib/announcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/announcement — the public site announcement (enabled-only, no secrets).
 * The top banner fetches this after paint. Cached briefly at the edge so it's cheap
 * under traffic but still reflects an admin change within a minute.
 */
export async function GET() {
  const announcement = await getPublicAnnouncement();
  return NextResponse.json(
    { announcement },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
