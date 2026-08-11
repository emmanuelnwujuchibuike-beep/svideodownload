import { describe, expect, it } from "vitest";

import type { RepostSignal } from "@/lib/social/repost/ranking";
import { describeSignals, repostReason, type ReasonInput } from "@/lib/social/repost/reason";

const sig = (kind: RepostSignal["kind"], weight: number): RepostSignal => ({ kind, weight });

const input = (over: Partial<ReasonInput> = {}): ReasonInput => ({
  signals: [],
  reposterNames: ["Chris"],
  reposterCount: 1,
  ...over,
});

describe("repostReason", () => {
  it("names the one person who reposted it", () => {
    const r = repostReason(input())!;
    expect(r.kind).toBe("one_reposter");
    expect(r.text).toBe("Chris reposted this.");
  });

  it("spells small counts, so it reads as a sentence not a metric", () => {
    expect(repostReason(input({ reposterNames: ["Chris"], reposterCount: 3 }))!.text).toBe(
      "Chris and two others reposted this.",
    );
    expect(repostReason(input({ reposterCount: 5 }))!.text).toBe("Five people you follow reposted this.");
  });

  it("uses the singular 'other' for exactly two", () => {
    expect(repostReason(input({ reposterCount: 2 }))!.text).toBe("Chris and one other reposted this.");
  });

  it("🔴 puts the relationship ahead of the algorithm, even when interest scored higher", () => {
    // "Friends first. Creators second. Algorithms third." A close friend's
    // recommendation is never described as "popular with people like you".
    const r = repostReason(
      input({
        signals: [sig("shared_interest", 40), sig("close_friend", 8)],
        categoryLabel: "skateboarding",
      }),
    )!;
    expect(r.kind).toBe("close_friend");
    expect(r.text).toContain("close friends");
  });

  it("explains a second-degree arrival only when provenance actually recorded one", () => {
    expect(repostReason(input({ signals: [sig("second_degree", 4)] }))!.kind).toBe("second_degree");
    expect(repostReason(input({ signals: [] }))!.kind).toBe("one_reposter");
  });

  it("🔴 says nothing rather than inventing a reason", () => {
    // No nameable reposter and no interest signal is a real, common state. The
    // honest output is null — a placeholder here would be fabricated proof.
    expect(repostReason(input({ reposterNames: [], reposterCount: 0 }))).toBeNull();
  });

  it("falls back to interest only when interest is genuinely the top signal", () => {
    const r = repostReason(
      input({ reposterNames: [], reposterCount: 0, signals: [sig("shared_interest", 8)], categoryLabel: "music" }),
    )!;
    expect(r.kind).toBe("shared_interest");
    expect(r.text).toContain("music");
  });

  it("🔴 keeps emoji out of the sentence, which is also the accessible name", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const count of [1, 2, 5, 9]) {
      const r = repostReason(input({ reposterCount: count }))!;
      expect(emoji.test(r.text)).toBe(false);
      expect(r.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe("describeSignals", () => {
  it("lists one fact per contributing signal, in weight order", () => {
    const lines = describeSignals(
      input({ signals: [sig("close_friend", 30), sig("many_reposters", 10)], reposterCount: 4 }),
    );
    expect(lines[0]!).toContain("close friends");
    expect(lines[1]!).toContain("4 people");
  });

  it("🔴 always states the two privacy promises the ranking makes", () => {
    const lines = describeSignals(input());
    expect(lines.at(-1)).toContain("location is never used");
    expect(lines.at(-1)).toContain("nobody is told that you saw this");
  });
});
