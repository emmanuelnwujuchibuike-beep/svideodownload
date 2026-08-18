import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves the signed-in user, the comment's author, and confirms the
 *  caller owns the POST this comment is on (same ownerGuard shape as
 *  pin/best — the post owner moderates their own post's comments). */
async function ownerGuard(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Sign in required." };

  const db = createAdminClient();
  const { data: comment } = await db.from("post_comments").select("post_id, author_id").eq("id", id).maybeSingle();
  if (!comment) return { ok: false as const, status: 404, error: "Comment not found." };
  const { data: post } = await db.from("posts").select("publisher_id").eq("id", comment.post_id).maybeSingle();
  if (!post || post.publisher_id !== user.id) {
    return { ok: false as const, status: 403, error: "Only the creator can do that." };
  }
  const authorId = comment.author_id as string;
  if (authorId === user.id) return { ok: false as const, status: 400, error: "You can't mute yourself." };
  return { ok: true as const, db, userId: user.id, authorId };
}

/**
 * POST /api/comments/:id/mute-author — the post owner mutes the comment's
 * author from commenting on ANY of their posts going forward (narrower than
 * a block — see migration 0122's own comment: the muted user keeps
 * following/messaging/seeing the creator's posts, they just can't comment).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.db.from("comment_muted_users").upsert(
    { creator_id: g.userId, muted_user_id: g.authorId },
    { onConflict: "creator_id,muted_user_id" },
  );
  if (error) {
    const msg = /column|schema|relation/i.test(error.message ?? "") ? "Muting isn't enabled yet." : "Couldn't mute.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — unmute. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.db.from("comment_muted_users").delete().eq("creator_id", g.userId).eq("muted_user_id", g.authorId);
  if (error) return NextResponse.json({ error: "Couldn't unmute." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
