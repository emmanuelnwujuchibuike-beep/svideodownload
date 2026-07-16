import { describe, expect, it } from "vitest";

import { rankForYou, type Row } from "./home-feed";

// ONE shared timestamp for every default row — NOT `new Date()` per call.
// Real CI flake (2026-07-16, run #451): each makeRow() used to call
// `new Date().toISOString()` separately, so two "otherwise-identical" rows
// created across a millisecond boundary genuinely differed in age — and
// rankForYou's freshness term (40/(1+ageHours/30)) is continuous, so a 1ms
// age gap produces a tiny nonzero score gap. The "ties preserve original
// order" test below then wasn't testing a tie at all: the older row
// correctly sorted last and the test failed, purely depending on clock
// timing (passed 450 runs by luck — all rows usually land in the same ms).
// ALSO deliberately OLDER than rankForYou's NEW_POST_WINDOW_MS (30 min).
// Posts inside that window pin to the top by recency and bypass scoring AND the
// shuffle entirely (owner: "new post should be at the top"), so a `new Date()`
// fixture would put every row in the pinned tier — where relationship/quality/
// boost have no effect by design — and the scoring tests below would be
// asserting against a code path they never reach. A day old is unambiguously in
// the ranked tier. The pinning behaviour has its own tests further down.
const SHARED_CREATED_AT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    publisher_id: "stranger",
    source_url: "https://example.com/x",
    platform: "frenz",
    media_kind: "video",
    title: "post",
    description: null,
    category: null,
    thumbnail_url: null,
    media_url: null,
    duration_sec: null,
    visibility: "public",
    status: "published",
    views_count: 0,
    likes_count: 0,
    saves_count: 0,
    shares_count: 0,
    comments_count: 0,
    downloads_count: 0,
    created_at: SHARED_CREATED_AT,
    ...overrides,
  };
}

describe("rankForYou", () => {
  it("ranks a followed creator's post above a stranger's otherwise-identical post", () => {
    const rows = [makeRow({ id: "a", publisher_id: "stranger" }), makeRow({ id: "b", publisher_id: "friend" })];
    const ranked = rankForYou(rows, new Set(["friend"]));
    expect(ranked[0]?.publisher_id).toBe("friend");
  });

  it("a boosted category outranks an otherwise-identical non-boosted post", () => {
    const rows = [makeRow({ id: "a", category: "sports" }), makeRow({ id: "b", category: "tech" })];
    const ranked = rankForYou(rows, new Set(), { preferFriends: false, boostedCategories: ["tech"] });
    expect(ranked[0]?.category).toBe("tech");
  });

  it("preferFriends (120→220 relationship bonus) is large enough to flip a ranking the default bonus wouldn't", () => {
    const friend = makeRow({ id: "friend-post", publisher_id: "friend", likes_count: 0 });
    const stranger = makeRow({ id: "stranger-post", publisher_id: "stranger", likes_count: 150 });
    const withoutPref = rankForYou([friend, stranger], new Set(["friend"]), { preferFriends: false, boostedCategories: [] });
    const withPref = rankForYou([friend, stranger], new Set(["friend"]), { preferFriends: true, boostedCategories: [] });
    expect(withoutPref[0]?.publisher_id).toBe("stranger"); // 120 bonus loses to a 150-like gap
    expect(withPref[0]?.publisher_id).toBe("friend"); // 220 bonus wins
  });

  it("quality signals (comments/shares weighted above raw likes) affect ranking among strangers", () => {
    const highLikes = makeRow({ id: "a", likes_count: 100 });
    const highComments = makeRow({ id: "b", likes_count: 10, comments_count: 50 }); // 10 + 100 = 110 > 100
    const ranked = rankForYou([highLikes, highComments], new Set());
    expect(ranked[0]?.id).toBe("b");
  });

  it("ties preserve original (recency) order — never shuffle arbitrarily", () => {
    const rows = [makeRow({ id: "first" }), makeRow({ id: "second" }), makeRow({ id: "third" })];
    const ranked = rankForYou(rows, new Set());
    expect(ranked.map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("is deterministic — the same input always produces the same order", () => {
    const rows = [
      makeRow({ id: "a", likes_count: 12, created_at: "2026-07-01T00:00:00Z" }),
      makeRow({ id: "b", likes_count: 40, created_at: "2026-07-05T00:00:00Z" }),
      makeRow({ id: "c", publisher_id: "friend", created_at: "2026-07-03T00:00:00Z" }),
    ];
    const first = rankForYou(rows, new Set(["friend"])).map((r) => r.id);
    const second = rankForYou(rows, new Set(["friend"])).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it("an anonymous viewer (no following set) still ranks sanely by quality/freshness", () => {
    const rows = [makeRow({ id: "a", likes_count: 5 }), makeRow({ id: "b", likes_count: 500 })];
    const ranked = rankForYou(rows, new Set());
    expect(ranked[0]?.id).toBe("b");
  });
});

/**
 * The per-refresh reshuffle (owner: "every refresh should reshuffle the feed
 * post arrangement like tiktok"). The property that actually matters here isn't
 * "it shuffles" — it's that ONE seed yields ONE stable order. The feed is
 * offset-paginated, so page 2 re-ranks the same candidate set page 1 did; if the
 * jitter weren't deterministic per (seed, id), pages would disagree and the
 * viewer would see some posts twice and never see others at all.
 */
describe("rankForYou — per-refresh shuffle", () => {
  const many = () => Array.from({ length: 40 }, (_, i) => makeRow({ id: `p${i}`, likes_count: 50 }));

  it("is deterministic: the same seed always yields the same order", () => {
    const a = rankForYou(many(), new Set(), undefined, "seed-alpha").map((r) => r.id);
    const b = rankForYou(many(), new Set(), undefined, "seed-alpha").map((r) => r.id);
    expect(a).toEqual(b);
  });

  it("reshuffles between refreshes: different seeds yield different orders", () => {
    const a = rankForYou(many(), new Set(), undefined, "seed-alpha").map((r) => r.id);
    const b = rankForYou(many(), new Set(), undefined, "seed-beta").map((r) => r.id);
    expect(a).not.toEqual(b);
  });

  it("keeps every post exactly once — shuffling must never drop or duplicate", () => {
    const ranked = rankForYou(many(), new Set(), undefined, "seed-alpha");
    expect(ranked).toHaveLength(40);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(40);
  });

  it("omitting the seed leaves the existing order untouched", () => {
    const withoutSeed = rankForYou(many(), new Set(), undefined).map((r) => r.id);
    const legacy = rankForYou(many(), new Set()).map((r) => r.id);
    expect(withoutSeed).toEqual(legacy);
  });

  it("jitter can't invert a real quality gap — a strong post stays on top", () => {
    // ±25% of each post's own score, so a 10x gap must survive any seed.
    const rows = [...many(), makeRow({ id: "banger", likes_count: 5000 })];
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      expect(rankForYou(rows, new Set(), undefined, seed)[0]?.id).toBe("banger");
    }
  });
});

/**
 * Brand-new posts pin to the top (owner: "new post should be at the top when
 * the new post button is clicked and when is refresh"). This is what makes the
 * realtime "N new posts" pill honest — it refreshes, and the thing it promised
 * is visibly at the top rather than wherever the ranker happened to put it.
 *
 * It deliberately overrides BOTH scoring and the shuffle, but only inside a
 * 30-minute window; the two asks ("reshuffle every refresh" / "my new post is
 * on top") can't both hold for the same post, so they're separated by scope.
 */
describe("rankForYou — brand-new posts pin to the top", () => {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it("puts a just-posted item above a viral old one, whatever the seed", () => {
    // The case a score-based freshness bonus loses: `quality` is unbounded, so
    // a big enough old post outbids any fixed bonus. A hard tier cannot be outbid.
    const rows = [
      makeRow({ id: "viral-old", likes_count: 100_000, created_at: SHARED_CREATED_AT }),
      makeRow({ id: "just-posted", likes_count: 0, created_at: minsAgo(1) }),
    ];
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      expect(rankForYou(rows, new Set(), undefined, seed)[0]?.id).toBe("just-posted");
    }
  });

  it("orders several brand-new posts newest-first, not by score", () => {
    const rows = [
      makeRow({ id: "new-oldest", likes_count: 900, created_at: minsAgo(20) }),
      makeRow({ id: "new-newest", likes_count: 0, created_at: minsAgo(1) }),
      makeRow({ id: "new-middle", likes_count: 400, created_at: minsAgo(10) }),
    ];
    expect(rankForYou(rows, new Set(), undefined, "seed").map((r) => r.id)).toEqual([
      "new-newest",
      "new-middle",
      "new-oldest",
    ]);
  });

  it("does not pin a post older than the 30-minute window", () => {
    const rows = [
      makeRow({ id: "strong-old", likes_count: 900, created_at: SHARED_CREATED_AT }),
      makeRow({ id: "weak-stale", likes_count: 0, created_at: minsAgo(45) }),
    ];
    // 45min is outside the window, so normal scoring decides — the strong post wins.
    expect(rankForYou(rows, new Set(), undefined)[0]?.id).toBe("strong-old");
  });

  it("still reshuffles the non-pinned tail while a new post holds the top", () => {
    const rows = [
      makeRow({ id: "fresh", created_at: minsAgo(2) }),
      ...Array.from({ length: 30 }, (_, i) => makeRow({ id: `old${i}`, likes_count: 50, created_at: SHARED_CREATED_AT })),
    ];
    const a = rankForYou(rows, new Set(), undefined, "seed-a").map((r) => r.id);
    const b = rankForYou(rows, new Set(), undefined, "seed-b").map((r) => r.id);
    expect(a[0]).toBe("fresh");
    expect(b[0]).toBe("fresh");
    // ...but everything under it still re-orders between refreshes.
    expect(a.slice(1)).not.toEqual(b.slice(1));
  });

  it("keeps pagination consistent — pinning must not drop or duplicate", () => {
    const rows = [
      makeRow({ id: "fresh", created_at: minsAgo(3) }),
      ...Array.from({ length: 20 }, (_, i) => makeRow({ id: `old${i}`, created_at: SHARED_CREATED_AT })),
    ];
    const ranked = rankForYou(rows, new Set(), undefined, "seed");
    expect(ranked).toHaveLength(21);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(21);
  });
});
