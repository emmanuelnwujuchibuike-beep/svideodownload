/**
 * Can THIS device play HEVC/H.265?
 *
 * Owner, 2026-09-03: "make sure no quality is lost in best quality and also the
 * preparing doesnt take time."
 *
 * Those two pull against each other only because of a re-encode. TikTok's top
 * tiers are bytevc1/H.265; the download pipeline turns them into H.264 so they
 * play everywhere, and that costs BOTH — a full server-side download plus a
 * full encode before the first byte reaches the browser, and a measured 9-25%
 * of the source bitrate at CRF 20 (see transcodeToH264's audit).
 *
 * If the device can decode HEVC, neither cost has to be paid: the original
 * bytes are already the best quality that exists and can be streamed straight
 * through. That is instant AND lossless — not a trade between them.
 *
 * ── Why the BROWSER's answer, for a file the OS will play ─────────────────────
 *
 * A saved file is opened by the gallery, not by this page, and OS support is
 * broader than browser support (Android has decoded HEVC since 5.0, iOS since
 * 11). So the browser saying yes is a CONSERVATIVE proxy: every browser that
 * can decode it sits on an OS that can. The error runs the safe way — a device
 * whose browser says no still gets the compatibility re-encode it gets today,
 * even if its gallery would have coped.
 *
 * Deliberately not a user-agent test. UA sniffing for a codec is how you ship a
 * black video to a device nobody had in the matrix; `canPlayType` asks the
 * decoder that will actually be used.
 */

/** Both fourCCs a browser may recognise for HEVC in MP4. */
const HEVC_TYPES = [
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
  'video/mp4; codecs="hev1.1.6.L93.B0"',
  'video/mp4; codecs="hvc1"',
];

/**
 * True only when the browser positively claims HEVC playback.
 *
 * `canPlayType` returns "probably" | "maybe" | "". "maybe" is included: it is
 * what Safari returns for a codec string it recognises but cannot fully verify
 * without the file, and excluding it would drop iOS — the platform with the
 * most complete HEVC support there is.
 */
export function canPlayHevc(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const v = document.createElement("video");
    if (typeof v.canPlayType !== "function") return false;
    return HEVC_TYPES.some((t) => v.canPlayType(t) !== "");
  } catch {
    // No video element, a locked-down webview, anything at all — fail closed
    // and take the re-encode. A slow download beats an unplayable file.
    return false;
  }
}
