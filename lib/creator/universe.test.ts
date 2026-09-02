import { describe, expect, it } from "vitest";

import { buildCreatorUniverse, universePoint, type UniverseInput } from "@/lib/creator/universe";

const BARE: UniverseInput = {
  handle: "ada",
  avatarUrl: null,
  followers: 0,
  categories: [],
  sounds: [],
  collections: [],
  surfaces: [],
  collaborators: [],
};

const FULL: UniverseInput = {
  handle: "ada",
  avatarUrl: "/me.jpg",
  followers: 4200,
  categories: [
    { id: "music", label: "Music", views: 9000 },
    { id: "tech", label: "Tech", views: 3000 },
    { id: "food", label: "Food", views: 500 },
  ],
  sounds: [{ id: "s1", title: "Night drive", plays: 800 }],
  collections: [{ id: "c1", title: "Best of", items: 12 }],
  surfaces: [
    { id: "for_you", label: "For You", views: 8000 },
    { id: "reels", label: "Reels", views: 2000 },
  ],
  collaborators: [{ id: "u2", handle: "grace", avatarUrl: null, posts: 3 }],
};

describe("buildCreatorUniverse", () => {
  it("puts the creator at the centre", () => {
    const g = buildCreatorUniverse(FULL);
    const self = g.nodes.find((n) => n.id === "self")!;
    expect(self.ring).toBe(0);
    expect(self.label).toBe("@ada");
    expect(self.value).toBe(4200);
  });

  it("reports empty when there is nothing but the creator", () => {
    const g = buildCreatorUniverse(BARE);
    expect(g.nodes).toHaveLength(1);
    expect(g.links).toEqual([]);
    expect(g.empty).toBe(true);
  });

  it("plots one node per real row and nothing else", () => {
    const g = buildCreatorUniverse(FULL);
    // 1 self + 3 categories + 1 sound + 1 collection + 2 surfaces + 1 collaborator
    expect(g.nodes).toHaveLength(9);
    expect(g.empty).toBe(false);
  });

  it("links every node to the centre — this is a reach map, not a social graph", () => {
    const g = buildCreatorUniverse(FULL);
    expect(g.links).toHaveLength(g.nodes.length - 1);
    expect(g.links.every((l) => l.from === "self")).toBe(true);
  });

  it("namespaces node ids so a category and a sound sharing an id cannot collide", () => {
    const g = buildCreatorUniverse({
      ...BARE,
      categories: [{ id: "x", label: "Cat", views: 1 }],
      sounds: [{ id: "x", title: "Sound", plays: 1 }],
    });
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("category:x");
    expect(ids).toContain("sound:x");
  });

  it("sizes nodes by real magnitude, relative to their own kind", () => {
    const g = buildCreatorUniverse(FULL);
    const music = g.nodes.find((n) => n.id === "category:music")!;
    const food = g.nodes.find((n) => n.id === "category:food")!;
    expect(music.weight).toBe(1);
    expect(food.weight).toBeLessThan(music.weight);
    // A tiny node still has to be visible.
    expect(food.weight).toBeGreaterThanOrEqual(0.25);
  });

  it("is deterministic — the same input draws the same picture twice", () => {
    expect(buildCreatorUniverse(FULL)).toEqual(buildCreatorUniverse(FULL));
  });

  it("breaks magnitude ties on a stable key rather than input order", () => {
    const a = buildCreatorUniverse({
      ...BARE,
      categories: [
        { id: "beta", label: "Beta", views: 10 },
        { id: "alpha", label: "Alpha", views: 10 },
      ],
    });
    const b = buildCreatorUniverse({
      ...BARE,
      categories: [
        { id: "alpha", label: "Alpha", views: 10 },
        { id: "beta", label: "Beta", views: 10 },
      ],
    });
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
  });

  it("caps each kind so the map stays a map", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, views: i }));
    const g = buildCreatorUniverse({ ...BARE, categories: many });
    expect(g.nodes.filter((n) => n.kind === "category")).toHaveLength(6);
  });

  it("keeps the highest-magnitude items when it caps", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, views: i }));
    const g = buildCreatorUniverse({ ...BARE, categories: many });
    expect(g.nodes.some((n) => n.id === "category:c29")).toBe(true);
    expect(g.nodes.some((n) => n.id === "category:c0")).toBe(false);
  });

  it("links a collaborator and a sound to their real pages", () => {
    const g = buildCreatorUniverse(FULL);
    expect(g.nodes.find((n) => n.id === "collaborator:u2")!.href).toBe("/u/grace");
    expect(g.nodes.find((n) => n.id === "sound:s1")!.href).toBe("/sound/s1");
  });
});

describe("universePoint", () => {
  it("places the centre node at the middle of the box", () => {
    const g = buildCreatorUniverse(FULL);
    const p = universePoint(g.nodes.find((n) => n.id === "self")!, 400);
    expect(p.x).toBeCloseTo(200, 5);
    expect(p.y).toBeCloseTo(200, 5);
  });

  it("puts an angle of 0 directly above the centre", () => {
    const g = buildCreatorUniverse({ ...BARE, categories: [{ id: "a", label: "A", views: 1 }] });
    const node = g.nodes.find((n) => n.kind === "category")!;
    expect(node.angle).toBe(0);
    const p = universePoint(node, 400);
    expect(p.x).toBeCloseTo(200, 5);
    expect(p.y).toBeLessThan(200);
  });

  it("keeps every node inside the box", () => {
    const g = buildCreatorUniverse(FULL);
    for (const node of g.nodes) {
      const p = universePoint(node, 400);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
  });
});
