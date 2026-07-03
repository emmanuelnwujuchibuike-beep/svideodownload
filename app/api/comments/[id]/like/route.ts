import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/comments/:id/like — like a comment (idempotent).
 * DELETE — remove the like. The likes_count on the comment is trigger-maintained.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase
    .from("comment_reactions")
    .upsert({ comment_id: id, user_id: user.id }, { onConflict: "comment_id,user_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: "Couldn't like." }, { status: 500 });
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
  if (error) return NextResponse.json({ error: "Couldn't unlike." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
