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
  /** Show it when a download is started. The only trigger today. */
  enabledOnDownload: boolean;
  /** Whether a skip/close control may appear at all. */
  skipEnabled: boolean;
  /** Seconds of playback before the skip control appears. */
  skipAfterSeconds: number;
  /** Milliseconds to wait for the ad to START before failing open. */
  timeoutMs: number;
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
  enabledOnDownload: true,
  skipEnabled: true,
  skipAfterSeconds: 5,
  timeoutMs: 3000,
  cooldownMs: 90_000,
};

/** Bounds. A stored value outside these is clamped, never honoured. */
export const VAST_LIMITS = {
  skipAfterSeconds: { min: 0, max: 30 },
  /*
    The startup budget is capped at 5s on purpose. This runs while someone is
    waiting for a file they asked for, and the whole design rule is that the ad
    is an optional enhancement — a longer budget would make ExoClick's latency
    the visitor's problem, which is precisely what fail-open exists to prevent.
  */
  timeoutMs: { min: 500, max: 5000 },
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
