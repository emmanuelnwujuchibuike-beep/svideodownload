import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { recomputeHotScores } from "@/lib/social/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recompute trending scores. Authorised by either a Vercel-cron bearer token
 * (CRON_SECRET) or an admin session (for the manual "Recompute now" button).
 */
async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return !!(await getAdminUser());
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const updated = await recomputeHotScores();
  return NextResponse.json({ ok: true, updated });
}

export const GET = run; // Vercel cron uses GET
export const POST = run; // admin button uses POST
