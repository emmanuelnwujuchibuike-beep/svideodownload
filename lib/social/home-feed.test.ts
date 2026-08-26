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
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

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

  it("preferFriends (25→46 relationship bonus) is large enough to flip a ranking the default bonus wouldn't", () => {
    const friend = makeRow({ id: "friend-post", publisher_id: "friend", likes_count: 0 });
    const stranger = makeRow({ id: "stranger-post", publisher_id: "stranger", likes_count: 150 });
    const withoutPref = rankForYou([friend, stranger], new Set(["friend"]), { preferFriends: false, boostedCategories: [] });
    const withPref = rankForYou([friend, stranger], new Set(["friend"]), { preferFriends: true, boostedCategories: [] });
    expect(withoutPref[0]?.publisher_id).toBe("stranger"); // 25 bonus loses to a 150-like gap
    expect(withPref[0]?.publisher_id).toBe("friend"); // 46 bonus wins
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

  it("engagement is a strong BIAS, not a guarantee — a banger averages the top of the feed", () => {
    /*
      🔴 This replaced "a strong post stays on top, whatever the seed"
      (2026-08-26). That assertion was true of the OLD scoring, where `quality`
      was raw and unbounded, and it is exactly what had to go: if a 100x
      engagement gap is unbridgeable then so is a 100x gap between an old viral
      post and today's, and the feed can never reshuffle across ages.

      What is asserted instead is the property that actually matters — a strong
      post is favoured HEAVILY on average, but is not nailed to slot one.
    */
    const rows = [...many(), makeRow({ id: "banger", likes_count: 5000 })];
    const ranks = Array.from({ length: 60 }, (_, i) =>
      rankForYou(rows, new Set(), undefined, `s${i}`).findIndex((r) => r.id === "banger"),
    );
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    // Chance alone would average 20 of 41. Measured 2026-08-26: ~9.5.
    expect(mean, "engagement stopped mattering — the feed became a lottery").toBeLessThan(15);
    // ...and it genuinely does reach the top, often.
    expect(ranks.filter((r) => r < 10).length / ranks.length).toBeGreaterThan(0.33);
  });

  /*
    🔴 REGRESSION GUARD for the jitter hash itself (2026-08-26).

    `seededUnit` was plain FNV-1a with no final avalanche, so ids sharing a
    prefix and differing only in their LAST character hashed into a band ~0.04
    wide — and to only 18 distinct orders across 200 seeds. Fixture ids look
    exactly like that, which is why an earlier attempt at this change saw two
    different seeds produce an identical order and mistook a hash defect for a
    ranking bug. Production ids are `uuid_generate_v4()` so the live feed was
    never affected, and that is precisely why only a test can catch a
    regression here.
  */
  it("the jitter hash does not collapse for ids differing only in the last character", () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ id: `q${i}`, created_at: daysAgo(i) }));
    const orders = new Set(
      Array.from({ length: 200 }, (_, i) =>
        rankForYou(rows, new Set(), undefined, `seed-${i}`).map((r) => r.id).join(","),
      ),
    );
    // Pre-fix this was 18. Anything near that means the avalanche is gone.
    expect(orders.size, "the seeded jitter has collapsed into a handful of orders").toBeGreaterThan(100);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FEED RESHUFFLES ACROSS THE WHOLE CATALOGUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-26: "feed should show random videos from older to newer every
 * time a user first enters the feed … it shouldnt show a fixed new post … after
 * a refresh it should show a reshuffled post from oldest to new, from the first
 * post to the new post every refresh and first entry".
 *
 * 🔴 THIS SUITE REPLACES TWO EARLIER ONES — "brand-new posts pin to the top"
 * and "day bucket beats quality across days" — which pinned the OPPOSITE
 * behaviour, from the owner's own earlier instructions. Both are described here
 * so nobody restores them as a bug fix:
 *
 *   • a brand-new post hard-pinned above everything for 30 minutes, on EVERY
 *     request;
 *   • a post could never outrank one from a newer DAY, at any score.
 *
 * Together those put the same newest post at the top of every entry and
 * confined the shuffle to within a single day — the "feed shows one post every
 * time I enter" being reported. The pin survives ONLY as the opt-in `pinNew`
 * flag, covered at the bottom of this file.
 */
describe("rankForYou — reshuffles across the whole catalogue", () => {
  it("🔴 does NOT always put the newest post first", () => {
    // The core of the complaint. A fresh post is still favoured by `freshness`
    // and `momentum`, but it is no longer GUARANTEED the top slot, so across a
    // spread of seeds the leader genuinely varies.
    const rows = [
      makeRow({ id: "new", created_at: daysAgo(0) }),
      makeRow({ id: "old-a", created_at: daysAgo(6), likes_count: 900 }),
      makeRow({ id: "old-b", created_at: daysAgo(12), likes_count: 1200 }),
    ];
    const leaders = new Set(
      Array.from({ length: 60 }, (_, i) => rankForYou(rows, new Set(), undefined, `s${i}`)[0]!.id),
    );
    expect(leaders.size, "the same post led every seed — the feed is fixed").toBeGreaterThan(1);
  });

  it("🔴 lets an OLDER post appear above a newer one", () => {
    // The day-bucket tier made this impossible at any score. "From oldest to
    // new" requires it to be possible.
    const rows = [
      makeRow({ id: "newer", created_at: daysAgo(1) }),
      makeRow({ id: "older", created_at: daysAgo(9), likes_count: 5000 }),
    ];
    const sawOlderFirst = Array.from({ length: 60 }, (_, i) =>
      rankForYou(rows, new Set(), undefined, `seed-${i}`),
    ).some((r) => r[0]!.id === "older");
    expect(sawOlderFirst, "an older post can never reach the top").toBe(true);
  });

  it("draws the top of the feed from the WHOLE age range, not just the newest days", () => {
    /*
      The property the owner is actually describing, measured rather than
      asserted anecdotally: 20 posts spanning 20 days, with engagement
      correlated to age the way a real catalogue's is.

      A day-bucketed sort puts days 0-4 in the top five 100% of the time.
      Measured after this change (2026-08-26): 36% / 31% / 19% / 14% across the
      four five-day bands, mean top-five age 7.6 days of a 0-19 range.
    */
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ id: `d${i}`, created_at: daysAgo(i), likes_count: i * 40 }),
    );
    const topAges: number[] = [];
    for (let n = 0; n < 60; n++) {
      const order = rankForYou(rows, new Set(), undefined, `real${n}`).map((r) => Number(r.id.slice(1)));
      topAges.push(...order.slice(0, 5));
    }
    const oldHalf = topAges.filter((a) => a >= 10).length / topAges.length;
    expect(oldHalf, "the older half of the catalogue never reaches the top five").toBeGreaterThan(0.15);
    const mean = topAges.reduce((a, b) => a + b, 0) / topAges.length;
    expect(mean, "the top of the feed is still clustered on the newest days").toBeGreaterThan(4);
    // ...but recency is still a real bias, not a coin flip (uniform would be 9.5).
    expect(mean, "recency stopped mattering entirely").toBeLessThan(9.5);
  });

  it("still reshuffles between refreshes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ id: `q${i}`, created_at: daysAgo(i) }));
    const a = rankForYou(rows, new Set(), undefined, "seed-a").map((r) => r.id);
    const b = rankForYou(rows, new Set(), undefined, "seed-b").map((r) => r.id);
    expect(a).not.toEqual(b);
  });

  it("is DETERMINISTIC for one seed, so pages of the same refresh agree", () => {
    // Page 2 must continue page 1's order rather than re-roll it — otherwise
    // offset pagination duplicates some posts and drops others.
    const rows = Array.from({ length: 8 }, (_, i) => makeRow({ id: `r${i}`, created_at: daysAgo(i) }));
    const first = rankForYou(rows, new Set(), undefined, "same").map((r) => r.id);
    const second = rankForYou(rows, new Set(), undefined, "same").map((r) => r.id);
    expect(first).toEqual(second);
  });

  it("engagement still decides between posts of the SAME age", () => {
    // Reshuffling must not become a lottery: with age held equal, quality wins.
    const rows = [
      makeRow({ id: "dead", created_at: daysAgo(3), likes_count: 0 }),
      makeRow({ id: "viral", created_at: daysAgo(3), likes_count: 10_000 }),
    ];
    expect(rankForYou(rows, new Set()).map((r) => r.id)).toEqual(["viral", "dead"]);
  });

  it("keeps every post exactly once across the whole catalogue", () => {
    const rows = Array.from({ length: 25 }, (_, i) => makeRow({ id: `k${i}`, created_at: daysAgo(i) }));
    const ranked = rankForYou(rows, new Set(), undefined, "seed");
    expect(ranked).toHaveLength(25);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(25);
  });
});

/**
 * The one surviving pin, and it is now OPT-IN (`pinNew`).
 *
 * Only the "N new posts" pill passes it, because that pill is the only place
 * the viewer has been promised specific posts and would rightly call it broken
 * not to see them. Entry, pull-to-refresh and pagination all reshuffle instead
 * — which is what stops the feed looking frozen on every visit.
 */
describe("rankForYou — the new-post pin is opt-in", () => {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const withFresh = () => [
    makeRow({ id: "fresh", created_at: minsAgo(2) }),
    ...Array.from({ length: 30 }, (_, i) => makeRow({ id: `o${i}`, likes_count: 50 })),
  ];

  it("pinNew=true puts the just-posted item on top, whatever the seed", () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
      expect(rankForYou(withFresh(), new Set(), undefined, seed, true)[0]?.id).toBe("fresh");
    }
  });

  it("pinNew=true beats a viral old post that would otherwise outscore it", () => {
    const rows = [
      makeRow({ id: "viral-old", likes_count: 100_000, created_at: SHARED_CREATED_AT }),
      makeRow({ id: "just-posted", likes_count: 0, created_at: minsAgo(1) }),
    ];
    for (const seed of ["s1", "s2", "s3"]) {
      expect(rankForYou(rows, new Set(), undefined, seed, true)[0]?.id).toBe("just-posted");
    }
  });

  it("orders several pinned posts newest-first, not by score", () => {
    const rows = [
      makeRow({ id: "new-oldest", likes_count: 900, created_at: minsAgo(20) }),
      makeRow({ id: "new-newest", likes_count: 0, created_at: minsAgo(1) }),
      makeRow({ id: "new-middle", likes_count: 400, created_at: minsAgo(10) }),
    ];
    expect(rankForYou(rows, new Set(), undefined, "seed", true).map((r) => r.id)).toEqual([
      "new-newest",
      "new-middle",
      "new-oldest",
    ]);
  });

  it("🔴 DEFAULTS OFF — a plain refresh does not re-pin the same new post", () => {
    // The regression that produced "the feed shows one post every time I enter
    // the feed". If this ever goes back to pinning by default, that returns.
    const pinned = Array.from({ length: 40 }, (_, i) =>
      rankForYou(withFresh(), new Set(), undefined, `s${i}`)[0]!.id,
    ).filter((id) => id === "fresh").length;
    expect(pinned, "an unpinned refresh still anchors on the newest post").toBeLessThan(20);
  });

  it("still reshuffles the tail while a pinned post holds the top", () => {
    const rows = withFresh();
    const a = rankForYou(rows, new Set(), undefined, "seed-a", true).map((r) => r.id);
    const b = rankForYou(rows, new Set(), undefined, "seed-b", true).map((r) => r.id);
    expect(a[0]).toBe("fresh");
    expect(b[0]).toBe("fresh");
    expect(a.slice(1)).not.toEqual(b.slice(1));
  });

  it("keeps pagination consistent — pinning must not drop or duplicate", () => {
    const ranked = rankForYou(withFresh(), new Set(), undefined, "seed", true);
    expect(ranked).toHaveLength(31);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(31);
  });
});
