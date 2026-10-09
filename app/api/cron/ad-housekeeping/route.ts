import { NextResponse } from "next/server";

import { runAdHousekeeping } from "@/lib/ads-platform/housekeeping";
import { cronAuthorized } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ad Platform Part 8: hourly ad housekeeping (retention, blocklist rescan,
 * asset cleanup, and one deduped admin alert for open flags). Authorised like
 * every cron here (lib/cron/auth.ts). Clocked by
 * .github/workflows/cron-ad-housekeeping.yml, because the Vercel cron slots
 * are spent.
 */
async function run(request: Request) {
  if (!(await cronAuthorized(request))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await runAdHousekeeping(createAdminClient()));
}

export const GET = run;
export const POST = run;
