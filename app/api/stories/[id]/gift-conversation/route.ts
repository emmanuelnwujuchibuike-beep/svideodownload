import { NextResponse } from "next/server";

import { getOrCreateConversation } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stories/[id]/gift-conversation — the chat a sticker gift FOR this story is sent into (owner, 2026-10-28:
 * "replace the story Frenz Coin button on the story reply placeholder with the Frenz gifting"). A gift is a message in
 * the 1:1 chat with the story's author, so the gift sheet asks for that chat only when the member presses Send —
 * opening the sheet, or just watching the story, never creates an empty chat.
 *
 * The same gates as a story reply (app/api/stories/reply): the member must be able to SEE the story
 * (`story_view_access`), it can't be their own, and the chat follows every direct-message rule (blocks, the author's
 * message setting) through getOrCreateConversation. The gift itself is then checked again by /api/gift/send.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "That story isn't available." }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const admin = createAdminClient();
  const [{ data: access, error: accessError }, { data: story }] = await Promise.all([
    admin.rpc("story_view_access", { p_story: id, p_viewer: user.id }),
    admin.from("stories").select("user_id").eq("id", id).maybeSingle(),
  ]);
  const authorId = (story as { user_id?: string } | null)?.user_id;
  if (accessError || access !== "ok" || !authorId) return NextResponse.json({ error: "That story isn't available." }, { status: 403 });
  if (authorId === user.id) return NextResponse.json({ error: "You can't gift your own story." }, { status: 400 });

  const conv = await getOrCreateConversation(user.id, authorId);
  if (!conv.ok) return NextResponse.json({ error: "You can't send gifts to this person." }, { status: 403 });
  return NextResponse.json({ conversationId: conv.id }, { headers: { "cache-control": "private, no-store" } });
}
