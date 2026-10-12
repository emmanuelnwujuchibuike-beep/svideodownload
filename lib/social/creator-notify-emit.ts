import { publishNotification } from "@/lib/notifications/publish";
import { pushPerson } from "@/lib/push/identity";
import { createAdminClient } from "@/lib/supabase/admin";

import { subscribersFor, type CreatorNotificationChannel } from "./creator-notifications";

/**
 * Fan-out for per-creator notification subscriptions ("Notify me when Sarah posts").
 *
 * Owner, 2026-08-23: "make users to be able to turn on and off another users
 * post notification, stories notification, feed or share notification." The
 * `shares` channel is an opt-OUT checked at its one emission point; posts,
 * stories and feed are opt-IN — `posts` defaults false, so a creator nobody
 * subscribed to costs one indexed lookup that returns nothing.
 *
 * ── Who is eligible (premium notification brief, 2026-10-12) ─────────────
 * Opting in is necessary, never sufficient. A subscriber is notified only if:
 *   · the post is PUBLISHED (never a draft, a scheduled post, one under review
 *     or removed) — checked against the row, not the caller's word
 *   · they may SEE it: public → anyone; followers → they follow the publisher;
 *     private → nobody (a notification would leak that it exists)
 *   · neither has BLOCKED the other, and they haven't MUTED the creator
 *   · they haven't ALREADY been told about this post (idempotent: an edit, a
 *     retry or a second call never notifies twice)
 * Each signal is one batched query over the subscriber list, never one per
 * person. And opting in is the only relevance signal used — no interaction
 * history, online status or behaviour is read to decide who hears about what.
 *
 * ── Bounded, and never on the request's critical path ────────────────────
 * Callers run this in `after()`. MAX_FANOUT bounds the work per event; a
 * creator with more opted-in subscribers than that needs a queue, which is a
 * real scale problem this app does not have yet (documented, not hidden).
 */
const MAX_FANOUT = 2_000;
const BATCH = 25;
const CHUNK = 500;

type Db = ReturnType<typeof createAdminClient>;
type Visibility = "public" | "followers" | "private";

/**
 * Pure: who of `subscribers` may be told. `follows` are the subscribers who follow the
 * publisher; `excluded` are blocked either way, muting, or already notified.
 */
export function eligibleViewers(input: { publisherId: string; subscribers: readonly string[]; visibility: Visibility; follows: ReadonlySet<string>; excluded: ReadonlySet<string> }): string[] {
  if (input.visibility === "private") return [];
  return input.subscribers.filter((v) => v !== input.publisherId && !input.excluded.has(v) && (input.visibility === "public" || input.follows.has(v)));
}

/** Rows for `ids`, in chunks (PostgREST URL length). THROWS on a failed read — callers that decide privacy must fail closed. */
async function inChunks<T>(ids: readonly string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await run(ids.slice(i, i + CHUNK));
    if (error) throw new Error("read failed");
    if (data) out.push(...data);
  }
  return out;
}

/** The same read with expires_at (0232), or without it while 0232 isn't live — a missing column must not open the door. */
async function withExpiry<T>(ids: readonly string[], full: (c: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>, base: (c: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    return await inChunks(ids, full);
  } catch {
    return inChunks(ids, base);
  }
}

/** Blocked either way, or muting the publisher (an expired temporary block or mute no longer counts). */
export async function excludedFor(db: Db, publisherId: string, viewers: readonly string[]): Promise<Set<string>> {
  const now = new Date().toISOString();
  const live = <R extends { expires_at?: string | null }>(r: R) => !r.expires_at || r.expires_at > now;
  // any read that still fails throws — the caller then notifies nobody (fail closed)
  const [blockedByThem, blockedThem, muting] = await Promise.all([
    withExpiry<{ blocked_id: string; expires_at?: string | null }>(viewers, (c) => db.from("blocks").select("blocked_id, expires_at").eq("blocker_id", publisherId).in("blocked_id", c), (c) => db.from("blocks").select("blocked_id").eq("blocker_id", publisherId).in("blocked_id", c)),
    withExpiry<{ blocker_id: string; expires_at?: string | null }>(viewers, (c) => db.from("blocks").select("blocker_id, expires_at").eq("blocked_id", publisherId).in("blocker_id", c), (c) => db.from("blocks").select("blocker_id").eq("blocked_id", publisherId).in("blocker_id", c)),
    withExpiry<{ muter_id: string; expires_at?: string | null }>(viewers, (c) => db.from("muted_creators").select("muter_id, expires_at").eq("muted_id", publisherId).in("muter_id", c), (c) => db.from("muted_creators").select("muter_id").eq("muted_id", publisherId).in("muter_id", c)),
  ]);
  return new Set([...blockedByThem.filter(live).map((r) => r.blocked_id), ...blockedThem.filter(live).map((r) => r.blocker_id), ...muting.filter(live).map((r) => r.muter_id)]);
}

async function deliver(viewers: readonly string[], build: (viewerId: string) => Parameters<typeof publishNotification>[0]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < viewers.length; i += BATCH) {
    await Promise.all(
      viewers.slice(i, i + BATCH).map((viewerId) =>
        publishNotification(build(viewerId))
          .then(() => void (sent += 1))
          .catch(() => {}),
      ),
    );
  }
  return sent;
}

/** What kind of thing was published, in words — a reel, an AI video, a photo post. */
export function contentNoun(p: { media_kind?: string | null; content_type?: string | null; ai_job_id?: string | null }): string {
  if (p.ai_job_id || p.content_type === "ai") return "a new AI video";
  if (p.media_kind === "video") return "a new reel";
  return "a new post";
}

/** Someone you asked to hear from published a post. */
export async function notifyNewPost(publisherId: string, postId: string, caption: string | null): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: post } = await db.from("posts").select("publisher_id, status, visibility, media_kind, content_type, ai_job_id, scheduled_at").eq("id", postId).maybeSingle();
    const p = post as { publisher_id: string; status: string; visibility: Visibility; media_kind: string | null; content_type: string | null; ai_job_id: string | null; scheduled_at: string | null } | null;
    // only a real, published, visible-now post — never a draft, a scheduled one, or one under review
    if (!p || p.publisher_id !== publisherId || p.status !== "published" || p.visibility === "private") return;
    if (p.scheduled_at && Date.parse(p.scheduled_at) > Date.now()) return;

    const subscribers = (await subscribersFor(publisherId, "posts")).slice(0, MAX_FANOUT);
    if (!subscribers.length) return;
    const [excluded, already, follows] = await Promise.all([
      excludedFor(db, publisherId, subscribers),
      inChunks<{ user_id: string }>(subscribers, (c) => db.from("notifications").select("user_id").eq("type", "news_following").eq("post_id", postId).in("user_id", c)),
      p.visibility === "followers" ? inChunks<{ follower_id: string }>(subscribers, (c) => db.from("follows").select("follower_id").eq("following_id", publisherId).in("follower_id", c)) : Promise.resolve([]),
    ]);
    for (const r of already) excluded.add(r.user_id);
    const viewers = eligibleViewers({ publisherId, subscribers, visibility: p.visibility, follows: new Set(follows.map((r) => r.follower_id)), excluded });
    if (!viewers.length) return;

    // rich identity: the creator is the title and the photo, what they shared is the text
    const who = await pushPerson(publisherId);
    const noun = contentNoun(p);
    const preview = (caption ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    await deliver(viewers, (userId) => ({
      userId,
      type: "news_following",
      actorId: publisherId,
      postId,
      push: {
        title: who.name,
        body: `Shared ${noun}${preview ? ` · ${preview}` : ""}`,
        // shown on a locked screen with previews off — reveals nothing
        genericBody: "New post from someone you follow.",
        url: `/p/${postId}`,
        icon: who.icon,
        tag: `new-post:${postId}`,
      },
    }));
  } catch {
    /* never let a notification failure affect the publish that triggered it */
  }
}

/** Someone you asked to hear from added to their story. Stories have no audience setting: anyone not blocked or muting. */
export async function notifyNewStory(publisherId: string, storyId?: string | null): Promise<void> {
  try {
    const db = createAdminClient();
    const subscribers = (await subscribersFor(publisherId, "stories")).slice(0, MAX_FANOUT);
    if (!subscribers.length) return;
    // one story notification per person per hour — five stories in a row are one "added to their story"
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const [excluded, recent] = await Promise.all([
      excludedFor(db, publisherId, subscribers),
      inChunks<{ user_id: string }>(subscribers, (c) => db.from("notifications").select("user_id").eq("type", "news_following").eq("actor_id", publisherId).is("post_id", null).like("data->>url", "/u/%").gte("created_at", since).in("user_id", c)),
    ]);
    for (const r of recent) excluded.add(r.user_id);
    const viewers = eligibleViewers({ publisherId, subscribers, visibility: "public", follows: new Set(), excluded });
    if (!viewers.length) return;
    const who = await pushPerson(publisherId);
    await deliver(viewers, (userId) => ({
      userId,
      type: "news_following",
      actorId: publisherId,
      push: {
        title: who.name,
        body: "Added to their story",
        genericBody: "New story from someone you follow.",
        // Stories are viewed from the person's profile, where their story tray lives.
        url: who.handle ? `/u/${who.handle}` : "/friends",
        icon: who.icon,
        tag: `new-story:${publisherId}${storyId ? `:${storyId}` : ""}`,
      },
    }));
  } catch {
    /* never let a notification failure affect the story */
  }
}

/**
 * Someone you asked to hear from uploaded wallpapers (complete-system brief, 2026-10-12). Member
 * wallpapers are public the moment they upload, so the "posts" opt-in decides; one notification
 * per upload batch, never one per file, and once per wallpaper (idempotent on its link).
 */
export async function notifyNewWallpaper(publisherId: string, wallpaperId: string, count = 1): Promise<void> {
  try {
    const db = createAdminClient();
    const subscribers = (await subscribersFor(publisherId, "posts")).slice(0, MAX_FANOUT);
    if (!subscribers.length) return;
    const url = `/wallpapers?w=${wallpaperId}`;
    const [excluded, already] = await Promise.all([
      excludedFor(db, publisherId, subscribers),
      inChunks<{ user_id: string }>(subscribers, (c) => db.from("notifications").select("user_id").eq("type", "news_following").eq("actor_id", publisherId).eq("data->>url", url).in("user_id", c)),
    ]);
    for (const r of already) excluded.add(r.user_id);
    const viewers = eligibleViewers({ publisherId, subscribers, visibility: "public", follows: new Set(), excluded });
    if (!viewers.length) return;
    const who = await pushPerson(publisherId);
    await deliver(viewers, (userId) => ({
      userId,
      type: "news_following",
      actorId: publisherId,
      push: {
        title: who.name,
        body: count > 1 ? `Uploaded ${count} new wallpapers` : "Uploaded a new wallpaper",
        genericBody: "New wallpaper from someone you follow.",
        url,
        icon: who.icon,
        tag: `new-wallpaper:${publisherId}`,
      },
    }));
  } catch {
    /* never let a notification failure affect the upload */
  }
}

/** Someone you asked to hear from reposted or reshared something (public posts only). */
export async function notifyFeedActivity(actorId: string, postId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: post } = await db.from("posts").select("status, visibility").eq("id", postId).maybeSingle();
    const p = post as { status: string; visibility: string } | null;
    if (!p || p.status !== "published" || p.visibility !== "public") return;
    const subscribers = (await subscribersFor(actorId, "feed")).slice(0, MAX_FANOUT);
    if (!subscribers.length) return;
    const excluded = await excludedFor(db, actorId, subscribers);
    const viewers = eligibleViewers({ publisherId: actorId, subscribers, visibility: "public", follows: new Set(), excluded });
    if (!viewers.length) return;
    const who = await pushPerson(actorId);
    await deliver(viewers, (userId) => ({
      userId,
      type: "news_following",
      actorId,
      postId,
      push: { title: who.name, body: "Reposted something", genericBody: "New activity from someone you follow.", url: `/p/${postId}`, icon: who.icon, tag: `repost:${actorId}:${postId}` },
    }));
  } catch {
    /* never let a notification failure affect the repost */
  }
}
