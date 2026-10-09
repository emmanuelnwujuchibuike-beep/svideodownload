import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeCatalog } from "@/lib/ads-platform/public-summary";

/** Landing + Download brief (owner, 2026-10-08). */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const catalog = (o: Record<string, unknown> = {}) => ({
  v: 1,
  settings: { ads_enabled: true, applications_open: false, multi_placement_enabled: false, max_placements_per_application: 1, display_currency: "USD", default_slot_count: 10 },
  formats: [{ code: "CONTENT_BANNER", name: "Content banner", media_types: ["image"], width: 320, height: 200 }],
  placements: [
    { code: "feed_banner", name: "Feed", description: null, format_code: "CONTENT_BANNER", page_scope: ["feed"] },
    { code: "reels_banner", name: "Reels", description: null, format_code: "CONTENT_BANNER", page_scope: ["reels"] },
    { code: "orphan", name: "Disabled format's slot", description: null, format_code: "GONE", page_scope: [] },
  ],
  durations: [],
  prices: [],
  promotions: [],
  at: "2026-10-08T00:00:00Z",
  ...o,
});

describe("public advertising summary (§13–§16, §36)", () => {
  it("advertising switched off ⇒ nothing to show (the section hides)", () => {
    expect(summarizeCatalog(catalog({ settings: { ...catalog().settings, ads_enabled: false } })).enabled).toBe(false);
    expect(summarizeCatalog(null).enabled).toBe(false);
  });

  it("only placements of ENABLED formats, by their human names", () => {
    expect(summarizeCatalog(catalog()).placements).toEqual(["Feed", "Reels"]);
  });

  it("a promotion only while it is live; an expired one never shows", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    const live = { id: "a", name: "Launch offer", description: null, placement_code: null, duration_id: null, extra_days: 5, discount_percent: 0, ends_at: "2026-10-31T00:00:00Z", created_at: "2026-10-01T00:00:00Z" };
    const gone = { ...live, id: "b", name: "Old", extra_days: 9, ends_at: "2026-10-01T00:00:00Z" };
    expect(summarizeCatalog(catalog({ promotions: [gone, live] }), now).promotion).toEqual({ name: "Launch offer", extraDays: 5, discountPercent: 0 });
    expect(summarizeCatalog(catalog({ promotions: [gone] }), now).promotion).toBeNull();
  });
});

describe("the landing page structure", () => {
  const page = src("app/(marketing)/page.tsx");

  it("Download first, then shortcuts, Frenz AI, Discover, Promote — before the downloader story", () => {
    const order = ["<Hero />", "<FrenzAiSection />", "<DiscoverSection />", "<PromoteSection", "<FeaturesGrid />", "<HowItWorks />", "<Faq />"].map((t) => page.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the third listing of the platforms and the duplicate ecosystem grid are gone", () => {
    expect(page).not.toContain("<PlatformShowcase />");
    expect(page).not.toContain("<ProductGrid />");
    // the header's "Products" link still has somewhere to land
    expect(src("components/landing/ecosystem.tsx")).toContain('<section id="products"');
  });

  it("no ad-serving engine for a CTA: the Promote section is links + a build-time summary (§27)", () => {
    const eco = src("components/landing/ecosystem.tsx");
    expect(eco).not.toMatch(/ads-platform\/(serving|eligibility|ad-events)|use client/);
    expect(page).toContain("const ads = await getPublicAdSummary();");
  });

  it("owner 2026-10-08: no shortcut row; the Promote card sits where the trust pill was, and the pill moved under the paste box", () => {
    expect(src("components/landing/hero.tsx")).toMatch(/hideEmptyStats/);
    expect(src("components/landing/hero.tsx")).not.toContain("quickActions");
    const hero = src("features/downloads/downloads-sections.tsx");
    // 2026-10-09 (owner): the promote button left the hero for fixed homes (promote-button.tsx)
    expect(hero).not.toContain("PromoteBubble");
    expect(hero).not.toContain("<PromoteCard");
    const core = src("features/downloads/download-page-core.tsx");
    // later the same day (owner): "remove this fast, secure and private card entirely"
    expect(core).not.toContain("<TrustPills");
    expect(hero).not.toContain("export function TrustPills");
    // one Promote door per page: the hero's — no second row lower down
    expect(core).not.toContain("promoteCta");
  });

  it("owner 2026-10-09: the credits strip (with Earn) tops /downloads; the landing has no Earn at the top", () => {
    expect(src("features/downloads/downloads-page.tsx")).toMatch(/<DownloadPageCore\s+topCredits="strip"/);
    expect(src("components/landing/hero.tsx")).toContain("topCredits={null}");
    expect(src("components/landing/hero.tsx")).not.toContain('topCredits="earn"');
    const core = src("features/downloads/download-page-core.tsx");
    // 2026-10-08 (owner): smaller, on the headline's row — it no longer pushes the headline down
    expect(core).toContain('<DownloadsHero trailing={topCredits === "earn" ? <EarnButton size="md" /> : undefined}');
    // /downloads drops the paragraph but shows the line under the credits card (owner, 2026-10-08 / 2026-10-09)
    expect(core).toContain('subtitle={topCredits !== "strip"}');
    expect(src("features/downloads/downloads-sections.tsx")).toContain('<h1 className="sr-only">Download</h1>');
    // one Earn definition, shared by the strip and the landing
    expect(src("features/ai/design/ai-credit-strip.tsx")).toContain("<EarnButton />");
  });
});
