/**
 * Session-wide video resume positions — the piece that makes tab switches feel
 * continuous: a video that remounts (feed pane swap, reels tab slide, viewer
 * reopen) resumes exactly where it stopped instead of restarting.
 *
 * Module-level (not React state): every player surface shares it, and it costs
 * nothing until a video actually pauses. Insertion-ordered Map doubles as an
 * LRU — capped so an hours-long session can't grow memory.
 */

const positions = new Map<string, number>();
const MAX = 150;

export function savePlaybackPosition(id: string | undefined, time: number, duration?: number): void {
  if (!id || !Number.isFinite(time)) return;
  // Near the start or the end, resuming feels broken (loops restart anyway).
  if (time < 1.5 || (duration && Number.isFinite(duration) && duration - time < 2)) {
    positions.delete(id);
    return;
  }
  positions.delete(id); // re-insert → most-recently-used
  positions.set(id, time);
  if (positions.size > MAX) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  }
}

export function getPlaybackPosition(id: string | undefined): number | null {
  if (!id) return null;
  return positions.get(id) ?? null;
}
