import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { videoStickerId, videoStickerUuid, type VideoStickerMedia } from "./video-stickers";

/**
 * The clips behind a set of sticker ids (any mix of emoji and `vs:` ids; only the visible video ones come back).
 * Tolerant of 0303 not having run: no table = no video stickers, never a failed comment list.
 */
export async function loadVideoStickers(stickerIds: Iterable<string | null | undefined>): Promise<Map<string, VideoStickerMedia>> {
  const out = new Map<string, VideoStickerMedia>();
  const uuids = [...new Set([...stickerIds].map(videoStickerUuid).filter((u): u is string => !!u))];
  if (!uuids.length) return out;
  try {
    const { data, error } = await createAdminClient().from("video_stickers").select("id, video_url, poster_url").in("id", uuids.slice(0, 200)).is("hidden_at", null);
    if (error) return out;
    for (const r of (data ?? []) as { id: string; video_url: string; poster_url: string }[]) {
      out.set(videoStickerId(r.id), { id: videoStickerId(r.id), videoUrl: r.video_url, posterUrl: r.poster_url });
    }
  } catch {
    /* 0303 not run yet */
  }
  return out;
}

/** Is this a video sticker that exists and hasn't been taken down (so it may be used or saved)? */
export async function videoStickerUsable(stickerId: string): Promise<boolean> {
  return (await loadVideoStickers([stickerId])).has(stickerId);
}
