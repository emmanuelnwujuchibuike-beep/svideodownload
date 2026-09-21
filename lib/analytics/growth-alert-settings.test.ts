import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_GROWTH_ALERTS, milestoneFor, normalizeGrowthAlerts } from "./growth-alert-settings";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("growth milestone emails (owner, 2026-09-20)", () => {
  it("defaults to every 1,000 visitors and members, both on; a partial row never switches one off", () => {
    expect(DEFAULT_GROWTH_ALERTS).toEqual({ visitors: { every: 1000, enabled: true }, users: { every: 1000, enabled: true } });
    expect(normalizeGrowthAlerts({ visitors: { every: 10_000 } })).toEqual({ visitors: { every: 10_000, enabled: true }, users: { every: 1000, enabled: true } });
    expect(normalizeGrowthAlerts({ users: { every: 0.5, enabled: false } }).users).toEqual({ every: 1, enabled: false });
    expect(normalizeGrowthAlerts({ visitors: { every: 1e12 } }).visitors.every).toBe(100_000_000);
    expect(normalizeGrowthAlerts(null)).toEqual(DEFAULT_GROWTH_ALERTS);
  });
  it("a milestone is the last multiple crossed, and none before the first", () => {
    expect(milestoneFor(999, 1000)).toBe(0);
    expect(milestoneFor(1000, 1000)).toBe(1000);
    expect(milestoneFor(24_999, 10_000)).toBe(20_000);
    expect(milestoneFor(0, 1000)).toBe(0);
    expect(milestoneFor(50, 0)).toBe(0);
  });
  it("is checked by the daily digest run (forced) and sampled from the collect route (throttled), locked once per milestone like the download email", () => {
    const svc = code("server/services/analytics.ts");
    expect(svc).toContain("sendAdminAlertOnce(\n      `${name}-${milestone}`,");
    expect(svc).toContain("const GROWTH_CHECK_THROTTLE_MS = 10 * 60_000;");
    expect(svc).toContain('supabase.rpc("analytics_visitors_total")');
    expect(code("app/api/cron/digest/route.ts")).toContain("checkGrowthMilestones({ force: true })");
    expect(code("app/api/analytics/collect/route.ts")).toContain("if (Math.random() < 0.02) after(() => checkGrowthMilestones().catch(() => undefined));");
    // the admin route is guarded and the counter is revoked from the browser roles
    expect(code("app/api/admin/growth-alerts/route.ts")).toContain("const admin = await getAdminUser();");
    expect(readFileSync(join(process.cwd(), "supabase/migrations/0165_analytics_visitors_total.sql"), "utf8")).toContain("revoke all on function public.analytics_visitors_total() from public, anon, authenticated");
  });
});
