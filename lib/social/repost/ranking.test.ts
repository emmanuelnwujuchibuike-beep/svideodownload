import { describe, expect, it } from "vitest";

import {
  capReposts,
  DEFAULT_LIMITS,
  rankReposts,
  repostSlots,
  scoreRepost,
  type RankingContext,
  type RepostCandidate,
} from "@/lib/social/repost/ranking";

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;

const candidate = (over: Partial<RepostCandidate> = {}): RepostCandidate => ({
  repostId: "r1",
  postId: "p1",
  reposterId: "u1",
  creatorId: "c1",
  createdAt: NOW - HOUR,
  audience: "public",
  hasCaption: false,
  reposterCount: 1,
  sourceRepostId: null,
  category: null,
  ...over,
});

const ctx = (over: Partial<RankingContext> = {}): RankingContext => ({
  strength: new Map(),
  mutualFriends: new Map(),
  closeFriends: new Set(),
  interests: new Set(),
  followedCreators: new Set(),
  reputation: new Map(),
  excludedPostIds: new Set(),
  dismissedPostIds: new Set(),
  now: NOW,
  ...over,
});

describe("scoreRepost", () => {
  it("makes the relationship the largest single term", () => {
    const strong = scoreRepost(candidate(), ctx({ strength: new Map([["u1", 100]]) }));
    const weak = scoreRepost(candidate(), ctx({ strength: new Map([["u1", 0]]) }));
    expect(strong.score).toBeGreaterThan(weak.score + 25);
  });

  it("🔴 treats reputation as a multiplier, so it can never outrank a close friend", () => {
    // The brief's own priority order: friends first, algorithms third. As an
    // additive term a high-reputation stranger would win this comparison.
    const friend = scoreRepost(
      candidate({ reposterId: "friend" }),
      ctx({ strength: new Map([["friend", 90]]), closeFriends: new Set(["friend"]) }),
    );
    const reputable = scoreRepost(
      candidate({ reposterId: "star" }),
      ctx({ strength: new Map([["star", 10]]), reputation: new Map([["star", 100]]) }),
    );
    expect(friend.score).toBeGreaterThan(reputable.score);
  });

  it("treats an unknown reputation as neutral, not as zero", () => {
    const unknown = scoreRepost(candidate(), ctx({ strength: new Map([["u1", 60]]) }));
    const midpoint = scoreRepost(
      candidate(),
      ctx({ strength: new Map([["u1", 60]]), reputation: new Map([["u1", 50]]) }),
    );
    expect(unknown.score).toBeCloseTo(midpoint.score, 5);
  });

  it("values two independent reposters above one", () => {
    const one = scoreRepost(candidate({ reposterCount: 1 }), ctx());
    const four = scoreRepost(candidate({ reposterCount: 4 }), ctx());
    expect(four.score).toBeGreaterThan(one.score);
  });

  it("penalises a creator the viewer already follows", () => {
    const discovery = scoreRepost(candidate(), ctx({ strength: new Map([["u1", 50]]) }));
    const alreadyFollowed = scoreRepost(
      candidate(),
      ctx({ strength: new Map([["u1", 50]]), followedCreators: new Set(["c1"]) }),
    );
    expect(alreadyFollowed.score).toBeLessThan(discovery.score);
  });

  it("decays with age but never to nothing", () => {
    const fresh = scoreRepost(candidate({ createdAt: NOW }), ctx({ strength: new Map([["u1", 80]]) }));
    const old = scoreRepost(candidate({ createdAt: NOW - 400 * HOUR }), ctx({ strength: new Map([["u1", 80]]) }));
    expect(old.score).toBeLessThan(fresh.score);
    expect(old.score).toBeGreaterThan(fresh.score * 0.5);
  });

  it("emits the signals that produced the score, biggest first", () => {
    const r = scoreRepost(
      candidate({ reposterCount: 6, category: "music", sourceRepostId: "r0" }),
      ctx({
        strength: new Map([["u1", 90]]),
        closeFriends: new Set(["u1"]),
        interests: new Set(["music"]),
        mutualFriends: new Map([["u1", 12]]),
      }),
    );
    expect(r.signals[0]?.kind).toBe("close_friend");
    expect(r.signals.map((s) => s.kind)).toContain("second_degree");
    for (let i = 1; i < r.signals.length; i++) {
      expect(r.signals[i - 1]!.weight).toBeGreaterThanOrEqual(r.signals[i]!.weight);
    }
  });
});

describe("rankReposts exclusions", () => {
  it("🔴 drops excluded and dismissed posts rather than ranking them low", () => {
    // A low-ranked exclusion resurfaces on a quiet day. It must not be a
    // candidate at all.
    const out = rankReposts(
      [candidate({ postId: "seen" }), candidate({ repostId: "r2", postId: "nope" })],
      ctx({ excludedPostIds: new Set(["seen"]), dismissedPostIds: new Set(["nope"]) }),
    );
    expect(out).toHaveLength(0);
  });

  it("never distributes a private repost", () => {
    expect(rankReposts([candidate({ audience: "private" })], ctx())).toHaveLength(0);
  });

  it("is deterministic when scores tie", () => {
    const a = candidate({ repostId: "aaa", postId: "p1" });
    const b = candidate({ repostId: "bbb", postId: "p2" });
    const first = rankReposts([a, b], ctx()).map((r) => r.candidate.repostId);
    const second = rankReposts([b, a], ctx()).map((r) => r.candidate.repostId);
    expect(first).toEqual(second);
  });
});

describe("capReposts — the anti-flood rules", () => {
  const ranked = (ids: [string, string, string, string][]) =>
    ids.map(([repostId, postId, reposterId, creatorId], i) => ({
      candidate: candidate({ repostId, postId, reposterId, creatorId }),
      score: 100 - i,
      signals: [],
    }));

  it("caps the page", () => {
    const out = capReposts(
      ranked([
        ["r1", "p1", "u1", "c1"],
        ["r2", "p2", "u2", "c2"],
        ["r3", "p3", "u3", "c3"],
      ]),
    );
    expect(out).toHaveLength(DEFAULT_LIMITS.maxPerPage);
  });

  it("🔴 one person cannot own the page", () => {
    const out = capReposts(
      ranked([
        ["r1", "p1", "u1", "c1"],
        ["r2", "p2", "u1", "c2"],
      ]),
    );
    expect(out).toHaveLength(1);
  });

  it("one creator cannot own the page either", () => {
    const out = capReposts(
      ranked([
        ["r1", "p1", "u1", "c1"],
        ["r2", "p2", "u2", "c1"],
      ]),
    );
    expect(out).toHaveLength(1);
  });

  it("the same post reposted by three people is still one item", () => {
    const out = capReposts(
      ranked([
        ["r1", "p1", "u1", "c1"],
        ["r2", "p1", "u2", "c1"],
        ["r3", "p1", "u3", "c1"],
      ]),
    );
    expect(out).toHaveLength(1);
  });

  it("keeps a person's BEST repost, not their most recent", () => {
    // Capping before scoring would have kept whichever came first.
    const out = capReposts([
      { candidate: candidate({ repostId: "best", postId: "p1", reposterId: "u1" }), score: 90, signals: [] },
      { candidate: candidate({ repostId: "meh", postId: "p2", reposterId: "u1" }), score: 10, signals: [] },
    ]);
    expect(out.map((r) => r.candidate.repostId)).toEqual(["best"]);
  });
});

describe("repostSlots", () => {
  it("🔴 never puts a repost first — that reads as an ad", () => {
    expect(repostSlots(10, 2)[0]!).toBeGreaterThan(0);
  });

  it("never places two reposts adjacent", () => {
    const slots = repostSlots(10, 3);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]! - slots[i - 1]!).toBeGreaterThan(1);
    }
  });

  it("returns nothing when there is nothing to interleave", () => {
    expect(repostSlots(0, 3)).toEqual([]);
    expect(repostSlots(10, 0)).toEqual([]);
  });

  it("stops before running off the end of a short page", () => {
    expect(repostSlots(2, 5).every((s) => s <= 7)).toBe(true);
  });
});
