import { NextResponse } from "next/server";

import { sweepDueScheduledPosts } from "@/lib/creator/schedule";
import { cronAuthorized } from "@/lib/cron/auth";
import { recomputeHotScores, recomputeTrustScores } from "@/lib/social/feed";
import { recomputeMomentumScores } from "@/lib/social/momentum";
import { recomputeSoundTrendScores } from "@/lib/social/sounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recompute trending scores. Authorised by either a Vercel-cron bearer token
 * (CRON_SECRET) or an admin session (for the manual "Recompute now" button).
 *
 * Momentum (Feature 15 Part 8) rides the same cron rather than claiming its
 * own Vercel schedule slot — same call already made for sound trend scores
 * below, and Vercel cron slots are a scarce, explicitly-tracked resource on
 * this project (see the cron-auth incident write-up).
 */

async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Maintenance: refresh trust scores first (feeds into discovery), then
  // recompute trending with the latest counters.
  const [trust, updated, soundsUpdated, momentumUpdated, publishedOnSchedule] = await Promise.all([
    recomputeTrustScores(),
    recomputeHotScores(),
    recomputeSoundTrendScores(),
    recomputeMomentumScores(),
    /*
      Scheduled publishing's guaranteed floor (Feature 15 Part 9). The sweep
      normally runs off real traffic, within about a minute of a post's time;
      this is what publishes a due post on a site nobody visited overnight.
      Same "ride an existing cron rather than claim a scarce slot" call the
      Momentum Engine made above.
    */
    sweepDueScheduledPosts(),
  ]);
  return NextResponse.json({ ok: true, updated, trust, soundsUpdated, momentumUpdated, publishedOnSchedule });
}

export const GET = run; // Vercel cron uses GET
export const POST = run; // admin button uses POST
