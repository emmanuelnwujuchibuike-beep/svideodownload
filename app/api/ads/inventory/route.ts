import { NextResponse } from "next/server";

import { computeAdInventory } from "@/lib/monetization/ad-inventory";
import { CDN_BUCKET_CACHE_CONTROL } from "@/lib/net/cdn-bucket";

export const runtime = "nodejs";
/*
  🔴 force-dynamic + a CDN header — NOT `export const revalidate`.
  An ISR route writes a cache entry on every regeneration (an ISR Write, the
  line that dominated the 2026-10-04 bill). `s-maxage` lets the Vercel CDN
  answer repeats without invoking this function and without any ISR write.
*/
export const dynamic = "force-dynamic";

/**
 * GET /api/ads/inventory?b=<5-minute bucket>
 *
 * The one ad request a page makes while ads are OFF — and normally the CDN
 * answers it. Identical for every visitor (no cookies read, no plan lookup),
 * which is what makes it cacheable where every other ad endpoint is private.
 * See lib/monetization/ad-inventory-shape.ts for why the bucket exists.
 */
export async function GET() {
  try {
    const inventory = await computeAdInventory();
    return NextResponse.json(inventory, {
      headers: { "Cache-Control": CDN_BUCKET_CACHE_CONTROL },
    });
  } catch {
    // Unknown ⇒ the client requests exactly as before. Never cache a failure.
    return NextResponse.json(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
