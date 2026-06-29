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
  const path = `${uid}/${postId}.${safeExt}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from("post-media").upload(path, buf, { contentType: ct, upsert: true });
  if (upErr) return { ok: false, error: "Upload failed." };

  const { data } = admin.storage.from("post-media").getPublicUrl(path);
  await admin.from("posts").update({ media_url: data.publicUrl }).eq("id", postId);
  return { ok: true, mediaUrl: data.publicUrl };
}
