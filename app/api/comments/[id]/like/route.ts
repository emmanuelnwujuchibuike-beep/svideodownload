import { NextResponse } from "next/server";
import { z } from "zod";

import { isCommentReaction } from "@/lib/social/comment-meta";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ emoji: z.string().max(8).optional() });

/**
 * POST /api/comments/:id/like — react to a comment. Body may carry an `emoji`
 * (defaults to ❤️); one reaction per user, so re-reacting with a different emoji
 * replaces it. DELETE removes the reaction. likes_count (total reactions) is
 * trigger-maintained.
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
    if (parsed.success && parsed.data.emoji && isCommentReaction(parsed.data.emoji)) emoji = parsed.data.emoji;
  } catch {
    /* empty body → default ❤️ */
  }

  // Upsert with emoji (update on conflict). Fall back to a plain like if the
  // emoji column isn't migrated yet.
  let { error } = await supabase
    .from("comment_reactions")
    .upsert({ comment_id: id, user_id: user.id, emoji }, { onConflict: "comment_id,user_id" });
  if (error && /column|schema/i.test(error.message ?? "")) {
    ({ error } = await supabase
      .from("comment_reactions")
      .upsert({ comment_id: id, user_id: user.id }, { onConflict: "comment_id,user_id", ignoreDuplicates: true }));
  }
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

  const { error } = await supabase.from("comment_reactions").delete().eq("comment_id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
