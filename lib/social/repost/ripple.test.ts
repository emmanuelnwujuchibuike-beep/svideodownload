import { describe, expect, it } from "vitest";

import { buildRipple, type RippleRow } from "@/lib/social/repost/ripple";

const NOW = 1_760_000_000_000;
const creator = { id: "creator", name: "Ada", avatarUrl: null };

const row = (over: Partial<RippleRow> & Pick<RippleRow, "repostId" | "reposterId">): RippleRow => ({
  name: over.reposterId,
  avatarUrl: null,
  sourceRepostId: null,
  createdAt: NOW,
  ...over,
});

describe("buildRipple", () => {
  it("draws nothing when nobody reposted it", () => {
    const r = buildRipple(creator, []);
    expect(r.layers).toEqual([]);
    expect(r.maxDepth).toBe(0);
    expect(r.longestChain).toEqual(["Ada"]);
  });

  it("🔴 puts two independent reposters side by side, not in a chain", () => {
    // A count-driven visualisation would draw a fan-out. What actually happened
    // is two people who each found it themselves.
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris" }),
      row({ repostId: "b", reposterId: "emma" }),
    ]);
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]!.nodes.map((n) => n.reposterId).sort()).toEqual(["chris", "emma"]);
  });

  it("follows the provenance edge into deeper layers", () => {
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris" }),
      row({ repostId: "b", reposterId: "emma", sourceRepostId: "a", createdAt: NOW + 1000 }),
      row({ repostId: "c", reposterId: "sam", sourceRepostId: "b", createdAt: NOW + 2000 }),
    ]);
    expect(r.maxDepth).toBe(3);
    expect(r.layers.map((l) => l.depth)).toEqual([1, 2, 3]);
    expect(r.longestChain).toEqual(["Ada", "chris", "emma", "sam"]);
  });

  it("counts children on the node they branch from", () => {
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris" }),
      row({ repostId: "b", reposterId: "emma", sourceRepostId: "a" }),
      row({ repostId: "c", reposterId: "sam", sourceRepostId: "a" }),
    ]);
    expect(r.layers[0]!.nodes[0]!.childCount).toBe(2);
    expect(r.layers[1]!.nodes).toHaveLength(2);
  });

  it("🔴 marks a missing edge as UNKNOWN and says so on the layer", () => {
    // Pre-0116 rows, and reposts made from a profile grid, genuinely have no
    // source. Drawing them as "from the creator" invents a hop.
    const r = buildRipple(creator, [row({ repostId: "a", reposterId: "chris" })]);
    expect(r.unknownProvenance).toBe(1);
    expect(r.layers[0]!.nodes[0]!.provenanceUnknown).toBe(true);
    expect(r.layers[0]!.note).toContain("Not traced");
  });

  it("🔴 deeper layers are never labelled untraceable — their edge resolved", () => {
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris" }),
      row({ repostId: "b", reposterId: "emma", sourceRepostId: "a" }),
    ]);
    expect(r.layers[1]!.note).toBeUndefined();
    expect(r.layers[1]!.nodes[0]!.provenanceUnknown).toBe(false);
  });

  it("counts a dangling edge separately from no edge at all", () => {
    // "Found it themselves" and "came through someone we can't name" are
    // different facts, even though both land in layer 1.
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris" }),
      row({ repostId: "b", reposterId: "emma", sourceRepostId: "deleted" }),
    ]);
    expect(r.unknownProvenance).toBe(1);
    expect(r.untracedParents).toBe(1);
  });

  it("keeps a row whose parent was not fetched, rather than dropping it", () => {
    // Dropping it would under-count the spread; promoting it to depth 1 with
    // unknown provenance is the honest placement.
    const r = buildRipple(creator, [row({ repostId: "b", reposterId: "emma", sourceRepostId: "missing" })]);
    expect(r.totalReposts).toBe(1);
    expect(r.layers[0]!.nodes).toHaveLength(1);
  });

  it("🔴 terminates on a cycle", () => {
    // A self-referencing FK plus an out-of-order insert could produce A→B→A on
    // live data that no fixture would contain. A naive walk recurses forever.
    const r = buildRipple(creator, [
      row({ repostId: "a", reposterId: "chris", sourceRepostId: "b" }),
      row({ repostId: "b", reposterId: "emma", sourceRepostId: "a" }),
    ]);
    expect(r.totalReposts).toBe(2);
    expect(r.maxDepth).toBeGreaterThan(0);
  });

  it("orders each layer oldest-first, so the picture reads as it happened", () => {
    const r = buildRipple(creator, [
      row({ repostId: "late", reposterId: "sam", createdAt: NOW + 5000 }),
      row({ repostId: "early", reposterId: "chris", createdAt: NOW }),
    ]);
    expect(r.layers[0]!.nodes.map((n) => n.reposterId)).toEqual(["chris", "sam"]);
  });
});
