import { NextResponse } from "next/server";

import { getUserPlan } from "@/lib/monetization/plan";
import { clientId, peekDaily } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { wallpaperDailyLimit, WALLPAPER_REWARD_SECONDS } from "@/lib/wallpapers-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallpapers/allowance — how many free wallpaper downloads are left
 * today, and whether this visitor watches an ad for the next one.
 *
 * ── Why the UI asks instead of assuming ───────────────────────────────────────
 * The gate that matters is in `/api/wallpaper?dl=1`; this endpoint exists so the
 * interface can be honest BEFORE someone taps — showing "3 left today" beside
 * the button, and a 30-second countdown they were expecting rather than one that
 * ambushes them. Finding out you were over the limit only after sitting through
 * half an ad is the version of this that makes people angry.
 *
 * It deliberately PEEKS: reading the allowance must never spend it. A page that
 * consumed a download just by rendering would be indistinguishable from the
 * runaway counter bug this whole area is recovering from.
 */
export async function GET(request: Request) {
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* signed out — the free allowance is keyed by IP */
  }

  const plan = await getUserPlan(userId);
  const limit = wallpaperDailyLimit(plan);

  // 0 = uncapped (Pro/Business). No counter to read, no ad to watch.
  if (limit === 0) {
    return NextResponse.json(
      { limit: 0, used: 0, remaining: null, needsAd: false, adSeconds: 0, plan },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const key = userId ? `wp:u:${userId}` : `wp:ip:${clientId(request.headers)}`;
  const used = await peekDaily(key);
  return NextResponse.json(
    {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      needsAd: true,
      adSeconds: WALLPAPER_REWARD_SECONDS,
      plan,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
