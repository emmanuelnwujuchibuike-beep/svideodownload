import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/messages/msg/[id]/star — save a message to your private Starred
 * list (Part 10). Distinct from `pinned` (visible to the whole conversation,
 * one at a time) — starring is a personal, unlimited save, never shown to
 * anyone else. Writes go through the RLS-scoped client, not admin — same
 * membership-implied-by-readability pattern the reactions route already
 * uses: if RLS lets this client SELECT the message at all, its author is
 * already a participant of that conversation.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data: msg } = await supabase.from("messages").select("id, deleted_at").eq("id", id).maybeSingle();
  if (!msg || msg.deleted_at) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  const { error } = await supabase
    .from("starred_messages")
    .upsert({ user_id: user.id, message_id: id }, { onConflict: "user_id,message_id" });
  if (error) return NextResponse.json({ error: "Couldn't star." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase.from("starred_messages").delete().eq("message_id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
