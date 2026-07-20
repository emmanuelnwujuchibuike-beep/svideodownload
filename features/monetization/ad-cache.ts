import type { AdSlotData } from "@/lib/monetization/types";

/**
 * One request per page, fired immediately, shared by every placement.
 *
 * ── The problem this solves ───────────────────────────────────────────────────
 *
 * Each `AdSlot` used to fetch its own zone on mount. A downloader page mounts
 * four or five of them, so the page made four or five separate round trips
 * before any ad could paint. On a mobile connection that is most of the reason
 * ads arrived after the visitor had already downloaded their file and gone —
 * the unit was configured correctly and simply lost the race.
 *
 * Slots that mount in the same tick are now coalesced into a single
 * `/api/ads?zones=…` call, and the answers are memoised for the life of the
 * page so a remount is free.
 *
 * ── Why a microtask and not a timer ───────────────────────────────────────────
 *
 * The batch window is one microtask (`queueMicrotask`), not a `setTimeout`.
 * Every slot on a page mounts within the same commit, so a microtask already
 * catches all of them, and it costs nothing measurable in latency. A timer
 * would add its own delay to the very thing being made faster.
 *
 * ── The cache is per page load, deliberately ──────────────────────────────────
 *
 * Not `sessionStorage`. Which ad a zone serves is a weighted pick made
 * server-side per request, so persisting it across navigations would pin one
 * creative for the whole visit and quietly break rotation — the advertiser with
 * the highest weight would win once and then win forever.
 */

type ZoneAnswer = AdSlotData | null;

/** Resolved answers, and in-flight promises, keyed by zone. */
const resolved = new Map<string, ZoneAnswer>();
const inflight = new Map<string, Promise<ZoneAnswer>>();

/** Zones queued for the next flush. */
let pending = new Set<string>();
let scheduled = false;

/** Resolvers waiting on the current batch. */
const waiters = new Map<string, ((value: ZoneAnswer) => void)[]>();

function flush() {
  scheduled = false;
  const zones = [...pending];
  pending = new Set();
  if (zones.length === 0) return;

  const settle = (answers: Record<string, ZoneAnswer>) => {
    for (const zone of zones) {
      const answer = answers[zone] ?? null;
      resolved.set(zone, answer);
      inflight.delete(zone);
      for (const resolve of waiters.get(zone) ?? []) resolve(answer);
      waiters.delete(zone);
    }
  };

  fetch(`/api/ads?zones=${encodeURIComponent(zones.join(","))}`)
    .then((r) => (r.ok ? r.json() : { ads: {} }))
    .then((d) => settle((d.ads ?? {}) as Record<string, ZoneAnswer>))
    /*
      A failed request resolves every waiter with null rather than rejecting.
      A placement that never hears back stays hidden forever, which is the safe
      direction but leaves its wrapper in an indefinite loading state — and for
      the surfaces that reserve height, that is a visible gap.
    */
    .catch(() => settle({}));
}

/** The ad for a zone. Batched with any other zone requested in the same tick. */
export function loadZoneAd(zone: string): Promise<ZoneAnswer> {
  if (resolved.has(zone)) return Promise.resolve(resolved.get(zone) ?? null);

  const existing = inflight.get(zone);
  if (existing) return existing;

  const promise = new Promise<ZoneAnswer>((resolve) => {
    const list = waiters.get(zone) ?? [];
    list.push(resolve);
    waiters.set(zone, list);
  });
  inflight.set(zone, promise);

  pending.add(zone);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
  return promise;
}

/**
 * Warm zones before anything renders them.
 *
 * Called from the marketing shell so the request is already in flight while
 * React is still mounting the tree — the ad data is then usually present by the
 * time the first placement asks for it, rather than starting a round trip at
 * that moment.
 */
export function prefetchZones(zones: readonly string[]): void {
  for (const zone of zones) void loadZoneAd(zone);
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function __resetAdCache(): void {
  resolved.clear();
  inflight.clear();
  waiters.clear();
  pending = new Set();
  scheduled = false;
}
