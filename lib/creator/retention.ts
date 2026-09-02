/**
 * Retention curves and drop-off (Feature 15 · Part 9).
 *
 * ── What the underlying signal actually is ────────────────────────────────
 * Part 8 shipped `post_watch_events`, whose `watch_ms` is the PLAYHEAD
 * POSITION when playback paused or ended — `recordWatch(id, v.currentTime *
 * 1000, v.duration * 1000, …)` in both the reel viewer and the feed player.
 * That is what makes a retention curve possible at all: each row says how far
 * into the video one watch got.
 *
 * ── And what it is not ───────────────────────────────────────────────────
 * It is a position at exit, not an attention trace. A viewer who seeks
 * backwards before leaving is recorded at the LOWER position, and a looping
 * rewatch arrives as a second row rather than a longer one. So this measures
 * "how far viewers had got when they stopped", which is a real distribution of
 * real playhead positions — not frame-accurate telemetry, and the UI says so.
 * Building it as though it were the latter would be the same defect class Part
 * 8 kept calling out: a label that doesn't match the query underneath it.
 *
 * Pure: no React, no Supabase, no clock.
 */

/** One watch, as stored. `durationMs <= 0` means the player never reported a
 *  duration (a stalled load, a live-ish stream) and the row cannot be placed on
 *  a curve — it is counted as unusable rather than silently treated as 0%. */
export interface WatchSample {
  watchMs: number;
  durationMs: number;
}

export interface RetentionPoint {
  /** Fraction of the video this point sits at: 0, 0.1, … 1.0. */
  at: number;
  /** Share of watches (0-1) that reached at least this far. */
  reached: number;
}

export interface RetentionCurve {
  /** 11 points, 0% through 100% inclusive. Empty when there is no usable sample. */
  points: RetentionPoint[];
  /** Watches that could be placed on the curve. */
  sampleSize: number;
  /** Watches thrown away because no duration was reported. */
  unusable: number;
  /** Mean completion across the usable sample (0-1). */
  averageCompletion: number;
  /** Share of the sample that reached the end (>= 95%, so a rounding
   *  millisecond short of the final frame still counts as finished). */
  completionRate: number;
  /**
   * The steepest fall between two adjacent deciles — where viewers leave.
   * `null` when the sample is too small to name one honestly: a "drop-off at
   * 40%" drawn from four watches is noise wearing a chart's clothes.
   */
  dropOff: { at: number; lost: number } | null;
}

/** Below this many usable watches, no drop-off point is claimed. */
export const MIN_DROPOFF_SAMPLE = 20;

/** A watch counts as finished at 95% — the last frames are routinely skipped by
 *  a pause/unload firing a hair before the end. */
const FINISHED_AT = 0.95;

const EMPTY: RetentionCurve = {
  points: [],
  sampleSize: 0,
  unusable: 0,
  averageCompletion: 0,
  completionRate: 0,
  dropOff: null,
};

/**
 * The survival function over deciles: for each tenth of the video, the share of
 * watches whose playhead got at least that far.
 *
 * Point 0 is always 1 — every watch reached the start, by definition of being a
 * watch. That is not a padded data point; it is the curve's anchor, and drawing
 * it lets the first decile's fall (usually the largest) be visible at all.
 */
export function buildRetentionCurve(samples: WatchSample[]): RetentionCurve {
  const usable: number[] = [];
  let unusable = 0;

  for (const s of samples) {
    if (!Number.isFinite(s.durationMs) || s.durationMs <= 0) {
      unusable += 1;
      continue;
    }
    if (!Number.isFinite(s.watchMs) || s.watchMs < 0) {
      unusable += 1;
      continue;
    }
    // Clamp: a playhead past the duration (a rounding overshoot at the end of
    // a loop) is a completed watch, not a 130% one.
    usable.push(Math.min(1, s.watchMs / s.durationMs));
  }

  if (usable.length === 0) return { ...EMPTY, unusable };

  const points: RetentionPoint[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const at = i / 10;
    const reached = i === 0 ? 1 : usable.filter((c) => c >= at).length / usable.length;
    points.push({ at, reached });
  }

  const averageCompletion = usable.reduce((sum, c) => sum + c, 0) / usable.length;
  const completionRate = usable.filter((c) => c >= FINISHED_AT).length / usable.length;

  let dropOff: RetentionCurve["dropOff"] = null;
  if (usable.length >= MIN_DROPOFF_SAMPLE) {
    let worst = { at: 0, lost: 0 };
    for (let i = 1; i < points.length; i += 1) {
      const lost = points[i - 1]!.reached - points[i]!.reached;
      if (lost > worst.lost) worst = { at: points[i]!.at, lost };
    }
    if (worst.lost > 0) dropOff = worst;
  }

  return {
    points,
    sampleSize: usable.length,
    unusable,
    averageCompletion,
    completionRate,
    dropOff,
  };
}

/**
 * An SVG path through a curve, for a chart `width` × `height` points wide.
 * Kept here rather than in the component so the geometry is testable and the
 * chart stays a dumb renderer.
 */
export function retentionPath(curve: RetentionCurve, width: number, height: number): string {
  if (curve.points.length === 0) return "";
  return curve.points
    .map((p, i) => {
      const x = p.at * width;
      const y = height - p.reached * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Hour-of-day histogram — 24 buckets, used by the audience dashboard and by
 *  the assistant's upload-time suggestion. Hours are whatever the caller put
 *  in: the audience page converts to the creator's local hours before calling,
 *  so a bucket means "9am where you are", not "9am UTC". */
export function hourHistogram(hours: number[]): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const h of hours) {
    if (!Number.isInteger(h) || h < 0 || h > 23) continue;
    buckets[h] = (buckets[h] ?? 0) + 1;
  }
  return buckets;
}

/** The busiest hour, or null when nothing has been watched yet. Ties resolve to
 *  the earlier hour — arbitrary, but stable, which matters when this drives a
 *  suggestion a creator may act on twice. */
export function peakHour(buckets: number[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (let h = 0; h < buckets.length; h += 1) {
    const count = buckets[h] ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = h;
    }
  }
  return bestCount > 0 ? best : null;
}
