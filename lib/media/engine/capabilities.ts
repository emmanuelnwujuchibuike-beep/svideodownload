/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FrenzStream™ — DEVICE CAPABILITY PROBE (Feature 15, Part 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What this machine can decode, and how much headroom it has to do it with.
 *
 * ── Why a probe and not a user-agent table ─────────────────────────────────
 * Codec support is a property of the build, the OS, the GPU and sometimes the
 * current power state — none of which a UA string tells you. `canPlayType` asks
 * the actual decoder. It is also cheap and synchronous, so it can run at attach
 * time without delaying the first frame.
 *
 * ── Why "probably" and "maybe" are BOTH treated as support ─────────────────
 * `canPlayType` returns "" (no), "maybe" (the container yes, the codec unknown
 * until bytes arrive) or "probably" (yes). Only "" is a real no. Treating
 * "maybe" as unsupported would drop AV1 on browsers that do support it but
 * decline to promise, which is most of them.
 *
 * ── What this does NOT claim ───────────────────────────────────────────────
 * 🔴 There is no web API for GPU load, CPU load, or device temperature. This
 * reports the two static hints that DO exist (`deviceMemory`,
 * `hardwareConcurrency`) and nothing more. The dynamic side of "is this device
 * struggling" is answered by observed dropped frames in `governor.ts`, which is
 * a consequence of throttling rather than a reading of it. Anything else would
 * be a fabricated number.
 */

export type DeviceClass = "low" | "mid" | "high";

export interface MediaCapabilities {
  /** Codecs the decoder will accept, probed rather than assumed. */
  av1: boolean;
  hevc: boolean;
  h264: boolean;
  vp9: boolean;
  webm: boolean;
  /** Native HLS playback from a plain `<video src>` (Safari, iOS). */
  nativeHls: boolean;
  /** Picture-in-Picture is offered by this browser (not: allowed right now). */
  pictureInPicture: boolean;
  /** Coarse hardware class, from the only two hints the platform exposes. */
  deviceClass: DeviceClass;
  /** `navigator.deviceMemory` in GB, when exposed. */
  memoryGb?: number;
  /** `navigator.hardwareConcurrency`, when exposed. */
  cores?: number;
}

/** Probe strings. Each names a container AND a codec — a bare container lies. */
const PROBES = {
  av1: 'video/mp4; codecs="av01.0.05M.08"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  h264: 'video/mp4; codecs="avc1.42E01E"',
  vp9: 'video/webm; codecs="vp9"',
  webm: 'video/webm; codecs="vp8, vorbis"',
} as const;

/**
 * Device class from the two static hints the platform gives us.
 *
 * Deliberately pessimistic when a hint is missing: Safari exposes neither
 * `deviceMemory` nor, historically, a useful `hardwareConcurrency`, and a large
 * share of this app's traffic is iPhones. Guessing "high" for an unknown device
 * would push the heaviest ladder at exactly the population we cannot measure, so
 * an unknown device is "mid" — full quality on a good network, but never the
 * deepest preload window.
 */
export function classifyDevice(memoryGb?: number, cores?: number): DeviceClass {
  if ((memoryGb !== undefined && memoryGb <= 2) || (cores !== undefined && cores <= 4)) return "low";
  if ((memoryGb !== undefined && memoryGb >= 8) || (cores !== undefined && cores >= 8)) return "high";
  return "mid";
}

let cached: MediaCapabilities | null = null;

/** Probe once per document — none of this can change during a session. */
export function getMediaCapabilities(): MediaCapabilities {
  if (cached) return cached;

  if (typeof document === "undefined") {
    // SSR: report the conservative floor. Nothing renders a decision from this
    // on the server, but returning a confident answer would be a lie that a
    // hydration mismatch could then bake in.
    return {
      av1: false,
      hevc: false,
      h264: true,
      vp9: false,
      webm: false,
      nativeHls: false,
      pictureInPicture: false,
      deviceClass: "mid",
    };
  }

  const el = document.createElement("video");
  const can = (type: string) => {
    try {
      // "" is the only real no — see the note above on "maybe".
      return el.canPlayType(type) !== "";
    } catch {
      return false;
    }
  };

  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined;
  const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined;

  cached = {
    av1: can(PROBES.av1),
    hevc: can(PROBES.hevc),
    h264: can(PROBES.h264),
    vp9: can(PROBES.vp9),
    webm: can(PROBES.webm),
    nativeHls: can("application/vnd.apple.mpegurl") || can("application/x-mpegURL"),
    pictureInPicture:
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true,
    deviceClass: classifyDevice(memoryGb, cores),
    memoryGb,
    cores,
  };
  return cached;
}

/** Test seam — the probe is cached for the life of the document. */
export function __resetCapabilitiesCache(): void {
  cached = null;
}
