import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { deliveryActionSchema, deliveryFiltersSchema } from "./admin-delivery";
import { viewsPatchSchema, viewsSettingsSchema, volumeTiersSchema } from "./admin-platform";
import { parseTiers, viewsRateFor, type ViewsTerms } from "./views-pricing";
import type { AdCatalog } from "./offer";

/**
 * Part 3 (0242) — Advertising Pricing & Delivery. The SQL ran on PGlite on the
 * real 0149–0241 migrations: 35 admin checks (switches, tiers, minimum
 * checkout, refusals, the policies sold with a campaign, escalation to review
 * and its resolution, audited corrections, the paged monitor, capacity, and an
 * advertiser denied every admin function), with the 0240 suite (71) and the
 * 0241 suite (16) still green. What can be pinned without a database is here.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M242 = src("supabase/migrations/0242_ad_pricing_delivery_admin.sql");
const fn = (name: string) => {
  const start = M242.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return M242.slice(start, M242.indexOf("\n$$;", start));
};

describe("only an admin reaches the pricing and delivery controls", () => {
  it("every handler of the delivery route is gated, and the platform route too", () => {
    const route = src("app/api/admin/ads/delivery/route.ts");
    const handlers = [...route.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]);
    expect(handlers.sort()).toEqual(["GET", "POST"]);
    // teeth: each handler's first lines check the admin
    for (const h of handlers) {
      const body = route.slice(route.indexOf(`export async function ${h}(`), route.indexOf(`export async function ${h}(`) + 200);
      expect(body, h).toContain("await requireAdminApi()");
      expect(body, h).toContain("if (!gate.ok) return gate.response;");
    }
    expect(src("app/api/admin/ads/platform/route.ts").match(/await requireAdminApi\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("every admin SQL function is revoked from the browser roles", () => {
    for (const f of ["ad_admin_resolve_delivery(uuid, uuid, text, integer, text)", "ad_admin_adjust_delivery(uuid, uuid, integer, text, text)", "ad_admin_delivery_summary(date, date, integer)", "ad_admin_delivery_list(jsonb, integer, integer)", "ad_admin_delivery_detail(uuid)", "ad_admin_capacity()"]) {
      expect(M242, f).toContain(`'public.${f}'`);
    }
    expect(M242).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
  });

  it("no code writes the delivery table directly — only the audited SQL functions do", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(join(process.cwd(), d), { withFileTypes: true })) {
        if (e.isDirectory() && e.name !== "node_modules") walk(`${d}/${e.name}`);
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.")) files.push(`${d}/${e.name}`);
      }
    };
    for (const d of ["lib", "app", "features"]) walk(d);
    for (const f of files) expect(src(f), f).not.toMatch(/from\("ad_campaign_delivery"\)\s*\.(update|insert|upsert|delete)/);
  });
});

describe("server-side validation of every setting", () => {
  it("refuses negative or fractional rates and unknown fields", () => {
    expect(viewsSettingsSchema.safeParse({ views_rate_per_1000_minor: -1 }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_rate_per_1000_minor: 2.5 }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_min_checkout_minor: -5 }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_on_exhausted: "forever" }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_free_money: true }).success).toBe(false);
  });
  it("tiers: thresholds distinct, a bigger tier never costs more, at most 10", () => {
    expect(volumeTiersSchema.safeParse([{ min_views: 100000, rate_per_1000_minor: 25 }, { min_views: 500000, rate_per_1000_minor: 20 }]).success).toBe(true);
    expect(volumeTiersSchema.safeParse([{ min_views: 100000, rate_per_1000_minor: 25 }, { min_views: 500000, rate_per_1000_minor: 30 }]).success).toBe(false);
    expect(volumeTiersSchema.safeParse([{ min_views: 100000, rate_per_1000_minor: 25 }, { min_views: 100000, rate_per_1000_minor: 20 }]).success).toBe(false);
    expect(volumeTiersSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ min_views: (i + 1) * 1000, rate_per_1000_minor: 30 - i }))).success).toBe(false);
  });
  it("a new length is 1–366 whole days", () => {
    expect(viewsPatchSchema.safeParse({ newDuration: { days: 21, name: "21 days" } }).success).toBe(true);
    expect(viewsPatchSchema.safeParse({ newDuration: { days: 0, name: "x" } }).success).toBe(false);
    expect(viewsPatchSchema.safeParse({ newDuration: { days: 1.5, name: "x" } }).success).toBe(false);
  });
  it("the database refuses both ways to buy switched off, and a max below the min", () => {
    expect(M242).toContain("add constraint ad_platform_settings_models_chk check (fixed_enabled or views_enabled)");
    expect(src("supabase/migrations/0240_ad_views_pricing.sql")).toContain("views_max_target between views_min_target and 100000000");
  });
});

describe("interventions are reason-coded and audited — nothing marks a campaign fulfilled by hand", () => {
  it("actions need a reason; a correction needs a reason code and a non-zero change", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(deliveryActionSchema.safeParse({ action: "extend", campaignId: id, days: 7, reason: "" }).success).toBe(false);
    expect(deliveryActionSchema.safeParse({ action: "close_refund", campaignId: id, reason: "ok" }).success).toBe(false);
    expect(deliveryActionSchema.safeParse({ action: "adjust", campaignId: id, delta: 0, reasonCode: "verified_dispute_credit", note: "proof attached" }).success).toBe(false);
    expect(deliveryActionSchema.safeParse({ action: "adjust", campaignId: id, delta: 10, reasonCode: "because", note: "proof attached" }).success).toBe(false);
    expect(deliveryActionSchema.safeParse({ action: "fulfil", campaignId: id }).success).toBe(false);
    expect(deliveryActionSchema.safeParse({ action: "adjust", campaignId: id, delta: 10, reasonCode: "verified_dispute_credit", note: "provider outage, logs attached" }).success).toBe(true);
  });
  it("the SQL logs every correction and fulfils only through the count", () => {
    const adj = fn("ad_admin_adjust_delivery");
    expect(adj).toContain("insert into public.ad_delivery_adjustments");
    expect(adj).toContain("'delivery_adjusted', p_admin, 'admin'");
    expect(adj).toContain("if v_after >= d.target_views then perform public.ad_views_fulfil(p_campaign); end if;");
    expect(adj).toContain("if v_after < 0 or v_after > d.target_views then");
    expect(fn("ad_admin_resolve_delivery")).toContain("'admin', ");
  });
});

describe("a promise is never closed silently", () => {
  it("when the extensions run out the default is review, and a resume cannot expire it", () => {
    expect(M242).toContain("add column if not exists views_on_exhausted text not null default 'review'");
    expect(fn("ad_views_deadline")).toContain("set phase = 'review', escalated_at = now()");
    expect(fn("activate_ad_campaign")).toContain("return jsonb_build_object('ok', false, 'reason', 'delivery_review');");
  });
  it("the policies are sold with the campaign and read from its snapshot", () => {
    expect(fn("ad_views_price_for")).toContain("'on_exhausted', s.views_on_exhausted");
    expect(fn("ad_views_deadline")).toContain("coalesce(v_terms ->> 'on_exhausted', s.views_on_exhausted)");
  });
  it("switching fixed sales off stops new quotes only", () => {
    const q = fn("ad_campaign_quote");
    expect(q).toContain("'fixed_pricing_disabled'");
    // teeth: the extension path is untouched
    expect(M242).not.toContain("create or replace function public.ad_extension_quote(");
  });
});

describe("the monitor never loads unbounded data", () => {
  it("a page is at most 100 rows, the client asks for 20", () => {
    expect(fn("ad_admin_delivery_list")).toContain("limit greatest(1, least(coalesce(p_limit, 25), 100))");
    expect(src("lib/ads-platform/admin-delivery.ts")).toContain("export const PAGE_SIZE = 20;");
  });
  it("no admin read touches the raw event table", () => {
    for (const f of ["ad_admin_delivery_summary", "ad_admin_delivery_list", "ad_admin_delivery_detail", "ad_admin_capacity"]) expect(fn(f), f).not.toContain("ad_events ");
  });
  it("the tab fetches on show and on Apply — never on a keystroke, never on a timer", () => {
    const ui = src("features/admin/ad-delivery-monitor.tsx");
    expect(ui).not.toMatch(/setInterval|\.channel\(|postgres_changes/);
    for (const m of ui.matchAll(/onChange=\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/load\(|fetch\(/);
  });
  it("filters are validated", () => {
    expect(deliveryFiltersSchema.safeParse({ phase: "review", progress_below: 0.5 }).success).toBe(true);
    expect(deliveryFiltersSchema.safeParse({ phase: "anything" }).success).toBe(false);
    expect(deliveryFiltersSchema.safeParse({ sql: "1=1" }).success).toBe(false);
  });
});

describe("the browser estimate follows the tier rule", () => {
  const terms: ViewsTerms = { ratePer1000Minor: 40, minTarget: 1000, maxTarget: 1_000_000, step: 1000, autoExtend: true, extensionDays: 7, maxExtensions: 8, tiers: parseTiers([{ min_views: 100000, rate_per_1000_minor: 25 }, { min_views: 500000, rate_per_1000_minor: 20 }])!, minCheckoutMinor: 0 };
  const cat = { placements: [{ code: "a", views_enabled: true, views_rate_per_1000_minor: null }, { code: "b", views_enabled: true, views_rate_per_1000_minor: 50 }] } as unknown as AdCatalog;
  it("base below the first tier, then each tier, and a placement rate wins", () => {
    expect(viewsRateFor(cat, terms, "a", 10_000)).toBe(40);
    expect(viewsRateFor(cat, terms, "a", 200_000)).toBe(25);
    expect(viewsRateFor(cat, terms, "a", 500_000)).toBe(20);
    expect(viewsRateFor(cat, terms, "b", 500_000)).toBe(50);
  });
  it("teeth: the SQL rule has the same order", () => {
    const r = fn("ad_views_rate");
    expect(r.indexOf("views_rate_per_1000_minor from public.ad_placements")).toBeLessThan(r.indexOf("views_volume_tiers"));
    expect(r).toContain("min((t ->> 'rate_per_1000_minor')::integer)");
  });
  it("malformed tiers are ignored, never half-applied", () => {
    expect(parseTiers([{ min_views: -1, rate_per_1000_minor: 5 }])).toBeNull();
    expect(parseTiers("x")).toBeNull();
  });
});

describe("runner hard law", () => {
  it("no semicolon inside a single-quoted string in 0242", () => {
    for (const m of M242.matchAll(/'[^'\n]*'/g)) expect(m[0], m[0]).not.toContain(";");
  });
});
