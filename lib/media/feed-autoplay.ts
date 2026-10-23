/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FEED AUTOPLAY — one election, the most visible video plays
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-22: "users should never need to play each video when they scroll in feed, video in
 * feed should auto play, stopping the previous video, two videos should never play at once, the
 * video being scrolled to should auto play instantly and never needs the play button".
 *
 * Each feed video used to decide for itself: it played when its OWN observer crossed 40% visible —
 * against a root stretched 200 px past the screen, so a clip still below the fold could start and,
 * through the coordinator, pause the one being watched. Observers only report threshold CROSSINGS,
 * so after a small scroll back nothing crossed again and the paused clip stayed paused until the
 * member tapped Play.
 *
 * Now every feed video reports how much of it is on screen, on every change, and ONE election picks
 * the winner: the largest share visible (of the clip, or of the screen for a clip taller than it),
 * at least MIN_SCORE, the one nearest the middle of the screen on a tie. The winner plays; whoever
 * held the turn before is paused. Pure bookkeeping — no DOM reads except the tie-break.
 */

export interface AutoplayCandidate {
  el: Element;
  /** Start (or keep) playing — the video decides whether it can (source ready, not paused by hand). */
  play: () => void;
  /** Lost the turn. */
  pause: () => void;
}

/** At least this much of the clip (or of the screen, for a tall clip) must be visible to win. */
export const MIN_SCORE = 0.5;

const scores = new Map<Element, number>();
const candidates = new Map<Element, AutoplayCandidate>();
let current: AutoplayCandidate | null = null;
let scheduled = false;

/** The share an observer entry shows: of the clip, or of the screen when the clip is taller than it. */
export function visibleScore(entry: { intersectionRect: { height: number }; boundingClientRect: { height: number }; rootBounds: { height: number } | null }, viewportHeight: number): number {
  const h = entry.boundingClientRect.height;
  if (!(h > 0)) return 0;
  const screen = entry.rootBounds?.height || viewportHeight;
  return Math.min(1, entry.intersectionRect.height / Math.min(h, screen > 0 ? screen : h));
}

/** The winner among scored entries — exported for the test. */
export function pickWinner<T>(entries: readonly { key: T; score: number; distanceFromCentre: number }[]): T | null {
  let best: { key: T; score: number; distanceFromCentre: number } | null = null;
  for (const e of entries) {
    if (e.score < MIN_SCORE) continue;
    if (!best || e.score > best.score + 0.01 || (Math.abs(e.score - best.score) <= 0.01 && e.distanceFromCentre < best.distanceFromCentre)) best = e;
  }
  return best ? best.key : null;
}

function elect() {
  scheduled = false;
  const mid = typeof window === "undefined" ? 0 : window.innerHeight / 2;
  const entries = [...candidates.values()].map((c) => {
    const r = c.el.getBoundingClientRect();
    return { key: c, score: scores.get(c.el) ?? 0, distanceFromCentre: Math.abs(r.top + r.height / 2 - mid) };
  });
  const winner = pickWinner(entries);
  if (winner !== current) {
    current?.pause();
    current = winner;
  }
  // play every time, not only on a change: a winner that could not start before (source not ready yet,
  // an overlay was open) starts the moment it can — the video ignores this when it is already playing
  winner?.play();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(elect);
  else elect();
}

export function registerAutoplay(c: AutoplayCandidate): () => void {
  candidates.set(c.el, c);
  return () => {
    candidates.delete(c.el);
    scores.delete(c.el);
    if (current === c) {
      current = null;
      schedule();
    }
  };
}

export function reportVisibility(el: Element, score: number): void {
  scores.set(el, score);
  schedule();
}

/** Run the election again — e.g. when a full-screen viewer closes over a feed that never scrolled. */
export function reelectAutoplay(): void {
  schedule();
}
