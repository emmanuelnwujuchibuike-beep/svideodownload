import { deleteStoredUpload } from "@/lib/storage";
import { parseUploadUrl, storageBasesFromEnv, type StorageBases } from "@/lib/storage/owned-media";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Delete OUR stored uploads among `urls` that nothing references any more — the same check the daily story clean-up
 * makes (`story_media_references`, 0285: every *_url / *_urls column in public, highlights included since 0289).
 *
 * Used when a story upload is refused (POST /api/stories) and when a story leaves a highlight after its story has
 * already been swept (lib/social/story-highlights.ts). A failed check or delete KEEPS the file: a kept file is a
 * smaller harm than a deleted one still in use. Never throws.
 */
export async function releaseUnreferencedUploads(urls: (string | null | undefined)[], bases: StorageBases = storageBasesFromEnv()): Promise<void> {
  try {
    const own = [...new Set(urls.filter((u): u is string => !!u && !!parseUploadUrl(u, bases)))];
    if (!own.length) return;
    const { data, error } = await createAdminClient().rpc("story_media_references", { p_urls: own, p_exclude: [] });
    if (error) return;
    const inUse = new Set(((data ?? []) as unknown[]).map((v) => (typeof v === "string" ? v : String((v as Record<string, unknown>)?.story_media_references ?? ""))));
    for (const url of own) {
      const up = parseUploadUrl(url, bases);
      if (up && !inUse.has(url)) await deleteStoredUpload(up).catch(() => false);
    }
  } catch {
    /* the caller's action stands either way */
  }
}
