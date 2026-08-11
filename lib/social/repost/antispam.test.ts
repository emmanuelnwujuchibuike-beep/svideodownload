import { describe, expect, it } from "vitest";

import { checkRepostSpam, LIMITS, type AntiSpamInput, type RepostHistoryEntry } from "@/lib/social/repost/antispam";

const NOW = 1_760_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** n reposts, evenly spaced over `spanMs` ending just now. */
function history(n: number, spanMs: number, over: Partial<RepostHistoryEntry> = {}): RepostHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    postId: `p${i}`,
    creatorId: `c${i}`,
    createdAt: NOW - Math.round((spanMs * i) / Math.max(1, n)),
    hasCaption: true,
    ...over,
  }));
}

const input = (over: Partial<AntiSpamInput> = {}): AntiSpamInput => ({
  recent: [],
  repeatsOfTarget: 0,
  targetCreatorId: "target",
  now: NOW,
  ...over,
});

describe("checkRepostSpam", () => {
  it("allows ordinary use", () => {
    const r = checkRepostSpam(input({ recent: history(6, 8 * HOUR) }));
    expect(r.verdict).toBe("allow");
    expect(r.reasons).toEqual([]);
  });

  it("blocks a burst and says when it clears", () => {
    const r = checkRepostSpam(input({ recent: history(LIMITS.burstMax, 2 * MIN) }));
    expect(r.verdict).toBe("block");
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(LIMITS.burstWindowMs);
  });

  it("does not count reposts outside the burst window", () => {
    // Same volume, spread over a working day — a very active member, not a bot.
    expect(checkRepostSpam(input({ recent: history(LIMITS.burstMax, 9 * HOUR) })).verdict).not.toBe("block");
  });

  it("blocks at the daily ceiling", () => {
    const r = checkRepostSpam(input({ recent: history(LIMITS.dailyMax, 20 * HOUR) }));
    expect(r.verdict).toBe("block");
  });

  it("blocks repost/undo farming of one post", () => {
    const r = checkRepostSpam(input({ repeatsOfTarget: LIMITS.repeatMax }));
    expect(r.verdict).toBe("block");
    // 🔴 No retry timer: this is about one post, not a rate. A timer would read
    // as a global lockout when everything else is still available.
    expect(r.retryAfterMs).toBeUndefined();
  });

  it("🔴 THROTTLES rather than blocks when one creator dominates", () => {
    // Throttle is the important verdict: it costs a spammer reach and is
    // invisible to a member who simply likes one creator a lot.
    const r = checkRepostSpam(
      input({
        recent: history(10, 6 * HOUR).map((e) => ({ ...e, creatorId: "target" })),
        targetCreatorId: "target",
      }),
    );
    expect(r.verdict).toBe("throttle");
    expect(r.retryAfterMs).toBeUndefined();
  });

  it("does not throttle a varied recent history", () => {
    expect(checkRepostSpam(input({ recent: history(10, 6 * HOUR) })).verdict).toBe("allow");
  });

  it("throttles high volume with not one recommendation attached", () => {
    const r = checkRepostSpam(
      input({ recent: history(LIMITS.uncaptionedDailyMax, 10 * HOUR, { hasCaption: false }) }),
    );
    expect(r.verdict).toBe("throttle");
  });

  it("leaves captioned volume alone", () => {
    const r = checkRepostSpam(input({ recent: history(LIMITS.uncaptionedDailyMax, 10 * HOUR, { hasCaption: true }) }));
    expect(r.verdict).toBe("allow");
  });

  it("🔴 a block outranks a throttle, and both reasons are still reported", () => {
    // A member told only the first of two problems fixes one and hits the next.
    const r = checkRepostSpam(
      input({
        recent: history(LIMITS.burstMax, 2 * MIN, { hasCaption: false, creatorId: "target" }),
        targetCreatorId: "target",
      }),
    );
    expect(r.verdict).toBe("block");
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it("never names another account in a reason shown to the member", () => {
    const r = checkRepostSpam(
      input({ recent: history(10, 6 * HOUR).map((e) => ({ ...e, creatorId: "target" })), targetCreatorId: "target" }),
    );
    for (const reason of r.reasons) expect(reason).not.toContain("target");
  });
});
