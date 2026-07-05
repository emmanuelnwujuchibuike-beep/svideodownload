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
  /**
   * Never auto-select a level taller than this (px). Spec: "do not default to
   * the highest resolution" — a weak connection, data-saver, or low battery
   * should cap the ladder instead of quietly buffering 4K. `null`/omitted = no
   * extra cap beyond `capLevelToPlayerSize`.
   */
  maxHeight?: number | null;
}

export interface HlsHandle {
  /** Fully releases the decoder + buffers (important for a long reels session). */
  destroy: () => void;
  /** Re-apply a quality cap after attach (e.g. once a battery reading resolves). */
  setMaxHeightCap: (maxHeight: number | null) => void;
  /** Last-observed rendition bitrate (kbps), for observability. */
  getBitrateKbps: () => number | undefined;
}

type HlsInstance = InstanceType<typeof import("hls.js").default>;

function applyHeightCap(hls: HlsInstance, maxHeight: number | null | undefined) {
  if (!maxHeight) {
    hls.autoLevelCapping = -1; // no extra cap — capLevelToPlayerSize still applies
    return;
  }
  const levels = hls.levels ?? [];
  let capIndex = -1;
  levels.forEach((lvl, i) => {
    if (lvl.height && lvl.height <= maxHeight) capIndex = i;
  });
  // Nothing at/under the cap (e.g. ladder starts above it) — keep the lowest rung
  // rather than forcing an unbounded auto level.
  if (capIndex === -1 && levels.length) capIndex = 0;
  hls.autoLevelCapping = capIndex;
}

/**
 * Attach an HLS stream to a `<video>` via hls.js. Returns a handle to destroy
 * (release decoder + buffers) or refine the quality cap later.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  opts: AttachHlsOptions = {},
): Promise<HlsHandle> {
  const noop: HlsHandle = { destroy: () => {}, setMaxHeightCap: () => {}, getBitrateKbps: () => undefined };
  let mod;
  try {
    mod = (await import("hls.js")).default;
  } catch {
    opts.onFatal?.();
    return noop;
  }
  const Hls = mod;
  if (!Hls.isSupported()) {
    opts.onFatal?.();
    return noop;
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
  // Never default to the top of the ladder on a weak connection / data-saver /
  // low battery — apply the caller's cap as soon as levels are known.
  hls.once(Hls.Events.MANIFEST_PARSED, () => applyHeightCap(hls, opts.maxHeight));

  hls.loadSource(url);
  hls.attachMedia(video);

  return {
    destroy: () => {
      try {
        hls.destroy();
      } catch {
        /* already gone */
      }
    },
    setMaxHeightCap: (maxHeight) => applyHeightCap(hls, maxHeight),
    getBitrateKbps: () => {
      const level = hls.levels?.[hls.currentLevel];
      return level?.bitrate ? Math.round(level.bitrate / 1000) : undefined;
    },
  };
}
