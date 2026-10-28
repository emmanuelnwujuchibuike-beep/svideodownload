import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConversation } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ to: z.string().uuid() }).strict();

/**
 * POST /api/gift/conversation — the 1:1 chat a sticker gift to this person is sent into, found or created only when
 * Send is pressed (owner, 2026-10-28: gifting from exclusive posts' comments — those posts live outside the feed's posts
 * table, so the gift names their creator). Every direct-message rule applies (blocks, the person's message setting)
 * through getOrCreateConversation; the gift itself is checked again by /api/gift/send.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to send a gift." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (parsed.data.to === user.id) return NextResponse.json({ error: "You can't gift yourself." }, { status: 400 });
  const conv = await getOrCreateConversation(user.id, parsed.data.to);
  if (!conv.ok) return NextResponse.json({ error: "You can't send gifts to this person." }, { status: 403 });
  return NextResponse.json({ conversationId: conv.id }, { headers: { "cache-control": "private, no-store" } });
}
