/**
 * Video stickers (owner, 2026-10-28): a member makes a ≤3-second, square, silent clip from a video of their own, keeps
 * it in their sticker library, uses it in comments, and anyone can save someone else's sticker to their own library.
 *
 * A video sticker's id is `vs:<uuid>` — it lives in the SAME slots an emoji sticker id does (`post_comments.sticker`,
 * `user_stickers.sticker`), so comments and the library need no second column. The clip itself is a row in
 * `video_stickers` (0303) pointing at a public post-media upload; the clip is made in the browser
 * (features/social/video-sticker-maker.tsx), so the server spends nothing encoding.
 *
 * Pure helpers here; the database reads are in video-stickers-server.ts.
 */

export const VIDEO_STICKER_PREFIX = "vs:";
/** The clip may be at most this long (a little slack over 3 s for the recorder's last frame). */
export const VIDEO_STICKER_MAX_MS = 3_300;
/** The rendered square edge, in px. */
export const VIDEO_STICKER_EDGE = 320;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface VideoStickerMedia {
  id: string;
  videoUrl: string;
  posterUrl: string;
}

/** The uuid in `vs:<uuid>`, or null for anything else (an emoji sticker id, junk). */
export function videoStickerUuid(stickerId: string | null | undefined): string | null {
  if (!stickerId || !stickerId.startsWith(VIDEO_STICKER_PREFIX)) return null;
  const u = stickerId.slice(VIDEO_STICKER_PREFIX.length).toLowerCase();
  return UUID.test(u) ? u : null;
}

export const videoStickerId = (uuid: string) => `${VIDEO_STICKER_PREFIX}${uuid}`;
