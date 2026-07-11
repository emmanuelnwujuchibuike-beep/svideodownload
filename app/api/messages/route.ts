import { NextResponse } from "next/server";
import { z } from "zod";

import { sendPushToUser } from "@/lib/push/web-push";
import { messageLimiter } from "@/lib/rate-limit";
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
  replyToId: z.string().uuid().optional(),
});

/** POST /api/messages — send a message in a conversation (direct or group). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await messageLimiter.limit(`msg:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're sending messages too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a message." }, { status: 400 });

  const res = await sendMessage(user.id, parsed.data.conversationId, parsed.data.body, parsed.data.replyToId);
  if (!res.ok) return NextResponse.json({ error: "Couldn't send (blocked or unavailable)." }, { status: 400 });

  // Web push to every other active member so a message reaches them with the site closed.
  void notifyMembers(user.id, parsed.data.conversationId, parsed.data.body);

  return NextResponse.json({ ok: true, id: res.id });
}

/**
 * Best-effort: resolve every other active member + sender name and push them
 * the message. Every millisecond here is added latency before the push even
 * leaves our server (separate from — and much smaller than — the delivery
 * hop itself), so the member lookup and sender-profile lookup run in
 * PARALLEL rather than sequentially.
 */
async function notifyMembers(senderId: string, conversationId: string, body: string): Promise<void> {
  try {
    const db = createAdminClient();
    const [{ data: members }, { data: sender }] = await Promise.all([
      db.from("conversation_members").select("user_id").eq("conversation_id", conversationId).is("left_at", null).neq("user_id", senderId),
      db.from("profiles").select("display_name, handle, avatar_url").eq("id", senderId).maybeSingle(),
    ]);
    const recipients = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (recipients.length === 0) return;
    const name = (sender?.display_name as string) || (sender?.handle ? `@${sender.handle as string}` : "New message");
    const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;

    await Promise.all(
      recipients.map((recipientId) =>
        sendPushToUser(recipientId, {
          title: name,
          body: preview,
          url: `/messages/${conversationId}`,
          icon: (sender?.avatar_url as string | null) ?? undefined,
          tag: `msg:${conversationId}`,
        }),
      ),
    );
  } catch {
    /* push is best-effort */
  }
}
