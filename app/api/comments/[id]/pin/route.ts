import { NextResponse } from "next/server";
import { z } from "zod";

import { isPinLabel, MAX_PINNED } from "@/lib/social/comment-meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ label: z.string().max(20).optional() });

/** Resolves the signed-in user and confirms they own the comment's post. */
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
 * POST /api/comments/:id/pin — the post owner pins a comment, optionally
 * labelled (Important/Announcement/FAQ/Update/Winner/Guideline). Multiple
 * pins are allowed — the brief's own pin categories imply that — capped at
 * MAX_PINNED per post so the top of a thread can't be entirely pins.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  let label: string | null = null;
  try {
    const parsed = schema.safeParse(await req.json());
    if (parsed.success && parsed.data.label && isPinLabel(parsed.data.label)) label = parsed.data.label;
  } catch {
    /* no body → unlabelled pin */
  }

  const { count } = await g.db
    .from("post_comments")
    .select("id", { head: true, count: "exact" })
    .eq("post_id", g.postId)
    .eq("pinned", true);
  if ((count ?? 0) >= MAX_PINNED) {
    return NextResponse.json({ error: `Up to ${MAX_PINNED} pinned comments — unpin one first.` }, { status: 409 });
  }

  const { error } = await g.db
    .from("post_comments")
    .update({ pinned: true, pin_label: label, pinned_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    const msg = /column|schema/i.test(error.message ?? "") ? "Pinning isn't enabled yet." : "Couldn't pin.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — unpin. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const g = await ownerGuard(id);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.db.from("post_comments").update({ pinned: false, pin_label: null, pinned_at: null }).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't unpin." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
