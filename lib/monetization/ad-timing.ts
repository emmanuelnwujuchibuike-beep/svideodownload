/**
 * 🔴 THE AD NETWORK'S OWN TIMER WINS. THE ADMIN NUMBER IS A FALLBACK.
 *
 * Owner, 2026-08-30, twice:
 *   "sometimes google adsense can have a 5 sec ad in their inventory and i set
 *    10sec, it should be skipable for 5 secs, time should be according to the ad
 *    network timer."
 *   "make same rule for the exoclick and others video ad in wallpaper download
 *    reward video or anywhere that is on 30sec or 10secs to be skipable when the
 *    ad finishes in the ad network, admin timer set up should only be a fallback."
 *
 * Every gated ad in this product used to run a fixed admin countdown — 30s for
 * the HD reward, 10s or 5s for the wallpaper reward, whatever `skipAfterSeconds`
 * said for the interstitials — with no idea how long the creative it was gating
 * actually was. When the network filled a shorter ad, the countdown kept running
 * over a finished video, and in the worst case the Skip control was gated on a
 * number the playback clock could never reach, so it never appeared at all on an
 * overlay whose only other exit was that control.
 *
 * This module is the one implementation of the rule, shared by the VAST
 * interstitial overlay, the reward gates and the full-screen interstitials, so
 * there is exactly one place it can be got wrong.
 *
 * Deliberately dependency-free and framework-free — imported by plain-DOM
 * players, React gates, the admin form and a server route alike.
 */

/** The shipped fallback when a caller passes no usable number at all. */
const FALLBACK_SECONDS = 5;

/**
 * How long the visitor must watch before the gate opens, in seconds.
 *
 * The admin number is a CEILING. The shortest KNOWN duration wins, because
 * every one of them is an upper bound on how long the visitor can possibly be
 * asked to watch:
 *
 *   `vastDurationSeconds`  — the network's declared `<Duration>`. This is the
 *                            "ad network timer" the owner means. Known BEFORE
 *                            the first frame, so the countdown starts at the
 *                            right number instead of correcting itself mid-play.
 *   `mediaDurationSeconds` — what the file turned out to be, from
 *                            `loadedmetadata`. Authoritative when the VAST
 *                            over-declared or omitted it.
 *
 * 🔴 Unknown durations are IGNORED, not treated as zero. `null` is what
 * `parseVast` returns for an absent `<Duration>`, `NaN` is what a `<video>`
 * reports before metadata, and `Infinity` is a live stream. Reading any of them
 * as "0 seconds" would hand the ad away for free; reading them as a real number
 * would gate on nonsense. When nothing is known, the admin number stands — which
 * is exactly what "admin timer set up should only be a fallback" means.
 */
export function effectiveSkipSeconds({
  configuredSeconds,
  vastDurationSeconds,
  mediaDurationSeconds,
}: {
  configuredSeconds: number;
  vastDurationSeconds?: number | null;
  mediaDurationSeconds?: number | null;
}): number {
  const configured =
    typeof configuredSeconds === "number" && Number.isFinite(configuredSeconds)
      ? Math.max(0, configuredSeconds)
      : FALLBACK_SECONDS;

  let skip = configured;
  for (const duration of [vastDurationSeconds, mediaDurationSeconds]) {
    // `> 0 && isFinite` rejects null, undefined, NaN, 0 and Infinity in one
    // test — all of them mean "no usable length", not "zero".
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      skip = Math.min(skip, duration);
    }
  }
  return Math.max(0, Math.round(skip));
}

/**
 * How long the visitor still has to wait, in whole seconds.
 *
 * ── Driven by PLAYBACK, not by the wall clock ─────────────────────────────────
 *
 * "Time should be according to the ad network timer" — so the countdown follows
 * the video's own position. A wall-clock interval keeps counting through
 * buffering, so on a slow connection the gate opened before the advertiser's ad
 * had actually been watched: we would be billing an impression for time nobody
 * saw, and showing less ad than the operator configured.
 *
 * ── …but the wall clock is the SAFETY NET ─────────────────────────────────────
 *
 * 🔴 A purely playback-driven countdown is a trap. If the media stalls dead — a
 * dead CDN mid-roll, a codec the device silently gives up on — the position
 * freezes, the gate never opens, and a full-screen overlay has no other exit.
 * The startup budget cannot help; it is already cleared by the time playback
 * began.
 *
 * So elapsed wall time, minus a grace, is a FLOOR. While playback is healthy it
 * stays behind and does nothing; the moment playback falls more than
 * `stallGraceSeconds` behind, it takes over and the visitor is released.
 */
export const SKIP_STALL_GRACE_SECONDS = 3;

export function skipRemainingSeconds({
  skipAtSeconds,
  playedSeconds,
  elapsedSeconds,
  stallGraceSeconds = SKIP_STALL_GRACE_SECONDS,
}: {
  skipAtSeconds: number;
  playedSeconds: number;
  elapsedSeconds: number;
  stallGraceSeconds?: number;
}): number {
  const played = Number.isFinite(playedSeconds) ? Math.max(0, playedSeconds) : 0;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const progress = Math.max(played, elapsed - stallGraceSeconds);
  return Math.max(0, Math.ceil(skipAtSeconds - progress));
}

/**
 * What a player reports upward so a gate can obey the rule.
 *
 * Both fields are optional-by-nature rather than optional-by-type because a gate
 * has to handle "not known yet" for each of them independently: duration arrives
 * at `loadedmetadata`, the end arrives at `ended`, and plenty of ads deliver
 * neither (a display creative has no timeline at all — that is the fallback
 * case).
 */
export interface AdTiming {
  /** The creative's length, once known. Null until then. */
  durationSeconds: number | null;
  /** True once the ad has played to its end. */
  ended: boolean;
}
