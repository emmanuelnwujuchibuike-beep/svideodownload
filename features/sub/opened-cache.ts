/**
 * Opened exclusive posts, shared by the gallery, the private viewer and the Exclusive feed.
 * A small module of its own so the feed can start opening a post without loading the gallery.
 *
 * Memory only — never storage, so nothing private outlives the tab.
 */

export interface Opened {
  caption: string | null;
  media: { kind: "image" | "video"; url: string; width: number | null; height: number | null }[];
  expiresAt: string;
  watermark: string | null;
  /** the creator's public handle — the roving mark links to their profile */
  creatorHandle?: string | null;
  /** 0248: locked or hidden (the creator can switch it from the viewer) */
  audience?: "locked" | "hidden";
}

/**
 * Posts opened in this tab, kept until their links are about to expire: reopening a post,
 * or one fetched on its own after the page's links ran out, never waits on the server again.
 */
export const openedCache = new Map<string, Opened>();
export const fresh = (o: Opened | undefined | null): o is Opened => !!o && Date.parse(o.expiresAt) - Date.now() > 30_000;

/*
  Part 15 — a post starts opening at the first touch, not after the tap ends: the same request the
  viewer would make (GET /api/sub/posts/[id], access checked there, no writes), started early and
  handed to the viewer when it mounts. One per post at a time; a touch that turns into a scroll
  (pointercancel) aborts it; an unclaimed one is dropped after a few seconds. Nothing is preloaded
  ahead of a touch, and nothing but this one JSON answer is fetched early.
*/
const CLAIM_WITHIN_MS = 8_000;
const early = new Map<string, { at: number; res: Promise<Response | null>; ctl: AbortController }>();

/** Starts opening a post (no-op if it is already open and fresh, or already starting). */
export function startOpening(postId: string): void {
  if (fresh(openedCache.get(postId))) return;
  const cur = early.get(postId);
  if (cur && Date.now() - cur.at < CLAIM_WITHIN_MS) return;
  const ctl = new AbortController();
  early.set(postId, { at: Date.now(), ctl, res: fetch(`/api/sub/posts/${postId}`, { cache: "no-store", signal: ctl.signal }).catch(() => null) });
}

/** The touch became a scroll: drop the early request (only if the viewer has not claimed it). */
export function cancelOpening(postId: string): void {
  const cur = early.get(postId);
  if (!cur) return;
  early.delete(postId);
  cur.ctl.abort();
}

/** The viewer claims the early request, if one started recently — once. */
export function claimOpening(postId: string): Promise<Response | null> | null {
  const cur = early.get(postId);
  early.delete(postId);
  return cur && Date.now() - cur.at < CLAIM_WITHIN_MS ? cur.res : null;
}
