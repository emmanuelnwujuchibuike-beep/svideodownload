/**
 * Parse an operator-set sampling switch (`NEXT_PUBLIC_*_SAMPLE`) into a share
 * in (0, 1]. Unset, empty, malformed or out of range ⇒ 0 = OFF.
 *
 * Shared by the two client beacons that each cost an invocation AND a log
 * event per send (web vitals, playback metrics): measurement is a switch an
 * operator turns on for a window, never a standing per-pageview cost (owner,
 * 2026-10-05: Observability Events was the largest line on the bill).
 */
export function parseSampleRate(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0;
}
