import type { StoryGroup, StoryItem } from "@/lib/social/stories";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHERE THE STORY VIEWER GOES NEXT — pure (Stories Part 3, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The order is Part 2's and is not re-ranked here: the rings in the order
 * lib/social/stories.ts returned them (you, friends, follows and chats, everyone
 * else — unwatched first), each author's stories in the order the viewer has
 * always played them (as delivered, newest first).
 *
 *   open a ring      start at its FIRST story not yet watched; all watched → the first (replay)
 *   advance          the next story in the ring — watched or not, so nothing unwatched
 *                    is ever jumped over — then the next ring, at ITS first unwatched
 *   a story leaves   (ended, deleted, or no longer the viewer's to see) the one after
 *                    it takes its place; a ring left empty is passed over; nothing
 *                    left → the viewer closes
 *
 * Moving never records anything. A view is recorded only for the story on screen
 * (story-viewer.tsx → story-seen.ts), so a story passed over is never marked.
 */

export type IsSeen = (story: StoryItem) => boolean;

export interface Position {
  gi: number;
  si: number;
}

/** A story's life (24 h) when the server sent no end time — the same rule as the disk copy (story-cache.ts). */
const LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Still live at `now`: before its own end time, or within 24 h of being posted. */
export function isStoryLive(story: StoryItem, now: number): boolean {
  const end = story.expiresAt ? Date.parse(story.expiresAt) : Date.parse(story.createdAt) + LIFETIME_MS;
  return Number.isFinite(end) && end > now;
}

/** Where a ring opens: its first unwatched story, else the first (a predictable replay). */
export function startIndex(group: StoryGroup | undefined, isSeen: IsSeen): number {
  if (!group) return 0;
  const i = group.stories.findIndex((s) => !isSeen(s));
  return i === -1 ? 0 : i;
}

/** The story after `pos`, or null at the very end. `changedGroup` tells the viewer a ring boundary was crossed. */
export function nextPosition(groups: readonly StoryGroup[], pos: Position, isSeen: IsSeen): (Position & { changedGroup: boolean }) | null {
  const g = groups[pos.gi];
  if (g && pos.si < g.stories.length - 1) return { gi: pos.gi, si: pos.si + 1, changedGroup: false };
  const ng = groups[pos.gi + 1];
  if (!ng) return null;
  return { gi: pos.gi + 1, si: startIndex(ng, isSeen), changedGroup: true };
}

/** Every ring without the removed stories, and without a ring left empty. */
export function withoutStories(groups: readonly StoryGroup[], gone: ReadonlySet<string>): StoryGroup[] {
  if (gone.size === 0) return [...groups];
  return groups.map((g) => ({ ...g, stories: g.stories.filter((s) => !gone.has(s.id)) })).filter((g) => g.stories.length > 0);
}

/**
 * Where the viewer stands after `removed` leave `groups` (both as the viewer sees
 * them now). The story on screen keeps its place if it stayed; if it left, the
 * next one in the same ring slides in (or the ring's last remaining one, as
 * deleting your own last story always did); a ring left empty hands over to the
 * next ring at its first unwatched story; nothing left → null (close).
 */
export function positionAfterRemoval(groups: readonly StoryGroup[], pos: Position, removed: ReadonlySet<string>, isSeen: IsSeen): Position | null {
  const after = withoutStories(groups, removed);
  const locate = (id: string): Position | null => {
    for (let gi = 0; gi < after.length; gi++) {
      const si = after[gi]!.stories.findIndex((s) => s.id === id);
      if (si !== -1) return { gi, si };
    }
    return null;
  };

  const group = groups[pos.gi];
  if (!group) return after.length > 0 ? { gi: Math.min(pos.gi, after.length - 1), si: 0 } : null;
  const current = group.stories[pos.si];
  if (current && !removed.has(current.id)) return locate(current.id);

  // the ring's remaining stories: the one after the removed story, else its last
  const left = group.stories.filter((s) => !removed.has(s.id));
  if (left.length > 0) {
    const before = group.stories.slice(0, pos.si).filter((s) => !removed.has(s.id)).length;
    return locate(left[Math.min(before, left.length - 1)]!.id);
  }

  // the ring is empty: the next ring with something left, where it opens
  for (let gi = pos.gi + 1; gi < groups.length; gi++) {
    const first = groups[gi]!.stories.find((s) => !removed.has(s.id));
    if (!first) continue;
    const at = locate(first.id);
    if (!at) continue;
    return { gi: at.gi, si: startIndex(after[at.gi], isSeen) };
  }
  return null;
}
