import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { viewsPatchSchema, viewsSettingsSchema } from "./admin-platform";
import type { AdCatalog } from "./offer";
import { offeredViewsDurations, parseTargetViews, targetProblem, viewsPriceMinor, viewsRateFor, viewsTermsOf, type ViewsTerms } from "./views-pricing";

/**
 * 0240 — views-based campaigns. The SQL itself (pricing, payment, crediting,
 * deadlines, extensions, refunds, RLS, grants) was EXECUTED on PGlite against
 * the real 0149–0219 ad and payment migrations: 71 checks covering the brief's
 * 16 cases, plus 0240 applied twice. Six mutants (no crediting, an admin pause
 * earning an extension, no target freeze, no capacity hold, a paid extension
 * offered, no deadline run) each turned it red. What can be pinned without a
 * database is pinned here.
 */

const M240 = readFileSync(join(process.cwd(), "supabase/migrations/0240_ad_views_pricing.sql"), "utf8");
const fn = (name: string) => {
  const start = M240.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return M240.slice(start, M240.indexOf("\n$$;", start));
};

const TERMS: ViewsTerms = { ratePer1000Minor: 30, minTarget: 1000, maxTarget: 1_000_000, step: 1000, autoExtend: true, extensionDays: 7, maxExtensions: 8 };

describe("the price: target × rate ÷ 1,000, integer cents", () => {
  it("the brief's table at $0.30 per 1,000 views", () => {
    const table: [number, number][] = [[1000, 30], [5000, 150], [10000, 300], [25000, 750], [50000, 1500], [100000, 3000], [250000, 7500], [500000, 15000], [1000000, 30000]];
    for (const [views, cents] of table) expect(viewsPriceMinor(views, 30), String(views)).toBe(cents);
  });

  it("rounds DOWN to the cent and stays an integer at the largest inputs", () => {
    expect(viewsPriceMinor(1500, 25)).toBe(37); // 37.5
    expect(Number.isSafeInteger(viewsPriceMinor(100_000_000, 10_000_000))).toBe(true);
  });

  it("the SQL uses the same integer rule, never a float", () => {
    const body = fn("ad_views_price_for");
    expect(body).toContain("v_total := (p_target::bigint * v_rate) / 1000;");
    expect(body).not.toMatch(/::(float|real|double)/);
  });
});

describe("a target from a request is a whole positive number or nothing", () => {
  it.each([[1000, 1000], ["5000", 5000], [" 2000 ", 2000]])("accepts %j", (raw, n) => expect(parseTargetViews(raw)).toBe(n));
  it.each([[-1000], [0], [1000.5], ["1000.5"], ["1e3"], ["-5"], ["abc"], [null], [undefined], [{}], [Number.NaN], [Infinity], ["9999999999"]])("refuses %j", (raw) => expect(parseTargetViews(raw)).toBeNull());
});

describe("target bounds — the same codes and order as ad_views_price_for", () => {
  it("min, max, step", () => {
    expect(targetProblem(TERMS, 999)).toBe("target_too_small");
    expect(targetProblem(TERMS, 1_000_001)).toBe("target_too_large");
    expect(targetProblem(TERMS, 1500)).toBe("target_step");
    expect(targetProblem(TERMS, 1000)).toBeNull();
  });
  it("teeth: every code the browser uses is one the database returns", () => {
    const body = fn("ad_views_price_for");
    for (const code of ["target_too_small", "target_too_large", "target_step", "views_pricing_disabled", "views_not_offered", "duration_disabled", "over_capacity"]) expect(body, code).toContain(`'${code}'`);
  });
});

describe("the catalog decides what is offered", () => {
  const cat = (over: Partial<AdCatalog["settings"]> = {}): AdCatalog => ({
    v: 1,
    settings: { ads_enabled: true, applications_open: true, multi_placement_enabled: false, max_placements_per_application: 1, display_currency: "USD", default_slot_count: 10, views_enabled: true, views_rate_per_1000_minor: 30, views_min_target: 1000, views_max_target: 1_000_000, views_target_step: 1000, views_auto_extend: true, views_extension_days: 7, views_max_extensions: 8, ...over },
    formats: [],
    placements: [
      { code: "feed_banner", name: "Feed", description: null, format_code: "CONTENT_BANNER", page_scope: ["all_pages"], views_enabled: true, views_rate_per_1000_minor: 45 },
      { code: "ai_banner", name: "AI", description: null, format_code: "CONTENT_BANNER", page_scope: ["all_pages"], views_enabled: false, views_rate_per_1000_minor: null },
      { code: "reels_banner", name: "Reels", description: null, format_code: "CONTENT_BANNER", page_scope: ["all_pages"] },
    ],
    durations: [{ id: "d7", name: "7 days", days: 7, views_enabled: true }, { id: "d1", name: "1 day", days: 1, views_enabled: false }],
    prices: [],
    promotions: [],
    at: "",
  });
  it("views off, or a database without 0240, sells nothing by views", () => {
    expect(viewsTermsOf(cat({ views_enabled: false }))).toBeNull();
    const pre = cat();
    for (const k of Object.keys(pre.settings).filter((k) => k.startsWith("views_"))) delete (pre.settings as Record<string, unknown>)[k];
    expect(viewsTermsOf(pre)).toBeNull();
  });
  it("a placement rate overrides the default; a placement can opt out", () => {
    const c = cat();
    const t = viewsTermsOf(c)!;
    expect(viewsRateFor(c, t, "feed_banner")).toBe(45);
    expect(viewsRateFor(c, t, "reels_banner")).toBe(30);
    expect(viewsRateFor(c, t, "ai_banner")).toBeNull();
    expect(viewsRateFor(c, t, "nope")).toBeNull();
  });
  it("only periods switched on for views are offered", () => {
    expect(offeredViewsDurations(cat()).map((d) => d.id)).toEqual(["d7"]);
  });
});

describe("0240 pins (with teeth)", () => {
  it("a qualifying impression is credited once, after the event-id dedupe, only for a views campaign", () => {
    const ingest = fn("track_ad_events");
    const credit = ingest.indexOf("perform public.ad_views_credit(v_cid);");
    expect(credit).toBeGreaterThan(ingest.indexOf("on conflict (event_id) do nothing;"));
    expect(ingest.slice(credit - 200, credit)).toContain("if v_q and v_type = 'impression' and c.pricing_model = 'views_based' then");
  });
  it("crediting never passes the target, under the delivery row lock", () => {
    expect(fn("ad_views_credit")).toMatch(/where campaign_id = p_campaign and phase in \('initial', 'extended'\) and delivered_views < target_views/);
    expect(M240).toContain("constraint ad_campaign_delivery_count_chk check (delivered_views between 0 and target_views)");
  });
  it("only an advertiser's own pause can earn a free extension, and extensions are capped", () => {
    const d = fn("ad_views_deadline");
    expect(d).toContain("when c.status = 'paused' and c.status_reason is distinct from 'advertiser_paused' then 'suspended'");
    expect(d).toContain("when d.extensions_used >= d.max_extensions then 'extensions_exhausted'");
    expect(M240).toContain("extensions_used between 0 and max_extensions");
  });
  it("what was bought is frozen with the payment", () => {
    expect(fn("ad_campaigns_guard")).toContain("or new.target_views is distinct from old.target_views) then");
  });
  it("a views campaign is never sold more time", () => {
    expect(fn("ad_extension_quote")).toContain("if c.pricing_model = 'views_based' then return jsonb_build_object('ok', false, 'reason', 'views_extend_free')");
  });
  it("the plain time expiry is for fixed campaigns only; views deadlines run first", () => {
    const life = fn("ad_campaigns_sync_lifecycle");
    expect(life.indexOf("public.ad_views_deadlines()")).toBeLessThan(life.indexOf("with due as"));
    expect(life).toContain("and pricing_model = 'fixed_period'");
  });
  it("every new function is the server's alone", () => {
    for (const f of ["ad_views_capacity(uuid, integer, integer)", "ad_views_price_for(uuid, uuid, integer, text)", "ad_views_fulfil(uuid)", "ad_views_credit(uuid)", "ad_views_deadline(uuid)", "ad_views_deadlines()", "ad_views_claim_notices(integer)"]) {
      expect(M240, f).toContain(`'public.${f}'`);
    }
    expect(M240).toContain("execute format('revoke all on function %s from public, anon, authenticated', fn);");
    expect(M240).toContain("revoke insert, update, delete, truncate on public.ad_campaign_delivery from anon, authenticated;");
  });
  it("runner hard law: no semicolon inside a single-quoted string", () => {
    for (const m of M240.matchAll(/'[^'\n]*'/g)) expect(m[0], m[0]).not.toContain(";");
  });
});

describe("the admin may set every views term (owner 2026-10-12: the minimum views)", () => {
  it("accepts the minimum, the rate and the rules", () => {
    expect(viewsSettingsSchema.safeParse({ views_min_target: 5000, views_rate_per_1000_minor: 25, views_capacity_policy: "block" }).success).toBe(true);
    expect(viewsPatchSchema.safeParse({ placement: { code: "feed_banner", views_rate_per_1000_minor: null } }).success).toBe(true);
  });
  it("teeth: refuses fractions, zero and unknown fields", () => {
    expect(viewsSettingsSchema.safeParse({ views_min_target: 1000.5 }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_min_target: 0 }).success).toBe(false);
    expect(viewsSettingsSchema.safeParse({ views_price: 1 }).success).toBe(false);
  });
});
