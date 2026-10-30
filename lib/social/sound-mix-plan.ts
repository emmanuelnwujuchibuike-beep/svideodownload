/**
 * The worker's recipe for a reel made with "Use this sound" (0308 — owner, 2026-10-30: the sound REPLACES the reel's
 * own audio, like TikTok). The reel's picture is copied untouched (no re-encode, no quality lost, seconds not minutes);
 * the sound becomes its only audio track, looped when the video is longer than the sound and cut where the video ends.
 * The sound's file may itself be a video (an original sound is its reel's own MP4): only its audio track is read.
 *
 * Pure: arguments only, so a test can read the exact command (lib/social/sound-mix-plan.test.ts).
 */
export const SOUND_MIX_AUDIO_BITRATE = "128k";
/** No reel is longer than this; a cap keeps a looped sound from ever writing an endless file. */
export const SOUND_MIX_MAX_SECONDS = 600;

export function buildSoundMixArgs(video: string, sound: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    video,
    // loop the SOUND (this option belongs to the input after it): a 10 s sound under a 30 s reel plays three times
    "-stream_loop",
    "-1",
    "-i",
    sound,
    // the reel's picture, the sound's audio — the reel's own audio is dropped
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    SOUND_MIX_AUDIO_BITRATE,
    "-ac",
    "2",
    // ends with the reel's picture, never the looping sound
    "-shortest",
    "-t",
    String(SOUND_MIX_MAX_SECONDS),
    "-movflags",
    "+faststart",
    output,
  ];
}

/** Where the mixed reel is stored (public bucket): a new key, so no cache ever serves the old audio under it. */
export function soundMixKey(postId: string, stamp: string): string {
  return `reels/sound-mix/${postId}-${stamp}.mp4`;
}
