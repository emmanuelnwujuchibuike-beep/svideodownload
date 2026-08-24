import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { runStreakReminders } from "@/lib/streaks/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly streak-reminder sweep.
 *
 * 🔴 HOURLY, NOT "AT 2 PM". "2 PM" is 24 different instants — one per zone —
 * and a single daily run at a fixed UTC hour would reach one band of the world
 * and silently never fire for everyone else. Each run asks, per candidate, "is
 * it past 14:00 where THEY are, and have they been here today?"; the
 * once-per-day guarantee comes from `last_reminder_date`, not from the
 * schedule. See lib/streaks/reminders.ts.
 *
 * Authorised exactly like every other cron here — see lib/cron/auth.ts: the
 * `CRON_SECRET` env var, a database-backed token (`npm run cron:token`), or an
 * admin session for the manual "run now" case.
 *
 * NOT registered in vercel.json — the Hobby plan's two-cron budget is already
 * spent by `trending` and `profile-snapshots` (same situation as
 * `wallpaper-reminder` and `digest`). Trigger it from whichever external
 * scheduler covers the other unregistered crons, hourly:  0 * * * *
 */

async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await runStreakReminders());
}

export const GET = run;
export const POST = run;
