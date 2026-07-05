import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Device push for social events (like/save/comment/follow). The in-app
 * notification row is created by DB triggers (migration 0013/0018); this mirrors
 * it to the user's registered browsers/home-screen apps so it arrives instantly
 * even with the site closed. Best-effort and never throws — call as
 * `void pushSocialEvent(...)` after the write succeeds.
 */

type SocialPushType = "like" | "save" | "comment" | "follow" | "repost";

const VERB: Record<SocialPushType, string> = {
  like: "liked your post",
  save: "saved your post",
  comment: "commented on your post",
  follow: "started following you",
  repost: "reposted your post",
};

export async function pushSocialEvent(opts: {
  actorId: string;
  type: SocialPushType;
  /** For post events the recipient is resolved from the post's publisher. */
  postId?: string;
  /** For follow — the user being followed. */
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
      recipientId = post.publisher_id as string;
      postTitle = (post.title as string | null) ?? null;
    }
    // Never push your own action back to you.
    if (!recipientId || recipientId === opts.actorId) return;

    const { data: actor } = await db
      .from("profiles")
      .select("display_name, handle, avatar_url")
      .eq("id", opts.actorId)
      .maybeSingle();
    const name =
      (actor?.display_name as string) || (actor?.handle ? `@${actor.handle as string}` : "Someone");

    await sendPushToUser(recipientId, {
      title: `${name} ${VERB[opts.type]}`,
      body: postTitle ?? (opts.type === "follow" ? "Tap to see their profile" : ""),
      url: opts.postId ? `/p/${opts.postId}` : actor?.handle ? `/u/${actor.handle as string}` : "/notifications",
      // The actor's profile picture becomes the notification's circular icon.
      icon: (actor?.avatar_url as string | null) ?? undefined,
      // Collapse repeats (e.g. a like-unlike-like burst) into one notification.
      tag: opts.postId ? `${opts.type}:${opts.postId}` : `follow:${opts.actorId}`,
    });
  } catch {
    /* push is best-effort */
  }
}
