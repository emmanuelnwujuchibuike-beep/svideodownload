/**
 * The ONE place the VAST interstitial's behaviour is configured.
 *
 * Deliberately dependency-free and framework-free: it is imported by the admin
 * form, by the public config route, and by the lazy client module, so it must
 * not drag zod, React or anything server-only into a client bundle.
 *
 * ── The two timers are NOT the same thing ─────────────────────────────────────
 *
 * `timeoutMs`  — how long we wait for an ad to START before giving up and
 *                letting the download proceed. A fail-open budget.
 * `skipAfterSeconds` — how long a visitor watches before the skip control
 *                appears. A UX rule that only applies once an ad is playing.
 *
 * Conflating them is how a slow network turns into a visitor staring at a blank
 * overlay for the length of the skip timer. They are separate fields, separately
 * clamped, and the startup budget is always the smaller of the two.
 */

export interface VastInterstitialConfig {
  /** Master switch for the whole interstitial. Off means nothing is ever loaded. */
  enabled: boolean;
  /** Show it when a download is STARTED. */
  enabledOnDownload: boolean;
  /**
   * Show it when a download COMPLETES — the landing, /download, /history and
   * every other page that can finish a transfer (owner, 2026-08-30: "download
   * completed in the landing pages and download, history and all pages should
   * trigger a 5 to 15 sec skipable video ad").
   *
   * 🔴 THIS AND `enabledOnDownload` COMPETE FOR ONE COOLDOWN. A start ad at
   * t=0 and a completion ad twenty seconds later are two interstitials inside
   * the default 90s `cooldownMs`, so the second is suppressed. With both on the
   * completion ad — the one actually asked for — is the one that never shows.
   * That is why the START trigger now defaults OFF and this one defaults ON.
   */
  enabledOnDownloadComplete: boolean;
  /** Whether a skip/close control may appear at all. */
  skipEnabled: boolean;
  /** Seconds of playback before the skip control appears. */
  skipAfterSeconds: number;
  /**
   * Milliseconds to wait for a CREATIVE TO RESOLVE before failing open.
   *
   * 🔴 THIS NO LONGER COVERS PLAYBACK. See `startTimeoutMs`.
   */
  timeoutMs: number;
  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  🔴🔴 THE BUDGET THAT WAS SILENTLY EATING EVERY VIDEO IMPRESSION
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Owner, twice: the Hilltop VAST zone reads 0 impressions while the banner
   * and slider zones serve normally.
   *
   * `timeoutMs` used to cover BOTH halves — resolving the VAST document AND
   * getting the first frame on screen — with a default of 3000ms and a hard
   * cap of 5000ms. Measured on production (scripts/vast-playback-probe.mjs),
   * on an unthrottled connection, the creative reaches `playing` at:
   *
   *     loadstart 5476ms  →  loadedmetadata 10836ms  →  playing 10910ms
   *
   * The media 302s from `silent-basis.pro` to an IP-addressed CDN and is only
   * then served as a 206. Ten seconds is the FAST case. The budget aborted at
   * three, `overlay.ts` fires `<Impression>` from the video's `playing` event,
   * and so the pixel never fired once. Not a low number — a structural zero.
   *
   * ── Why splitting the timer is the correct fix, not just raising it ─────
   *
   * The two halves are different promises. Before a creative exists, the
   * visitor may be waiting for nothing, and failing open fast is right. Once a
   * creative IS in hand the visitor is going to see an ad, the overlay is
   * already on screen, and giving up merely wastes the seconds already spent
   * AND the impression. So resolution stays on the short fail-open budget and
   * playback gets its own, realistic one.
   *
   * Kept bounded, because "the ad is an optional enhancement" is still the
   * rule — this is not permission for an unbounded wait. The real answer to
   * the latency is warming the media at prefetch (see `warmMedia`), which is
   * what lets playback start well inside this budget.
   */
  startTimeoutMs: number;
  /** Minimum gap between two interstitials, per browser. 0 = every time. */
  cooldownMs: number;
}

/**
 * Defaults, and they are the ones that ship.
 *
 * `enabled: false` — the interstitial is the most intrusive placement in the
 * product, so it must be a deliberate act to turn on, exactly like the ExoClick
 * master switch it sits under.
 */
export const DEFAULT_VAST_INTERSTITIAL: VastInterstitialConfig = {
  enabled: false,
  // OFF, and deliberately changed from the original default — see the cooldown
  // note on `enabledOnDownloadComplete`. Still fully available in the admin for
  // an operator who wants the ad up front instead.
  enabledOnDownload: false,
  enabledOnDownloadComplete: true,
  skipEnabled: true,
  skipAfterSeconds: 5,
  timeoutMs: 3000,
  /* Measured: a cold Hilltop creative reaches `playing` at ~10.9s on an
     unthrottled connection. 12s clears that with a little room; warming the
     media at prefetch is what should make it land far sooner in practice. */
  startTimeoutMs: 12_000,
  cooldownMs: 90_000,
};

/** Bounds. A stored value outside these is clamped, never honoured. */
export const VAST_LIMITS = {
  skipAfterSeconds: { min: 0, max: 30 },
  /*
    The RESOLVE budget stays short and stays capped at 5s, for the original
    reason: this runs while someone is waiting for a file they asked for, and
    before a creative exists they may be waiting for nothing at all.
  */
  timeoutMs: { min: 500, max: 5000 },
  /*
    🔴 The PLAYBACK budget. Larger by design — once a creative is in hand the
    visitor is going to see an ad and the overlay is already up, so abandoning
    it throws away both the seconds already spent and the impression. The old
    shared 5s ceiling was below the measured ~10.9s cold start, which is why
    the VAST zone reported exactly zero. Still bounded: an ad may be slow, it
    may not be indefinite.
  */
  startTimeoutMs: { min: 3000, max: 20_000 },
  cooldownMs: { min: 0, max: 24 * 60 * 60 * 1000 },
} as const;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/**
 * Coerce anything stored (or posted) into a usable config.
 *
 * Every field falls back rather than throwing: a malformed settings blob must
 * degrade to "no interstitial", never to a download flow that crashes. The
 * admin brief is explicit — negatives, NaN and absurd values must not reach the
 * player.
 */
export function normalizeVastInterstitial(raw: unknown): VastInterstitialConfig {
  const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const bool = (key: keyof VastInterstitialConfig, fallback: boolean) =>
    typeof v[key] === "boolean" ? (v[key] as boolean) : fallback;

  return {
    enabled: bool("enabled", DEFAULT_VAST_INTERSTITIAL.enabled),
    enabledOnDownload: bool("enabledOnDownload", DEFAULT_VAST_INTERSTITIAL.enabledOnDownload),
    enabledOnDownloadComplete: bool(
      "enabledOnDownloadComplete",
      DEFAULT_VAST_INTERSTITIAL.enabledOnDownloadComplete,
    ),
    skipEnabled: bool("skipEnabled", DEFAULT_VAST_INTERSTITIAL.skipEnabled),
    skipAfterSeconds: clampInt(
      v.skipAfterSeconds,
      DEFAULT_VAST_INTERSTITIAL.skipAfterSeconds,
      VAST_LIMITS.skipAfterSeconds.min,
      VAST_LIMITS.skipAfterSeconds.max,
    ),
    timeoutMs: clampInt(
      v.timeoutMs,
      DEFAULT_VAST_INTERSTITIAL.timeoutMs,
      VAST_LIMITS.timeoutMs.min,
      VAST_LIMITS.timeoutMs.max,
    ),
    startTimeoutMs: clampInt(
      v.startTimeoutMs,
      DEFAULT_VAST_INTERSTITIAL.startTimeoutMs,
      VAST_LIMITS.startTimeoutMs.min,
      VAST_LIMITS.startTimeoutMs.max,
    ),
    cooldownMs: clampInt(
      v.cooldownMs,
      DEFAULT_VAST_INTERSTITIAL.cooldownMs,
      VAST_LIMITS.cooldownMs.min,
      VAST_LIMITS.cooldownMs.max,
    ),
  };
}

/** Options offered in the admin dropdown. */
export const SKIP_SECOND_OPTIONS = [0, 3, 5, 10, 15, 20, 30] as const;

/*
  The skip-timing rule lives in `ad-timing.ts` — it is not specific to this
  interstitial. Every gated ad in the product obeys it (owner: "make same rule
  for the exoclick and others video ad in wallpaper download reward video or
  anywhere"), so it has one home and this file re-exports it for the callers
  that already import from here.
*/
export {
  effectiveSkipSeconds,
  skipRemainingSeconds,
  SKIP_STALL_GRACE_SECONDS,
  type AdTiming,
} from "./ad-timing";

