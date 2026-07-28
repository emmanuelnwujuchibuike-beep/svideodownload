/**
 * Life Journey™ (Feature 18 · Life Memories). A chronological story of a member's
 * time on Frenzsave, DERIVED from real data — the dated milestones (joined date,
 * first post) come straight from the database; the "where you are now" highlights
 * (posts, friends, rank, achievements) reuse the same real signals the Reputation
 * and Achievement engines compute. There are no invented dates or fabricated
 * events. Time Capsule, Year in Review, Private Journal, Digital Legacy and the AI
 * Memory Studio are the declared next layers — they need encryption / AI / a
 * time-series store this honest core deliberately does without.
 */

export interface LifeJourneySignals {
  joinedAt: string;
  firstPost: { id: string; title: string | null; thumbnailUrl: string | null; createdAt: string } | null;
  rankName: string;
  achievementsEarned: number;
  postsCount: number;
  friendsCount: number;
}

export interface JourneyEntry {
  key: string;
  iconKey: "flag" | "file" | "layers" | "users" | "shield" | "trophy";
  tint: "violet" | "blue" | "cyan" | "emerald" | "amber" | "rose";
  title: string;
  sub?: string;
  /** ISO date — rendered when present (dated milestone vs current-state highlight). */
  date?: string;
  thumbnailUrl?: string | null;
}

export function buildLifeJourney(s: LifeJourneySignals): JourneyEntry[] {
  const entries: JourneyEntry[] = [
    { key: "joined", iconKey: "flag", tint: "violet", title: "Joined Frenzsave", date: s.joinedAt },
  ];

  if (s.firstPost) {
    entries.push({
      key: "first-post",
      iconKey: "file",
      tint: "blue",
      title: "Published your first post",
      sub: s.firstPost.title ?? undefined,
      date: s.firstPost.createdAt,
      thumbnailUrl: s.firstPost.thumbnailUrl,
    });
  }

  if (s.postsCount > 0) {
    entries.push({ key: "posts", iconKey: "layers", tint: "cyan", title: `${s.postsCount} ${s.postsCount === 1 ? "post" : "posts"} shared` });
  }
  if (s.friendsCount > 0) {
    entries.push({ key: "friends", iconKey: "users", tint: "emerald", title: `${s.friendsCount} ${s.friendsCount === 1 ? "friend" : "friends"} made` });
  }

  entries.push({ key: "rank", iconKey: "shield", tint: "amber", title: `Reached ${s.rankName}`, sub: "Reputation rank" });

  if (s.achievementsEarned > 0) {
    entries.push({ key: "achievements", iconKey: "trophy", tint: "rose", title: `${s.achievementsEarned} ${s.achievementsEarned === 1 ? "achievement" : "achievements"} earned` });
  }

  return entries;
}
