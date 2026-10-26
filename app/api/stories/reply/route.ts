import { after, NextResponse } from "next/server";
import { z } from "zod";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { STORY_REPLY_PREFIX } from "@/lib/social/story-reply-text";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  toUserId: z.string().uuid(),
  text: z.string().trim().min(1).max(500),
  /** The story replied to (the Story viewer design, 2026-10-26). Older clients omit it. */
  storyId: z.string().uuid().optional(),
  /** A reaction (Love it, Fire, Wow, the heart, a double-tap, a one-emoji reply) — counted for the author (0288). */
  reaction: z.boolean().optional(),
  /** Stories Part 4 (B6): one key per reply, reused on a retry — the SAME message comes back, nothing is sent twice. */
  clientId: z.string().uuid().optional(),
});

/**
 * POST /api/stories/reply — reply to a story. Delivered as a direct message to
 * the story's author (creating the conversation if needed), prefixed so they see
 * it's a story reply. Powers text / emoji / sticker replies from the viewer.
 *
 * With `storyId` (the new viewer always sends it):
 *   · the replier must be able to SEE that story (`story_view_access`, 0285/0287)
 *     and it must be this author's — a reply never reaches past a block;
 *   · the author's "Allow replies" switch (0288) is obeyed: off → 403;
 *   · a `reaction` is recorded once per person per story (story_reactions, 0288)
 *     so the author's "Seen by" can count it. Best-effort: an unapplied 0288
 *     never stops the message itself.
 *
 * ── Stories Part 4 (2026-10-26, audit B6): the notification is reliable and says WHICH story ──
 *   · the reply is SAVED first (sendMessage, which writes the in-app notification row through
 *     the messages trigger); only then does the push go — in `after()`, the framework's
 *     post-response hook, not a bare `void` a serverless function may freeze mid-way;
 *   · a push that fails never turns a saved reply into an error;
 *   · `clientId` makes a retry return the SAME message (sendMessage's idempotency): no second
 *     message, no second push, no second reaction;
 *   · the message carries `{ kind: "story_reply", storyId }` and the push shows the story's
 *     own picture — sent only to its AUTHOR, so no story is shown to anyone else;
 *   · the push goes through sendSmartPush like every chat message (Do Not Disturb, hidden
 *     previews, the in-app row's delivery stamp), not straight to the device.
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
  const { toUserId, text, storyId, reaction, clientId } = parsed.data;

  if (toUserId === user.id) return NextResponse.json({ error: "You can't reply to your own story." }, { status: 400 });

  // the story's own picture, for its AUTHOR's notification only
  let storyCover: string | null = null;
  if (storyId) {
    const admin = createAdminClient();
    const [{ data: access, error: accessError }, storyRead] = await Promise.all([
      admin.rpc("story_view_access", { p_story: storyId, p_viewer: user.id }),
      admin.from("stories").select("user_id, allow_replies, media_kind, media_url, thumbnail_url").eq("id", storyId).maybeSingle(),
    ]);
    // 0288 not applied: read the author without the switch (replies stay on, the column's default)
    const story = (storyRead.error ? (await admin.from("stories").select("user_id, media_kind, media_url, thumbnail_url").eq("id", storyId).maybeSingle()).data : storyRead.data) as
      | { user_id: string; allow_replies?: boolean | null; media_kind?: string; media_url?: string; thumbnail_url?: string | null }
      | null;
    if (accessError || access !== "ok" || !story || story.user_id !== toUserId) {
      return NextResponse.json({ error: "That story isn't available." }, { status: 403 });
    }
    if (story.allow_replies === false) {
      return NextResponse.json({ error: "Replies are off for this story." }, { status: 403 });
    }
    storyCover = story.media_kind === "image" ? (story.media_url ?? null) : (story.thumbnail_url ?? null);
  }

  // the same rule as any direct message (blocks, the recipient's message setting) — lib/social/messages.ts canMessage
  const conv = await getOrCreateConversation(user.id, toUserId);
  if (!conv.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 403 });

  // SAVED first. A retry with the same clientId returns this same message (duplicate: true).
  // no emoji in the text (2026-10-26): the chat draws the "Replied to your story" label with its own icon (lib/social/story-reply-text.ts)
  const sent = await sendMessage(user.id, conv.id, `${STORY_REPLY_PREFIX}${text}`, {
    ...(clientId ? { clientId } : {}),
    ...(storyId ? { metadata: { kind: "story_reply", storyId } } : {}),
  });
  if (!sent.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 500 });

  // a replay already did all of this the first time — nothing more is counted or pushed
  if (!sent.duplicate) {
    if (storyId && reaction) {
      await createAdminClient()
        .from("story_reactions")
        .upsert({ story_id: storyId, reactor_id: user.id, emoji: text.slice(0, 16), reacted_at: new Date().toISOString() }, { onConflict: "story_id,reactor_id" })
        .then(
          () => undefined,
          () => undefined,
        );
    }
    const replierId = user.id;
    const conversationId = conv.id;
    after(() => notifyStoryReply({ authorId: toUserId, replierId, conversationId, text, storyCover }));
  }

  return NextResponse.json({ ok: true, conversationId: conv.id, duplicate: sent.duplicate ?? false });
}

/**
 * The author's push: "Ada replied to your story", the reply, the story's own picture, opening the chat. Through
 * sendSmartPush like any direct message — the in-app row was written by the messages trigger, so only its delivery is
 * stamped. Never throws: the reply is already saved.
 */
async function notifyStoryReply(r: { authorId: string; replierId: string; conversationId: string; text: string; storyCover: string | null }): Promise<void> {
  try {
    const { data: actor } = await createAdminClient().from("profiles").select("display_name, handle, avatar_url").eq("id", r.replierId).maybeSingle();
    const name = (actor?.display_name as string) || (actor?.handle ? `@${actor.handle as string}` : "Someone");
    const preview = r.text.length > 140 ? `${r.text.slice(0, 140)}…` : r.text;
    await sendSmartPush(
      r.authorId,
      {
        title: `${name} replied to your story`,
        body: preview,
        genericBody: "Replied to your story",
        url: `${SITE_URL}/messages/${r.conversationId}`,
        // the story itself when there is one (its author is the only recipient), else the replier's face
        icon: r.storyCover ?? (actor?.avatar_url as string | null) ?? undefined,
        tag: `msg:${r.conversationId}`,
        conversationId: r.conversationId,
      },
      "high",
      "social",
      { recorded: { type: "message", conversationId: r.conversationId, actorId: r.replierId } },
    );
  } catch (e) {
    console.warn("[stories/reply] push failed — the reply is saved", { error: e instanceof Error ? e.name : "unknown" });
  }
}
