import "server-only";

import { presignPrivateGet } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

import { CLIP_NEEDS_WORK_FILTER, lacksPlayableClip } from "./blur-clip-plan";

/**
 * The blurred preview of a locked exclusive post (0263, owner 2026-10-18, REQUIRED): the ONLY picture a
 * non-subscriber ever receives for it.
 *
 * Made on the server from the private file: shrunk to BLUR_WIDTH pixels, blurred, re-encoded as a tiny
 * WebP and stored on the post as a data URL of a few hundred bytes. The detail is destroyed before it
 * is stored — there is nothing to enlarge back into the picture — so it can be sent to anyone, with no
 * signed link and no extra request. A video's preview is made from its first-frame thumb (the composer
 * makes one); a video with no thumb has no preview, and its tile stays a plain locked tile.
 *
 * Runs only right after a post is published (after(), on Vercel) or for at most a few older posts when
 * their creator opens their own gallery — never on a timer, never on the worker.
 */

type Row = Record<string, unknown>;
const BLUR_WIDTH = 20;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** A heavily blurred, 20 px wide WebP data URL — null if the bytes aren't an image sharp can read. */
export async function makeBlurPreview(bytes: Uint8Array): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(bytes)).rotate().resize({ width: BLUR_WIDTH, withoutEnlargement: false }).blur(1.2).webp({ quality: 35 }).toBuffer();
    const url = `data:image/webp;base64,${out.toString("base64")}`;
    return url.length <= 4000 ? url : null;
  } catch {
    return null;
  }
}

/** The private file a preview is made from: the first item's thumb, else the first item if it is a photo. */
function sourceKey(first: Row | undefined): string | null {
  if (!first) return null;
  if (typeof first.thumb_key === "string" && first.thumb_key) return first.thumb_key;
  return first.media_kind === "image" && typeof first.object_key === "string" ? first.object_key : null;
}

/** Makes and stores one post's preview if it has none. Best effort: a failure leaves the plain locked tile. */
export async function ensureBlurPreview(postId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const withThumb = await db.from("sub_post_media").select("idx, media_kind, object_key, thumb_key").eq("post_id", postId).order("idx").limit(1);
    const first = ((withThumb.error ? (await db.from("sub_post_media").select("idx, media_kind, object_key").eq("post_id", postId).order("idx").limit(1)).data : withThumb.data) ?? [])[0] as Row | undefined;
    const key = sourceKey(first);
    if (!key) return;
    const res = await fetch(await presignPrivateGet(key, 120));
    if (!res.ok) return;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_BYTES) return;
    const preview = await makeBlurPreview(bytes);
    if (!preview) return;
    // only an empty one is ever filled — a second run changes nothing
    await db.from("sub_posts").update({ blur_preview: preview }).eq("id", postId).is("blur_preview", null);
  } catch {
    /* the tile stays a plain locked tile */
  }
  await ensureItemBlurPreviews(postId);
}

/**
 * 0306: the same blurred still for EVERY item (owner, 2026-10-29: "slide through a multi post sideways, but blurred").
 * Only items without one, each made from its own thumb (a video) or itself (a photo). Before 0306 the read fails and
 * nothing happens; any one failure leaves that slide plain and the rest still made.
 */
export async function ensureItemBlurPreviews(postId: string): Promise<void> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("sub_post_media").select("id, idx, media_kind, object_key, thumb_key, blur_preview").eq("post_id", postId).is("blur_preview", null).order("idx");
    if (error) return;
    for (const item of ((data ?? []) as Row[]).slice(0, MAX_SLIDES)) {
      const key = sourceKey(item);
      if (!key) continue;
      try {
        const res = await fetch(await presignPrivateGet(key, 120));
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_SOURCE_BYTES) continue;
        const preview = await makeBlurPreview(bytes);
        if (preview) await db.from("sub_post_media").update({ blur_preview: preview }).eq("id", item.id as string).is("blur_preview", null);
      } catch {
        /* this slide stays plain */
      }
    }
  } catch {
    /* every slide stays plain */
  }
}

/** One slide of a locked post: its blurred still and, for a video, its blurred clip. Never the file. */
export interface BlurSlide {
  kind: "image" | "video";
  blurUrl?: string;
  blurVideoUrl?: string;
}
const MAX_SLIDES = 20;

/**
 * 0306: each post's slides, in order, one per item. The first slide falls back to the post-level preview. A database
 * before 0306 answers none, and the caller shows the post-level preview as its one slide.
 */
export async function readBlurSlides(postIds: string[]): Promise<Map<string, BlurSlide[]>> {
  const out = new Map<string, BlurSlide[]>();
  if (!postIds.length) return out;
  const db = createAdminClient();
  const [items, posts] = await Promise.all([
    db.from("sub_post_media").select("post_id, idx, media_kind, blur_preview, blur_video_url").in("post_id", postIds).order("idx"),
    db.from("sub_posts").select("id, blur_preview, blur_video_url").in("id", postIds),
  ]);
  if (items.error) return out;
  const postLevel = new Map(((posts.data ?? []) as Row[]).map((r) => [r.id as string, r]));
  const byPost = new Map<string, Row[]>();
  for (const r of (items.data ?? []) as Row[]) byPost.set(r.post_id as string, [...(byPost.get(r.post_id as string) ?? []), r]);
  for (const [id, rows] of byPost) {
    const slides = rows.slice(0, MAX_SLIDES).map((r, i): BlurSlide => {
      const post = i === 0 ? postLevel.get(id) : undefined;
      const still = goodStill(r.blur_preview) ?? goodStill(post?.blur_preview);
      const clip = r.media_kind === "video" ? (goodClip(r.blur_video_url) ?? goodClip(post?.blur_video_url)) : null;
      return { kind: r.media_kind === "video" ? "video" : "image", ...(still ? { blurUrl: still } : {}), ...(clip ? { blurVideoUrl: clip } : {}) };
    });
    out.set(id, slides);
  }
  return out;
}

/**
 * The creator's own video items that still lack a blurred clip (older posts, made before every video got one): their
 * browser makes them on a visit (features/sub/blur-clip-backfill.ts). At most `limit`, newest posts first.
 */
export async function missingBlurClips(creatorId: string, limit = 2): Promise<{ postId: string; idx: number; key: string }[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sub_post_media")
    .select("post_id, idx, object_key, sub_posts!inner(creator_id, status, audience, created_at)")
    .eq("media_kind", "video")
    .is("blur_video_url", null)
    .eq("sub_posts.creator_id", creatorId)
    .eq("sub_posts.status", "published")
    .eq("sub_posts.audience", "locked")
    // newest first IN THE DATABASE — a limit on an unordered read is an arbitrary set (code review, 2026-10-30)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return [];
  const rows = (data ?? []) as (Row & { sub_posts: Row | Row[] })[];
  const created = (r: (typeof rows)[number]) => String((Array.isArray(r.sub_posts) ? r.sub_posts[0] : r.sub_posts)?.created_at ?? "");
  return rows
    .sort((a, b) => created(b).localeCompare(created(a)) || Number(a.idx) - Number(b.idx))
    .slice(0, limit)
    .map((r) => ({ postId: r.post_id as string, idx: Number(r.idx), key: r.object_key as string }));
}

/** Stores one item's clip (the creator's own browser made it). Only an empty one is filled; the first video's also on the post. */
export async function saveItemBlurClip(postId: string, idx: number, url: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db.from("sub_post_media").update({ blur_video_url: url }).eq("post_id", postId).eq("idx", idx).eq("media_kind", "video").is("blur_video_url", null).select("idx");
  if (error || !data?.length) return false;
  await db.from("sub_posts").update({ blur_video_url: url }).eq("id", postId).is("blur_video_url", null).then(() => undefined, () => undefined);
  return true;
}

function goodStill(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("data:image/webp;base64,") ? v : null;
}
function goodClip(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("https://") ? v : null;
}

/** The stored previews of these posts. A database without 0263, or a failed read, answers none. */
export async function readBlurPreviews(postIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!postIds.length) return out;
  const { data, error } = await createAdminClient().from("sub_posts").select("id, blur_preview").in("id", postIds);
  if (error) return out;
  for (const r of (data ?? []) as Row[]) if (typeof r.blur_preview === "string" && r.blur_preview.startsWith("data:image/webp;base64,")) out.set(r.id as string, r.blur_preview);
  return out;
}

/**
 * 0305: the blurred MOVING previews of these posts (a 24 px clip made in the creator's browser — lib/media/make-blur-clip.ts).
 * Sent only where the still preview is, to a viewer without access. A database without 0305 answers none.
 */
export async function readBlurVideos(postIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!postIds.length) return out;
  const { data, error } = await createAdminClient().from("sub_posts").select("id, blur_video_url").in("id", postIds);
  if (error) return out;
  for (const r of (data ?? []) as Row[]) if (typeof r.blur_video_url === "string" && r.blur_video_url.startsWith("https://")) out.set(r.id as string, r.blur_video_url);
  return out;
}

/*
  ═══════════════════════════════════════════════════════════════════════════
   EVERY locked video gets its blurred clip — made on the WORKER (2026-10-29)
  ═══════════════════════════════════════════════════════════════════════════
  Owner: "the 18+ and all exclusive should auto play in the exclusive feed like normal feed but blurred on unsubscriber,
  nothing less than that". Until now a clip existed only if the creator's browser made one — at publish, or two per
  visit to their own gallery — so older videos sat black for everyone else. The worker now makes the missing ones from
  the private file (server/services/sub-blur-clip-service.ts, lib/sub/blur-clip-plan.ts), for every creator, and remakes
  the WebM clips some browsers recorded, which an iPhone may not play.
*/

/**
 * Locked, published video items without a clip an iPhone plays (none, a WebM one, or one that is not https — the same
 * rule the feed asks with, CLIP_NEEDS_WORK_FILTER in lib/sub/blur-clip-plan.ts) — newest posts first, any creator.
 *
 * Newest first IN THE DATABASE (code review, 2026-10-30): the 400 were an unordered read sorted afterwards, so with a
 * larger backlog Postgres handed back whichever rows it liked and recent posts could stay black for many kicks. An
 * item is written together with its post, so its own created_at orders it like the post; the post time breaks ties.
 */
export async function lockedVideosNeedingClips(limit: number): Promise<{ postId: string; idx: number; key: string }[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sub_post_media")
    .select("post_id, idx, object_key, blur_video_url, sub_posts!inner(status, audience, created_at)")
    .eq("media_kind", "video")
    .or(CLIP_NEEDS_WORK_FILTER)
    .eq("sub_posts.status", "published")
    .eq("sub_posts.audience", "locked")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) return [];
  const rows = (data ?? []) as (Row & { sub_posts: Row | Row[] })[];
  const created = (r: (typeof rows)[number]) => String((Array.isArray(r.sub_posts) ? r.sub_posts[0] : r.sub_posts)?.created_at ?? "");
  return rows
    .filter((r) => typeof r.object_key === "string" && r.object_key && lacksPlayableClip([r.blur_video_url as string | null]))
    .sort((a, b) => created(b).localeCompare(created(a)) || Number(a.idx) - Number(b.idx))
    .slice(0, limit)
    .map((r) => ({ postId: r.post_id as string, idx: Number(r.idx), key: r.object_key as string }));
}

/**
 * Locked, published posts still missing a blurred still — the post-level one, OR any slide's (owner, 2026-10-29: "the
 * blur issue also happens with multiple posts … in a slide show"). Only items a still CAN be made from count (a photo, or
 * a video with a thumb), so an item with no source never holds a place. Newest first, any creator.
 */
export async function lockedPostsNeedingStills(limit: number): Promise<string[]> {
  const db = createAdminClient();
  const [posts, items] = await Promise.all([
    db.from("sub_posts").select("id, created_at").eq("status", "published").eq("audience", "locked").is("blur_preview", null).order("created_at", { ascending: false }).limit(limit),
    db
      .from("sub_post_media")
      .select("post_id, media_kind, thumb_key, sub_posts!inner(status, audience, created_at)")
      .is("blur_preview", null)
      .eq("sub_posts.status", "published")
      .eq("sub_posts.audience", "locked")
      // newest first in the database, like the clips above (code review, 2026-10-30)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);
  const created = new Map<string, string>();
  if (!posts.error) for (const r of (posts.data ?? []) as Row[]) created.set(r.id as string, String(r.created_at ?? ""));
  // before 0306 (no per-item still) this read fails and only the post-level ones are worked on
  if (!items.error) {
    for (const r of (items.data ?? []) as (Row & { sub_posts: Row | Row[] })[]) {
      if (r.media_kind !== "image" && !(typeof r.thumb_key === "string" && r.thumb_key)) continue;
      const post = Array.isArray(r.sub_posts) ? r.sub_posts[0] : r.sub_posts;
      created.set(r.post_id as string, String(post?.created_at ?? ""));
    }
  }
  return [...created.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Is this item's clip slot still waiting for the worker (code review, 2026-10-30)? Asked right before ffmpeg runs: a
 * creator's browser may have stored an MP4 since the run read its list, and then there is nothing to make or upload.
 * A failed read answers true — the conditional save below still refuses a filled slot.
 */
export async function blurClipSlotOpen(postId: string, idx: number): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("sub_post_media")
    .select("idx")
    .eq("post_id", postId)
    .eq("idx", idx)
    .eq("media_kind", "video")
    .or(CLIP_NEEDS_WORK_FILTER)
    .limit(1);
  return error ? true : (data?.length ?? 0) > 0;
}

/**
 * Stores a clip the WORKER made: fills a slot with no clip an iPhone plays (CLIP_NEEDS_WORK_FILTER — the same rule the
 * worker selected it by) — never a good MP4 a browser already made. The post-level clip (the first video's) follows
 * the same rule.
 */
export async function saveServerBlurClip(postId: string, idx: number, url: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("sub_post_media")
    .update({ blur_video_url: url })
    .eq("post_id", postId)
    .eq("idx", idx)
    .eq("media_kind", "video")
    .or(CLIP_NEEDS_WORK_FILTER)
    .select("idx");
  if (error || !data?.length) return false;
  await db
    .from("sub_posts")
    .update({ blur_video_url: url })
    .eq("id", postId)
    .or(CLIP_NEEDS_WORK_FILTER)
    .then(
      () => undefined,
      () => undefined,
    );
  return true;
}
