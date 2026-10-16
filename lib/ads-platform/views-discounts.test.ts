import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { volumeDiscountsSchema } from "./admin-platform";
import { discountedMinor, parseDiscounts, viewsDiscountPercent, viewsPriceMinor } from "./views-pricing";

/* Owner, 2026-10-15: "In AD by views let their be discount from 5% to 30% when a user
   select 1m views, 500K views should have a discount of 25%." */
const M246 = readFileSync(join(process.cwd(), "supabase/migrations/0246_ad_views_discounts_engagement.sql"), "utf8");
const DEFAULT = parseDiscounts(JSON.parse(/default '(\[[^']+\])'::jsonb/.exec(M246)![1]!))!;

describe("the default discount table (0246)", () => {
  it("runs from 5% to 30%: 500K views 25%, 1M views 30%", () => {
    const t = { discounts: DEFAULT };
    expect(viewsDiscountPercent(t, 500_000)).toBe(25);
    expect(viewsDiscountPercent(t, 1_000_000)).toBe(30);
    expect(Math.min(...DEFAULT.map((d) => d.percent))).toBe(5);
    expect(Math.max(...DEFAULT.map((d) => d.percent))).toBe(30);
  });

  it("below the first step there is no discount; between steps the lower one applies", () => {
    const t = { discounts: DEFAULT };
    expect(viewsDiscountPercent(t, 1000)).toBe(0);
    expect(viewsDiscountPercent(t, 49_000)).toBe(0);
    expect(viewsDiscountPercent(t, 999_000)).toBe(25);
  });

  it("teeth: no table (before 0246) means no discount, and the charge is the list price", () => {
    expect(viewsDiscountPercent({}, 1_000_000)).toBe(0);
    expect(discountedMinor(viewsPriceMinor(1_000_000, 30), 0)).toBe(30_000);
  });

  it("the money rule matches the database: cents off rounded DOWN", () => {
    // $300 list at 30% off = $210; 1,001 cents at 25% off: 250.25 off → 250 off → 751
    expect(discountedMinor(30_000, 30)).toBe(21_000);
    expect(discountedMinor(1001, 25)).toBe(751);
    expect(M246).toContain("v_total := v_list - (v_list * v_pct) / 100;");
  });
});

describe("the admin's discount table is validated on the server", () => {
  it("accepts the default", () => {
    expect(volumeDiscountsSchema.safeParse(DEFAULT.map((d) => ({ min_views: d.minViews, percent: d.percent }))).success).toBe(true);
  });
  it("refuses a bigger step with a smaller discount, duplicates, over 90%, fractions and more than 10", () => {
    expect(volumeDiscountsSchema.safeParse([{ min_views: 100000, percent: 20 }, { min_views: 500000, percent: 10 }]).success).toBe(false);
    expect(volumeDiscountsSchema.safeParse([{ min_views: 100000, percent: 10 }, { min_views: 100000, percent: 20 }]).success).toBe(false);
    expect(volumeDiscountsSchema.safeParse([{ min_views: 100000, percent: 95 }]).success).toBe(false);
    expect(volumeDiscountsSchema.safeParse([{ min_views: 100000, percent: 2.5 }]).success).toBe(false);
    expect(volumeDiscountsSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ min_views: (i + 1) * 1000, percent: i }))).success).toBe(false);
  });
  it("a malformed table from the catalog is no table at all", () => {
    expect(parseDiscounts([{ min_views: "x", percent: 5 }])).toBeNull();
    expect(parseDiscounts([{ min_views: 1000, percent: 200 }])).toBeNull();
    expect(parseDiscounts("nope")).toBeNull();
  });
});

describe("0242 keeps the discount whichever runs last", () => {
  const M242 = readFileSync(join(process.cwd(), "supabase/migrations/0242_ad_pricing_delivery_admin.sql"), "utf8");
  it("0242's price applies 0246's percentage when it exists, and its catalog carries the table", () => {
    expect(M242).toContain("if to_regprocedure('public.ad_views_discount_percent(integer)') is not null then");
    expect(M242).toContain("'views_volume_discounts', to_jsonb(s) -> 'views_volume_discounts'");
  });
  it("0246 reads 0242's columns without needing them", () => {
    expect(M246).toContain("v_min := coalesce((sj ->> 'views_min_checkout_minor')::bigint, 0);");
    expect(M246).toContain("if to_regprocedure('public.ad_views_rate(uuid, integer)') is not null then");
  });
});
