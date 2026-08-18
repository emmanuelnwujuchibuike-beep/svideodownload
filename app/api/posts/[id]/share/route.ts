import { NextResponse } from "next/server";
import { z } from "zod";

import { sendPushToUser } from "@/lib/push/web-push";
import { shareLimiter } from "@/lib/rate-limit";
import { publishNotification } from "@/lib/notifications/publish";
import { checkShareSpam, type ShareHistoryEntry } from "@/lib/social/share/antispam";
import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { getPost } from "@/lib/social/posts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    /** Recipient user ids (1:1 — a conversation is found/created per id). */
    to: z.array(z.string().uuid()).max(10).optional().default([]),
    /** Existing GROUP conversation ids — sent directly, no per-recipient
     *  conversation lookup (a group has no single "other" user). Real gap
     *  found by audit: ShareSheet previously had no way to address a group
     *  at all, unlike reshare's destination picker. */
    toGroups: z.array(z.string().uuid()).max(10).optional().default([]),
    note: z.string().trim().max(500).optional(),
  })
  // Capped so a share can't be used as a blast tool regardless of how the
  // 10 slots split between people and groups.
  .refine((v) => v.to.length + v.toGroups.length >= 1 && v.to.length + v.toGroups.length <= 10, {
    message: "Pick 1-10 destinations.",
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

  const { success } = await shareLimiter.limit(`share:${user.id}`);
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

  // Graded antispam (lib/social/share/antispam.ts) — the Upstash limiter
  // above is the cross-instance backstop; this is the part that can explain
  // itself. `block` refuses the send outright (rate no human hand produces);
  // `throttle` still delivers (the recipients did nothing wrong) but the
  // response tells the client to skip the counter bump + skips the author
  // notification below, so repeated abuse doesn't self-reinforce.
  const db = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: historyRows } = await db
    .from("share_events")
    .select("post_id, creator_id, created_at")
    .eq("sharer_id", user.id)
    .gte("created_at", since)
    .limit(200);
  const history: ShareHistoryEntry[] = (historyRows ?? []).map((r) => ({
    postId: r.post_id as string,
    creatorId: r.creator_id as string,
    createdAt: new Date(r.created_at as string).getTime(),
    recipientCount: 0,
  }));
  const spam = checkShareSpam({ recent: history, targetCreatorId: post.publisher.id, now: Date.now() });
  if (spam.verdict === "block") {
    return NextResponse.json(
      { error: spam.reasons[0] ?? "Couldn't share right now." },
      { status: 429, headers: spam.retryAfterMs ? { "Retry-After": String(Math.ceil(spam.retryAfterMs / 1000)) } : {} },
    );
  }
  const throttled = spam.verdict === "throttle";

  const origin = new URL(request.url).origin;
  const link = `${origin}/p/${id}`;
  const note = parsed.data.note;
  const body = note ? `${note}\n${link}` : link;

  const recipients = [...new Set(parsed.data.to)].filter((r) => r !== user.id);
  let sent = 0;
  const sentRecipientIds: string[] = [];
  for (const rid of recipients) {
    const conv = await getOrCreateConversation(user.id, rid);
    if (!conv.ok) continue;
    const res = await sendMessage(user.id, conv.id, body);
    if (!res.ok) continue;
    sent += 1;
    sentRecipientIds.push(rid);
    void pushShared(user.id, rid, conv.id, note);
  }

  // Group conversations — sent directly (no per-recipient lookup, a group has
  // no single "other" user). sendMessage() itself verifies the sender is an
  // active member (conversation_members, left_at is null), so a group id the
  // sharer isn't actually part of just fails closed here, not silently sent.
  let sentToGroup = false;
  for (const cid of new Set(parsed.data.toGroups)) {
    const res = await sendMessage(user.id, cid, body);
    if (!res.ok) continue;
    sent += 1;
    sentToGroup = true;
  }

  if (sent === 0) return NextResponse.json({ error: "Couldn't send to anyone selected." }, { status: 400 });

  // recipient_ids only ever holds actual USER ids (the `to` list) — a group
  // has member recipients we don't individually attribute here, so a
  // group-only send records kind='group' with no recipient list (§ledger's
  // own "unknown ≠ zero" note: unmeasured, not zero).
  void db
    .from("share_events")
    .insert({
      sharer_id: user.id,
      post_id: id,
      creator_id: post.publisher.id,
      recipient_count: sent,
      kind: sentRecipientIds.length > 0 ? "dm" : sentToGroup ? "group" : "dm",
      recipient_ids: sentRecipientIds.length > 0 ? sentRecipientIds : null,
    })
    .then(
      () => {},
      () => {},
    );

  // Tell the post's author their post was shared — ONE notification per share
  // action (not per recipient, which would burst up to 10 at once for a
  // single tap). The `share` NotificationType has been fully registered
  // (icon, verb string, priority) since it was built but never actually
  // emitted anywhere — this is that missing call. Skipped when throttled —
  // that's the whole point of the verdict.
  if (post.publisher.id !== user.id && !throttled) {
    void publishNotification({
      userId: post.publisher.id,
      type: "share",
      actorId: user.id,
      postId: id,
      push: {
        title: "Your post was shared",
        body: sent > 1 ? `Shared with ${sent} people.` : "Someone shared your post.",
        genericBody: "Someone shared your post.",
        url: `/p/${id}`,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, sent, throttled });
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
