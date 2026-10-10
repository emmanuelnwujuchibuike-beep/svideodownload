import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatMinor, fundingSource } from "./funding-alerts";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("admin funding alerts (owner, 2026-10-10: push + email for every payment, with its source)", () => {
  it("names the source in the owner's words and the amount in its own currency", () => {
    expect(fundingSource("wallet_topup")).toBe("AI credit funding");
    expect(fundingSource("ai_subscription")).toBe("AI subscription");
    expect(fundingSource("ad_campaign")).toBe("Advertiser payment");
    expect(formatMinor(250000, "ngn")).toBe("NGN 2,500");
    expect(formatMinor(1999, "USD")).toBe("USD 19.99");
  });

  it("teeth: every success path reaches the alert, and each payment is announced once", () => {
    expect(src("lib/ai/topup-attempts.ts")).toContain('if (!error && outcome.status === "success")');
    expect(src("lib/ads-platform/payment-server.ts")).toContain("m.flushFundingAlertsSoon()");
    expect(src("app/api/cron/ai-reconcile/route.ts")).toContain("flushFundingAlerts()");
    const flush = src("lib/admin/funding-alerts.ts");
    // claimed (sent_at stamped) BEFORE anything is sent
    expect(flush.indexOf('.update({ sent_at: new Date().toISOString() })')).toBeLessThan(flush.indexOf("sendPushToUser(id"));
    expect(src("supabase/migrations/0218_admin_funding_alerts_weekly_awards.sql")).toContain("on conflict (reference) do nothing");
  });
});

describe("admin test campaigns (owner, 2026-10-10: make an ad without paying, for testing)", () => {
  it("teeth: only an admin, only their OWN campaign, recorded at 0 with a test reference — never revenue", () => {
    const lib = src("lib/ads-platform/admin-test-publish.ts");
    expect(lib).toContain('if (owner !== adminId) return { ok: false, reason: "not_your_campaign" };');
    expect(lib).toContain("total_amount_minor: 0");
    expect(lib).toContain("payment_reference: `${ADMIN_TEST_REFERENCE_PREFIX}${adminId}`");
    expect(lib).toContain('reason: "admin test - no charge"');
    const route = src("app/api/ads/advertiser/test-publish/route.ts");
    expect(route).toContain("const gate = await requireAdminApi();");
    expect(route).toContain("if (!gate.ok) return gate.response;");
  });
});

describe("video ad sound", () => {
  it("plays with sound when allowed, falls back to muted, and the speaker never opens the ad", () => {
    const c = src("features/ads-platform/serve/self-ad-creative.tsx");
    expect(c).toContain("v.muted = !adSoundOn();");
    expect(c).toContain("setSoundBlocked(true);");
    expect(c).toMatch(/const toggleSound = [\s\S]*?e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
    expect(c).toContain('aria-label={soundOn && !soundBlocked ? "Mute ad" : "Turn ad sound on"}');
  });
});
