import { describe, expect, it } from "vitest";

import { capPerFriend, type FriendActivityEntry } from "./friend-activity";
import type { FriendProfile } from "./friends";

function makeProfile(id: string): FriendProfile {
  return { id, handle: id, displayName: id, avatarUrl: null, isVerified: false };
}

function makeEntry(actorId: string, createdAt: string, kind: FriendActivityEntry["kind"] = "post"): FriendActivityEntry {
  return { kind, createdAt, actor: makeProfile(actorId) };
}

describe("capPerFriend", () => {
  it("caps a very active friend at maxPerFriend while a quiet friend's item still gets through", () => {
    const entries = [
      makeEntry("A", "2026-07-10T10:00:00Z"),
      makeEntry("A", "2026-07-10T09:00:00Z"),
      makeEntry("A", "2026-07-10T08:00:00Z"),
      makeEntry("A", "2026-07-10T07:00:00Z"),
      makeEntry("A", "2026-07-10T06:00:00Z"),
      makeEntry("B", "2026-07-10T05:00:00Z"),
    ];
    const out = capPerFriend(entries, 8);
    expect(out.filter((e) => e.actor.id === "A")).toHaveLength(2);
    expect(out.some((e) => e.actor.id === "B")).toBe(true);
    expect(out).toHaveLength(3);
  });

  it("applies the overall limit AFTER capping, keeping the most recent items", () => {
    const entries = [
      makeEntry("A", "2026-07-10T10:00:00Z"),
      makeEntry("B", "2026-07-10T09:00:00Z"),
      makeEntry("C", "2026-07-10T08:00:00Z"),
      makeEntry("D", "2026-07-10T07:00:00Z"),
    ];
    const out = capPerFriend(entries, 2);
    expect(out.map((e) => e.actor.id)).toEqual(["A", "B"]);
  });

  it("always sorts newest-first regardless of input order", () => {
    const entries = [makeEntry("A", "2026-07-10T01:00:00Z"), makeEntry("B", "2026-07-10T05:00:00Z"), makeEntry("C", "2026-07-10T03:00:00Z")];
    const out = capPerFriend(entries, 8);
    expect(out.map((e) => e.actor.id)).toEqual(["B", "C", "A"]);
  });

  it("does not mutate the input array", () => {
    const entries = [makeEntry("A", "2026-07-10T01:00:00Z"), makeEntry("B", "2026-07-10T05:00:00Z")];
    const before = entries.map((e) => e.actor.id).join(",");
    capPerFriend(entries, 8);
    expect(entries.map((e) => e.actor.id).join(",")).toBe(before);
  });

  it("returns an empty array for empty input", () => {
    expect(capPerFriend([], 8)).toHaveLength(0);
  });
});
