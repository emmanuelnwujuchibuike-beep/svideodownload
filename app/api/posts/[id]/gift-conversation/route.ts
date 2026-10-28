import { NextResponse } from "next/server";

import { getOrCreateConversation } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/[id]/gift-conversation — the chat a sticker gift FOR this post is sent into (owner, 2026-10-28: "add
 * the sticker gifting in the feed, reels and AI reels, and exclusive posts' comments"). A gift is a message in the 1:1
 * chat with the post's creator, so the gift sheet asks for that chat only when Send is pressed — opening the sheet, or
 * scrolling past the post, never creates an empty chat.
 *
 * Gates: a published post that isn't the caller's own, and every direct-message rule (blocks, the creator's message
 * setting) through getOrCreateConversation. The gift itself is checked again by /api/gift/send.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "That post isn't available." }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to send a gift." }, { status: 401 });

  const { data: post } = await createAdminClient().from("posts").select("publisher_id, status").eq("id", id).maybeSingle();
  const authorId = (post as { publisher_id?: string; status?: string } | null)?.publisher_id;
  if (!post || !authorId || (post as { status?: string }).status !== "published") return NextResponse.json({ error: "That post isn't available." }, { status: 404 });
  if (authorId === user.id) return NextResponse.json({ error: "You can't gift your own post." }, { status: 400 });

  const conv = await getOrCreateConversation(user.id, authorId);
  if (!conv.ok) return NextResponse.json({ error: "You can't send gifts to this person." }, { status: 403 });
  return NextResponse.json({ conversationId: conv.id }, { headers: { "cache-control": "private, no-store" } });
}
