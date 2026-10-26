import { NextResponse } from "next/server";

import { cacheDelete } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/stories/:id — the author removes their own story (owner,
 * 2026-10-08: "add story options like history options where user can delete…").
 *
 * Runs with the member's OWN session, and `expire_own_story` (0285) takes
 * ownership from auth.uid() inside the database — not a check here that could
 * drift. A story that is not theirs (or does not exist) changes nothing and
 * answers 404.
 *
 * 🔴 Stories Part 1 (2026-10-26, audit S1): the story is ENDED, not removed.
 * It leaves every ring and viewer at once (they all read `expires_at > now`),
 * and the daily sweep (lib/social/story-cleanup.ts) then removes the row, its
 * viewer list, and its file when nothing else uses it — a story posted "to
 * both" shares its file with the feed post, which keeps it. Removing the row
 * here was what left every deleted story's file online for good: the row was
 * the only record of which file it was. This route still never deletes a file itself.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.rpc("expire_own_story", { p_story: id });
  if (error) return NextResponse.json({ error: "Couldn't delete the story." }, { status: 500 });
  if (data !== true) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/stories/:id  { allowReplies: boolean } — the author's "Allow replies"
 * switch (Story options, 0288). A member session cannot update a story (0285), so
 * the service role writes it — only after matching the row to THIS member, in the
 * same statement (`.eq("user_id", user.id)`): another member's story changes
 * nothing and answers 404. The 0285 trigger still guards the story's life.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { allowReplies?: unknown } | null;
  if (typeof body?.allowReplies !== "boolean") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("stories")
    .update({ allow_replies: body.allowReplies })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // the author's own rings carry the switch — their 20 s copy must not show the old value
  await Promise.all((["all", "friends", "following"] as const).map((s) => cacheDelete(`stories:${user.id}:${s}`))).catch(() => {});
  return NextResponse.json({ ok: true, allowReplies: body.allowReplies });
}
