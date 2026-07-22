import { NextResponse } from "next/server";

import { getMonetizationSettings, normalizeSkipSeconds } from "@/lib/monetization/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, non-user-specific ad behaviour config the client needs before an ad
 * fills — currently just the admin-set interstitial skip delay. Kept off the
 * per-zone `/api/ads` response because it is global, not per-slot, and the
 * interstitial needs it whether or not a creative ends up filling. Cached
 * briefly so it costs about nothing.
 */
export async function GET() {
  const settings = await getMonetizationSettings();
  return NextResponse.json(
    { interstitialSkipSeconds: normalizeSkipSeconds(settings.interstitialSkipSeconds) },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
