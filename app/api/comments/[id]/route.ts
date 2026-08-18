import { NextResponse } from "next/server";
import { z } from "zod";

import { commentSpamReason } from "@/lib/social/engagement";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patchSchema = z.object({ body: z.string().min(1).max(1000) });

/**
 * DELETE /api/comments/:id — remove a comment. RLS allows the author, the post's
 * publisher (moderate their own post), or an admin.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { error } = await supabase.from("post_comments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/comments/:id — edit a comment's text. Author only — RLS lets a
 * post owner/admin delete someone else's comment for moderation, but never
 * rewrite it; that distinction is enforced here (query filters on author_id,
 * not just row existence) since RLS on this table is delete/select scoped.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  const body = parsed.data.body.trim();
  const spam = commentSpamReason(body);
  if (spam) return NextResponse.json({ error: spam }, { status: 400 });

  const { data, error } = await supabase
    .from("post_comments")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("author_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const msg = /column|schema/i.test(error.message ?? "") ? "Editing isn't enabled yet." : "Couldn't save.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Only the author can edit this." }, { status: 403 });
  return NextResponse.json({ ok: true });
}
