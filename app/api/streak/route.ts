import { z } from "zod";

import { getStreak, neutralState, recordActivity } from "@/lib/streaks/engine";
import { streakContext, streakResponse } from "@/lib/streaks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The streak API.
 *
 *   GET  /api/streak  — current state, records nothing.
 *   POST /api/streak  — credit today's activity (idempotent), return the state.
 *
 * Both work for anonymous and signed-in visitors; the identity is resolved
 * server-side (lib/streaks/identity.ts) and the response plants an httpOnly
 * cookie the first time an anonymous visitor is seen.
 *
 * 🔴 The ONLY thing a client may assert is "I was here, and my timezone is X".
 * Streak numbers, dates and statuses are all computed from server time — see
 * the note at the top of lib/streaks/engine.ts.
 */

const bodySchema = z.object({
  /**
   * IANA zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
   * Untrusted: validated by `safeZone` before it reaches a formatter, and it
   * can only move a day boundary by hours, never manufacture a day.
   */
  timezone: z.string().min(1).max(64).optional(),
});

export async function GET(request: Request) {
  const ctx = await streakContext(request);
  if (!ctx.enabled) return streakResponse(neutralState(), ctx);
  return streakResponse(await getStreak(ctx.identity), ctx);
}

export async function POST(request: Request) {
  const ctx = await streakContext(request);
  if (!ctx.enabled) return streakResponse(neutralState(), ctx);

  let timezone: string | null = null;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (parsed.success) timezone = parsed.data.timezone ?? null;
  } catch {
    /* no body is fine — the stored zone (or UTC) is used */
  }

  return streakResponse(await recordActivity(ctx.identity, timezone), ctx);
}
