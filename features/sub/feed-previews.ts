/**
 * Expired-preview recovery for the Exclusive feed (Part 15).
 *
 * A tile's preview link lasts five minutes (lib/sub/feed.ts). An <img> error does not say WHY it
 * failed, so a failure counts as "the link ran out" only when the clock says it has: the page says
 * when its links were signed (server time) and the browser notes when it received them (its own
 * monotonic clock) — either one past the lifetime (less a margin) is enough, so a phone whose clock
 * is wrong can only refresh early, never late. Any other failure is a real one: the tile says so
 * and offers a retry (a tap — never automatic).
 *
 * Refreshes are batched: failures within a short window share ONE request, only one request is in
 * flight at a time, at most PREVIEW_BATCH ids each. The server re-checks access for every id;
 * a post the viewer may no longer see comes back "gone" and is never asked about again by its tile.
 */

export const PREVIEW_BATCH = 24;
const WINDOW_MS = 80;
const MARGIN_S = 30;

export interface LinkBirth {
  /** server ms when the link was signed */
  issuedAt: number;
  /** performance.now() when the browser received it */
  receivedAt: number;
  /** lifetime in seconds */
  ttl: number;
}

/** Has this link (probably) run out? True only when a clock says so — never a guess from the error. */
export function linkExpired(b: LinkBirth, now = Date.now(), mono = typeof performance !== "undefined" ? performance.now() : 0): boolean {
  const life = Math.max(0, b.ttl - MARGIN_S) * 1000;
  return now - b.issuedAt >= life || mono - b.receivedAt >= life;
}

/**
 * May a tile refresh its link AUTOMATICALLY now? Only when the link has (probably) run out AND the
 * tile's last automatic refresh — timed by the browser's monotonic clock alone — was at least one
 * link lifetime ago. Part 16: a phone clock minutes fast makes every link look expired on arrival;
 * without this bound, an image failing for another reason (object missing, host blocked) refreshed
 * again on every error until the rate limiter answered 429.
 */
export function mayAutoRefresh(b: LinkBirth, lastAutoAt: number | null, now = Date.now(), mono = typeof performance !== "undefined" ? performance.now() : 0): boolean {
  if (!linkExpired(b, now, mono)) return false;
  return lastAutoAt === null || mono - lastAutoAt >= Math.max(0, b.ttl - MARGIN_S) * 1000;
}

/**
 * Is a server-rendered first page a REPLAY (to be asked for again at once)? The app's router cache
 * keeps pages for hours (next.config staleTimes), so a page already shown in this tab, or signed
 * more than `maxAgeMs` ago by either clock reading, is shown and re-checked; a fresh one is used
 * as it is — no second request after hydration.
 */
export function firstPageIsReplay(issuedAt: number, alreadyShown: boolean, now = Date.now(), maxAgeMs = 60_000): boolean {
  return alreadyShown || Math.abs(now - issuedAt) > maxAgeMs;
}

export type Refreshed = { kind: "url"; url: string; birth: LinkBirth } | { kind: "none" } | { kind: "gone" } | { kind: "failed" };

const waiting = new Map<string, ((r: Refreshed) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** A fresh preview link for one post, through the batched, access-checked refresh. */
export function refreshPreview(postId: string): Promise<Refreshed> {
  return new Promise((resolve) => {
    const list = waiting.get(postId);
    if (list) list.push(resolve);
    else waiting.set(postId, [resolve]);
    schedule();
  });
}

function schedule() {
  if (inFlight || timer) return;
  timer = setTimeout(() => void flush(), WINDOW_MS);
}

async function flush() {
  timer = null;
  if (inFlight || !waiting.size) return;
  inFlight = true;
  const batch = [...waiting.entries()].slice(0, PREVIEW_BATCH);
  for (const [id] of batch) waiting.delete(id);
  type Answer = { previews?: Record<string, string | null>; issuedAt?: number; previewTtl?: number };
  const answer = await fetch("/api/sub/feed/previews", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch.map(([id]) => id) }) })
    .then((res) => (res.ok ? (res.json() as Promise<Answer>) : null))
    .catch(() => null);
  const receivedAt = typeof performance !== "undefined" ? performance.now() : 0;
  for (const [id, fns] of batch) {
    let r: Refreshed;
    if (!answer?.previews) r = { kind: "failed" };
    else if (!(id in answer.previews)) r = { kind: "gone" };
    else {
      const url = answer.previews[id];
      r = url ? { kind: "url", url, birth: { issuedAt: answer.issuedAt ?? Date.now(), receivedAt, ttl: answer.previewTtl ?? 300 } } : { kind: "none" };
    }
    for (const fn of fns) fn(r);
  }
  inFlight = false;
  if (waiting.size) schedule();
}
