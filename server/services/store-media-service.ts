import { needsRehost } from "@/lib/media/poster-host";
import { copyToStream, hasStream } from "@/lib/media/stream";
import { putServerMedia } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaKind } from "@/types";

import { resolveDownload } from "./download-service";

/**
 * Downloads a post's media via the local yt-dlp pipeline (runs on the WORKER,
 * where there's no serverless memory/time ceiling) and uploads it to the public
 * `post-media` bucket, then records `posts.media_url`. Streamed with an early
 * size guard. Returns the public URL.
 */

const MAX_BYTES = 400 * 1024 * 1024; // generous on the worker; guards runaway files

// Hosts we control — a poster already on one of these needs no re-hosting.
const r2PublicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : null;

const EXT_CT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export interface StoreMediaInput {
  postId: string;
  uid: string;
  url: string;
  formatId: string;
  kind: MediaKind;
  title: string;
}

export type StoreMediaResult =
  | { ok: true; mediaUrl: string }
  | { ok: false; error: string; tooLarge?: boolean };

const MAX_POSTER_BYTES = 8 * 1024 * 1024;
const POSTER_CT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

/**
 * Copy a post's poster onto OUR storage, and do it now.
 *
 * `posts.thumbnail_url` is whatever yt-dlp resolved from the source platform, which
 * is almost always a *signed* CDN URL — p16-/p19-common-sign.tiktokcdn-us.com,
 * scontent-*.fbcdn.net. Those signatures EXPIRE, and once they do the URL 403s
 * permanently: the tile is broken forever, on the feed and on the landing page.
 * Measured 2026-07-17 before this existed: 50 of 64 video posts had a dead or
 * missing poster, and 4 of 11 images on the landing page were already 403ing.
 *
 * The fix is just timing. The signed URL is still VALID at this exact moment — we
 * are holding it seconds after the download resolved it — so fetch the bytes while
 * we still can and re-host them. Waiting is what loses them. This is also why the
 * repair can't be a fetch later: by then there is nothing to fetch (the backfill
 * script has to re-decode a frame out of the stored mp4 instead).
 *
 * Best-effort, exactly like the Cloudflare Stream copy below: a failure leaves the
 * original URL in place (it works today, and backfill-video-posters.mjs can repair
 * it), and must never fail the store flow.
 */
async function rehostPoster(
  admin: ReturnType<typeof createAdminClient>,
  postId: string,
  uid: string,
): Promise<void> {
  try {
    const { data } = await admin.from("posts").select("thumbnail_url").eq("id", postId).maybeSingle();
    const thumb = data?.thumbnail_url as string | null | undefined;
    // Null → nothing to copy (backfill decodes a frame instead). Already on our
    // storage (client-captured poster, or a re-store) → leave it alone.
    if (!needsRehost(thumb, { r2PublicBase, supabaseHost })) return;

    const res = await fetch(thumb!);
    if (!res.ok) return; // already expired — backfill will decode a frame instead
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_POSTER_BYTES) return;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_POSTER_BYTES) return;

    const ct = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
    const ext = POSTER_CT[ct] ?? "jpg";
    // Deterministic per-post key, matching the media key above, so a re-store
    // overwrites rather than piling up orphans.
    const { url } = await putServerMedia({
      key: `${uid}/posts/${postId}-poster.${ext}`,
      body: bytes,
      contentType: ct.startsWith("image/") ? ct : "image/jpeg",
    });
    await admin.from("posts").update({ thumbnail_url: url }).eq("id", postId);
  } catch {
    /* keep the source URL; backfill-video-posters.mjs repairs it later */
  }
}

export async function storePostMedia(input: StoreMediaInput): Promise<StoreMediaResult> {
  const { postId, uid, url, formatId, kind, title } = input;

  let resolved;
  try {
    resolved = await resolveDownload(url, formatId, kind, title);
  } catch {
    return { ok: false, error: "Couldn't fetch media." };
  }
  const { stream, ext, contentType, filesize } = resolved;
  if (filesize > MAX_BYTES) {
    void stream.cancel?.().catch(() => {});
    return { ok: false, error: "Too large to store.", tooLarge: true };
  }

  // Collect the web stream with an early size guard.
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, error: "Too large to store.", tooLarge: true };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, error: "Download interrupted." };
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  const safeExt = (ext || (kind === "audio" ? "mp3" : kind === "image" ? "jpg" : "mp4")).toLowerCase();
  const ct = contentType || EXT_CT[safeExt] || "application/octet-stream";
  // Deterministic per-post key so a re-store overwrites rather than duplicates.
  const key = `${uid}/posts/${postId}.${safeExt}`;

  // Main media (usually video) → Cloudflare R2 when configured, else Supabase.
  let mediaUrl: string;
  try {
    ({ url: mediaUrl } = await putServerMedia({ key, body: buf, contentType: ct }));
  } catch {
    return { ok: false, error: "Upload failed." };
  }

  const admin = createAdminClient();
  await admin.from("posts").update({ media_url: mediaUrl }).eq("id", postId);

  await rehostPoster(admin, postId, uid);

  // Cloudflare Stream (adaptive-bitrate playback), best-effort: pull the just-stored
  // video into Stream by URL and record its uid so SmartVideo/PostViewer play the
  // HLS ladder instead of the raw file. No-op unless Stream is configured + it's a
  // video; never fails the store flow (playback falls back to `media_url`).
  if (hasStream && kind === "video") {
    try {
      const streamUid = await copyToStream(mediaUrl, uid);
      if (streamUid) await admin.from("posts").update({ stream_uid: streamUid }).eq("id", postId);
    } catch {
      /* keep the stored file; Stream can be backfilled later */
    }
  }

  return { ok: true, mediaUrl };
}
