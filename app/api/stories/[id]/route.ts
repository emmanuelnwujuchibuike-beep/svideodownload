import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/stories/:id — the author removes their own story (owner,
 * 2026-10-08: "add story options like history options where user can delete…").
 *
 * Runs with the member's OWN session, so the "stories owner delete" RLS policy
 * (0015) is what enforces ownership — not a check here that could drift. A
 * story that is not theirs (or does not exist) deletes nothing and answers 404.
 *
 * The media file is NOT removed: a story posted "to both" shares its file with
 * the feed post, and the story's own expiry already ends its life.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.from("stories").delete().eq("id", id).eq("user_id", user.id).select("id");
  if (error) return NextResponse.json({ error: "Couldn't delete the story." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
