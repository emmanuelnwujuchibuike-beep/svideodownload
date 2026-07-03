import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownerGuard(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Sign in required." };

  const db = createAdminClient();
  const { data: comment } = await db.from("post_comments").select("post_id").eq("id", id).maybeSingle();
  if (!comment) return { ok: false as const, status: 404, error: "Comment not found." };
  const { data: post } = await db.from("posts").select("publisher_id").eq("id", comment.post_id).maybeSingle();
  if (!post || post.publisher_id !== user.id) {
    return { ok: false as const, status: 403, error: "Only the creator can do that." };
  }
  return { ok: true as const, db, postId: comment.post_id as string };
}

/**
 * POST /api/comments/:id/best — the post owner marks this comment as the Best
 * Answer (only one per post, so any previous best is cleared first).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  // One best answer per post.
  await g.db.from("post_comments").update({ is_best: false }).eq("post_id", g.postId).eq("is_best", true);
  const { error } = await g.db.from("post_comments").update({ is_best: true }).eq("id", id);
  if (error) {
    const msg = /column|schema/i.test(error.message ?? "") ? "Best answer isn't enabled yet." : "Couldn't mark.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — unmark best answer. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.db.from("post_comments").update({ is_best: false }).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
