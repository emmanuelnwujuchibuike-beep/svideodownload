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
  /** Frames the decoder dropped (thermal/CPU pressure signal), when available. */
  droppedFrames?: number;
  /** Frames decoded in the session, for a dropped-frame ratio. */
  decodedFrames?: number;
  /** Last-observed HLS rendition bitrate (kbps), when adaptive. */
  bitrateKbps?: number;
  /** A fatal decode/network error ended playback before completion. */
  errored?: boolean;
}

export function reportPlayback(p: PlaybackReport): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    navigator.sendBeacon("/api/metrics/playback", JSON.stringify(p));
  } catch {
    /* metrics are best-effort — never surface an error */
  }
}
