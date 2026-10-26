import "server-only";

import { httpRangeReader, probeMp4, type RangeRead } from "@/lib/media/mp4-probe";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A STORY VIDEO MAY BE (Stories Part 4, 2026-10-26, audit B7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The audit: a story video was checked for nothing but its 100 MB size (in the browser) — so a 40-minute file was a
 * "story", and an iPhone's HEVC .mov became a story that many Android phones and desktop browsers cannot play.
 *
 * Decided here, on the SERVER, from the file itself (lib/media/mp4-probe.ts reads its index with range requests —
 * never the whole video, never a number the browser sent):
 *
 *   length   up to STORY_VIDEO_MAX_SECONDS (60 s — one story segment, as the big apps cut them)
 *   format   MP4 or QuickTime (.mov) holding H.264 video ("avc1"/"avc3") — the one codec every browser and phone
 *            plays. HEVC, AV1, VP9 and anything else gets a clear message saying how to export it instead. No
 *            transcoding exists in this architecture to convert it (and renaming a file converts nothing).
 *
 * A file that cannot be read is refused rather than published broken.
 */
export const STORY_VIDEO_MAX_SECONDS = 60;
const PLAYABLE = new Set(["avc1", "avc3"]);

export type StoryVideoVerdict = { ok: true; durationSec: number | null; codec: string } | { ok: false; reason: "too_long" | "codec" | "unreadable" | "no_video"; message: string };

export async function checkStoryVideo(mediaUrl: string, read: RangeRead = httpRangeReader(mediaUrl)): Promise<StoryVideoVerdict> {
  const facts = await probeMp4(read);
  if ("error" in facts) {
    return { ok: false, reason: "unreadable", message: facts.error === "not_mp4" ? "Stories take MP4 or MOV videos. Export it as MP4 and try again." : "We couldn't read that video. Export it as MP4 (H.264) and try again." };
  }
  if (!facts.videoCodec) return { ok: false, reason: "no_video", message: "That file has no video in it." };
  if (facts.durationSec !== null && facts.durationSec > STORY_VIDEO_MAX_SECONDS + 0.5) {
    return { ok: false, reason: "too_long", message: `Story videos can be up to ${STORY_VIDEO_MAX_SECONDS} seconds. Trim it and try again.` };
  }
  if (!PLAYABLE.has(facts.videoCodec)) {
    const hevc = facts.videoCodec === "hvc1" || facts.videoCodec === "hev1";
    return {
      ok: false,
      reason: "codec",
      message: hevc
        ? "This video is in HEVC, which many phones and browsers can't play. On iPhone choose Settings › Camera › Formats › Most Compatible, or export it as MP4 (H.264)."
        : "This video's format won't play on every phone. Export it as MP4 (H.264) and try again.",
    };
  }
  return { ok: true, durationSec: facts.durationSec, codec: facts.videoCodec };
}
