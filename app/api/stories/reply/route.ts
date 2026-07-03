import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  toUserId: z.string().uuid(),
  text: z.string().trim().min(1).max(500),
});

/**
 * POST /api/stories/reply — reply to a story. Delivered as a direct message to
 * the story's author (creating the conversation if needed), prefixed so they see
 * it's a story reply. Powers text / emoji / sticker replies from the viewer.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reply." }, { status: 400 });
  const { toUserId, text } = parsed.data;

  if (toUserId === user.id) return NextResponse.json({ error: "You can't reply to your own story." }, { status: 400 });

  const conv = await getOrCreateConversation(user.id, toUserId);
  if (!conv.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 403 });

  const sent = await sendMessage(user.id, conv.id, `↩️ Replied to your story: ${text}`);
  if (!sent.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 500 });
  return NextResponse.json({ ok: true, conversationId: conv.id });
}
