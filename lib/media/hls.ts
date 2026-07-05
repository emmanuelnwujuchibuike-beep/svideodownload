/**
 * Adaptive-bitrate playback helpers. Cloudflare Stream serves HLS (an auto quality
 * ladder + AV1/H.265/H.264, delivered from the global edge). Safari/iOS play the
 * `.m3u8` manifest natively; everywhere else we attach hls.js — dynamically imported
 * so its ~100 KB never touches a bundle until a Stream video actually plays on a
 * non-native browser.
 *
 * Tuned for a scrolling reels feed: small forward buffer + trimmed back-buffer
 * (low memory/battery), cap the level to the element size (never fetch 4K into a
 * phone-sized player), auto start level by bandwidth (fast first frame), and parse
 * segments in a worker (keeps the main thread — and the device — cool). Any fatal
 * error calls `onFatal` so the caller can fall back to the plain MP4.
 */

/** Does this browser play HLS from a plain `<video src>` (Safari, iOS)? */
export function supportsNativeHls(video: HTMLVideoElement): boolean {
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    video.canPlayType("application/x-mpegURL") !== ""
  );
}

export interface AttachHlsOptions {
  /** Fired on an unrecoverable error so the caller can fall back to MP4. */
  onFatal?: () => void;
  /** Fired once the first frames are parsed — for time-to-first-frame metrics. */
  onReady?: () => void;
}

/**
 * Attach an HLS stream to a `<video>` via hls.js. Returns a destroy function that
 * fully releases the decoder + buffers (important for a long reels session).
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  opts: AttachHlsOptions = {},
): Promise<() => void> {
  let mod;
  try {
    mod = (await import("hls.js")).default;
  } catch {
    opts.onFatal?.();
    return () => {};
  }
  const Hls = mod;
  if (!Hls.isSupported()) {
    opts.onFatal?.();
    return () => {};
  }

  const hls = new Hls({
    // Fast first frame, small footprint.
    maxBufferLength: 12, // seconds buffered ahead
    maxMaxBufferLength: 24,
    backBufferLength: 6, // drop already-watched buffer → stable memory on long scroll
    capLevelToPlayerSize: true, // never fetch a level larger than the element
    startLevel: -1, // auto-pick by measured bandwidth
    abrEwmaDefaultEstimate: 1_000_000, // reasonable first guess so startup isn't stuck low
    enableWorker: true, // parse segments off the main thread (CPU/thermal)
    lowLatencyMode: false,
    // Fail fast so a not-yet-ready Stream video falls back to MP4 quickly.
    manifestLoadingMaxRetry: 1,
    manifestLoadingTimeOut: 8_000,
    fragLoadingMaxRetry: 2,
  });

  let recovered = false;
  hls.on(Hls.Events.ERROR, (_evt: unknown, data: { fatal?: boolean; type?: string }) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
      recovered = true;
      try {
        hls.recoverMediaError();
        return;
      } catch {
        /* fall through to fatal */
      }
    }
    opts.onFatal?.();
  });
  if (opts.onReady) hls.once(Hls.Events.FRAG_BUFFERED, () => opts.onReady?.());

  hls.loadSource(url);
  hls.attachMedia(video);

  return () => {
    try {
      hls.destroy();
    } catch {
      /* already gone */
    }
  };
}
