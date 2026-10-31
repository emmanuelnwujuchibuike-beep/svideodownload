import { describe, expect, it } from "vitest";

import { cleanSeed, decodeShuffleCursor, encodeShuffleCursor, exclusiveOrder, NEW_MAX, spreadCreators } from "./feed-order";

/** Owner, 2026-10-31: the Exclusive feed reshuffles like the main feed, new posts first, never the same opener every visit. */
const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600 * 1000).toISOString();
const post = (id: string, creatorId: string, hoursAgo: number) => ({ id, creatorId, createdAt: ago(hoursAgo) });

// an old catalogue: 3 creators, nothing new
const old = [
  post("a1", "A", 300), post("a2", "A", 310), post("a3", "A", 320), post("a4", "A", 330),
  post("b1", "B", 305), post("b2", "B", 315),
  post("c1", "C", 340), post("c2", "C", 350),
];

describe("the Exclusive feed order", () => {
  it("🔴 a new visit opens on a different post — not always the same creator's newest (the reported bug)", () => {
    const openers = new Set(Array.from({ length: 30 }, (_, i) => exclusiveOrder(old, `seed${i}`, null, NOW)[0]!.id));
    // teeth: the old newest-first order opened on a1 every time
    expect(openers.size).toBeGreaterThan(3);
  });

  it("the same seed gives the same order (the next pages and a return to the tab line up)", () => {
    expect(exclusiveOrder(old, "visit-1", null, NOW).map((p) => p.id)).toEqual(exclusiveOrder(old, "visit-1", null, NOW).map((p) => p.id));
    expect(exclusiveOrder(old, "visit-1", null, NOW).map((p) => p.id)).not.toEqual(exclusiveOrder(old, "visit-2", null, NOW).map((p) => p.id));
    // nothing lost or doubled
    expect(exclusiveOrder(old, "visit-1", null, NOW).map((p) => p.id).sort()).toEqual(old.map((p) => p.id).sort());
  });

  it("a post made since the last visit is pinned on top, newest first — whatever the seed", () => {
    const items = [...old, post("n1", "B", 2), post("n2", "C", 1)];
    const since = NOW - 5 * 3600 * 1000;
    for (const seed of ["x", "y", "z"]) expect(exclusiveOrder(items, seed, since, NOW).slice(0, 2).map((p) => p.id)).toEqual(["n2", "n1"]);
    // seen already (the last visit was after them): back in the shuffle
    expect(exclusiveOrder(items, "x", NOW - 600_000, NOW).slice(0, 2).map((p) => p.id)).not.toEqual(["n2", "n1"]);
    // an unknown visit: the last day counts as new; never more than NEW_MAX pinned
    expect(exclusiveOrder(items, "x", null, NOW)[0]!.id).toBe("n2");
    const flood = Array.from({ length: 25 }, (_, i) => post(`f${i}`, `C${i % 4}`, 1 + i / 100));
    expect(exclusiveOrder(flood, "x", null, NOW).slice(0, NEW_MAX).map((p) => p.id)).toEqual(flood.slice(0, NEW_MAX).map((p) => p.id));
  });

  it("never the same creator twice in a row while another one is waiting", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const order = exclusiveOrder(old, seed, null, NOW);
      // A has 4 of 8: a valid spread exists, and A never follows A until only A is left
      for (let i = 1; i < order.length; i++) {
        const rest = order.slice(i);
        if (rest.some((p) => p.creatorId !== order[i - 1]!.creatorId)) expect(order[i]!.creatorId, `${seed} @${i}`).not.toBe(order[i - 1]!.creatorId);
      }
    }
    expect(spreadCreators([post("1", "A", 1), post("2", "A", 2), post("3", "B", 3)]).map((p) => p.creatorId)).toEqual(["A", "B", "A"]);
  });

  it("the paging cursor carries the seed, the offset and the visit — and refuses anything else", () => {
    const c = encodeShuffleCursor("abc_D-9", 24, 1761900000000);
    expect(decodeShuffleCursor(c)).toEqual({ seed: "abc_D-9", offset: 24, sinceMs: 1761900000000 });
    expect(decodeShuffleCursor(encodeShuffleCursor("s", 12, null))).toEqual({ seed: "s", offset: 12, sinceMs: null });
    for (const bad of ["", "s1..12.", "s1.a b.1.", "eyJhdCI6IjIwMjYifQ", "s1.x.99999.", null]) expect(decodeShuffleCursor(bad), String(bad)).toBeNull();
    expect(cleanSeed("a<script>b")).toBe("ascriptb");
    expect(cleanSeed("")).toBeNull();
  });
});
