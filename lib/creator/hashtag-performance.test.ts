import { describe, expect, it } from "vitest";

import {
  applyTags,
  extractTags,
  rankTagPerformance,
  type TaggedPost,
} from "@/lib/creator/hashtag-performance";

describe("extractTags", () => {
  it("finds tags anywhere in the text", () => {
    expect(extractTags("a #one mid #two").map((t) => t.key)).toEqual(["one", "two"]);
  });

  it("de-dupes per post, so a caption spamming one tag counts once", () => {
    expect(extractTags("#same #same #same")).toHaveLength(1);
  });

  it("keeps first-seen casing but groups case-insensitively", () => {
    const [tag] = extractTags("#SummerVibes and #summervibes");
    expect(tag!.display).toBe("SummerVibes");
    expect(tag!.key).toBe("summervibes");
  });

  it("is unicode-aware, matching the search index's own regex", () => {
    expect(extractTags("#عيد #夏祭 #tech").map((t) => t.key)).toEqual(["عيد", "夏祭", "tech"]);
  });

  it("applies the same two-character floor the search index applies", () => {
    // `#夏` is a single character and lib/social/hashtags.ts cannot find it
    // either. Scoring a tag search can never surface would be worse than
    // skipping it — the two regexes have to agree.
    expect(extractTags("#夏")).toEqual([]);
  });

  it("ignores a bare hash and a single character", () => {
    expect(extractTags("# #a")).toEqual([]);
  });
});

describe("rankTagPerformance", () => {
  const posts: TaggedPost[] = [
    { id: "1", title: "a #dance", views: 1000, engagement: 100 },
    { id: "2", title: "b #dance", views: 3000, engagement: 200 },
    { id: "3", title: "c #rare", views: 5000, engagement: 400 },
    { id: "4", title: "d", description: "in the description #tech", views: 100, engagement: 5 },
  ];

  it("counts tags from the description too — search reads both fields", () => {
    expect(rankTagPerformance(posts).map((t) => t.tag)).toContain("tech");
  });

  it("🔴 ranks by AVERAGE views, so a tag on many posts cannot win on volume alone", () => {
    const ranked = rankTagPerformance(posts);
    // #dance has 4000 total views across 2 posts; #rare has 5000 across 1.
    // Ranking on totals would put #dance below #rare anyway, so use a case
    // where totals and averages actually disagree:
    const conflicting = rankTagPerformance([
      { id: "1", title: "#big", views: 100, engagement: 1 },
      { id: "2", title: "#big", views: 100, engagement: 1 },
      { id: "3", title: "#big", views: 100, engagement: 1 },
      { id: "4", title: "#sharp", views: 250, engagement: 1 },
    ]);
    expect(conflicting[0]!.tag).toBe("sharp");
    expect(conflicting.find((t) => t.tag === "big")!.totalViews).toBe(300);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("reports the post count beside the average, so thin evidence is visible", () => {
    const dance = rankTagPerformance(posts).find((t) => t.tag === "dance")!;
    expect(dance.posts).toBe(2);
    expect(dance.totalViews).toBe(4000);
    expect(dance.averageViews).toBe(2000);
    expect(dance.averageEngagement).toBe(150);
  });

  it("is stable across equal averages", () => {
    const a = rankTagPerformance([
      { id: "1", title: "#zeta", views: 10, engagement: 1 },
      { id: "2", title: "#alpha", views: 10, engagement: 1 },
    ]);
    expect(a.map((t) => t.tag)).toEqual(["alpha", "zeta"]);
  });

  it("returns nothing for untagged posts", () => {
    expect(rankTagPerformance([{ id: "1", title: "no tags here", views: 9, engagement: 1 }])).toEqual([]);
  });
});

describe("applyTags", () => {
  it("appends tags to a caption that had none", () => {
    expect(applyTags("A caption", ["one", "two"])).toBe("A caption\n\n#one #two");
  });

  it("replaces the existing tag set without eating the words around it", () => {
    expect(applyTags("Great trip #old #stale", ["new"])).toBe("Great trip\n\n#new");
  });

  it("pulls a mid-sentence tag out and leaves the sentence readable", () => {
    expect(applyTags("the #beach was lovely", ["sea"])).toBe("the was lovely\n\n#sea");
  });

  it("does not accumulate blank lines when tags are edited repeatedly", () => {
    let caption = "Body text";
    for (const round of [["aa"], ["bb"], ["cc"]]) caption = applyTags(caption, round);
    expect(caption).toBe("Body text\n\n#cc");
  });

  it("accepts tags written with or without the hash", () => {
    expect(applyTags("x", ["#one", "two"])).toBe("x\n\n#one #two");
  });

  it("drops invalid tags rather than writing a broken one into the caption", () => {
    // "a" is a single character — below the two-character floor the search
    // regex enforces. A tag nothing could ever find must not be written either.
    expect(applyTags("x", ["ok", "no spaces", "!", "a"])).toBe("x\n\n#ok");
  });

  it("de-dupes case-insensitively, keeping the creator's casing", () => {
    expect(applyTags("x", ["Dance", "dance"])).toBe("x\n\n#Dance");
  });

  it("clears the tags entirely when given none", () => {
    expect(applyTags("Body #aa #bb", [])).toBe("Body");
  });

  it("produces a tags-only caption when there is no body", () => {
    expect(applyTags("#old", ["new"])).toBe("#new");
  });

  it("🔴 writes tags back where search actually reads them", () => {
    // The whole point: the edited caption must still parse back to the same
    // tags, because the caption IS the index.
    const caption = applyTags("Trip to the coast", ["Sea", "Summer"]);
    expect(extractTags(caption).map((t) => t.key)).toEqual(["sea", "summer"]);
  });
});
