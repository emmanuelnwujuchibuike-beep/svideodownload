import { isAccountVisibleTo, type ViewerRelation } from "@/lib/social/account-visibility";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO SEES WHOSE STORY — one rule, pure (Stories Part 2, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The audit's B1: lib/social/stories.ts dropped every author whose profile was
 * not literally `public`, so a followers-only or private member's story reached
 * nobody but themselves — not even the Friends tab built for their friends —
 * while the in-chat strip showed it. Two surfaces, two answers.
 *
 * This is the ONE answer, used by Home, Friends, Messages and the chat strip
 * (lib/social/stories.ts), and the SQL twin of `story_view_access` (0285, widened
 * for followers in 0287) that guards views and reshares. The same case table
 * pins both (story-audience.test.ts, supabase/tests/0287_story_followers.pglite.mjs).
 *
 * It invents no privacy model. It is the app's existing one:
 *
 *   blocks / status restrictions, either way      never (lib/social/stories.ts)
 *   suspended author                              never; hidden author: friends only
 *                                                 (lib/social/account-visibility.ts)
 *   yourself                                      always
 *   public profile                                everyone
 *   followers-only profile                        accepted followers — a `follows` row
 *                                                 exists only once a follow is accepted
 *                                                 (canSeePost, lib/social/posts.ts)
 *   private profile                               nobody else (canSeePost, profile.ts)
 *
 * …plus the one rule stories have always had of their own: two members who share
 * a DIRECT chat see each other's stories (the in-chat strip — "strictly more
 * intimate context than anyone browsing the app", stories.ts since 2026-07-14).
 *
 * ⚠️ A FRIENDSHIP alone does not open a followers-only or private profile here,
 * because it opens nothing else on such a profile either (profile.ts, canSeePost).
 * Whether private-profile stories should also reach friends is an owner decision:
 * one line below and one in story_view_access.
 */

export interface StoryAuthorFacts {
  id: string;
  handle: string | null;
  /** profiles.visibility: public | followers | private */
  visibility: string | null;
  isSuspended: boolean;
  isHidden: boolean;
}

/** How the viewer is tied to one author. All false for a signed-out viewer. */
export interface ViewerTies {
  /** a row in `friendships` */
  friend: boolean;
  /** the viewer follows the author (an accepted follow) */
  follows: boolean;
  /** the two share a DIRECT conversation */
  chat: boolean;
  /** a block or a status restriction, either way */
  excluded: boolean;
}

export const NO_TIES: ViewerTies = { friend: false, follows: false, chat: false, excluded: false };

export function storyVisibleTo(author: StoryAuthorFacts, viewerId: string | null, ties: ViewerTies): boolean {
  if (!author.handle) return false; // an unfinished account has no ring anywhere
  const self = !!viewerId && viewerId === author.id;
  if (!self && ties.excluded) return false;
  const relation: ViewerRelation = self ? "self" : ties.friend ? "friend" : "stranger";
  if (!isAccountVisibleTo({ isSuspended: author.isSuspended, isHidden: author.isHidden }, relation)) return false;
  if (self) return true;
  if (author.visibility === "public") return true;
  if (author.visibility === "followers") return ties.follows || ties.chat;
  return ties.chat; // private
}

/**
 * Where an author's ring sits (Stories Part 2, B3): yourself, then friends, then the
 * people you follow or chat with, then everyone else you may see. Relationship
 * only — no engagement signals.
 */
export type StoryTier = 0 | 1 | 2 | 3;

export function storyTier(authorId: string, viewerId: string | null, ties: ViewerTies): StoryTier {
  if (viewerId && authorId === viewerId) return 0;
  if (ties.friend) return 1;
  if (ties.follows || ties.chat) return 2;
  return 3;
}

/**
 * Tier first, then the groups with a story the viewer has NOT watched, then the
 * most recent story. Stable for equal keys. Pure — never mutates its input.
 */
export function rankStoryGroups<T extends { tier: StoryTier; unwatched: boolean; newestAt: string }>(groups: readonly T[]): T[] {
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      if (a.g.tier !== b.g.tier) return a.g.tier - b.g.tier;
      if (a.g.unwatched !== b.g.unwatched) return a.g.unwatched ? -1 : 1;
      if (a.g.newestAt !== b.g.newestAt) return a.g.newestAt > b.g.newestAt ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ g }) => g);
}
