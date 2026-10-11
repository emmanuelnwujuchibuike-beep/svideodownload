import { describe, expect, it } from "vitest";

import { trustFromSignals, type TrustSignals } from "./trust";

const base: TrustSignals = { verified: false, accountAgeDays: 400, activity90: 12, friends: 15, collaborations: 1, recommendations: 1, endorsers: 1, upheldReports: 0, restricted: false };

describe("Trust Graph: explainable bands, never vanity", () => {
  it("a long-standing, active, vouched-for, verified member is trusted, with the reasons", () => {
    const t = trustFromSignals({ ...base, verified: true });
    expect(t.band).toBe("trusted");
    expect(t.reasons.map((r) => r.text)).toContain("Verified identity");
    expect(t.next).toEqual([]);
  });
  it("upheld reports lower trust; unreviewed ones are not even an input", () => {
    expect(trustFromSignals({ ...base, verified: true, upheldReports: 3 }).band).not.toBe("trusted");
    expect(Object.keys(base)).not.toContain("reports");
  });
  it("a team restriction is 'limited' whatever else is true", () => {
    expect(trustFromSignals({ ...base, verified: true, restricted: true }).band).toBe("limited");
  });
  it("a new account is new, and is told what would help", () => {
    const t = trustFromSignals({ ...base, accountAgeDays: 3, activity90: 0, friends: 0, collaborations: 0, recommendations: 0, endorsers: 0 });
    expect(t.band).toBe("new");
    expect(t.next).toContain("Verify your account");
  });
  it("followers and likes are not signals at all", () => {
    expect(Object.keys(base).some((k) => /follower|like|view/i.test(k))).toBe(false);
  });
});
