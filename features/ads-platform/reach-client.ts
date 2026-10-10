"use client";

/**
 * The measured audience reach per placement (GET /api/ads/reach — CDN-cached
 * for an hour). One request per page session, shared by every caller. `null`
 * placements = not enough data yet: show no percentage rather than a guess.
 */
export interface Reach {
  windowDays: number;
  placements: Record<string, number> | null;
}

let pending: Promise<Reach | null> | null = null;

export function loadReach(): Promise<Reach | null> {
  pending ??= fetch("/api/ads/reach")
    .then((r) => (r.ok ? (r.json() as Promise<Reach>) : null))
    .catch(() => null)
    .then((r) => {
      if (!r) pending = null; // a failure is not remembered
      return r;
    });
  return pending;
}

/** "Reaches 63% of visits" — or null when there is nothing honest to say. */
export function reachLabel(reach: Reach | null, placementCode: string): string | null {
  const pct = reach?.placements?.[placementCode];
  return typeof pct === "number" && pct > 0 ? `Reaches ${pct}% of visits` : null;
}
