import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applicationState, destinationHost, detailsProblems, normalizeDestination, sanitizeText } from "./application";
import { aspectFits, checkDestinationUrl, validateCreative, type CreativeLimits } from "./creative-validation";
import { adMessage } from "./messages";
import {
  bestPromotion,
  estimate,
  formatMoney,
  formatSpecs,
  fromPrice,
  isStripFormat,
  recommendedSize,
  STRIP_GUIDANCE,
  maxPlacements,
  offeredDurations,
  offeredFormats,
  offeredPlacements,
  parseCatalog,
  type AdCatalog,
  type CatalogFormat,
} from "./offer";
import { ADVERTISING_RULES, ADVERTISING_RULES_VERSION, AUTOMATED_VALIDATION_NOTICE, RULES_CHECKBOX_TEXT } from "./rules";

/**
 * Part 2 — the advertiser application. The menu, the estimate, the creative
 * rules, the destination, the rules agreement and the state an advertiser
 * sees. The SQL side (ad_catalog, the blocklist, the rules constraint, the
 * staging bucket) was executed against a real Postgres: 77 checks with 0195.
 */

const NOW = Date.parse("2026-10-07T12:00:00Z");
const D1 = "d1";
const D7 = "d7";
const D30 = "d30";

function fmt(code: string, over: Partial<CatalogFormat> = {}): CatalogFormat {
  return {
    code, name: code, description: null, recommendation: null, media_types: ["image"], width: null, height: null, rotation_seconds: null,
    max_duration_seconds: null, max_file_bytes: 5_000_000, max_width: 2160, max_height: 3840, min_width: null, min_height: null,
    aspect_ratio: null, aspect_tolerance: 0.12, delivery_long_edge: 1280, image_quality: 82, max_upload_bytes: null, ...over,
  };
}

function catalog(over: Partial<AdCatalog> = {}): AdCatalog {
  return {
    v: 1,
    settings: { ads_enabled: true, applications_open: true, multi_placement_enabled: false, max_placements_per_application: 3, display_currency: "USD", default_slot_count: 10 },
    formats: [
      fmt("TOP_BANNER", { height: 32, rotation_seconds: 5, min_width: 640, min_height: 64, aspect_ratio: 10, aspect_tolerance: 0.35 }),
      fmt("INTERSTITIAL", { media_types: ["image", "video"], max_duration_seconds: 30 }),
      fmt("REWARD_VIDEO", { media_types: ["video"], max_duration_seconds: 15, max_file_bytes: 50 * 1024 * 1024, min_width: 540, min_height: 960, aspect_ratio: 0.5625 }),
    ],
    placements: [
      { code: "global_top_banner", name: "Top banner", description: null, format_code: "TOP_BANNER", page_scope: ["all_pages"] },
      { code: "feed_banner", name: "Feed", description: null, format_code: "TOP_BANNER", page_scope: ["feed"] },
      { code: "interstitial", name: "Interstitial", description: null, format_code: "INTERSTITIAL", page_scope: ["all_pages"] },
      { code: "ai_video_save_reward", name: "AI video save reward", description: null, format_code: "REWARD_VIDEO", page_scope: ["ai"] },
    ],
    durations: [
      { id: D1, name: "1 day", days: 1 },
      { id: D7, name: "7 days", days: 7 },
      { id: D30, name: "30 days", days: 30 },
    ],
    prices: [
      { placement_code: "global_top_banner", duration_id: D1, currency: "USD", price_minor: 500 },
      { placement_code: "global_top_banner", duration_id: D7, currency: "USD", price_minor: 2_500 },
      { placement_code: "global_top_banner", duration_id: D30, currency: "USD", price_minor: 9_000 },
      { placement_code: "feed_banner", duration_id: D7, currency: "USD", price_minor: 1_999 },
      { placement_code: "ai_video_save_reward", duration_id: D7, currency: "USD", price_minor: 4_000 },
      // priced in NGN only - not for sale while the display currency is USD
      { placement_code: "interstitial", duration_id: D7, currency: "NGN", price_minor: 1_000_000 },
    ],
    promotions: [],
    at: new Date(NOW).toISOString(),
    ...over,
  };
}

const codes = <T extends { code: string }>(xs: T[]) => xs.map((x) => x.code);

describe("the menu: only admin-enabled, PRICED options", () => {
  it("formats: a format with no priced placement is not offered", () => {
    expect(codes(offeredFormats(catalog()))).toEqual(["TOP_BANNER", "REWARD_VIDEO"]);
  });
  it("disabled format (absent from ad_catalog) is not offered", () => {
    const c = catalog();
    c.formats = c.formats.filter((f) => f.code !== "REWARD_VIDEO");
    c.placements = c.placements.filter((p) => p.format_code !== "REWARD_VIDEO");
    expect(codes(offeredFormats(c))).toEqual(["TOP_BANNER"]);
  });
  it("placements: only of the chosen format, only priced — no invalid format/placement pair", () => {
    expect(codes(offeredPlacements(catalog(), "TOP_BANNER"))).toEqual(["global_top_banner", "feed_banner"]);
    expect(codes(offeredPlacements(catalog(), "REWARD_VIDEO"))).toEqual(["ai_video_save_reward"]);
    expect(codes(offeredPlacements(catalog(), "INTERSTITIAL"))).toEqual([]);
  });
  it("disabled placement (absent) disappears", () => {
    const c = catalog({ placements: catalog().placements.filter((p) => p.code !== "feed_banner") });
    expect(codes(offeredPlacements(c, "TOP_BANNER"))).toEqual(["global_top_banner"]);
  });
  it("durations: enabled and priced for EVERY chosen placement", () => {
    expect(offeredDurations(catalog(), ["global_top_banner"]).map((d) => d.id)).toEqual([D1, D7, D30]);
    expect(offeredDurations(catalog(), ["global_top_banner", "feed_banner"]).map((d) => d.id)).toEqual([D7]);
    expect(offeredDurations(catalog(), [])).toEqual([]);
  });
  it("a duration the admin removes disappears, one the admin adds appears", () => {
    const removed = catalog({ durations: catalog().durations.filter((d) => d.id !== D30) });
    expect(offeredDurations(removed, ["global_top_banner"]).map((d) => d.name)).toEqual(["1 day", "7 days"]);
    const added = catalog({
      durations: [...catalog().durations, { id: "d5", name: "5 days", days: 5 }],
      prices: [...catalog().prices, { placement_code: "global_top_banner", duration_id: "d5", currency: "USD", price_minor: 2_000 }],
    });
    expect(offeredDurations(added, ["global_top_banner"]).map((d) => d.name)).toContain("5 days");
  });
  it("multiple placements only when the admin turns it on, up to the admin's number", () => {
    expect(maxPlacements(catalog())).toBe(1);
    expect(maxPlacements(catalog({ settings: { ...catalog().settings, multi_placement_enabled: true, max_placements_per_application: 2 } }))).toBe(2);
  });
  it("parseCatalog normalises Postgres numerics and refuses junk", () => {
    const raw = JSON.parse(JSON.stringify(catalog()));
    raw.prices[0].price_minor = "500";
    raw.formats[0].aspect_ratio = "10.0000";
    const c = parseCatalog(raw)!;
    expect(c.prices[0]!.price_minor).toBe(500);
    expect(c.formats[0]!.aspect_ratio).toBe(10);
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog({ v: 2 })).toBeNull();
    expect(parseCatalog({ ...raw, prices: "x" })).toBeNull();
  });
});

describe("price estimate — follows ad_campaign_quote rule for rule", () => {
  it("normal price", () => {
    expect(estimate(catalog(), ["global_top_banner"], D7, NOW)).toMatchObject({ currency: "USD", subtotal: 2_500, discount: 0, total: 2_500 });
  });
  it("changed admin price is the price", () => {
    const c = catalog();
    c.prices[1] = { ...c.prices[1]!, price_minor: 3_100 };
    expect(estimate(c, ["global_top_banner"], D7, NOW)!.total).toBe(3_100);
  });
  it("disabled duration ⇒ no estimate", () => {
    expect(estimate(catalog({ durations: catalog().durations.filter((d) => d.id !== D7) }), ["global_top_banner"], D7, NOW)).toBeNull();
  });
  it("multiple placements: the sum of each line", () => {
    const e = estimate(catalog(), ["global_top_banner", "feed_banner"], D7, NOW)!;
    expect(e.lines.map((l) => l.total)).toEqual([2_500, 1_999]);
    expect(e.total).toBe(4_499);
  });
  it("promotion: discount rounded DOWN, bonus days, best one wins like the SQL", () => {
    const c = catalog({
      promotions: [
        { id: "a", name: "Weekly promo", description: null, placement_code: null, duration_id: D7, extra_days: 2, discount_percent: 15, ends_at: null, created_at: "2026-10-01T00:00:00Z" },
        { id: "b", name: "Smaller", description: null, placement_code: null, duration_id: D7, extra_days: 9, discount_percent: 10, ends_at: null, created_at: "2026-09-01T00:00:00Z" },
      ],
    });
    const feed = estimate(c, ["feed_banner"], D7, NOW)!;
    expect(feed.lines[0]).toMatchObject({ discountPercent: 15, discount: 299, total: 1_700, extraDays: 2 }); // 1999 × 15% = 299.85 → 299
    expect(bestPromotion(c, "feed_banner", D7, NOW)!.name).toBe("Weekly promo");
    expect(bestPromotion(c, "feed_banner", D30, NOW)).toBeNull(); // not this duration
  });
  it("a promotion that ends while the page is open stops being offered at once", () => {
    const c = catalog({ promotions: [{ id: "x", name: "Flash", description: null, placement_code: null, duration_id: null, extra_days: 1, discount_percent: 50, ends_at: new Date(NOW + 60_000).toISOString(), created_at: "2026-10-01T00:00:00Z" }] });
    expect(estimate(c, ["global_top_banner"], D7, NOW)!.total).toBe(1_250);
    expect(estimate(c, ["global_top_banner"], D7, NOW + 61_000)!.total).toBe(2_500);
  });
  it("the TS order is the SQL order (teeth: the quote's ORDER BY and floor are pinned)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0195_ad_platform_foundation.sql"), "utf8");
    expect(sql).toContain("order by discount_percent desc, extra_days desc, created_at");
    expect(sql).toContain("floor(v_price * v_discount / 100)");
  });
  it("money in the advertiser's terms, and 'from' prices", () => {
    expect(formatMoney(2_500, "USD")).toBe("$25");
    expect(formatMoney(1_999, "USD")).toBe("$19.99");
    expect(formatMoney(125_000, "NGN")).toBe("₦1,250");
    expect(formatMoney(1, "CREDIT")).toBe("1 credit");
    expect(fromPrice(catalog(), "TOP_BANNER")).toBe(500);
  });
});

describe("format information is the admin's CURRENT configuration", () => {
  const reward = catalog().formats.find((f) => f.code === "REWARD_VIDEO")!;
  it("reward video shows the current maximum — 15, then 20 when the admin changes it", () => {
    expect(formatSpecs(reward)).toContain("Video up to 15 s");
    expect(formatSpecs({ ...reward, max_duration_seconds: 20 })).toContain("Video up to 20 s");
  });
  it("sizes: a strip, a card, full-screen", () => {
    // 2026-10-10 (owner): the strip asks for an image 32–40 px tall and fits its width to every screen
    expect(formatSpecs(catalog().formats[0]!)[0]).toBe("Image 32–40 px tall, fitted to every screen");
    expect(formatSpecs(fmt("C", { width: 320, height: 200 }))[0]).toBe("320 × 200");
    expect(formatSpecs(catalog().formats[1]!)[0]).toBe("Full-screen");
  });
});

describe("creative rules (the same function the server runs on the real bytes)", () => {
  const lim = (f: CatalogFormat): CreativeLimits => ({
    code: f.code, mediaTypes: f.media_types, maxDurationSeconds: f.max_duration_seconds, maxFileBytes: f.max_file_bytes, maxWidth: f.max_width,
    maxHeight: f.max_height, minWidth: f.min_width, minHeight: f.min_height, aspectRatio: f.aspect_ratio, aspectTolerance: f.aspect_tolerance,
  });
  const banner = lim(catalog().formats[0]!);
  const reward = lim(catalog().formats[2]!);
  const img = (o: object) => validateCreative({ formatCode: "TOP_BANNER", mediaType: "image", mimeType: "image/png", fileSizeBytes: 50_000, width: 1280, height: 128, destinationUrl: null, ...o }, banner);
  const vid = (d: number, o: object = {}) => validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", mimeType: "video/mp4", fileSizeBytes: 5_000_000, width: 1080, height: 1920, durationSeconds: d, destinationUrl: null, ...o }, reward);

  it("valid image; invalid image (too small, oversized) — never refused for its SHAPE (0208)", () => {
    expect(img({}).status).toBe("valid");
    expect(img({ width: 320, height: 32 }).errors).toContain("dimensions_too_small");
    // a square image for a 10:1 strip is valid: it is shown whole, with space around it
    expect(img({ width: 1280, height: 1280 }).status).toBe("valid");
    expect(img({ width: 1280, height: 1280 }).errors).not.toContain("wrong_shape");
    expect(img({ fileSizeBytes: 6_000_000 }).errors).toContain("file_too_large");
  });
  it("upload caps are orientation-agnostic: a 4K landscape video passes a 2160 × 3840 cap", () => {
    expect(vid(10, { width: 3840, height: 2160 }).errors).not.toContain("dimensions_too_large");
    expect(vid(10, { width: 1920, height: 1080 }).status).toBe("valid"); // landscape in a portrait format
    expect(vid(10, { width: 4096, height: 2160 }).errors).toContain("dimensions_too_large"); // past the long edge
    expect(img({ width: 128, height: 1280 }).errors).not.toContain("dimensions_too_small"); // portrait strip art, rotated min
  });
  it("a video that will be transcoded may be uploaded larger than it is served — up to the upload cap", () => {
    const big = { ...reward, maxUploadBytes: 200 * 1024 * 1024, videoProcessing: true };
    const v = (bytes: number, lim: typeof reward) => validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", mimeType: "video/mp4", fileSizeBytes: bytes, width: 3840, height: 2160, durationSeconds: 10, destinationUrl: null }, lim);
    expect(v(120 * 1024 * 1024, big).status).toBe("valid");
    expect(v(120 * 1024 * 1024, reward).errors).toContain("file_too_large"); // no transcoder: the served cap applies
    expect(v(250 * 1024 * 1024, big).errors).toContain("file_too_large"); // past the upload cap
    // teeth: duration is never transcoded away
    expect(validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", mimeType: "video/mp4", fileSizeBytes: 1, width: 3840, height: 2160, durationSeconds: 16, destinationUrl: null }, big).errors).toContain("video_too_long");
  });
  it("valid video; oversized video", () => {
    expect(vid(10).status).toBe("valid");
    expect(vid(10, { fileSizeBytes: 60 * 1024 * 1024 }).errors).toContain("file_too_large");
  });
  it("reward video: under the limit, exactly at it, over it", () => {
    expect([vid(10).status, vid(15).status, vid(16).status]).toEqual(["valid", "valid", "invalid"]);
    const at20 = { ...reward, maxDurationSeconds: 20 };
    const v20 = (d: number) => validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", fileSizeBytes: 1, width: 1080, height: 1920, durationSeconds: d, destinationUrl: null }, at20).status;
    expect([v20(18), v20(20), v20(21)]).toEqual(["valid", "valid", "invalid"]);
  });
  it("aspect ratio within the admin's tolerance", () => {
    expect(aspectFits(1080, 1920, 0.5625, 0.12)).toBe(true);
    expect(aspectFits(1080, 1350, 0.5625, 0.12)).toBe(false);
    expect(aspectFits(500, 500, null, 0.12)).toBe(true);
  });
  it("an image on a video-only format is refused", () => {
    expect(validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "image", fileSizeBytes: 1, width: 1080, height: 1920, destinationUrl: null }, reward).errors).toContain("media_type_not_allowed");
  });
});

describe("destination URL", () => {
  it("valid, malformed, unsafe", () => {
    expect(checkDestinationUrl(normalizeDestination("acme.com/shop")).status).toBe("valid");
    expect(normalizeDestination("acme.com")).toBe("https://acme.com");
    expect(checkDestinationUrl(normalizeDestination("http://acme.com")).status).toBe("blocked");
    expect(checkDestinationUrl(normalizeDestination("acme")).status).toBe("blocked");
    expect(checkDestinationUrl("javascript:alert(1)").status).toBe("blocked");
    expect(checkDestinationUrl("https://10.0.0.1/admin").status).toBe("blocked");
  });
  it("shows the host, read from the string — never fetched", () => {
    expect(destinationHost("https://www.acme.com/a?b=1")).toBe("acme.com");
    expect(destinationHost("nonsense")).toBeNull();
  });
  it("the blocklist runs on the server for every submission and every activation; the only link probe is the restricted one", () => {
    const server = readFileSync(join(process.cwd(), "lib/ads-platform/server.ts"), "utf8");
    expect(server).toMatch(/export async function checkDestination[\s\S]*checkDestinationUrl\(raw\)[\s\S]*destinationHeuristics\(url\)[\s\S]*blockedDomain\(db, host\)/);
    expect(server).toContain("await checkDestination(db, cr.destination_url, { deep: true })");
    const adv = readFileSync(join(process.cwd(), "lib/ads-platform/advertiser-server.ts"), "utf8");
    expect(adv).toContain("const dest = await checkDestination(db, destinationUrl, { deep: true });");
    // SSRF: the advertiser server fetches only the STAGING url it minted itself
    expect([...adv.matchAll(/\bfetch\(/g)]).toHaveLength(1);
    expect(adv).toMatch(/createSignedUrl\(path, 120\)[\s\S]*await fetch\(url,/);
    // Part 8: the advertiser's link is probed ONLY through url-safety's restricted HEAD (no fetch of the page)
    const safety = readFileSync(join(process.cwd(), "lib/ads-platform/url-safety.ts"), "utf8");
    expect(safety).toContain('method: "HEAD"');
    expect(safety).toContain("lookup: safeLookup as never");
    expect(safety).not.toMatch(/fetch\(\s*(raw|url|current|next)\b/);
  });
});

describe("text is made inert", () => {
  it("strips markup, control and bidi characters, collapses space, caps length", () => {
    expect(sanitizeText("  Big <b>sale</b>\u0000 ‮today  ", 90)).toBe("Big sale today");
    expect(sanitizeText("<script>alert(1)</script>Hi", 90)).toBe("alert(1) Hi");
    expect(sanitizeText("x".repeat(200), 90)).toHaveLength(90);
    expect(sanitizeText(42, 10)).toBe("");
  });
  it("details: name and brand required, headline and description optional but capped", () => {
    expect(detailsProblems({ name: "", businessName: "", headline: "", description: "" })).toEqual({ name: expect.any(String), businessName: expect.any(String) });
    expect(detailsProblems({ name: "A", businessName: "B", headline: "", description: "" })).toEqual({});
    expect(detailsProblems({ name: "A", businessName: "B", headline: "h".repeat(91), description: "" }).headline).toBeTruthy();
  });
});

describe("errors in plain words, with the real numbers", () => {
  it("the brief's examples, word for word", () => {
    expect(adMessage("video_too_long", { durationSeconds: 18, maxDurationSeconds: 15 })).toBe("That video is 18 seconds long. The current maximum is 15 seconds.");
    expect(adMessage("format_unavailable")).toBe("This ad format is currently unavailable.");
    expect(adMessage("duration_unavailable")).toBe("This campaign duration is no longer available. Please choose another.");
    expect(adMessage("file_too_large", { mediaType: "image" })).toBe("Your image is larger than the allowed file size.");
    expect(adMessage("url_invalid")).toMatch(/^Please enter a valid destination URL/);
    expect(adMessage("payment_not_started")).toBe("Payment could not be started. Your campaign has not been charged.");
  });
  it("an unknown code is a generic line — never an internal error", () => {
    expect(adMessage("PGRST116 relation does not exist")).toBe("Something went wrong on our side. Please try again.");
  });
});

describe("advertising rules", () => {
  it("cover every required area", () => {
    expect(ADVERTISING_RULES.map((r) => r.id)).toEqual(["privacy", "scams", "malicious", "misleading", "illegal", "safety", "responsibility", "enforcement"]);
    const all = JSON.stringify(ADVERTISING_RULES).toLowerCase();
    for (const w of ["passwords", "authentication", "phishing", "fake investment", "impersonation", "malware", "spyware", "redirect", "fake testimonials", "fake urgency", "misleading buttons", "unintentionally", "disabling security", "pause", "suspend"]) {
      expect(all, w).toContain(w);
    }
  });
  it("the checkbox wording and the validation notice are the brief's", () => {
    expect(RULES_CHECKBOX_TEXT).toBe(
      "I have read and agree to the Frenzsave Advertising Rules. I confirm that my advertisement and destination URL do not contain scams, malicious links, phishing, deceptive content, privacy violations, or prohibited material.",
    );
    expect(AUTOMATED_VALIDATION_NOTICE).toBe("After successful payment, your campaign can go live immediately if it passes our automated validation and safety checks.");
    expect(ADVERTISING_RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("unchecked by default, payment button disabled until checked, and the server refuses without it", () => {
    const wiz = readFileSync(join(process.cwd(), "features/ads-platform/advertise-wizard.tsx"), "utf8");
    expect(wiz).toContain("const [rulesAccepted, setRulesAccepted] = useState(false);");
    // §55: the CTA's resting label; disabled until the rules are accepted
    expect(wiz).toContain(': "Continue to Payment";');
    expect(wiz).toMatch(/disabled=\{!rulesAccepted \|\|/);
    // never persisted: a reload asks again
    expect(wiz).not.toMatch(/rulesAccepted[^\n]*sessionStorage|sessionStorage[^\n]*rulesAccepted/);
    const adv = readFileSync(join(process.cwd(), "lib/ads-platform/advertiser-server.ts"), "utf8");
    expect(adv).toContain('if (input.rulesAccepted !== true) refuse("rules_not_accepted");');
    expect(adv).toContain('if (input.rulesVersion !== ADVERTISING_RULES_VERSION) refuse("rules_outdated", 409);');
    const route = readFileSync(join(process.cwd(), "app/api/ads/advertiser/submit/route.ts"), "utf8");
    expect(route).toContain("rulesAccepted: body.rulesAccepted === true");
  });
});

describe("the server never takes a price, a promotion or a duration from the browser", () => {
  it("no route reads price, total, discount, promotion, days or status from the body", () => {
    for (const r of ["draft", "upload", "upload/finalize", "submit"]) {
      const src = readFileSync(join(process.cwd(), `app/api/ads/advertiser/${r}/route.ts`), "utf8");
      expect(src, r).not.toMatch(/body\.(price|total|amount|discount|promotion|extra|days|status|currency|width|height|duration(?!Id)|mediaUrl)/i);
    }
  });
  it("the locked price comes from the database quote, and the finalize verdict from the stored bytes", () => {
    const adv = readFileSync(join(process.cwd(), "lib/ads-platform/advertiser-server.ts"), "utf8");
    expect(adv).toContain('db.rpc("ad_campaign_quote", { p_campaign: r.id, p_currency: cat.settings.display_currency })');
    // 0208: nothing above the cap is even probed; the cap grows past the served size only when a transcoder exists
    expect(adv).toMatch(/const facts = size > sizeCap \? null : await probeMedia\(src\.read, size\);/);
    expect(adv).toContain("const sizeCap = Math.max(limits.maxFileBytes, limits.videoProcessing ? (limits.maxUploadBytes ?? 0) : 0);");
  });
});

describe("application state is read off the ONE campaign status", () => {
  const c = (validation_status: string, url_validation_status = "pending") => ({ status: "active", validation_status, url_validation_status });
  it("maps every phase", () => {
    expect(applicationState("draft", [])).toBe("draft");
    expect(applicationState("draft", [], true)).toBe("uploading");
    expect(applicationState("draft", [c("pending")])).toBe("validation");
    expect(applicationState("draft", [c("invalid")])).toBe("failed");
    expect(applicationState("draft", [c("valid", "blocked")])).toBe("blocked");
    expect(applicationState("awaiting_payment", [c("valid", "valid")])).toBe("ready_for_payment");
    expect(applicationState("payment_processing", [])).toBe("payment_processing");
    expect(applicationState("paid", [])).toBe("activating");
    expect(applicationState("validating", [])).toBe("validation_required");
    expect(applicationState("active", [])).toBe("active");
    expect(applicationState("rejected", [])).toBe("blocked");
  });
  it("there is no manual 'awaiting admin approval' step in the normal flow", () => {
    const all = readFileSync(join(process.cwd(), "lib/ads-platform/application.ts"), "utf8");
    expect(all).not.toMatch(/awaiting_approval|pending_approval|admin_review/);
  });
});

describe("the top strip: an image 32–40 px tall, no description (owner, 2026-10-10)", () => {
  it("the strip is told the height and that its words go in the image", () => {
    const strip = catalog().formats[0]!;
    expect(isStripFormat(strip)).toBe(true);
    expect(recommendedSize(strip)).toBe("an image 32–40 px tall, any width");
    expect(STRIP_GUIDANCE).toMatch(/32–40 px tall/);
    expect(STRIP_GUIDANCE).toMatch(/no description/);
  });

  it("teeth: a card or full-screen format is not a strip", () => {
    expect(isStripFormat({ width: 320, height: 200 })).toBe(false);
    expect(isStripFormat({ width: null, height: null })).toBe(false);
  });

  it("the wizard hides the description and sends none for a strip", () => {
    const wizard = readFileSync(join(process.cwd(), "features/ads-platform/advertise-wizard.tsx"), "utf8");
    expect(wizard).toContain("{format && isStripFormat(format) ? null : (");
    expect(wizard).toContain(`description: format && isStripFormat(format) ? "" : form.description,`);
  });
});
