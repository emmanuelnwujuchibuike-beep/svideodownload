import { describe, expect, it } from "vitest";

import {
  canDiscloseEdge,
  ENFORCEMENT_EDGES,
  GRAPH_EDGES,
  graphEdge,
  isEnforcementEdge,
  liveEdges,
  plannedEdges,
} from "@/lib/social/graph/edges";

describe("graph edge catalogue", () => {
  it("has no duplicate keys", () => {
    const keys = GRAPH_EDGES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every live edge names a real table, every planned one names none", () => {
    for (const e of liveEdges()) expect(e.table, `${e.key} is live but has no table`).toBeTruthy();
    for (const e of plannedEdges()) expect(e.table, `${e.key} is planned but claims a table`).toBeNull();
  });

  it("every planned edge says exactly what is missing", () => {
    for (const e of plannedEdges()) {
      expect(e.needs, `${e.key} is planned without a reason`).toBeTruthy();
      expect(e.needs!.length).toBeGreaterThan(20);
    }
  });

  it("catalogues the edges that already existed rather than inventing new ones", () => {
    const tables = liveEdges().map((e) => e.table);
    expect(tables).toEqual(
      expect.arrayContaining([
        "follows",
        "friendships",
        "friend_requests",
        "friend_favorites",
        "blocks",
        "muted_creators",
        "user_restrictions",
      ]),
    );
  });
});

describe("disclosure", () => {
  it("never tells the other side about a block, mute, restrict or favourite", () => {
    for (const key of ["block", "mute", "restrict", "favorite"]) {
      expect(canDiscloseEdge(key, "owner")).toBe(true);
      expect(canDiscloseEdge(key, "other-participant")).toBe(false);
      expect(canDiscloseEdge(key, "public")).toBe(false);
    }
  });

  it("keeps friendships between the two people", () => {
    expect(canDiscloseEdge("friend", "other-participant")).toBe(true);
    expect(canDiscloseEdge("friend", "public")).toBe(false);
  });

  it("treats follows as public", () => {
    expect(canDiscloseEdge("follow", "public")).toBe(true);
  });

  it("fails closed on an unknown edge", () => {
    expect(canDiscloseEdge("telepathy", "owner")).toBe(false);
    expect(canDiscloseEdge("", "public")).toBe(false);
  });
});

describe("enforcement edges", () => {
  it("names block, mute and restrict", () => {
    expect([...ENFORCEMENT_EDGES].sort()).toEqual(["block", "mute", "restrict"]);
  });

  it("identifies them and nothing else", () => {
    expect(isEnforcementEdge("block")).toBe(true);
    expect(isEnforcementEdge("friend")).toBe(false);
    expect(isEnforcementEdge("nonsense")).toBe(false);
  });

  it("every enforcement edge is owner-only — they must never be discoverable", () => {
    for (const key of ENFORCEMENT_EDGES) {
      expect(graphEdge(key)!.disclosure).toBe("owner-only");
    }
  });
});
