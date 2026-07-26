import { NextResponse } from "next/server";

import { resolveMonetagPlacements, resolveMonetagTags } from "@/lib/monetization/monetag";
import { getMonetizationSettings } from "@/lib/monetization/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Monetag config for the client injector.
 *
 * ── Why the client fetches this instead of the server baking it ───────────────
 *
 * The marketing pages are `force-static` and the layout revalidates on ISR, so a
 * server-rendered Monetag tag is baked at build/revalidate time — an admin change
 * doesn't appear until the page regenerates. Fetching the config on the client (the
 * same freshness the placed-ad endpoint `/api/ads` gives) means a change in the
 * admin shows within seconds, with no rebuild.
 *
 * ── Safe to be public ─────────────────────────────────────────────────────────
 *
 * It returns already-PARSED tags (`{ src, zone, cfAsync }`) — never the raw admin
 * snippet — plus the moment placements and the page scope. Those tags load in the
 * browser anyway, so there's nothing here that isn't already public. Premium
 * (Pro/Business are ad-free) and page-scope gating happen on the client, so this
 * response is user-independent and can be cached briefly at the edge.
 */
export async function GET() {
  const settings = await getMonetizationSettings();
  return NextResponse.json(
    {
      tags: resolveMonetagTags(settings),
      placements: resolveMonetagPlacements(settings),
      allPages: settings.monetagAllPages,
      surfaces: settings.monetagSurfaces,
    },
    { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } },
  );
}
