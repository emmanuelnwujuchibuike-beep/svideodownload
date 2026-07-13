import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRACE_DAYS = 30;

/**
 * Purges accounts whose deletion grace period (30 days from request, set by
 * `POST /api/account/delete`) has elapsed. Uses Supabase's own
 * `auth.admin.deleteUser` — every table with a `references auth.users(id)
 * on delete cascade` FK (profiles, posts, comments, follows, blocks, mutes,
 * sessions, …, the established pattern throughout this schema) cleans up
 * automatically; this route doesn't hand-roll a 30-table cascade itself.
 * Same cron auth pattern as every other scheduled route in this app.
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
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 864e5).toISOString();

  const { data: due, error } = await db.from("profiles").select("id").not("deletion_requested_at", "is", null).lt("deletion_requested_at", cutoff);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let purged = 0;
  for (const row of (due ?? []) as { id: string }[]) {
    const { error: delErr } = await db.auth.admin.deleteUser(row.id);
    if (!delErr) purged += 1;
  }

  return NextResponse.json({ ok: true, purged });
}

export const GET = run;
export const POST = run;
