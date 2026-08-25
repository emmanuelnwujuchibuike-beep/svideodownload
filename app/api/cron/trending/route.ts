import { NextResponse } from "next/server";

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
  const [trust, updated, soundsUpdated, momentumUpdated] = await Promise.all([
    recomputeTrustScores(),
    recomputeHotScores(),
    recomputeSoundTrendScores(),
    recomputeMomentumScores(),
  ]);
  return NextResponse.json({ ok: true, updated, trust, soundsUpdated, momentumUpdated });
}

export const GET = run; // Vercel cron uses GET
export const POST = run; // admin button uses POST
