import { describe, expect, it } from "vitest";

import { BOUNDARY_MODES, BUNDLE_KEYS, connectAllowed, describeBundle, nextMondayMorning, PRESETS, privacyAdvice, restoreFor } from "./relationship";

const ALLOWED: Record<string, readonly unknown[]> = {
  messages_policy: ["everyone", "followers", "off"],
  follow_policy: ["everyone", "friends_of_friends", "verified", "friends", "approval", "nobody"],
  friend_requests_policy: ["everyone", "friends_of_friends", "verified", "nobody"],
  comments_policy: ["everyone", "followers", "off"],
  mention_policy: ["everyone", "following", "friends", "nobody"],
  collab_invite_policy: ["everyone", "following", "friends", "nobody"],
  memory_tag_policy: ["friends", "nobody"],
  friends_visibility: ["public", "friends", "private"],
  show_in_recommendations: [true, false],
  last_seen_visibility: ["everyone", "friends", "nobody"],
};

describe("relationship privacy rules", () => {
  it("who-can policies: each audience exactly as named", () => {
    expect(connectAllowed("everyone", { isFriend: false, memberFollowsActor: false })).toBe(true);
    expect(connectAllowed("following", { isFriend: false, memberFollowsActor: true })).toBe(true);
    expect(connectAllowed("following", { isFriend: false, memberFollowsActor: false })).toBe(false);
    expect(connectAllowed("friends", { isFriend: false, memberFollowsActor: true })).toBe(false);
    expect(connectAllowed("friends", { isFriend: true, memberFollowsActor: false })).toBe(true);
    expect(connectAllowed("nobody", { isFriend: true, memberFollowsActor: true })).toBe(false);
    expect(connectAllowed("garbage", { isFriend: true, memberFollowsActor: true })).toBe(false);
  });
  it("every preset and mode only sets real columns to values the database accepts", () => {
    for (const [name, p] of Object.entries({ ...PRESETS, ...BOUNDARY_MODES })) {
      for (const [k, v] of Object.entries(p.bundle)) {
        expect(BUNDLE_KEYS as readonly string[], `${name}.${k}`).toContain(k);
        expect(ALLOWED[k], `${name}.${k}=${String(v)}`).toContain(v);
      }
      expect(describeBundle(p.bundle).length, name).toBeGreaterThan(0);
    }
  });
  it("a mode can always be undone exactly", () => {
    const current = { messages_policy: "everyone", mention_policy: "everyone", follow_policy: "approval" };
    expect(restoreFor(current, BOUNDARY_MODES.vacation!.bundle)).toEqual({ messages_policy: "everyone", mention_policy: "everyone", collab_invite_policy: null, last_seen_visibility: null });
  });
  it("private weekend ends on Monday morning", () => {
    expect(nextMondayMorning(new Date("2026-10-10T15:00:00Z")).toISOString()).toBe("2026-10-12T06:00:00.000Z");
    expect(nextMondayMorning(new Date("2026-10-12T09:00:00Z")).toISOString()).toBe("2026-10-19T06:00:00.000Z");
  });
  it("the advisor explains itself and stays quiet when there is nothing to say", () => {
    const quiet = privacyAdvice({ messagesPolicy: "followers", friendsVisibility: "friends", lastSeen: "friends", mentionPolicy: "following", trustedContacts: 1, pendingSentOld: 0, staleCollaborators: 0, tempBlocksEndingSoon: 0, hasAvatar: true, inRecommendations: true, requestFiltersOn: true });
    expect(quiet).toEqual([]);
    const loud = privacyAdvice({ messagesPolicy: "everyone", friendsVisibility: "public", lastSeen: "everyone", mentionPolicy: "everyone", trustedContacts: 0, pendingSentOld: 2, staleCollaborators: 0, tempBlocksEndingSoon: 0, hasAvatar: true, inRecommendations: true, requestFiltersOn: false });
    expect(loud.map((a) => a.id)).toEqual(["friends-public", "open-contact", "mentions", "trusted", "old-requests", "filters"]);
    for (const a of loud) expect(a.why.length).toBeGreaterThan(10);
  });
});
