import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { safeNext } from "@/lib/auth/safe-next";
import { subscriptionCharge, usd, withdrawalSplit } from "@/lib/creator/membership/engine";
import { SUB_DEFAULTS } from "@/lib/rewards/config";

import sitemap from "./sitemap";

/*
  /earn — the public creator-monetization page (owner SEO brief 2026-10-11).
  It states money, so its arithmetic and its doors are pinned here.
*/

const PAGE = readFileSync("app/(marketing)/earn/page.tsx", "utf8");
const START = readFileSync("app/(marketing)/earn/start/route.ts", "utf8");

/** What the creator ends up with from one payment at a given price: the price, less the withdrawal fee. */
const keeps = (priceCents: number, cfg = SUB_DEFAULTS) => withdrawalSplit(priceCents, cfg.withdrawalFeePercent).netCents;

describe("/earn fee examples", () => {
  it("at the default fees the brief's examples are exact: $3 → $2.70, $5 → $4.50, $10 → $9.00, $20 → $18.00", () => {
    expect([300, 500, 1000, 2000].map((p) => usd(keeps(p)))).toEqual(["$2.70", "$4.50", "$9.00", "$18.00"]);
  });

  it("the subscriber's side is shown too: a $10 price costs $11.00", () => {
    expect(usd(subscriptionCharge(1000, SUB_DEFAULTS.purchaseFeePercent).totalCents)).toBe("$11.00");
  });

  it("the examples follow the admin's fee, not a hard-coded 90 % (teeth)", () => {
    const cfg = { ...SUB_DEFAULTS, withdrawalFeePercent: 15 };
    expect(usd(keeps(1000, cfg))).toBe("$8.50");
    // and the page renders from the live settings and the engine, never a literal amount
    expect(PAGE).toMatch(/getLandingSettings\(\)/);
    expect(PAGE).toMatch(/withdrawalSplit\(p, outFee\)/);
    expect(PAGE).not.toMatch(/\$2\.70|\$4\.50|\$9\.00|\$18\.00/);
  });
});

describe("/earn is indexable and static; /earn/start is neither", () => {
  it("the sitemap never lists /earn/start (and, since 2026-10-29, not /earn either — it is off the owner's list)", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/earn"))).toBe(false);
    expect(urls.some((u) => u.includes("/earn/start"))).toBe(false);
  });

  it("the page is force-static with its own canonical, and reads no cookie", () => {
    expect(PAGE).toMatch(/export const dynamic = "force-static"/);
    expect(PAGE).toMatch(/canonical: "\/earn"/);
    // the title and description state the share, so they come from the live fee too
    expect(PAGE).toMatch(/export async function generateMetadata/);
    expect(PAGE).not.toMatch(/cookies\(|headers\(|createClient\(/);
  });

  it("the CTAs are plain links to /earn/start (a handler redirect cannot be followed by a client navigation)", () => {
    expect(PAGE.match(/<a href=\{START\}/g)?.length).toBe(2);
    expect(PAGE).toMatch(/const START = "\/earn\/start"/);
  });
});

describe("/earn/start sends people only to fixed paths", () => {
  it("the sign-in hop survives safeNext unchanged and comes back to /earn/start", () => {
    const m = /const LOGIN = `\/login\?next=\$\{encodeURIComponent\("([^"]+)"\)\}`/.exec(START);
    expect(m?.[1]).toBe("/earn/start?via=login");
    expect(safeNext(m![1])).toBe("/earn/start?via=login");
  });

  it("no destination is read from the request: only `via` is, and only compared", () => {
    expect(START).not.toMatch(/searchParams\.get\("(next|to|url|redirect)"\)/);
    expect(START).toMatch(/searchParams\.get\("via"\) === "login"/);
  });

  it("a signed-in creator goes to their OWN SUB tab, by the session's user id", () => {
    expect(START).toMatch(/\.eq\("id", user\.id\)/);
    // 2026-10-17: profiles live at /:handle — profilePath builds it (and encodes)
    expect(START).toMatch(/`\$\{profilePath\(handle\)\}\?tab=sub`/);
  });

  it("safeNext still refuses the open-redirect shapes the hop could be bent into (teeth)", () => {
    for (const bad of ["//evil.com/earn/start", "https://evil.com", "/\\evil.com", "@evil.com"]) expect(safeNext(bad)).toBe("/home");
  });
});
