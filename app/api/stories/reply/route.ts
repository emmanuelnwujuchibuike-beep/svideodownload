import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { sendPushToUser } from "@/lib/push/web-push";
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
  const { toUserId, text, storyId, reaction } = parsed.data;

  if (toUserId === user.id) return NextResponse.json({ error: "You can't reply to your own story." }, { status: 400 });

  if (storyId) {
    const admin = createAdminClient();
    const [{ data: access, error: accessError }, storyRead] = await Promise.all([
      admin.rpc("story_view_access", { p_story: storyId, p_viewer: user.id }),
      admin.from("stories").select("user_id, allow_replies").eq("id", storyId).maybeSingle(),
    ]);
    // 0288 not applied: read the author without the switch (replies stay on, the column's default)
    const story = storyRead.error ? (await admin.from("stories").select("user_id").eq("id", storyId).maybeSingle()).data : storyRead.data;
    if (accessError || access !== "ok" || !story || (story.user_id as string) !== toUserId) {
      return NextResponse.json({ error: "That story isn't available." }, { status: 403 });
    }
    if ((story as { allow_replies?: boolean | null }).allow_replies === false) {
      return NextResponse.json({ error: "Replies are off for this story." }, { status: 403 });
    }
  }

  const conv = await getOrCreateConversation(user.id, toUserId);
  if (!conv.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 403 });

  const sent = await sendMessage(user.id, conv.id, `↩️ Replied to your story: ${text}`);
  if (!sent.ok) return NextResponse.json({ error: "Couldn't send." }, { status: 500 });

  if (storyId && reaction) {
    await createAdminClient()
      .from("story_reactions")
      .upsert({ story_id: storyId, reactor_id: user.id, emoji: text.slice(0, 16), reacted_at: new Date().toISOString() }, { onConflict: "story_id,reactor_id" })
      .then(
        () => undefined,
        () => undefined,
      );
  }

  // Device push to the story author (this path bypasses the messages API route,
  // so it wouldn't otherwise push when they're away).
  void (async () => {
    try {
      const { data: actor } = await createAdminClient()
        .from("profiles")
        .select("display_name, handle, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      const name = (actor?.display_name as string) || (actor?.handle ? `@${actor.handle as string}` : "Someone");
      await sendPushToUser(toUserId, {
        // rich identity (2026-10-12): the person is the title, like a chat app
        title: name,
        body: `Replied to your story: ${text}`,
        url: `/messages/${conv.id}`,
        icon: (actor?.avatar_url as string | null) ?? undefined,
        tag: `story-reply:${user.id}`,
      });
    } catch {
      /* best-effort */
    }
  })();

  return NextResponse.json({ ok: true, conversationId: conv.id });
}
