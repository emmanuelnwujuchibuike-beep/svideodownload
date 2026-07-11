import { NextResponse } from "next/server";
import { z } from "zod";

import { type PushPriority, sendSmartPush } from "@/lib/notifications/smart-delivery";
import { messageLimiter } from "@/lib/rate-limit";
import { parseMentionedHandles } from "@/lib/social/message-meta";
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
  // Idempotency key: the offline-queue (or a flaky-network retry) can safely
  // replay the exact same POST — sendMessage() dedupes on this instead of
  // creating a second message.
  clientId: z.string().max(100).optional(),
  clientSentAt: z.string().datetime().optional(),
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

  const res = await sendMessage(user.id, parsed.data.conversationId, parsed.data.body, {
    replyToId: parsed.data.replyToId,
    clientId: parsed.data.clientId,
    clientSentAt: parsed.data.clientSentAt,
  });
  if (!res.ok) return NextResponse.json({ error: "Couldn't send (blocked or unavailable)." }, { status: 400 });

  // Web push to every other active member so a message reaches them with the
  // site closed — skipped on a deduped replay, since the original send
  // already pushed (an offline-queue retry must never double-notify).
  if (!res.duplicate) void notifyMembers(user.id, parsed.data.conversationId, parsed.data.body);

  return NextResponse.json({ ok: true, id: res.id, duplicate: res.duplicate ?? false });
}

/**
 * Best-effort: resolve every other active member + sender name and push them
 * the message. Every millisecond here is added latency before the push even
 * leaves our server (separate from — and much smaller than — the delivery
 * hop itself), so the member lookup, sender-profile lookup, and burst check
 * run in PARALLEL rather than sequentially.
 *
 * Smart delivery: a mention (or any direct-thread message) is `high`
 * priority — always pushed, even during the recipient's Do Not Disturb;
 * a plain group message is `medium` — held back during DND (still lands
 * in-app via Realtime + the Notification Center). A burst of several
 * messages in the last minute collapses into one "N new messages" push
 * instead of spamming one per message (the existing `tag` already makes a
 * newer push REPLACE the last one at the OS level — this makes the
 * REPLACEMENT say something truthful about the burst, not just show
 * whichever message happened to be last).
 */
async function notifyMembers(senderId: string, conversationId: string, body: string): Promise<void> {
  try {
    const db = createAdminClient();
    const [{ data: conv }, { data: memberRows }, { data: sender }, { count: burstCount }] = await Promise.all([
      db.from("conversations").select("type").eq("id", conversationId).maybeSingle(),
      db.from("conversation_members").select("user_id").eq("conversation_id", conversationId).is("left_at", null).neq("user_id", senderId),
      db.from("profiles").select("display_name, handle, avatar_url").eq("id", senderId).maybeSingle(),
      db
        .from("messages")
        .select("id", { head: true, count: "exact" })
        .eq("conversation_id", conversationId)
        .neq("sender_id", senderId)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString()),
    ]);
    const recipientIds = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (recipientIds.length === 0) return;

    const mentionedHandles = parseMentionedHandles(body);
    let mentionedRecipientIds = new Set<string>();
    if (mentionedHandles.length > 0) {
      const { data: recipientProfiles } = await db.from("profiles").select("id, handle").in("id", recipientIds);
      const idByHandle = new Map(
        ((recipientProfiles ?? []) as { id: string; handle: string | null }[])
          .filter((p) => p.handle)
          .map((p) => [p.handle!.toLowerCase(), p.id]),
      );
      mentionedRecipientIds = new Set(mentionedHandles.map((h) => idByHandle.get(h)).filter((id): id is string => !!id));
    }

    const name = (sender?.display_name as string) || (sender?.handle ? `@${sender.handle as string}` : "New message");
    const isGroup = conv?.type === "group";
    const isBurst = (burstCount ?? 0) > 1;
    const preview = isBurst ? `${burstCount} new messages` : body.length > 140 ? `${body.slice(0, 140)}…` : body;

    await Promise.all(
      recipientIds.map((recipientId) => {
        const mentioned = mentionedRecipientIds.has(recipientId);
        const priority: PushPriority = mentioned || !isGroup ? "high" : "medium";
        return sendSmartPush(
          recipientId,
          {
            title: mentioned ? `${name} mentioned you` : name,
            body: preview,
            url: `/messages/${conversationId}`,
            icon: (sender?.avatar_url as string | null) ?? undefined,
            tag: `msg:${conversationId}`,
            conversationId,
            actions: [
              { action: "mark_read", title: "Mark as read" },
              { action: "mute", title: "Mute" },
            ],
          },
          priority,
        );
      }),
    );
  } catch {
    /* push is best-effort */
  }
}
