import { getStreak, neutralState, restoreStreak } from "@/lib/streaks/engine";
import { streakContext, streakResponse } from "@/lib/streaks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/streak/restore — bring back an interrupted streak.
 *
 * Every guard lives in the engine and the pure calculator: the restore window,
 * the lifetime cap, and a conditional UPDATE that no-ops if a concurrent
 * request already restored. A client that hammers this endpoint gets one
 * restore and then `ok: false` — there is nothing here to spend twice.
 */
export async function POST(request: Request) {
  const ctx = await streakContext(request);
  if (!ctx.enabled) return streakResponse(neutralState(), ctx);

  const restored = await restoreStreak(ctx.identity);
  if (!restored) {
    // Not an error: "you can't restore" is a legitimate answer, and a 4xx here
    // would surface as a broken page rather than a disabled button.
    return streakResponse({ ok: false, state: await getStreak(ctx.identity) }, ctx);
  }
  return streakResponse({ ok: true, state: restored }, ctx);
}
