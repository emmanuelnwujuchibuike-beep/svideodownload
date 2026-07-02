import { createAdminClient } from "@/lib/supabase/admin";

import { hasR2, presignR2Put, putR2 } from "./r2";

/**
 * Media storage router for Frenz.
 *
 * Main/large media (videos, audio, reels, story media) lives in **Cloudflare R2**
 * (zero egress, CDN-served) when it's configured; small profile images stay in
 * **Supabase Storage**. If R2 isn't provisioned yet, everything transparently
 * falls back to the existing Supabase `post-media` bucket, so uploads keep
 * working unchanged. See docs/INFRASTRUCTURE.md.
 */

export const POST_BUCKET = "post-media";
export type StorageBackend = "r2" | "supabase";

export { hasR2 };

/** Where new post/reel/story media should be written right now. */
export function activeBackend(): StorageBackend {
  return hasR2 ? "r2" : "supabase";
}

const SAFE = /[^a-z0-9]/g;

/** Deterministic, collision-resistant object key scoped to the owner. */
export function buildMediaKey(uid: string, kind: string, ext: string): string {
  const safeExt = (ext || "bin").toLowerCase().replace(SAFE, "").slice(0, 5) || "bin";
  const safeKind = kind.toLowerCase().replace(SAFE, "") || "media";
  return `${uid}/${safeKind}s/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
}

/** Server-side upload of media bytes. Returns the public (CDN) URL + backend used. */
export async function putServerMedia(opts: {
  key: string;
  body: Uint8Array | Buffer | Blob;
  contentType: string;
}): Promise<{ url: string; backend: StorageBackend }> {
  if (hasR2) {
    const url = await putR2(opts.key, opts.body as Uint8Array | Blob, opts.contentType);
    return { url, backend: "r2" };
  }
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(POST_BUCKET)
    .upload(opts.key, opts.body, { contentType: opts.contentType, upsert: true });
  if (error) throw new Error("Supabase upload failed");
  const { data } = admin.storage.from(POST_BUCKET).getPublicUrl(opts.key);
  return { url: data.publicUrl, backend: "supabase" };
}

/**
 * Decide how a client should upload the given media and hand back the plan.
 * R2 → a short-lived presigned PUT URL (client uploads directly, no bytes through
 * us). Supabase → the object key for the client to upload via the Supabase SDK
 * (RLS scopes it to the owner). Either way the caller ends up with `publicUrl`.
 */
export async function planClientUpload(
  uid: string,
  kind: string,
  ext: string,
): Promise<
  | { backend: "r2"; key: string; uploadUrl: string; publicUrl: string }
  | { backend: "supabase"; key: string }
> {
  const key = buildMediaKey(uid, kind, ext);
  if (hasR2) {
    const { uploadUrl, publicUrl } = await presignR2Put(key);
    return { backend: "r2", key, uploadUrl, publicUrl };
  }
  return { backend: "supabase", key };
}
