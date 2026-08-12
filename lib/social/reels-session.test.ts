import { describe, expect, it } from "vitest";

import { freshDeck, MIN_DECK, shuffleWithSeed } from "@/lib/social/reels-session";

const deck = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `post-${i}` }));
const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id);

describe("shuffleWithSeed", () => {
  it("is deterministic for one seed — every page of an open must agree", () => {
    const items = deck(30);
    expect(ids(shuffleWithSeed(items, "abc"))).toEqual(ids(shuffleWithSeed(items, "abc")));
  });

  it("gives a different arrangement for a different seed", () => {
    const items = deck(30);
    expect(ids(shuffleWithSeed(items, "abc"))).not.toEqual(ids(shuffleWithSeed(items, "xyz")));
  });

  it("never drops or invents an item", () => {
    const items = deck(30);
    const out = shuffleWithSeed(items, "seed");
    expect(out).toHaveLength(30);
    expect(new Set(ids(out))).toEqual(new Set(ids(items)));
  });
});

describe("freshDeck", () => {
  it("drops watched reels when there are plenty left", () => {
    const out = freshDeck(deck(20), { seed: "s", watched: ["post-0", "post-1"], suppressed: [] });
    expect(out.items.map((i) => i.id)).not.toContain("post-0");
    expect(out.items.map((i) => i.id)).not.toContain("post-1");
    expect(out.items).toHaveLength(18);
    expect(out.exhausted).toBe(false);
  });

  it("drops suppressed reels absolutely — an instruction, not a preference", () => {
    const out = freshDeck(deck(3), { seed: "s", watched: [], suppressed: ["post-0", "post-1", "post-2"] });
    expect(out.items).toHaveLength(0);
  });

  it("🔴 abandons the watched filter rather than hand back an empty deck", () => {
    // Everything watched — the exact state a viewer reaches on a small
    // catalogue, and the one that used to be an empty full-screen player.
    const items = deck(10);
    const out = freshDeck(items, { seed: "s", watched: ids(items), suppressed: [] });
    expect(out.items).toHaveLength(10);
    expect(out.exhausted).toBe(true);
  });

  it("falls back as soon as fewer than MIN_DECK unseen remain", () => {
    const items = deck(10);
    const watched = ids(items).slice(0, 10 - (MIN_DECK - 1)); // leaves MIN_DECK - 1 unseen
    const out = freshDeck(items, { seed: "s", watched, suppressed: [] });
    expect(out.exhausted).toBe(true);
    expect(out.items).toHaveLength(10);
  });

  it("does NOT report exhaustion when nothing was watched in the first place", () => {
    // Fewer than MIN_DECK items total, none watched: the deck is small, not
    // starved, and clearing the ledger over it would throw away real history.
    const out = freshDeck(deck(2), { seed: "s", watched: [], suppressed: [] });
    expect(out.exhausted).toBe(false);
    expect(out.items).toHaveLength(2);
  });

  it("suppression still applies in the exhausted fallback", () => {
    const items = deck(6);
    const out = freshDeck(items, { seed: "s", watched: ids(items), suppressed: ["post-3"] });
    expect(out.exhausted).toBe(true);
    expect(out.items.map((i) => i.id)).not.toContain("post-3");
  });

  it("shuffle:false filters without reordering — the server already ranked", () => {
    const out = freshDeck(deck(10), { seed: "s", watched: ["post-4"], suppressed: [], shuffle: false });
    expect(out.items.map((i) => i.id)).toEqual([
      "post-0",
      "post-1",
      "post-2",
      "post-3",
      "post-5",
      "post-6",
      "post-7",
      "post-8",
      "post-9",
    ]);
  });

  it("reshuffles by default, so two opens of the same pool differ", () => {
    const items = deck(24);
    const a = freshDeck(items, { seed: "open-a", watched: [], suppressed: [] });
    const b = freshDeck(items, { seed: "open-b", watched: [], suppressed: [] });
    expect(ids(a.items)).not.toEqual(ids(b.items));
    expect(new Set(ids(a.items))).toEqual(new Set(ids(b.items)));
  });
});
