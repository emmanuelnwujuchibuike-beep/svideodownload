import type { FeedItem, HomeFeedSort } from "@/lib/social/home-feed";

/**
 * "Instant Resume" for the Home feed — same-device only (cross-device sync is
 * a separate, bigger "Cloud State" ask, deliberately not attempted here; see
 * docs/PROJECT_NOTES.md batch 36). `SmartFeed` remounts fresh every time a
 * viewer navigates away from `/home` and back (confirmed in code — see the
 * `lastFeedFetchAt` comment in `smart-feed.tsx`), which resets scroll
 * position, the active tab, and every page loaded past the first via infinite
 * scroll. This module lets that state survive the remount — and a real app
 * restart — via `localStorage`, the same idiom this feature already uses for
 * `frenz:feed-seen-at` and story-seen state.
 *
 * Deliberately capped and time-boxed: only the most recent `MAX_ITEMS_PER_TAB`
 * items per tab are kept (bounds storage size; pagination continues past that
 * via the preserved `nextOffset`, nothing is lost), and a snapshot older than
 * `MAX_AGE_MS` is ignored entirely — restoring a scroll position into content
 * that's gone stale would be worse than just showing the fresh SSR page.
 */

const KEY = "frenz:feed-continuity:v1";
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ITEMS_PER_TAB = 60;

export interface FeedContinuitySnapshot {
  sort: HomeFeedSort;
  scrollY: number;
  savedAt: number;
  tabs: Partial<Record<HomeFeedSort, { items: FeedItem[]; nextOffset: number | null }>>;
}

export function saveFeedContinuity(snapshot: Omit<FeedContinuitySnapshot, "savedAt">): void {
  try {
    const tabs: FeedContinuitySnapshot["tabs"] = {};
    for (const [k, v] of Object.entries(snapshot.tabs) as [HomeFeedSort, { items: FeedItem[]; nextOffset: number | null }][]) {
      // Items accumulate oldest-first (smart-feed.tsx appends each new page to
      // the end), so the viewer's current scroll position lives near the TAIL
      // of the array, not the head. `slice(0, N)` (the original, buggy version
      // of this line) kept the head — the top-of-feed content the viewer had
      // already scrolled PAST — discarding exactly what a deep scroller needed
      // restored. `slice(-N)` keeps the most recent items instead. This still
      // isn't pixel-perfect once truncation actually kicks in (a `scrollY`
      // computed against the full untruncated list can overshoot a shorter
      // restored one) — but `window.scrollTo` clamps to the real max, which
      // lands at the BOTTOM of the retained (most recent) items, still close
      // to where the viewer actually was. Precise recovery would need
      // per-item height tracking, out of scope for this fix.
      tabs[k] = { items: v.items.slice(-MAX_ITEMS_PER_TAB), nextOffset: v.nextOffset };
    }
    const payload: FeedContinuitySnapshot = { ...snapshot, tabs, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage blocked / quota exceeded — continuity just won't restore next time */
  }
}

/** Returns null when there's nothing saved, or it's aged past `MAX_AGE_MS`. */
export function loadFeedContinuity(): FeedContinuitySnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedContinuitySnapshot;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!parsed.tabs || typeof parsed.tabs !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
