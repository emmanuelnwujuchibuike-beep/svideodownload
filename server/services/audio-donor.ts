import type { MediaFormat } from "@/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PICTURE WITH NO SOUND gets its sound from the same post (owner, 2026-10-30)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Some TikTok video doesn't download with sound" — vt.tiktok.com/ZSg7YNcy3, measured the same day. TikTok now serves
 * its taller tiers as ADAPTIVE streams ("adapt_lowest_1080_1", "adapt_lower_720_1", "adapt_540_1"): a video track and
 * NOTHING else — its own player fetches the sound separately. Only the "normal_*" tier and playAddr carry audio. Our
 * "Best quality" row is the tallest tier, so it downloaded as a silent 1080p file (every converter here maps the
 * source's audio as OPTIONAL — `0:a:0?` — so a source without one simply produced none, with no error).
 *
 * Now, when the chosen file has a picture but no audio, the audio is taken from another rendition of the SAME post —
 * a sibling video tier first (the identical soundtrack, H.264 tiers first since they are the ones TikTok muxes), then
 * the post's audio-only format — and laid under the full-quality picture. Pure: the order and the arguments, so a test
 * reads the exact command (server/services/audio-donor.test.ts); download-service runs it.
 */

/** The renditions that may lend their audio, best first. Never the chosen file itself, never a synthesized tier. */
export function audioDonorCandidates(formats: readonly MediaFormat[], chosen: MediaFormat): MediaFormat[] {
  const others = formats.filter((f) => !!f.directUrl && f.directUrl !== chosen.directUrl && !f.transcodeMaxHeight);
  const videos = others.filter((f) => f.kind === "video");
  // a sibling tier is the very same soundtrack; the audio-only format may be the post's MUSIC (for a reel that used a
  // licensed song, the song alone — not the creator's voice over it), so it is only the last resort
  return [...videos.filter((f) => f.vcodec === "h264"), ...videos.filter((f) => f.vcodec !== "h264"), ...others.filter((f) => f.kind === "audio")];
}

/** How many renditions are probed for audio before giving up (each probe reads a container header only). */
export const MAX_DONOR_PROBES = 4;

export interface DonorAudioCodecs {
  audio: string | null;
  audioProfile: string | null;
}

/**
 * The donor's audio, as delivered: plain AAC copied untouched; HE-AAC turned into AAC-LC (phones' gallery players
 * mangle HE-AAC — see isHeAac in download-service); anything else converted to AAC.
 */
export function donorAudioArgs(c: DonorAudioCodecs): string[] {
  if (c.audio === "aac" && /he-aac/i.test(c.audioProfile ?? "")) return ["-c:a", "aac", "-b:a", "128k"];
  if (c.audio === "aac") return ["-c:a", "copy"];
  return ["-c:a", "aac", "-b:a", "192k"];
}

/**
 * The inputs and stream maps: the PICTURE from input 0, the SOUND from input 1 — never input 0's audio (it has none) —
 * ending with the shorter of the two (they are the same post, so the same length).
 */
export function audioMuxInputArgs(video: { url: string; headerArgs: string[] }, donor: { url: string; headerArgs: string[] }, threads: string): string[] {
  return [...video.headerArgs, "-threads", threads, "-i", video.url, ...donor.headerArgs, "-i", donor.url, "-map", "0:v:0", "-map", "1:a:0", "-shortest"];
}

const HEVC_NAMES = new Set(["hevc", "h265", "hvc1", "hev1"]);
export function isHevcCodec(codec: string | null | undefined): boolean {
  return !!codec && HEVC_NAMES.has(codec.toLowerCase());
}

/**
 * An HEVC picture for a device that PLAYS HEVC (the browser's own canPlayType): "raw" — the original bytes, straight
 * through; "copyPicture" — the picture copied untouched and only HE-AAC sound converted to AAC-LC (phones' gallery
 * players mangle HE-AAC); null — not this case (the compatibility re-encode decides).
 *
 * 🔴 NEVER a re-encode of a picture the device already plays (owner, 2026-10-30: "why does hevc re-encode … I don't want
 * anything that breaks down quality and consume time"). TikTok's Best tier is HEVC + HE-AACv2 (measured on
 * @tiktok/video/7106594312292453675): it was re-encoded whole — 9.5 s before the first byte and 2.9x the source's size —
 * for an iPhone that plays the original. Copying the picture gives the original 1080x1920, 3.6 MB.
 */
export function hevcDelivery(clientPlaysHevc: boolean, videoCodec: string | null | undefined, heAac: boolean): "raw" | "copyPicture" | null {
  if (!clientPlaysHevc || !isHevcCodec(videoCodec)) return null;
  return heAac ? "copyPicture" : "raw";
}

/**
 * The picture, as delivered: H.264 copied; HEVC copied too when the DEVICE plays it (tagged hvc1, the tag Apple's
 * players require in MP4); anything else re-encoded to H.264 at the same settings as transcodeToH264.
 */
export function muxVideoArgs(videoCodec: string | null, keepHevc: boolean, threads: string): string[] {
  if (videoCodec === "h264") return ["-c:v", "copy"];
  if (keepHevc && isHevcCodec(videoCodec)) return ["-c:v", "copy", "-tag:v", "hvc1"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", threads, "-x264-params", `threads=${threads}:lookahead-threads=1`];
}
