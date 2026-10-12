import { defaultPriorityFor } from "@/lib/notifications/priority";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { pushPerson } from "@/lib/push/identity";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Device push for social events (like/save/comment/follow). The in-app
 * notification row is created by DB triggers (migration 0013/0018); this mirrors
 * it to the user's registered browsers/home-screen apps so it arrives instantly
 * even with the site closed. Best-effort and never throws — call as
 * `after(() => pushSocialEvent(...))` after the write succeeds (next/server's
 * `after()`, not a bare `void` — a fire-and-forget call started right before a
 * serverless Route Handler returns isn't guaranteed to finish; see the
 * 2026-07-12 fix at every call site for the "push arrives minutes late" bug
 * this caused).
 */

type SocialPushType = "like" | "save" | "comment" | "reply" | "follow" | "repost";

const VERB: Record<SocialPushType, string> = {
  like: "Wow'd your post",
  save: "saved your post",
  comment: "commented on your post",
  reply: "replied to your comment",
  follow: "started following you",
  repost: "reposted your post",
};

export async function pushSocialEvent(opts: {
  actorId: string;
  type: SocialPushType;
  /** For post events the recipient defaults to the post's publisher — unless
   *  `recipientId` is already given (e.g. a reply's recipient is the parent
   *  comment's author, not the post owner), in which case that wins; either
   *  way the post is still looked up for its title. */
  postId?: string;
  /** For follow — the user being followed. Also overrides postId's default
   *  recipient (see above) when both are given. */
  recipientId?: string;
}): Promise<void> {
  try {
    const db = createAdminClient();

    let recipientId = opts.recipientId ?? null;
    let postTitle: string | null = null;
    if (opts.postId) {
      const { data: post } = await db
        .from("posts")
        .select("publisher_id, title")
        .eq("id", opts.postId)
        .maybeSingle();
      if (!post) return;
      if (!recipientId) recipientId = post.publisher_id as string;
      postTitle = (post.title as string | null) ?? null;
    }
    // Never push your own action back to you.
    if (!recipientId || recipientId === opts.actorId) return;

    /*
      Rich identity (owner 2026-10-12: "just like WhatsApp and Instagram"): the PERSON is
      the title and the icon, what they did is the body. And it now goes through the
      Attention Engine like every other push — before, these went straight to the device,
      past Do Not Disturb, focus modes, quiet hours and the member's category switches.
      The in-app row was written by the database trigger; a held push is stamped on it.
    */
    const who = await pushPerson(opts.actorId);
    await sendSmartPush(
      recipientId,
      {
        title: who.name,
        body: cap(postTitle ? `${VERB[opts.type]} · ${postTitle}` : VERB[opts.type]),
        genericBody: "New activity on Frenz",
        url: opts.postId ? `/p/${opts.postId}` : who.handle ? `/u/${who.handle}` : "/notifications",
        icon: who.icon,
        // Collapse repeats (e.g. a like-unlike-like burst) into one notification.
        tag: opts.postId ? `${opts.type}:${opts.postId}` : `follow:${opts.actorId}`,
        actorId: opts.actorId,
      },
      defaultPriorityFor(opts.type),
      "social",
      { recorded: { type: opts.type, actorId: opts.actorId } },
    );
  } catch {
    /* push is best-effort */
  }
}

/** "commented on your post" → "Commented on your post" — the body starts a sentence now the name is the title. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
