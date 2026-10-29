/**
 * Client-side comments prefetch cache. Warming a post's comments on hover (feed
 * card) or when a reel becomes active means the comments sheet opens instantly
 * instead of showing a loading state. Single-flight + a short TTL so we never
 * fire duplicate requests, and the data stays fresh enough for a session.
 */
const cache = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = 60_000;

/** Fetch (or return cached) comments for a post. Callers cast to their shape. */
export async function loadPostComments<T = unknown>(postId: string): Promise<T | null> {
  const hit = cache.get(postId);
  if (hit && Date.now() - hit.at < TTL) return hit.data as T;
  const existing = inflight.get(postId);
  if (existing) return existing as Promise<T | null>;

  const p = (async () => {
    try {
      const res = await fetch(`/api/posts/${postId}/comments`);
      if (!res.ok) return null;
      const data = await res.json();
      cache.set(postId, { data, at: Date.now() });
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(postId);
    }
  })();

  inflight.set(postId, p as Promise<unknown>);
  return p as Promise<T | null>;
}

/** The event an open comment list listens for: something outside its composer (a gift, 0304) added a comment. */
export const POST_COMMENTS_CHANGED = "frenz:post-comments-changed";

/**
 * Something outside the composer added a comment to this post (a sticker gift lands as one, 0304). Drop the cached
 * copy, so the next open reads it, and tell an open list to re-read now.
 */
export function postCommentsChanged(postId: string): void {
  cache.delete(postId);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(POST_COMMENTS_CHANGED, { detail: { postId } }));
}

/** Fire-and-forget warm-up — no-op if already fresh in cache. */
export function prefetchPostComments(postId: string): void {
  const hit = cache.get(postId);
  if (hit && Date.now() - hit.at < TTL) return;
  void loadPostComments(postId);
}
