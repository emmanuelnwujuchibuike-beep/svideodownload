import { createHash } from "node:crypto";

import { bustHomeFeedCache } from "@/lib/social/home-feed";
import { sendMessage } from "@/lib/social/messages";
import {
  canReshareTo,
  isValidReelMedia,
  type ReshareDestination,
  type ReshareSource,
} from "@/lib/social/reshare-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resharing — lifting media out of where it was published into somewhere else,
 * and the original author's control over whether that's allowed at all.
 *
 * Owner spec (2026-07-16), implemented literally:
 *   - media SENT TO YOU IN CHAT may be reshared to a story, the feed, or Reels;
 *   - a FRIEND'S STORY may be reshared "to their own stories or private chat
 *     no where else";
 *   - "users who made the posts on stories or who sent the media in chat can
 *     set the media to be reshare or not".
 *
 * The destination rules are a single table (`ALLOWED_DESTINATIONS`) rather than
 * scattered `if`s, because "nowhere else" is the whole point of the second rule
 * — a story must never reach the feed or Reels, and that's much easier to read,
 * test and keep true as one map than as branches across two call sites.
 *
 * Everything here is enforced SERVER-side. `allow_reshare` is an honest social
 * signal, not a security boundary (a chat recipient can already screenshot a
 * photo they can see) — but it must still be impossible to bypass with a
 * hand-rolled request, so the check lives here rather than in the UI.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// The rules themselves live in `reshare-rules.ts` — pure, importable from a
// client component without dragging this module's server dependencies
// (node:crypto, the admin client, sendMessage) into the browser bundle.
export {
  ALLOWED_DESTINATIONS,
  RESHARE_DESTINATIONS,
  canReshareTo,
  isValidReelMedia,
  type ReshareDestination,
  type ReshareSource,
} from "@/lib/social/reshare-rules";

export type ReshareResult =
  | { ok: true; postId?: string | null; storyId?: string | null }
  | { ok: false; reason: "not-found" | "forbidden" | "not-allowed" | "bad-destination" | "failed" };

interface SourceMedia {
  mediaUrl: string;
  mediaKind: "image" | "video";
  thumbnailUrl: string | null;
  /** The person who published the source — never the viewer resharing it. */
  authorId: string;
}

/**
 * Resolve the media behind a chat attachment the viewer is allowed to reshare.
 * Fails closed on every step: the message must exist, the viewer must be a
 * member of its conversation, and the sender must not have turned resharing
 * off.
 */
async function resolveMessageMedia(viewerId: string, messageId: string, attachmentId: string): Promise<SourceMedia | { error: ReshareResult }> {
  const db = createAdminClient();

  const { data: msg } = await db
    .from("messages")
    .select("id, conversation_id, sender_id, allow_reshare, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.deleted_at) return { error: { ok: false, reason: "not-found" } };

  // Membership, not authorship: the whole point is that a RECIPIENT reshares.
  const { data: member } = await db
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", msg.conversation_id as string)
    .eq("user_id", viewerId)
    .maybeSingle();
  if (!member) return { error: { ok: false, reason: "forbidden" } };

  // The sender's own message is always resharable BY THE SENDER — the toggle is
  // there to stop OTHER people lifting it out, not to lock the author out of
  // their own media.
  const isSender = (msg.sender_id as string) === viewerId;
  // `allow_reshare` arrives with migration 0081; treat a missing column as
  // "allowed" so an unapplied migration degrades to today's behaviour rather
  // than blocking the feature outright.
  const allowed = msg.allow_reshare === undefined || msg.allow_reshare === null ? true : !!msg.allow_reshare;
  if (!isSender && !allowed) return { error: { ok: false, reason: "not-allowed" } };

  const { data: att } = await db
    .from("message_attachments")
    .select("id, media_kind, media_url, thumbnail_url")
    .eq("id", attachmentId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (!att) return { error: { ok: false, reason: "not-found" } };

  const kind = att.media_kind as string;
  if (kind !== "image" && kind !== "video") return { error: { ok: false, reason: "bad-destination" } };

  return {
    mediaUrl: att.media_url as string,
    mediaKind: kind,
    thumbnailUrl: (att.thumbnail_url as string | null) ?? null,
    authorId: msg.sender_id as string,
  };
}

/**
 * Resolve a story the viewer may reshare. A story is visible to the viewer if
 * it hasn't expired; `allow_reshare` is the author's own switch.
 */
async function resolveStoryMedia(viewerId: string, storyId: string): Promise<SourceMedia | { error: ReshareResult }> {
  const db = createAdminClient();
  const { data: story } = await db
    .from("stories")
    .select("id, user_id, media_url, media_kind, allow_reshare, expires_at")
    .eq("id", storyId)
    .maybeSingle();
  if (!story) return { error: { ok: false, reason: "not-found" } };
  if (new Date(story.expires_at as string).getTime() <= Date.now()) {
    return { error: { ok: false, reason: "not-found" } };
  }

  const isAuthor = (story.user_id as string) === viewerId;
  const allowed = story.allow_reshare === undefined || story.allow_reshare === null ? true : !!story.allow_reshare;
  if (!isAuthor && !allowed) return { error: { ok: false, reason: "not-allowed" } };

  const kind = (story.media_kind as string) === "video" ? "video" : "image";
  return {
    mediaUrl: story.media_url as string,
    mediaKind: kind,
    thumbnailUrl: null,
    authorId: story.user_id as string,
  };
}

export interface ReshareInput {
  viewerId: string;
  source: ReshareSource;
  /** Message id (source="message") or story id (source="story"). */
  sourceId: string;
  /** Which attachment of the message — required for source="message". */
  attachmentId?: string;
  destination: ReshareDestination;
  caption?: string;
  /** Required for destination="chat". */
  conversationId?: string;
}

/**
 * Perform a reshare. Reuses the source's existing storage URL rather than
 * re-uploading the bytes — it's already our own object, so a copy would double
 * storage and egress (see the egress-cloudflare-storage notes) for no benefit.
 */
export async function reshare(input: ReshareInput): Promise<ReshareResult> {
  if (!hasSupabase) return { ok: false, reason: "failed" };
  const { viewerId, source, sourceId, destination, caption } = input;

  if (!canReshareTo(source, destination)) return { ok: false, reason: "bad-destination" };

  const resolved =
    source === "message"
      ? input.attachmentId
        ? await resolveMessageMedia(viewerId, sourceId, input.attachmentId)
        : ({ error: { ok: false as const, reason: "not-found" as const } } as const)
      : await resolveStoryMedia(viewerId, sourceId);
  if ("error" in resolved) return resolved.error;

  if (destination === "reel" && !isValidReelMedia(resolved.mediaKind)) {
    return { ok: false, reason: "bad-destination" };
  }

  const db = createAdminClient();

  if (destination === "chat") {
    if (!input.conversationId) return { ok: false, reason: "bad-destination" };
    // sendMessage does its own membership + block/restriction gating, so a
    // reshare can never reach a conversation the viewer couldn't message
    // normally.
    const sent = await sendMessage(viewerId, input.conversationId, caption?.trim() ?? "", {
      attachments: [{ mediaKind: resolved.mediaKind, mediaUrl: resolved.mediaUrl, thumbnailUrl: resolved.thumbnailUrl ?? undefined }],
    });
    return sent.ok ? { ok: true } : { ok: false, reason: "forbidden" };
  }

  if (destination === "story") {
    const { data: created, error } = await db
      .from("stories")
      .insert({
        user_id: viewerId,
        media_url: resolved.mediaUrl,
        media_kind: resolved.mediaKind,
        caption: caption?.trim() || null,
        ...(source === "story"
          ? { reshared_from_story_id: sourceId, reshared_from_user_id: resolved.authorId }
          : {}),
      })
      .select("id")
      .maybeSingle();
    // 42703 = the provenance columns (0081) aren't applied yet — retry without
    // them so the reshare itself still works, same stance as /api/stories'
    // `format` insert.
    if (error?.code === "42703") {
      const { data: plain } = await db
        .from("stories")
        .insert({
          user_id: viewerId,
          media_url: resolved.mediaUrl,
          media_kind: resolved.mediaKind,
          caption: caption?.trim() || null,
        })
        .select("id")
        .maybeSingle();
      return plain ? { ok: true, storyId: plain.id as string } : { ok: false, reason: "failed" };
    }
    if (error || !created) return { ok: false, reason: "failed" };
    return { ok: true, storyId: created.id as string };
  }

  // post | reel — both are `posts` rows; `format` is what separates the feed
  // from the Reels product (see the feed-reels-split notes).
  const { data: prof } = await db.from("profiles").select("handle, is_suspended").eq("id", viewerId).maybeSingle();
  if (!prof?.handle || prof.is_suspended) return { ok: false, reason: "forbidden" };

  const cover = resolved.mediaKind === "image" ? resolved.mediaUrl : resolved.thumbnailUrl;
  const base = {
    publisher_id: viewerId,
    source_url: resolved.mediaUrl,
    // The same media reshared by two different people must not collide on the
    // unique source-url hash, and resharing it twice yourself shouldn't either
    // — salt it per publisher + source row.
    source_url_hash: createHash("sha256").update(`${resolved.mediaUrl}:${viewerId}:${sourceId}`).digest("hex"),
    platform: "frenz",
    media_kind: resolved.mediaKind,
    title: (caption ?? "").slice(0, 300),
    media_url: resolved.mediaUrl,
    thumbnail_url: cover,
    visibility: "public",
    status: "published",
  };
  const format = destination === "reel" ? "reel" : "feed";

  const first = await db.from("posts").insert({ ...base, format }).select("id").maybeSingle();
  let post = first.data;
  if (first.error?.code === "42703") {
    ({ data: post } = await db.from("posts").insert(base).select("id").maybeSingle());
  }
  if (!post) return { ok: false, reason: "failed" };

  await bustHomeFeedCache(viewerId);
  return { ok: true, postId: post.id as string };
}

/** The author's own switch. Only the publisher may flip it. */
export async function setReshareAllowed(
  viewerId: string,
  source: ReshareSource,
  sourceId: string,
  allowed: boolean,
): Promise<{ ok: boolean }> {
  if (!hasSupabase) return { ok: false };
  const db = createAdminClient();
  const table = source === "message" ? "messages" : "stories";
  const ownerColumn = source === "message" ? "sender_id" : "user_id";
  const { error } = await db
    .from(table)
    .update({ allow_reshare: allowed })
    .eq("id", sourceId)
    .eq(ownerColumn, viewerId); // authorship enforced in the WHERE, not read-then-write
  return { ok: !error };
}
