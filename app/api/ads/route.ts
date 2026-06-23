import { NextResponse } from "next/server";

import { getAdForZone } from "@/lib/monetization/ads";
import { getUserPlan } from "@/lib/monetization/plan";
import type { AdZone } from "@/lib/monetization/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES: ReadonlySet<string> = new Set<AdZone>([
  "homepage_top",
  "download_result_page",
  "sidebar",
  "exit_intent_popup",
  "mobile_bottom_banner",
]);

/** Returns the ad slot to render for a zone, or null for premium users. */
export async function GET(request: Request) {
  const zone = new URL(request.url).searchParams.get("zone") ?? "";
  if (!ZONES.has(zone)) {
    return NextResponse.json({ ad: null }, { status: 400 });
  }

  // Premium users never see ads.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const plan = await getUserPlan(user?.id);
    if (plan !== "free") return NextResponse.json({ ad: null });
  } catch {
    /* no session → treat as free */
  }

  const ad = await getAdForZone(zone);
  return NextResponse.json(
    { ad },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
