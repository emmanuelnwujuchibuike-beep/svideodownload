import "server-only";

import { imageSize } from "@/lib/media/image-size";
import { makeThumbnail } from "@/lib/media/thumbnail";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WALLPAPER UPLOADS STRAIGHT TO STORAGE (2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "Wallpapers are refusing to upload from admin dashboard … and also from users, it was refusing double
 * uploading and then stopped." The library itself was fine (579 rows, 272 MB, the last upload that morning). The
 * uploads carried every picked photo in ONE request through a Vercel function, and Vercel refuses a request body over
 * ~4.5 MB before our code runs — two phone photos already pass it, and the 20 MB per-file limit could never be reached.
 *
 * Now the bytes never pass through Vercel:
 *   1. sign    the server checks type, size and count and hands out one signed upload URL per file, for a key in the
 *              caller's own folder (members/<uid>/… or curated/…), valid once;
 *   2. upload  the browser PUTs the file straight to Supabase Storage — full resolution, nothing re-encoded;
 *   3. commit  the server reads the stored object back (server to server), checks it is really an image of an allowed
 *              type and size, measures it, makes the small thumbnail and creates the row. A file it refuses is deleted.
 *
 * Nothing about a row is taken from the browser but the optional name and category.
 */

export const WALLPAPER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
export const WALLPAPER_MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

export type WallpaperOwner = { kind: "member"; userId: string } | { kind: "admin"; adminId: string };

const folderOf = (o: WallpaperOwner) => (o.kind === "member" ? `members/${o.userId}` : "curated");

export interface SignedWallpaperUpload {
  key: string;
  token: string;
}

/** One signed upload per file, in the owner's folder — or a reason the whole batch is refused. */
export async function signWallpaperUploads(owner: WallpaperOwner, files: unknown, maxFiles: number): Promise<{ ok: true; uploads: SignedWallpaperUpload[] } | { ok: false; error: string }> {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "Choose at least one image." };
  if (files.length > maxFiles) return { ok: false, error: `Choose up to ${maxFiles} images at a time.` };
  const db = createAdminClient();
  const uploads: SignedWallpaperUpload[] = [];
  for (const f of files as { type?: unknown; size?: unknown }[]) {
    const type = typeof f?.type === "string" ? f.type : "";
    const size = typeof f?.size === "number" ? f.size : NaN;
    if (!WALLPAPER_TYPES.has(type)) return { ok: false, error: "Wallpapers can be JPG, PNG, WebP or AVIF." };
    if (!(size > 0) || size > WALLPAPER_MAX_BYTES) return { ok: false, error: "Each image must be under 20 MB." };
    const key = `${folderOf(owner)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${EXT[type]}`;
    const { data, error } = await db.storage.from("wallpapers").createSignedUploadUrl(key);
    if (error || !data?.token) return { ok: false, error: "Couldn't prepare the upload. Try again." };
    uploads.push({ key, token: data.token });
  }
  return { ok: true, uploads };
}

export type CommitResult = { ok: true; id: string | null; title: string; url: string; width: number | null; height: number | null } | { ok: false; error: string };

/**
 * The uploaded object becomes a wallpaper row — only a key in the owner's own folder, only a real image of an allowed
 * type under the size limit (read from the stored bytes, never the browser's word). A refused object is deleted.
 */
export async function commitWallpaperUpload(owner: WallpaperOwner, key: unknown, row: { title: string; category: string }): Promise<CommitResult> {
  const folder = `${folderOf(owner)}/`;
  if (typeof key !== "string" || !key.startsWith(folder) || key.includes("..") || !/^[A-Za-z0-9/_.-]{1,200}$/.test(key) || key.slice(folder.length).includes("/")) {
    return { ok: false, error: "That upload isn't yours." };
  }
  const db = createAdminClient();
  const bucket = db.storage.from("wallpapers");
  const { data: blob, error: dlErr } = await bucket.download(key);
  if (dlErr || !blob) return { ok: false, error: "The upload didn't arrive. Try again." };
  const refuse = async (error: string): Promise<CommitResult> => {
    await bucket.remove([key]).catch(() => undefined);
    return { ok: false, error };
  };
  if (blob.size > WALLPAPER_MAX_BYTES) return refuse("Each image must be under 20 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const size = imageSize(bytes);
  // the bytes decide what it is: a renamed or broken file is not a wallpaper
  if (!size) return refuse("That file isn't a readable image.");
  const contentType = blob.type && WALLPAPER_TYPES.has(blob.type) ? blob.type : null;
  if (!contentType && !/\.(jpg|png|webp|avif)$/.test(key)) return refuse("Wallpapers can be JPG, PNG, WebP or AVIF.");

  const imageUrl = bucket.getPublicUrl(key).data.publicUrl;
  let thumbUrl: string | null = null;
  const thumb = await makeThumbnail(bytes);
  if (thumb) {
    const name = key.slice(key.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    const thumbKey = `${folder}thumbs/${name}.${thumb.ext}`;
    const { error: thumbErr } = await bucket.upload(thumbKey, thumb.buffer, { contentType: thumb.contentType, cacheControl: "31536000", upsert: false });
    if (!thumbErr) thumbUrl = bucket.getPublicUrl(thumbKey).data.publicUrl;
  }

  const { data: inserted, error: rowErr } = await db
    .from("wallpapers")
    .insert({
      title: row.title,
      category: row.category,
      image_url: imageUrl,
      thumb_url: thumbUrl,
      bytes: blob.size,
      width: size.width,
      height: size.height,
      status: "published",
      source: owner.kind === "member" ? "member" : "admin",
      uploaded_by: owner.kind === "member" ? owner.userId : owner.adminId,
    })
    .select("id")
    .maybeSingle();
  if (rowErr) return refuse("Couldn't save the wallpaper. Try again.");
  return { ok: true, id: (inserted as { id: string } | null)?.id ?? null, title: row.title, url: imageUrl, width: size.width, height: size.height };
}
