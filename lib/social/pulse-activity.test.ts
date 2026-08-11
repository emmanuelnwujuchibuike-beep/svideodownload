import { describe, expect, it } from "vitest";

import { groupPulseActivity, MAX_ACTORS, type PulseProfileRow } from "./pulse-activity";

/**
 * The grouping rules are where this feature can quietly start lying — double
 * counting one person, naming the viewer back to themselves, or reporting a
 * weaker signal than the one that happened. Each of those produces a plausible
 * card that is wrong, which is worse than no card.
 */

const prof = (id: string, over: Partial<PulseProfileRow> = {}): [string, PulseProfileRow] => [
  id,
  { id, handle: over.handle === undefined ? id : over.handle, display_name: over.display_name ?? id + " name", avatar_url: over.avatar_url ?? null },
];

const profiles = new Map<string, PulseProfileRow>([prof("ann"), prof("bob"), prof("cat"), prof("dan"), prof("me")]);

describe("groupPulseActivity", () => {
  it("groups by post and names the actors", () => {
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "ann", kind: "repost" },
        { post_id: "p2", user_id: "bob", kind: "like" },
      ],
      profiles,
      null,
    );
    expect(out.get("p1")?.actors.map((a) => a.handle)).toEqual(["ann"]);
    expect(out.get("p1")?.actors[0]!.kind).toBe("repost");
    expect(out.get("p2")?.total).toBe(1);
  });

  it("🔴 never shows the viewer their own action back to them", () => {
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "me", kind: "like" },
        { post_id: "p1", user_id: "ann", kind: "like" },
      ],
      profiles,
      "me",
    );
    expect(out.get("p1")?.actors.map((a) => a.handle)).toEqual(["ann"]);
    expect(out.get("p1")?.total).toBe(1);
  });

  it("drops a post entirely when the viewer was its only engaged follow", () => {
    const out = groupPulseActivity([{ post_id: "p1", user_id: "me", kind: "like" }], profiles, "me");
    expect(out.has("p1")).toBe(false);
  });

  it("🔴 counts one person ONCE however many ways they engaged", () => {
    // Liking and then reposting is one friend, not two. Double counting turns
    // two people into "3 friends" — a small lie of exactly the kind this
    // module exists to avoid.
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "ann", kind: "repost" },
        { post_id: "p1", user_id: "ann", kind: "like" },
        { post_id: "p1", user_id: "bob", kind: "like" },
      ],
      profiles,
      null,
    );
    expect(out.get("p1")?.total).toBe(2);
    expect(out.get("p1")?.actors).toHaveLength(2);
  });

  it("reports the STRONGER signal when one person did several things", () => {
    // Rows arrive repost-first by construction, and the de-dupe keeps the first.
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "ann", kind: "repost" },
        { post_id: "p1", user_id: "ann", kind: "like" },
      ],
      profiles,
      null,
    );
    expect(out.get("p1")?.actors[0]!.kind).toBe("repost");
  });

  it("caps the NAMES but not the count", () => {
    const rows = ["ann", "bob", "cat", "dan"].map((u) => ({ post_id: "p1", user_id: u, kind: "like" as const }));
    const out = groupPulseActivity(rows, profiles, null);
    expect(out.get("p1")?.actors).toHaveLength(MAX_ACTORS);
    expect(out.get("p1")?.total).toBe(4);
  });

  it("counts a handle-less profile but never names it", () => {
    // Rendering "@undefined" is worse than a count that is one larger than the
    // list of names, which Friend Energy already expresses.
    const p = new Map<string, PulseProfileRow>([prof("ann"), ["ghost", { id: "ghost", handle: null, display_name: null, avatar_url: null }]]);
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "ghost", kind: "like" },
        { post_id: "p1", user_id: "ann", kind: "like" },
      ],
      p,
      null,
    );
    expect(out.get("p1")?.actors.map((a) => a.handle)).toEqual(["ann"]);
    expect(out.get("p1")?.total).toBe(2);
  });

  it("falls back to the handle when a profile has no display name", () => {
    const p = new Map<string, PulseProfileRow>([["ann", { id: "ann", handle: "ann", display_name: null, avatar_url: null }]]);
    const out = groupPulseActivity([{ post_id: "p1", user_id: "ann", kind: "like" }], p, null);
    expect(out.get("p1")?.actors[0]!.displayName).toBe("ann");
  });

  it("returns nothing for no rows — the correct and common state", () => {
    expect(groupPulseActivity([], profiles, null).size).toBe(0);
  });

  it("keeps posts independent of one another", () => {
    const out = groupPulseActivity(
      [
        { post_id: "p1", user_id: "ann", kind: "like" },
        { post_id: "p2", user_id: "ann", kind: "repost" },
      ],
      profiles,
      null,
    );
    expect(out.get("p1")?.actors[0]!.kind).toBe("like");
    expect(out.get("p2")?.actors[0]!.kind).toBe("repost");
  });
});
