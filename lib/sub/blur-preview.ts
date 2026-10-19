import "server-only";

import { presignPrivateGet } from "@/lib/storage/r2";
import { createAdminClient } from "@/lib/supabase/admin";

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
