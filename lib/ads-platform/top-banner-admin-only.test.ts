import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { offeredFormats, offeredPlacements, parseCatalog } from "./offer";

// owner, 2026-10-24: "there won't be a top banner ad — only admin can use top banner for platform promotion"
const raw = (formats: string[]) => ({
  v: 1,
  settings: { max_placements_per_application: 1, default_slot_count: 3, display_currency: "USD" },
  formats: formats.map((code) => ({ code, name: code, max_file_bytes: 1, aspect_ratio: null, aspect_tolerance: 0 })),
  placements: [
    { code: "global_top_banner", name: "Top", description: null, format_code: "TOP_BANNER", page_scope: ["all_pages"] },
    { code: "feed_banner", name: "Feed", description: null, format_code: "CONTENT_BANNER", page_scope: ["feed"] },
  ],
  durations: [{ id: "d7", name: "7 days", days: 7 }],
  prices: [
    { placement_code: "global_top_banner", duration_id: "d7", currency: "USD", price_minor: 2_500 },
    { placement_code: "feed_banner", duration_id: "d7", currency: "USD", price_minor: 1_999 },
  ],
  promotions: [],
  at: "2026-10-24T00:00:00Z",
});

describe("the top banner is the platform's own — never sold to an advertiser", () => {
  it("even an enabled, priced TOP_BANNER row is left out of the advertiser catalog", () => {
    const cat = parseCatalog(raw(["TOP_BANNER", "CONTENT_BANNER"]))!;
    expect(cat.formats.map((f) => f.code)).toEqual(["CONTENT_BANNER"]);
    expect(offeredFormats(cat).map((f) => f.code)).toEqual(["CONTENT_BANNER"]);
    expect(offeredPlacements(cat, "TOP_BANNER")).toEqual([]);
    expect(cat.placements.map((p) => p.code)).toEqual(["feed_banner"]);
  });
  it("the wizard no longer tells advertisers about the top banner's size", () => {
    const w = readFileSync("features/ads-platform/advertise-wizard.tsx", "utf8");
    expect(w).not.toContain("will not show in the top banner");
    expect(w).not.toContain("too tall for the 32 px strip");
  });
});
