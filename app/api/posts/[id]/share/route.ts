import { NextResponse } from "next/server";
import { z } from "zod";

import { sendPushToUser } from "@/lib/push/web-push";
import { assistantLimiter } from "@/lib/rate-limit";
import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { getPost } from "@/lib/social/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  /** Recipient user ids — capped so shares can't be used as a blast tool. */
  to: z.array(z.string().uuid()).min(1).max(10),
  note: z.string().trim().max(500).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/posts/[id]/share — send a post to friends as direct messages
 * (the Share sheet's internal send). Sender must be able to SEE the post
 * (privacy respected); each recipient's own access is enforced again when
 * they open the link (the post page privacy-gates). Blocked/unavailable
 * pairs fail silently per-recipient so one bad recipient never voids the rest.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await assistantLimiter.limit(`share:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're sharing too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Pick at least one person." }, { status: 400 });

  // Privacy: the sender must be able to see the post at all.
  const post = await getPost(id, user.id);
  if (!post) return NextResponse.json({ error: "Post unavailable." }, { status: 404 });

  const origin = new URL(request.url).origin;
  const link = `${origin}/p/${id}`;
  const note = parsed.data.note;
  const body = note ? `${note}\n${link}` : link;

  const recipients = [...new Set(parsed.data.to)].filter((r) => r !== user.id);
  let sent = 0;
  for (const rid of recipients) {
    const conv = await getOrCreateConversation(user.id, rid);
    if (!conv.ok) continue;
    const res = await sendMessage(user.id, conv.id, body);
    if (!res.ok) continue;
    sent += 1;
    void pushShared(user.id, rid, conv.id, note);
  }

  if (sent === 0) return NextResponse.json({ error: "Couldn't send to anyone selected." }, { status: 400 });
  return NextResponse.json({ ok: true, sent });
}

/** Best-effort push: "<name> shared a post" → opens the conversation. */
async function pushShared(senderId: string, recipientId: string, conversationId: string, note?: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: sender } = await db
      .from("profiles")
      .select("display_name, handle, avatar_url")
      .eq("id", senderId)
      .maybeSingle();
    const name = (sender?.display_name as string) || (sender?.handle ? `@${sender.handle as string}` : "Someone");
    await sendPushToUser(recipientId, {
      title: `${name} shared a post`,
      body: note ? (note.length > 120 ? `${note.slice(0, 120)}…` : note) : "Tap to see it",
      url: `/messages/${conversationId}`,
      icon: (sender?.avatar_url as string | null) ?? undefined,
      tag: `msg:${conversationId}`,
    });
  } catch {
    /* push is best-effort */
  }
}
