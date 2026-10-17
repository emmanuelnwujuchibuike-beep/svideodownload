import { describe, expect, it } from "vitest";

import { normalizeRewardsConfig, REWARDS_DEFAULTS, type RewardsConfig } from "@/lib/rewards/config";

import { cashOutLine, earnOpportunities } from "./earn";

const cfg = (patch: (c: RewardsConfig) => void): RewardsConfig => {
  const c = structuredClone(REWARDS_DEFAULTS);
  patch(c);
  return c;
};

describe("anonymous Profile: earning copy comes only from the live reward rules", () => {
  it("Rewards v2 defaults: joining and inviting, with their real amounts — no AI-creation or download rewards", () => {
    const items = earnOpportunities(normalizeRewardsConfig(null));
    const ids = items.map((i) => i.id);
    expect(ids).toContain("account_created");
    expect(ids).toContain("referrals");
    expect(ids).not.toContain("ai_video_completed");
    expect(ids).not.toContain("download_completed");
    expect(items.find((i) => i.id === "account_created")!.body).toContain(`${REWARDS_DEFAULTS.events.account_created.actorCredits} credits`);
  });

  it("a switched-off event is never mentioned, and a switched-on one uses the configured number", () => {
    const off = earnOpportunities(cfg((c) => (c.events.ai_video_completed.enabled = false)));
    expect(off.map((i) => i.id)).not.toContain("ai_video_completed");
    const dl = earnOpportunities(cfg((c) => (c.events.download_completed = { ...c.events.download_completed, enabled: true, actorCredits: 7 })));
    expect(dl.find((i) => i.id === "download_completed")?.body).toContain("7 credits");
  });

  it("rewards off entirely ⇒ nothing is promised", () => {
    expect(earnOpportunities(cfg((c) => (c.enabled = false)))).toEqual([]);
  });

  it("referrals appear only when an event pays the referrer", () => {
    expect(earnOpportunities(cfg((c) => { for (const e of Object.values(c.events)) e.referrerCredits = 0; })).map((i) => i.id)).not.toContain("referrals");
    const ref = earnOpportunities(cfg((c) => {
      for (const e of Object.values(c.events)) e.referrerCredits = 0;
      c.events.ai_video_completed = { ...c.events.ai_video_completed, enabled: true, referrerCredits: 4 };
    }));
    expect(ref[0]?.id).toBe("referrals");
    expect(ref[0]?.body).toContain("4 credits when they create an AI video");
  });

  it("cash-out is never promised while withdrawals are closed, and states the real requirements when open", () => {
    expect(cashOutLine(cfg((c) => (c.withdrawals.enabled = false)))).toContain("aren't open");
    const open = cashOutLine(cfg((c) => { c.withdrawals.enabled = true; c.qualification.minAccountAgeDays = 30; c.qualification.minEngagements = 100; }));
    expect(open).toContain("30 active days");
    expect(open).toContain("100 qualifying engagements");
    expect(open).toContain("never cashable");
  });
});
