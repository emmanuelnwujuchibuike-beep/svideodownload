import { NextResponse } from "next/server";

import { getPublicAnnouncement } from "@/lib/announcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/announcement — the public site announcement (enabled-only, no secrets).
 * The top banner fetches this after paint. NOT edge-cached, so an admin change
 * appears on the next page load instead of waiting out a CDN TTL (owner: "I updated
 * it but didn't see it immediately"). Kept cheap by a short in-memory cache in
 * getPublicAnnouncement rather than a CDN cache.
 */
export async function GET() {
  const announcement = await getPublicAnnouncement();
  return NextResponse.json({ announcement }, { headers: { "Cache-Control": "no-store" } });
}
