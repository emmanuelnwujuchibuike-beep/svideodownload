import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * POST /api/mute/:id — mute a creator: their posts stop appearing in the
 * MUTER's own feed, silently (unlike a block, nothing is severed and the
 * muted creator is never notified). Best-effort against a not-yet-applied
 * migration 0035 — a missing table degrades to "couldn't mute" rather than
 * a 500 with a confusing stack trace.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.id === id) return NextResponse.json({ error: "You can't mute yourself." }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.from("muted_creators").upsert({ muter_id: user.id, muted_id: id }, { onConflict: "muter_id,muted_id" });
  if (error) return NextResponse.json({ error: "Couldn't mute." }, { status: 500 });
  return NextResponse.json({ ok: true, muted: true });
}

/** DELETE /api/mute/:id — unmute a creator. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = createAdminClient();
  const { error } = await db.from("muted_creators").delete().eq("muter_id", user.id).eq("muted_id", id);
  if (error) return NextResponse.json({ error: "Couldn't unmute." }, { status: 500 });
  return NextResponse.json({ ok: true, muted: false });
}
