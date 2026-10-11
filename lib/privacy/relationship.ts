/**
 * Relationship Privacy™ — the pure rules (Feature 19 · Part 17).
 *
 * Presets and Boundary Modes are BUNDLES of the settings that already exist and
 * are already enforced (messages, follows, friend requests, comments, mentions,
 * collaboration invites, memories, list visibility, recommendations, last seen).
 * A preset never invents a control; every key below is a real column that a real
 * code path reads. Each bundle lists exactly what it changes, so the member is
 * never surprised, and every change can be undone (a Boundary Mode keeps the
 * settings it replaced and puts them back when it ends).
 *
 * The Privacy Advisor suggests, it never acts.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type ConnectPolicy = "everyone" | "following" | "friends" | "nobody";

/** "Who can mention me / invite me": `following` = people the MEMBER follows. */
export function connectAllowed(policy: string | null | undefined, actor: { isFriend: boolean; memberFollowsActor: boolean }): boolean {
  switch (policy ?? "everyone") {
    case "everyone":
      return true;
    case "following":
      return actor.memberFollowsActor || actor.isFriend;
    case "friends":
      return actor.isFriend;
    default:
      return false;
  }
}

export const CONNECT_LABELS: Record<ConnectPolicy, string> = { everyone: "Everyone", following: "People you follow", friends: "Friends", nobody: "Nobody" };

/** Settings a preset or mode may set — each one a live, enforced column. */
export interface PrivacyBundle {
  messages_policy?: "everyone" | "followers" | "off";
  follow_policy?: "everyone" | "friends_of_friends" | "verified" | "friends" | "approval" | "nobody";
  friend_requests_policy?: "everyone" | "friends_of_friends" | "verified" | "nobody";
  comments_policy?: "everyone" | "followers" | "off";
  mention_policy?: ConnectPolicy;
  collab_invite_policy?: ConnectPolicy;
  memory_tag_policy?: "friends" | "nobody";
  friends_visibility?: "public" | "friends" | "private";
  show_in_recommendations?: boolean;
  last_seen_visibility?: "everyone" | "friends" | "nobody";
}

export const BUNDLE_KEYS = ["messages_policy", "follow_policy", "friend_requests_policy", "comments_policy", "mention_policy", "collab_invite_policy", "memory_tag_policy", "friends_visibility", "show_in_recommendations", "last_seen_visibility"] as const;

const LABEL: Record<(typeof BUNDLE_KEYS)[number], string> = {
  messages_policy: "Messages",
  follow_policy: "Follows",
  friend_requests_policy: "Friend requests",
  comments_policy: "Comments",
  mention_policy: "Mentions",
  collab_invite_policy: "Collaboration invites",
  memory_tag_policy: "Shared memories",
  friends_visibility: "Your friend list",
  show_in_recommendations: "Suggestions to others",
  last_seen_visibility: "Last seen",
};

const VALUE: Record<string, string> = {
  everyone: "everyone",
  followers: "followers",
  off: "nobody",
  friends_of_friends: "friends of friends",
  verified: "verified accounts",
  friends: "friends",
  approval: "your approval",
  nobody: "nobody",
  following: "people you follow",
  public: "everyone",
  private: "only you",
  true: "on",
  false: "off",
};

/** "Messages: followers · Mentions: friends …" — what a bundle will do, in words. */
export function describeBundle(b: PrivacyBundle): string[] {
  return BUNDLE_KEYS.filter((k) => b[k] !== undefined).map((k) => `${LABEL[k]}: ${VALUE[String(b[k])] ?? String(b[k])}`);
}

export const PRESETS: Record<string, { label: string; blurb: string; bundle: PrivacyBundle }> = {
  maximum: { label: "Maximum privacy", blurb: "Only friends reach you. Nobody finds you through suggestions.", bundle: { messages_policy: "off", follow_policy: "approval", friend_requests_policy: "friends_of_friends", comments_policy: "followers", mention_policy: "friends", collab_invite_policy: "friends", memory_tag_policy: "friends", friends_visibility: "private", show_in_recommendations: false, last_seen_visibility: "nobody" } },
  friends_first: { label: "Friends first", blurb: "Friends get through, everyone else asks first.", bundle: { messages_policy: "followers", follow_policy: "approval", friend_requests_policy: "friends_of_friends", comments_policy: "followers", mention_policy: "friends", collab_invite_policy: "friends", memory_tag_policy: "friends", friends_visibility: "friends", show_in_recommendations: true, last_seen_visibility: "friends" } },
  balanced: { label: "Balanced", blurb: "Open to people you follow, protected from strangers.", bundle: { messages_policy: "followers", follow_policy: "everyone", friend_requests_policy: "everyone", comments_policy: "everyone", mention_policy: "following", collab_invite_policy: "following", memory_tag_policy: "friends", friends_visibility: "friends", show_in_recommendations: true, last_seen_visibility: "friends" } },
  creator: { label: "Creator", blurb: "Easy to find and follow, with mentions and invites open.", bundle: { messages_policy: "followers", follow_policy: "everyone", friend_requests_policy: "verified", comments_policy: "everyone", mention_policy: "everyone", collab_invite_policy: "everyone", memory_tag_policy: "friends", friends_visibility: "private", show_in_recommendations: true, last_seen_visibility: "nobody" } },
  business: { label: "Business", blurb: "Customers can reach you; your personal network stays private.", bundle: { messages_policy: "everyone", follow_policy: "everyone", friend_requests_policy: "nobody", comments_policy: "everyone", mention_policy: "everyone", collab_invite_policy: "following", memory_tag_policy: "nobody", friends_visibility: "private", show_in_recommendations: true, last_seen_visibility: "nobody" } },
  public_figure: { label: "Public figure", blurb: "Open to follow and mention, closed to direct contact.", bundle: { messages_policy: "off", follow_policy: "everyone", friend_requests_policy: "nobody", comments_policy: "followers", mention_policy: "following", collab_invite_policy: "following", memory_tag_policy: "nobody", friends_visibility: "private", show_in_recommendations: true, last_seen_visibility: "nobody" } },
  student: { label: "Student", blurb: "Classmates can find you; strangers can't message you.", bundle: { messages_policy: "followers", follow_policy: "friends_of_friends", friend_requests_policy: "friends_of_friends", comments_policy: "followers", mention_policy: "following", collab_invite_policy: "friends", memory_tag_policy: "friends", friends_visibility: "friends", show_in_recommendations: true, last_seen_visibility: "friends" } },
  family: { label: "Family", blurb: "A small, close circle: friends only, nothing public.", bundle: { messages_policy: "followers", follow_policy: "friends", friend_requests_policy: "friends_of_friends", comments_policy: "followers", mention_policy: "friends", collab_invite_policy: "friends", memory_tag_policy: "friends", friends_visibility: "private", show_in_recommendations: false, last_seen_visibility: "friends" } },
};

export const BOUNDARY_MODES: Record<string, { label: string; blurb: string; bundle: PrivacyBundle }> = {
  quiet: { label: "Quiet", blurb: "Fewer people can reach you for a while.", bundle: { messages_policy: "followers", mention_policy: "friends", collab_invite_policy: "friends" } },
  vacation: { label: "Vacation", blurb: "No new messages, mentions or invites while you're away.", bundle: { messages_policy: "off", mention_policy: "nobody", collab_invite_policy: "nobody", last_seen_visibility: "nobody" } },
  friends_only: { label: "Friends only", blurb: "Only friends can mention, invite or comment.", bundle: { messages_policy: "followers", follow_policy: "approval", comments_policy: "followers", mention_policy: "friends", collab_invite_policy: "friends" } },
  work: { label: "Work", blurb: "Collaborations open, personal contact quieter.", bundle: { messages_policy: "followers", mention_policy: "following", collab_invite_policy: "everyone" } },
  creator: { label: "Creator", blurb: "Open for a launch: follows, mentions and invites from everyone.", bundle: { follow_policy: "everyone", comments_policy: "everyone", mention_policy: "everyone", collab_invite_policy: "everyone" } },
  invisible: { label: "Invisible", blurb: "Out of suggestions, last seen hidden, nothing new reaches you.", bundle: { messages_policy: "off", mention_policy: "nobody", collab_invite_policy: "nobody", show_in_recommendations: false, last_seen_visibility: "nobody" } },
  weekend: { label: "Private weekend", blurb: "Quiet until Monday morning.", bundle: { messages_policy: "followers", mention_policy: "friends", collab_invite_policy: "nobody", last_seen_visibility: "friends" } },
};

/** When a weekend mode ends: the next Monday 06:00 UTC. */
export function nextMondayMorning(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6));
  const add = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

/** The settings a bundle will replace, so they can be put back exactly. */
export function restoreFor(current: Record<string, unknown>, bundle: PrivacyBundle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BUNDLE_KEYS) if (bundle[k] !== undefined) out[k] = current[k] ?? null;
  return out;
}

// ─── Privacy Advisor ────────────────────────────────────────────────────────

export interface AdvisorFacts {
  messagesPolicy: string;
  friendsVisibility: string;
  lastSeen: string;
  mentionPolicy: string;
  trustedContacts: number;
  pendingSentOld: number;
  staleCollaborators: number;
  tempBlocksEndingSoon: number;
  hasAvatar: boolean;
  inRecommendations: boolean;
  requestFiltersOn: boolean;
}

export interface Advice {
  id: string;
  title: string;
  why: string;
  href: string;
}

/** Suggestions only — each explains itself and links to where to act. Nothing changes until the member does. */
export function privacyAdvice(f: AdvisorFacts): Advice[] {
  const out: Advice[] = [];
  if (f.friendsVisibility === "public") out.push({ id: "friends-public", title: "Your friend list is public", why: "Anyone can see who you're friends with. Friends only is a common choice.", href: "/account/privacy-center#who-can-see" });
  if (f.messagesPolicy === "everyone" && f.lastSeen === "everyone") out.push({ id: "open-contact", title: "Anyone can message you and see when you were last on", why: "Together, that lets strangers time their messages. Limiting either one helps.", href: "/account/privacy-center#who-can-reach" });
  if (f.mentionPolicy === "everyone") out.push({ id: "mentions", title: "Anyone can mention you", why: "If mentions from strangers ever feel like too much, limit them to people you follow.", href: "/account/privacy-center#who-can-reach" });
  if (f.trustedContacts === 0) out.push({ id: "trusted", title: "Add a trusted contact", why: "A trusted contact can help if you're ever locked out. Nobody is added without you choosing them.", href: "/account/relationships" });
  if (f.pendingSentOld > 0) out.push({ id: "old-requests", title: `${f.pendingSentOld} friend ${f.pendingSentOld === 1 ? "request" : "requests"} you sent over a month ago`, why: "Unanswered requests stay open. You can withdraw ones you no longer want.", href: "/friends" });
  if (f.staleCollaborators > 0) out.push({ id: "collaborators", title: `${f.staleCollaborators} collaborator${f.staleCollaborators === 1 ? "" : "s"} you haven't worked with in a year`, why: "Old collaborations stay credited on those posts. Review them if that's no longer right.", href: "/friends/graph" });
  if (f.tempBlocksEndingSoon > 0) out.push({ id: "temp-blocks", title: `${f.tempBlocksEndingSoon} temporary block${f.tempBlocksEndingSoon === 1 ? " ends" : "s end"} within a day`, why: "Make it permanent if you still want distance.", href: "/account/privacy-center#blocked" });
  if (!f.requestFiltersOn && f.inRecommendations) out.push({ id: "filters", title: "Filter friend requests from brand-new or faceless accounts", why: "They're kept quietly instead of notifying you; you can still review them.", href: "/account/privacy-center#filters" });
  return out;
}
