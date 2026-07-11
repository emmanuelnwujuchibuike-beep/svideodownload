import { NextResponse } from "next/server";
import { z } from "zod";

import { isMessageReaction } from "@/lib/social/message-meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ emoji: z.string().max(8).optional() });

/**
 * POST /api/messages/msg/[id]/reactions — react to a message. Body may carry
 * an `emoji` (defaults to ❤️); one reaction per user (re-reacting with a
 * different emoji replaces it, mirroring comment_reactions' upsert). Writes
 * go through the RLS-scoped client (not admin) — `message_reactions`' own
 * policy re-verifies the sender is an active member of the message's
 * conversation, matching the comment-reaction precedent this mirrors.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let emoji = "❤️";
  try {
    const parsed = schema.safeParse(await request.json());
    if (parsed.success && parsed.data.emoji && isMessageReaction(parsed.data.emoji)) emoji = parsed.data.emoji;
  } catch {
    /* empty body → default ❤️ */
  }

  const { data: msg } = await supabase.from("messages").select("conversation_id").eq("id", id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  const { error } = await supabase
    .from("message_reactions")
    .upsert(
      { message_id: id, conversation_id: msg.conversation_id, user_id: user.id, emoji },
      { onConflict: "message_id,user_id" },
    );
  if (error) return NextResponse.json({ error: "Couldn't react." }, { status: 500 });
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

  const { error } = await supabase.from("message_reactions").delete().eq("message_id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

interface Reactor {
  emoji: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** GET /api/messages/msg/[id]/reactions — who reacted, with which emoji (members only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ reactors: [] }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ reactors: [] }, { status: 401 });

  try {
    const db = createAdminClient();
    const { data: msg } = await db.from("messages").select("conversation_id").eq("id", id).maybeSingle();
    if (!msg) return NextResponse.json({ reactors: [] });
    const { data: membership } = await db
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", msg.conversation_id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle();
    if (!membership) return NextResponse.json({ reactors: [] }, { status: 403 });

    const { data: rows } = await db.from("message_reactions").select("user_id, emoji").eq("message_id", id).limit(200);
    const list = (rows ?? []) as { user_id: string; emoji: string }[];
    if (list.length === 0) return NextResponse.json({ reactors: [] });

    const ids = [...new Set(list.map((r) => r.user_id))];
    const { data: profs } = await db.from("profiles").select("id, handle, display_name, avatar_url, is_suspended").in("id", ids);
    const byId = new Map<string, { handle: string; displayName: string; avatarUrl: string | null }>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      if ((p.is_suspended as boolean) || !p.handle) continue;
      byId.set(p.id as string, {
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string) ?? null,
      });
    }
    const reactors: Reactor[] = [];
    for (const r of list) {
      const card = byId.get(r.user_id);
      if (!card) continue;
      reactors.push({ emoji: r.emoji || "❤️", ...card });
    }
    return NextResponse.json({ reactors }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ reactors: [] });
  }
}
