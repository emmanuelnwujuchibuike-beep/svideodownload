import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/cron/auth";
import { runStoryCleanup } from "@/lib/social/story-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pages stop starting at 45 s (lib/social/story-cleanup.ts), so this is headroom, not a target. */
export const maxDuration = 60;

/**
 * The Stories expiry sweep (Part 1, 2026-10-26) — removes expired stories, their
 * viewer lists, and the files nothing else uses. See lib/social/story-cleanup.ts.
 *
 * Authorised exactly like every other cron here (lib/cron/auth.ts): `CRON_SECRET`,
 * a database-backed token (`npm run cron:token`), or an admin session for a manual
 * run. Clocked once a day by .github/workflows/cron-story-cleanup.yml — not
 * vercel.json, whose two Hobby slots are spent by `trending` and `profile-snapshots`.
 */
async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await runStoryCleanup());
}

export const GET = run;
export const POST = run;
