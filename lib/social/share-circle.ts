import { friendsOverview } from "@/lib/social/friends";
import { relationshipStrength } from "@/lib/social/graph/strength";

const DAY = 86_400_000;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/**
 * Smart Share Circle™ — ranks the viewer's own friends by relationship
 * strength for the share sheet's destination list, reusing the exact
 * privacy-reviewed scorer Part 4's repost ranking already reuses
 * (`relationshipStrength`) rather than re-deriving "who do I share with
 * most" from scratch. `friendsOverview` already returns favourite/since/
 * lastChatAt for every friend in one batched call (see graph/overview.ts's
 * own header on why this costs 4 queries total, not one per friend) — this
 * is a second consumer of that same cheap composition, not a new query cost.
 *
 * Deliberately friends-only: mutual friends and shared circles are left at 0
 * (same floor-not-overstatement tradeoff `graphOverview` already accepts) —
 * a strength FLOOR is fine for ranking a share list, unlike the Connections
 * hub where the exact score is shown to the viewer. Non-friend recent chat
 * partners (real, valid share destinations) aren't scored here at all —
 * `loadPeople()` keeps them in their existing recency order and simply
 * treats "no score" as "rank after every scored friend," never invents a
 * cross-category comparison.
 */
export async function shareCircleScores(userId: string, now = Date.now()): Promise<Record<string, number>> {
  const overview = await friendsOverview(userId, 100);
  const scores: Record<string, number> = {};
  for (const f of overview.friends) {
    const strength = relationshipStrength({
      isFriend: true,
      isFollowing: false,
      followsBack: false,
      isFavorite: f.favorite,
      sharedCircles: 0,
      mutualFriends: 0,
      daysSinceMessage: daysSince(f.lastChatAt, now),
      daysSinceViewerEngaged: null,
      daysKnown: daysSince(f.since, now),
    });
    scores[f.user.id] = strength.score;
  }
  return scores;
}
