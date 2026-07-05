/**
 * Playback observability. A tiny, fire-and-forget beacon of the key streaming
 * health signals — time-to-first-frame, rebuffer count, and which source path was
 * used — so we can watch startup delay + rebuffering per source without any player
 * chrome. Sampled at the call site to keep volume low; uses `sendBeacon` so it never
 * blocks or delays teardown.
 */
export type PlaybackMode = "native-hls" | "hls" | "mp4";

export interface PlaybackReport {
  postId?: string;
  mode: PlaybackMode;
  /** Time from source attach to the first frame (ms). */
  ttffMs?: number;
  /** How many times playback stalled to rebuffer after starting. */
  rebuffers: number;
}

export function reportPlayback(p: PlaybackReport): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    navigator.sendBeacon("/api/metrics/playback", JSON.stringify(p));
  } catch {
    /* metrics are best-effort — never surface an error */
  }
}
