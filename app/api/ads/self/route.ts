import { NextResponse } from "next/server";

import { loadServingPayload } from "@/lib/ads-platform/server";
import { CDN_BUCKET_CACHE_CONTROL } from "@/lib/net/cdn-bucket";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
/*
  🔴 force-dynamic + a CDN header — NOT `export const revalidate` (an ISR write
  per regeneration, the line that dominated the 2026-10-04 bill). Same shape as
  /api/ads/inventory.
*/
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/self?b=<5-minute bucket>
 *
 * The self-serve campaigns' serving payload: every placement's rotation pool,
 * the admin's format rules, the global switch. Identical for every visitor —
 * no cookie, no plan lookup — so the CDN answers it and this function runs at
 * most once per bucket per region, however many visitors and page changes
 * there are. Rotation, the no-repeat rule, page targeting and the exact
 * campaign window are then applied in the browser with no further request.
 *
 * An admin switch (global off, placement off, campaign paused) reaches every
 * visitor within one bucket: the URL changes every five minutes, so neither
 * the browser nor Cloudflare's TTL rewrite can hold an older answer.
 */
export async function GET() {
  try {
    const payload = await loadServingPayload(createAdminClient());
    return NextResponse.json(payload, { headers: { "Cache-Control": CDN_BUCKET_CACHE_CONTROL } });
  } catch (e) {
    console.error("[ads-platform] serving payload failed", { error: String(e).slice(0, 200) });
    // Unknown ⇒ the browser serves nothing. Never cache a failure.
    return NextResponse.json(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
