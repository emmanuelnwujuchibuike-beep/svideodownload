/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PLAYBACK SPEED (Feature 15, Part 2 — tranche 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Support 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x, temporary hold-to-speed. Remember
 *  user preference."
 *
 * ── Why the preference is remembered but the HOLD is not ───────────────────
 *
 * Two different intentions wearing the same number. Picking 1.5x from the sheet
 * is a statement about how you like to watch, so it survives the session. Holding
 * to skim a slow part is a statement about THIS moment, so it is released with
 * the finger. Persisting the hold would mean every reel afterwards played at 2x
 * because of one impatient second — the classic "why is everything fast now" bug.
 *
 * ── Why it is a fixed ladder and not a slider ──────────────────────────────
 *
 * A slider on a video surface is a drag target competing with the scrubber, the
 * album swipe and the vertical scroll — four gestures in one thumb's reach. The
 * ladder is also what every player a person already knows uses, so nobody has to
 * discover the vocabulary.
 *
 * ── The bounds are not arbitrary ───────────────────────────────────────────
 *
 * Browsers stop rendering audio outside roughly 0.25x–4x (Chrome mutes beyond
 * it; Safari clamps). Staying inside 0.5x–2x means the sound is always intact,
 * which matters here because a muted reel at 2x is just a flicker.
 */

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export const DEFAULT_RATE: PlaybackRate = 1;
/** What a press-and-hold temporarily jumps to. */
export const HOLD_RATE = 2;

const KEY = "frenz:video-speed";

/** Nearest ladder rung to an arbitrary number — the stored value is untrusted. */
export function nearestRate(value: number): PlaybackRate {
  if (!Number.isFinite(value)) return DEFAULT_RATE;
  let best: PlaybackRate = DEFAULT_RATE;
  let bestGap = Infinity;
  for (const r of PLAYBACK_RATES) {
    const gap = Math.abs(r - value);
    if (gap < bestGap) {
      bestGap = gap;
      best = r;
    }
  }
  return best;
}

/**
 * Read the remembered speed.
 *
 * Snapped to the ladder rather than trusted: this comes from localStorage, which
 * a person can edit and an older build may have written differently. A rogue
 * `playbackRate` of 16 would be silent — the video simply plays unwatchably fast
 * with no error anywhere — so it is clamped at the boundary instead of validated
 * at each of the call sites that set it.
 */
export function getPlaybackRate(): PlaybackRate {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw === null) return DEFAULT_RATE;
    return nearestRate(Number.parseFloat(raw));
  } catch {
    return DEFAULT_RATE;
  }
}

export function setPlaybackRate(rate: PlaybackRate): void {
  try {
    localStorage.setItem(KEY, String(rate));
  } catch {
    /* private mode — the choice just does not outlive the session */
  }
}

/** The next rung, wrapping — the sheet row cycles rather than opening a picker. */
export function nextRate(current: number): PlaybackRate {
  const i = PLAYBACK_RATES.indexOf(nearestRate(current));
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]!;
}

/** "1x" / "1.5x" — no trailing zeros, because "1.50x" reads like a price. */
export function formatRate(rate: number): string {
  return `${Number.parseFloat(rate.toFixed(2))}×`;
}

/**
 * Apply a rate to an element.
 *
 * 🔴 `preservesPitch` is set explicitly rather than left to the default, which
 * differs by engine: Chrome preserves pitch, older Safari does not, and the
 * difference between a voice that sounds normal at 1.5x and a chipmunk is not
 * something to leave to chance. The vendor-prefixed spellings are still needed
 * for Safari versions this app supports.
 */
export function applyRate(video: HTMLMediaElement | null, rate: number): void {
  if (!video) return;
  try {
    const v = video as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    v.preservesPitch = true;
    v.webkitPreservesPitch = true;
    video.playbackRate = rate;
  } catch {
    /* a detached or not-yet-ready element — the next attach applies it */
  }
}
