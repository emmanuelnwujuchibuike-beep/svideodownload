import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Soft-deletes messages whose conversation has disappearing messages
 * enabled (migration 0061) and whose age has passed the configured
 * `disappear_after_seconds`. Reuses the existing `messages.deleted_at`
 * soft-delete column/UI (same "This message was deleted" rendering
 * `deleteMessage()` already produces) — no new message-level state.
 * Not to-the-second precise (runs on whatever cron cadence is registered),
 * an honest, real approximation rather than a client-side timer that could
 * be bypassed. Same auth pattern as the other cron routes in this app.
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

  const { data: convs, error: convError } = await db
    .from("conversations")
    .select("id, disappear_after_seconds")
    .not("disappear_after_seconds", "is", null);
  if (convError) return NextResponse.json({ ok: false, error: convError.message }, { status: 500 });

  let deleted = 0;
  const now = new Date().toISOString();
  for (const conv of (convs ?? []) as { id: string; disappear_after_seconds: number }[]) {
    const cutoff = new Date(Date.now() - conv.disappear_after_seconds * 1000).toISOString();
    const { count, error } = await db
      .from("messages")
      .update({ body: "", deleted_at: now, pinned: false, pinned_at: null, pinned_by: null }, { count: "exact" })
      .eq("conversation_id", conv.id)
      .lt("created_at", cutoff)
      .is("deleted_at", null);
    if (!error) deleted += count ?? 0;
  }

  return NextResponse.json({ ok: true, deleted });
}

export const GET = run;
export const POST = run;
