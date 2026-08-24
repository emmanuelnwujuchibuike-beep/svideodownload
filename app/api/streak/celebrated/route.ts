import { getStreak, markCelebrated, neutralState } from "@/lib/streaks/engine";
import { streakContext, streakResponse } from "@/lib/streaks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/streak/celebrated — record that today's celebration has been shown.
 *
 * Called by the celebration component once, as it opens. The date is written
 * server-side and compared server-side, so a refresh, a route change, a PWA
 * relaunch or a second tab can never replay the animation: `shouldCelebrate`
 * simply stops being true for the rest of that local day.
 */
export async function POST(request: Request) {
  const ctx = await streakContext(request);
  if (!ctx.enabled) return streakResponse(neutralState(), ctx);

  await markCelebrated(ctx.identity);
  return streakResponse(await getStreak(ctx.identity), ctx);
}
