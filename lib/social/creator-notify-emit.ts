import { publishNotification } from "@/lib/notifications/publish";
import { createAdminClient } from "@/lib/supabase/admin";

import { subscribersFor, type CreatorNotificationChannel } from "./creator-notifications";

/**
 * Fan-out for per-creator notification subscriptions.
 *
 * Owner, 2026-08-23: "make users to be able to turn on and off another users
 * post notification, stories notification, feed or share notification."
 *
 * The `shares` channel is an opt-OUT checked inline at its single existing
 * emission point (app/api/posts/[id]/share/route.ts). The other three are
 * opt-IN and had no emission point at all — nothing in the app has ever
 * notified anyone about a new post, story or repost. This is that code.
 *
 * ── Always fire-and-forget ────────────────────────────────────────────────
 * Every function here swallows its own errors and is called with `void`.
 * Publishing a post must never fail because a notification could not be
 * delivered, and migration 0129 may not be applied everywhere yet — the same
 * discipline `createSound`/`attachSoundToPost` already follow in posts.ts.
 */

/**
 * Cap on how many subscribers one event notifies.
 *
 * `subscribersFor` is already paginated and capped at 20 000, but that is a
 * bound on the QUERY. This is a bound on the WORK: each notification is a row
 * insert plus a push, so a very popular account publishing once could
 * otherwise turn a single request into tens of thousands of sequential
 * operations inside a serverless invocation that will time out long before it
 * finishes — delivering an arbitrary prefix and silently dropping the rest.
 *
 * At this cap the fan-out is bounded and honest. Crossing it is a real scale
 * problem that wants a queue, not a bigger number here.
 */
const MAX_FANOUT = 2_000;

/** Delivered in batches so one slow push cannot stall the whole fan-out. */
const BATCH = 25;

async function fanOut(
  targetId: string,
  channel: CreatorNotificationChannel,
  build: (viewerId: string) => Parameters<typeof publishNotification>[0],
): Promise<void> {
  try {
    const subscribers = (await subscribersFor(targetId, channel)).slice(0, MAX_FANOUT);
    if (subscribers.length === 0) return;

    for (let i = 0; i < subscribers.length; i += BATCH) {
      await Promise.all(
        subscribers.slice(i, i + BATCH).map((viewerId) =>
          publishNotification(build(viewerId)).catch(() => {}),
        ),
      );
    }
  } catch {
    /* never let a notification failure affect the action that triggered it */
  }
}

/** The creator's @handle, for notification copy. Null when unavailable. */
async function handleOf(userId: string): Promise<string | null> {
  try {
    const db = createAdminClient();
    const { data } = await db.from("profiles").select("handle").eq("id", userId).maybeSingle();
    return (data?.handle as string) ?? null;
  } catch {
    return null;
  }
}

/** Someone you asked to hear from published a post. */
export async function notifyNewPost(
  publisherId: string,
  postId: string,
  caption: string | null,
): Promise<void> {
  const handle = await handleOf(publisherId);
  const who = handle ? `@${handle}` : "Someone you follow";
  // The caption can now be 250 words (lib/social/caption.ts) — a push body has
  // to be a glance, so it is cut to one short line here rather than shipping a
  // paragraph to a lock screen.
  const preview = (caption ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  await fanOut(publisherId, "posts", (userId) => ({
    userId,
    type: "news_following",
    actorId: publisherId,
    postId,
    push: {
      title: `${who} posted`,
      body: preview || "Tap to see the new post.",
      // The generic body is what shows when the device is locked and the
      // viewer has content previews off — it must reveal nothing.
      genericBody: "New post from someone you follow.",
      url: `/p/${postId}`,
    },
  }));
}

/** Someone you asked to hear from added to their story. */
export async function notifyNewStory(publisherId: string): Promise<void> {
  const handle = await handleOf(publisherId);
  const who = handle ? `@${handle}` : "Someone you follow";
  await fanOut(publisherId, "stories", (userId) => ({
    userId,
    type: "news_following",
    actorId: publisherId,
    push: {
      title: `${who} added a story`,
      body: "Tap to watch before it disappears.",
      genericBody: "New story from someone you follow.",
      // Stories are viewed from the person's profile, which is where the
      // story tray for that account lives.
      url: handle ? `/u/${handle}` : "/friends",
    },
  }));
}

/** Someone you asked to hear from reposted or reshared something. */
export async function notifyFeedActivity(
  actorId: string,
  postId: string,
): Promise<void> {
  const handle = await handleOf(actorId);
  const who = handle ? `@${handle}` : "Someone you follow";
  await fanOut(actorId, "feed", (userId) => ({
    userId,
    type: "news_following",
    actorId,
    postId,
    push: {
      title: `${who} reposted`,
      body: "Tap to see what they shared.",
      genericBody: "New activity from someone you follow.",
      url: `/p/${postId}`,
    },
  }));
}
