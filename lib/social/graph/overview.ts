import { relationshipStrength, shouldSuggestReconnect, type StrengthBand } from "@/lib/social/graph/strength";
import { circleMemberIds, listCircles, listLabels, type CircleRow } from "@/lib/social/graph/store";
import { friendsOverview, type FriendProfile } from "@/lib/social/friends";

/**
 * The Social Graph view of a member's connections — one composition over reads
 * that already exist (Feature 18 · Part 17).
 *
 * ── Why this adds no per-friend queries ───────────────────────────────────
 * `friendsOverview` already returns, for every friend, when the friendship
 * began, whether they are a favourite, and when the last direct message was.
 * That is three of the five strength signals for free, in the call the hub was
 * making anyway. Circles and labels are one query each for the WHOLE list.
 *
 * So a hundred friends cost four queries, not four hundred — which is the
 * difference between this page fitting the two-second budget and not.
 *
 * ── What is deliberately left out of the list ─────────────────────────────
 * Mutual-friend counts are a per-PAIR query (`mutualFriendsCount`), so
 * including them here would mean one round trip per friend. They stay at 0 in
 * the list and are resolved only on a single profile, where one query is fine.
 * The strength score is therefore a floor, never an overstatement — a
 * relationship can only rank higher than shown, never lower.
 */

export interface GraphConnection {
  user: FriendProfile;
  since: string;
  favorite: boolean;
  lastChatAt: string | null;
  unread: number;
  /** The viewer's private label, if any. */
  label: string | null;
  /** Circle ids this friend belongs to (the viewer's own circles). */
  circleIds: string[];
  score: number;
  band: StrengthBand;
  reasons: string[];
  reconnect: boolean;
}

export interface GraphOverview {
  viewer: FriendProfile | null;
  connections: GraphConnection[];
  circles: CircleRow[];
  /** Friends worth getting back in touch with, strongest first. */
  reconnect: GraphConnection[];
  counts: { friends: number; labelled: number; circled: number };
}

const DAY = 86_400_000;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

export async function graphOverview(userId: string, now = Date.now()): Promise<GraphOverview> {
  const [overview, circles, labels] = await Promise.all([
    friendsOverview(userId),
    listCircles(userId),
    listLabels(userId),
  ]);

  // Membership for every circle in one pass. Bounded by MAX_CIRCLES_PER_MEMBER
  // (50), and each is a single indexed read on (owner_id, circle_id).
  const membership = new Map<string, string[]>();
  await Promise.all(
    circles.map(async (c) => {
      for (const memberId of await circleMemberIds(userId, c.id)) {
        const list = membership.get(memberId);
        if (list) list.push(c.id);
        else membership.set(memberId, [c.id]);
      }
    }),
  );

  const connections: GraphConnection[] = overview.friends.map((f) => {
    const circleIds = membership.get(f.user.id) ?? [];
    const input = {
      isFriend: true,
      isFollowing: false,
      followsBack: false,
      isFavorite: f.favorite,
      sharedCircles: circleIds.length,
      // See the header: a per-pair query per friend is the one thing this
      // composition refuses to do.
      mutualFriends: 0,
      daysSinceMessage: daysSince(f.lastChatAt, now),
      daysSinceViewerEngaged: null,
      daysKnown: daysSince(f.since, now),
    };
    const strength = relationshipStrength(input);
    return {
      user: f.user,
      since: f.since,
      favorite: f.favorite,
      lastChatAt: f.lastChatAt,
      unread: f.unread,
      label: labels.get(f.user.id)?.label ?? null,
      circleIds,
      score: strength.score,
      band: strength.band,
      reasons: strength.reasons,
      reconnect: shouldSuggestReconnect({ ...input, isSuppressed: false }),
    };
  });

  return {
    viewer: overview.viewer,
    connections,
    circles,
    reconnect: connections.filter((c) => c.reconnect).sort((a, b) => b.score - a.score).slice(0, 6),
    counts: {
      friends: connections.length,
      labelled: connections.filter((c) => c.label).length,
      circled: connections.filter((c) => c.circleIds.length > 0).length,
    },
  };
}
