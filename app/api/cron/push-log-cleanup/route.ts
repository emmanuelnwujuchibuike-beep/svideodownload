import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 30;

/**
 * Prunes `push_delivery_log` rows older than 30 days — one row per push
 * ATTEMPT (lib/push/web-push.ts), so this table grows fast on an active app;
 * nothing reads history past the 7-day admin dashboard window (see
 * push-delivery-stats.ts), so 30 days is a generous retention floor, not a
 * tight one. Same auth/registration pattern as the other cron routes in this
 * app (see friend-reminders' identical comment) — not registered in
 * vercel.json by default (Hobby plan cron limits); add a daily schedule on a
 * plan that allows it.
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
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  const db = createAdminClient();
  const { error, count } = await db.from("push_delivery_log").delete({ count: "exact" }).lt("created_at", cutoff);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}

export const GET = run;
export const POST = run;
