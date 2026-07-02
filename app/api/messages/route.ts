import { NextResponse } from "next/server";
import { z } from "zod";

import { sendPushToUser } from "@/lib/push/web-push";
import { assistantLimiter } from "@/lib/rate-limit";
import { listConversations, sendMessage } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/messages — the signed-in user's inbox (powers the live badge + list). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ conversations: [] });

  const conversations = await listConversations(user.id);
  const unread = conversations.filter((c) => c.unread).length;
  return NextResponse.json({ conversations, unread });
}

const schema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

/** POST /api/messages — send a message in a conversation. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await assistantLimiter.limit(`msg:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're sending messages too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a message." }, { status: 400 });

  const res = await sendMessage(user.id, parsed.data.conversationId, parsed.data.body);
  if (!res.ok) return NextResponse.json({ error: "Couldn't send (blocked or unavailable)." }, { status: 400 });

  // Web push to the recipient so a message reaches them with the site closed.
  void notifyRecipient(user.id, parsed.data.conversationId, parsed.data.body);

  return NextResponse.json({ ok: true });
}

/** Best-effort: resolve the other participant + sender name and push them the message. */
async function notifyRecipient(senderId: string, conversationId: string, body: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: conv } = await db
      .from("conversations")
      .select("user_low, user_high")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return;
    const recipientId = conv.user_low === senderId ? (conv.user_high as string) : (conv.user_low as string);

    const { data: sender } = await db
      .from("profiles")
      .select("display_name, handle")
      .eq("id", senderId)
      .maybeSingle();
    const name = (sender?.display_name as string) || (sender?.handle ? `@${sender.handle as string}` : "New message");

    await sendPushToUser(recipientId, {
      title: name,
      body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
      url: `/messages/${conversationId}`,
      tag: `msg:${conversationId}`,
    });
  } catch {
    /* push is best-effort */
  }
}
