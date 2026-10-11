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
    expect(lib).toContain("payment_reference: adminTestReference(adminId, campaignId)");
    expect(lib).toContain('reason: "admin test - no charge"');
    const route = src("app/api/ads/advertiser/test-publish/route.ts");
    expect(route).toContain("const gate = await requireAdminApi();");
    expect(route).toContain("if (!gate.ok) return gate.response;");
  });

  it("teeth: an admin can publish MORE THAN ONE test (payment_reference is unique per campaign)", async () => {
    vi.doMock("@/lib/ads-platform/server", () => ({ activateCampaign: async () => ({ ok: true }) }));
    const { adminTestPublish } = await import("@/lib/ads-platform/admin-test-publish");
    // a fake ad_campaigns that enforces `payment_reference text unique` like 0195 does
    const rows = new Map<string, { id: string; status: string; payment_verified_at: string | null; payment_reference: string | null }>();
    for (const id of ["c1", "c2", "c3"]) rows.set(id, { id, status: "awaiting_payment", payment_verified_at: null, payment_reference: null });
    const db = {
      from(table: string) {
        if (table === "ad_campaign_events") return { insert: async () => ({ error: null }) };
        let id = "";
        let patch: Record<string, unknown> | null = null;
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (_c: string, v: string) => ((id = v), q),
          in: () => q,
          is: () => q,
          maybeSingle: async () => ({ data: { ...rows.get(id), advertisers: { user_id: "admin-1" } } }),
          update: (p: Record<string, unknown>) => ((patch = p), q),
          then: (resolve: (v: unknown) => void) => {
            const ref = patch?.payment_reference as string;
            if ([...rows.values()].some((r) => r.payment_reference === ref)) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            Object.assign(rows.get(id)!, patch);
            return resolve({ data: [{ id }], error: null });
          },
        };
        return q;
      },
    };
    for (const id of ["c1", "c2", "c3"]) {
      const out = await adminTestPublish(db as never, "admin-1", id);
      expect(out.ok, `test ${id}`).toBe(true);
    }
    expect(new Set([...rows.values()].map((r) => r.payment_reference)).size).toBe(3);
    expect([...rows.values()].every((r) => r.payment_reference?.startsWith("admin-test:"))).toBe(true);
  });

  it("the route answers with a `message` the wizard shows, not only an `error` sentence", () => {
    const route = src("app/api/ads/advertiser/test-publish/route.ts");
    expect(route).toContain("message: ERR[out.reason");
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
