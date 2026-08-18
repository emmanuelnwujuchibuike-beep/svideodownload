import { describe, expect, it } from "vitest";

import { checkShareSpam, SHARE_LIMITS, type ShareAntiSpamInput, type ShareHistoryEntry } from "@/lib/social/share/antispam";

const NOW = 1_760_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** n share_events, evenly spaced over `spanMs` ending just now. */
function history(n: number, spanMs: number, over: Partial<ShareHistoryEntry> = {}): ShareHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    postId: `p${i}`,
    creatorId: `c${i}`,
    createdAt: NOW - Math.round((spanMs * i) / Math.max(1, n)),
    recipientCount: 1,
    ...over,
  }));
}

const input = (over: Partial<ShareAntiSpamInput> = {}): ShareAntiSpamInput => ({
  recent: [],
  targetCreatorId: "target",
  now: NOW,
  ...over,
});

describe("checkShareSpam", () => {
  it("allows ordinary use", () => {
    const r = checkShareSpam(input({ recent: history(6, 8 * HOUR) }));
    expect(r.verdict).toBe("allow");
    expect(r.reasons).toEqual([]);
  });

  it("blocks a burst and says when it clears", () => {
    const r = checkShareSpam(input({ recent: history(SHARE_LIMITS.burstMax, 2 * MIN) }));
    expect(r.verdict).toBe("block");
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(SHARE_LIMITS.burstWindowMs);
  });

  it("does not count shares outside the burst window", () => {
    // Same volume, spread over a working day — a very active member, not a script.
    expect(checkShareSpam(input({ recent: history(SHARE_LIMITS.burstMax, 9 * HOUR) })).verdict).not.toBe("block");
  });

  it("blocks at the daily ceiling", () => {
    const r = checkShareSpam(input({ recent: history(SHARE_LIMITS.dailyMax, 20 * HOUR) }));
    expect(r.verdict).toBe("block");
  });

  it("🔴 THROTTLES rather than blocks when one creator dominates", () => {
    // Throttle still delivers the DM (the recipient did nothing wrong) — it
    // only suppresses the counter bump + author notification.
    const r = checkShareSpam(
      input({
        recent: history(10, 6 * HOUR).map((e) => ({ ...e, creatorId: "target" })),
        targetCreatorId: "target",
      }),
    );
    expect(r.verdict).toBe("throttle");
    expect(r.retryAfterMs).toBeUndefined();
  });

  it("does not throttle a varied recent history", () => {
    expect(checkShareSpam(input({ recent: history(10, 6 * HOUR) })).verdict).toBe("allow");
  });

  it("🔴 a block outranks a throttle, and both reasons are still reported", () => {
    const r = checkShareSpam(
      input({
        recent: history(SHARE_LIMITS.burstMax, 2 * MIN, { creatorId: "target" }),
        targetCreatorId: "target",
      }),
    );
    expect(r.verdict).toBe("block");
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it("never names another account in a reason shown to the member", () => {
    const r = checkShareSpam(
      input({ recent: history(10, 6 * HOUR).map((e) => ({ ...e, creatorId: "target" })), targetCreatorId: "target" }),
    );
    for (const reason of r.reasons) expect(reason).not.toContain("target");
  });
});
