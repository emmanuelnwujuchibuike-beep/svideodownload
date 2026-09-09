import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { runAiRetention } from "@/lib/ai/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A page of deletions, not a backlog catch-up — see the BATCH note. */
export const maxDuration = 120;

/**
 * The AI retention sweep (Part 7 · §7, §37).
 *
 * 🔴 It keeps a promise that has been on screen since Part 3 and enforced by
 * nothing: "Kept privately for three days, then deleted." Every source video
 * and every result any member has ever uploaded is still in the bucket, because
 * `expires_at` was written, indexed, read for display — and never acted on.
 *
 * Authorised exactly like every other cron here (lib/cron/auth.ts): the
 * `CRON_SECRET` env var, a database-backed token (`npm run cron:token`), or an
 * admin session for the manual "run now" case.
 *
 * NOT registered in vercel.json — the Hobby plan's two cron slots are long
 * spent by `trending` and `profile-snapshots`. GitHub Actions is the clock for
 * every unregistered cron in this project, and this joins them rather than
 * introducing a fourth mechanism. Hourly is plenty: retention is a three-day
 * promise, so the sweep only has to be punctual to within a lot less than that.
 */
async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await runAiRetention());
}

export const GET = run;
export const POST = run;
