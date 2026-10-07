import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAiPlansConfig } from "@/lib/ai/credits/config";
import { calculateCredits } from "@/lib/ai/credits/engine";
import { AI_CREDIT_FEATURES, featureAccess, featurePolicy, includedPeriodKey, normalizeAiFeaturePolicies, overMaxInput, publicFeatureAccess, tierOf } from "@/lib/ai/credits/features";

/**
 * 0185 — the admin feature table (credit brief §5, §12, §13). Tiers =
 * Free / AI Pro / AI Max (owner, 2026-10-07).
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the table's defaults change nothing", () => {
  it("every paid tool: on, pay-as-you-go, every tier, no floor, no ceiling, nothing included", () => {
    const p = normalizeAiFeaturePolicies(undefined);
    for (const id of AI_CREDIT_FEATURES) {
      expect(p[id]).toEqual({ enabled: true, payAsYouGo: true, tiers: { free: true, ai_pro: true, ai_max: true }, minimumCredits: 0, maxInputSeconds: null, monthlyIncluded: { free: 0, ai_pro: 0, ai_max: 0 } });
    }
  });
  it("an id outside the table behaves as before", () => {
    expect(featurePolicy(normalizeAiFeaturePolicies({}), "ai_something_new").enabled).toBe(true);
  });
});

describe("normalising what an admin saved", () => {
  const p = normalizeAiFeaturePolicies({
    ai_text_to_video: { enabled: true, payAsYouGo: false, tiers: { free: false }, minimumCredits: "5", maxInputSeconds: 10, monthlyIncluded: { ai_pro: 3, ai_max: "8", free: -2 } },
    ai_text_to_audio: { maxInputSeconds: 30, monthlyIncluded: { ai_pro: 5 } },
    ai_voice_clone: { monthlyIncluded: { ai_max: 4 } },
  });
  it("clamps and coerces", () => {
    expect(p.ai_text_to_video).toMatchObject({ payAsYouGo: false, tiers: { free: false, ai_pro: true, ai_max: true }, minimumCredits: 5, maxInputSeconds: 10, monthlyIncluded: { free: 0, ai_pro: 3, ai_max: 8 } });
  });
  it("🔴 a tool with an allowance of its own never gets a second one, and a tool with no length has no length ceiling", () => {
    expect(p.ai_text_to_audio.monthlyIncluded).toEqual({ free: 0, ai_pro: 0, ai_max: 0 });
    expect(p.ai_voice_clone.monthlyIncluded).toEqual({ free: 0, ai_pro: 0, ai_max: 0 });
    expect(p.ai_text_to_audio.maxInputSeconds).toBeNull();
  });
});

describe("who may use it", () => {
  const base = normalizeAiFeaturePolicies({}).ai_lip_sync;
  it("a tier the table closes is refused, naming the plan that would open it", () => {
    const access = featureAccess({ ...base, tiers: { free: false, ai_pro: false, ai_max: true } }, "free");
    expect(access).toEqual({ ok: false, tier: "free", reason: "tier", upgrade: "ai_max" });
  });
  it("a feature switched off is off for every tier, with no upgrade to offer", () => {
    expect(featureAccess({ ...base, enabled: false }, "ai_max")).toEqual({ ok: false, tier: "ai_max", reason: "disabled", upgrade: null });
  });
  it("an open tier gets its included count and the pay-as-you-go flag", () => {
    expect(featureAccess({ ...base, monthlyIncluded: { free: 0, ai_pro: 4, ai_max: 9 } }, "ai_pro")).toEqual({ ok: true, tier: "ai_pro", includedPerMonth: 4, payAsYouGo: true });
  });
  it("the tier is the ACTIVE AI plan, else Free", () => {
    expect(tierOf(null)).toBe("free");
    expect(tierOf("ai_pro")).toBe("ai_pro");
    expect(tierOf("ai_max")).toBe("ai_max");
  });
  it("the public view says whether upgrading changes the allowance (brief §13)", () => {
    const v = publicFeatureAccess({ ...base, monthlyIncluded: { free: 1, ai_pro: 5, ai_max: 5 } }, "free", 1);
    expect(v).toMatchObject({ available: true, includedPerMonth: 1, includedRemaining: 0, upgradeTier: "ai_pro", upgradeIncludedPerMonth: 5 });
    expect(publicFeatureAccess(base, "ai_max", 0).upgradeTier).toBeNull();
  });
});

describe("length ceiling and the month", () => {
  const base = normalizeAiFeaturePolicies({}).ai_text_to_video;
  it("no ceiling = the tool's own", () => expect(overMaxInput(base, 9999)).toBeNull());
  it("over the ceiling names it; at it is fine", () => {
    expect(overMaxInput({ ...base, maxInputSeconds: 10 }, 10)).toBeNull();
    expect(overMaxInput({ ...base, maxInputSeconds: 10 }, 15)).toBe(10);
  });
  it("the month key is the operator's zone, not UTC", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Lagos (UTC+1)
    expect(includedPeriodKey(new Date("2026-09-30T23:30:00Z"), "Africa/Lagos")).toBe("2026-10");
    expect(includedPeriodKey(new Date("2026-09-30T23:30:00Z"), "UTC")).toBe("2026-09");
  });
});

describe("a feature's own minimum in the ONE engine", () => {
  it("the higher of the global and the feature minimum applies, and the breakdown says so", () => {
    const plans = normalizeAiPlansConfig({ credits: { centsPerCredit: 10, minimumCredits: 1 }, features: { ai_lip_sync: { minimumCredits: 7 } } });
    const e = calculateCredits({ feature: "ai_lip_sync", priceCents: 20 }, plans);
    expect(e.creditsRequired).toBe(7);
    expect(e.breakdown.some((l) => l.key === "minimum" && l.credits === 7)).toBe(true);
    // another feature keeps the global floor
    expect(calculateCredits({ feature: "ai_text_to_video", priceCents: 20 }, plans).creditsRequired).toBe(2);
  });
  it("a free generation is still 0 — a minimum on nothing would be a charge", () => {
    const plans = normalizeAiPlansConfig({ features: { ai_lip_sync: { minimumCredits: 7 } } });
    expect(calculateCredits({ feature: "ai_lip_sync", priceCents: 0 }, plans).creditsRequired).toBe(0);
  });
});

describe("🔴 every paid tool asks the table before money moves", () => {
  const tools = {
    "lib/ai/video/create.ts": true,
    "lib/ai/lip-sync/start-job.ts": true,
    "lib/ai/text-to-audio/generate.ts": false,
    "lib/ai/voice-clone/start.ts": false,
  } as const;
  for (const [file, offersIncluded] of Object.entries(tools)) {
    it(`${file}: gate before the claim, pay-as-you-go before the wallet${offersIncluded ? ", included before credits" : ""}`, () => {
      const s = code(file);
      const gate = s.indexOf("featureRefusal(fctx)");
      const payg = s.indexOf("payAsYouGoRefusal(fctx)");
      const claim = s.indexOf("claimJobStart({");
      expect(gate).toBeGreaterThan(-1);
      expect(payg).toBeGreaterThan(gate);
      expect(claim).toBeGreaterThan(payg);
      if (offersIncluded) {
        expect(s).toContain("const included = !complimentary && fctx.includedRemaining > 0;");
        expect(s.indexOf("consumeIncludedUse(")).toBeGreaterThan(claim);
        expect(s).toContain("included_use: { feature:");
      }
    });
  }
  it("a refused plan-credit reservation is never treated as reserved (the video bug fixed with 0185)", () => {
    const s = code("lib/ai/video/create.ts");
    expect(s).toContain("reserved = !!reservation && reservation.ok;");
    expect(s).not.toMatch(/reserved = !!reservation;/);
  });
  it("an undone job gives its included generation back before any other release", () => {
    const f = code("lib/ai/funding.ts");
    expect(f.indexOf("releaseIncludedUseForJob")).toBeGreaterThan(-1);
    expect(f.indexOf("releaseIncludedUseForJob")).toBeLessThan(f.indexOf("await restoreFreeUse(opts.job.id"));
  });
  it("the counter's writers are revoked from the browser and locked per member", () => {
    const sql = code("supabase/migrations/0185_ai_feature_included_usage.sql");
    expect(sql).toContain("revoke all on function public.consume_feature_included(uuid, text, text, integer) from public, anon, authenticated");
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('ai_included:' || p_user_id::text))");
    expect(sql).toContain("if v_used >= p_limit then");
  });
});
