import { NextResponse } from "next/server";

import { getPublicAnnouncement } from "@/lib/announcement";
import { CDN_BUCKET_CACHE_CONTROL } from "@/lib/net/cdn-bucket";

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
  /*
    One global answer for every visitor, so the CDN serves it: the banner asks
    for `?b=<5-minute bucket>` once per document (it used to ask `no-store` on
    EVERY client navigation — measured 2026-10-05). An admin change is live
    within one bucket. See lib/net/cdn-bucket.ts; carved out of the wide
    no-store rule in next.config.ts.
  */
  return NextResponse.json({ announcement }, { headers: { "Cache-Control": CDN_BUCKET_CACHE_CONTROL } });
}
