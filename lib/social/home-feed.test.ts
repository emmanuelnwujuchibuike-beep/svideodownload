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
const SHARED_CREATED_AT = new Date().toISOString();

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
