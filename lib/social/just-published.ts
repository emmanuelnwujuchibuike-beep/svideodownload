/**
 * "Your post is at the top of the feed" (owner, 2026-10-14: "When a user create
 * a post it should appear instantly on the feed after post have successfully
 * uploaded, he don't need to be looking for the post").
 *
 * The composer marks the new post here once `/api/stories` has accepted it; the
 * Home feed takes the mark on its next mount and reloads page 0 with the post
 * hoisted to the top. Without it the feed restored its saved snapshot (or a
 * reshuffled page 0) and the new post landed wherever the ranking put it.
 *
 * sessionStorage, not localStorage: the promise is "the feed you go back to",
 * in this tab. Taken once, so a later visit is the normal reshuffled feed.
 */

const KEY = "frenz:just-published";

/** Matches the server's `pinNew` window (`NEW_POST_WINDOW_MS`, lib/social/home-feed.ts). */
export const JUST_PUBLISHED_TTL_MS = 30 * 60 * 1000;

export function markJustPublished(postId: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ id: postId, at: now }));
  } catch {
    /* storage blocked: the feed just behaves as it did before */
  }
}

/** Reads and clears the mark. Null when absent, malformed or older than the TTL. */
export function takeJustPublished(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof v.id !== "string" || !v.id || typeof v.at !== "number") return null;
    if (now - v.at > JUST_PUBLISHED_TTL_MS) return null;
    return v.id;
  } catch {
    return null;
  }
}

/** Moves the item with `id` to the front; the same array when it isn't there. */
export function hoistById<T extends { id: string }>(items: T[], id: string): T[] {
  const i = items.findIndex((x) => x.id === id);
  if (i <= 0) return items;
  return [items[i]!, ...items.slice(0, i), ...items.slice(i + 1)];
}
