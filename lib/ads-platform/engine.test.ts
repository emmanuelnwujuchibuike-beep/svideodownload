import { describe, expect, it } from "vitest";

import { checkDestinationUrl, validateCreative, type CreativeLimits } from "./creative-validation";
import { getEligibleAds, type ServingSnapshot, type SnapshotCampaign, type SnapshotCreative, type SnapshotFormat } from "./eligibility";
import { bannerIndexAt, gapElapsed, msUntilNextRotation, pickNextNoRepeat } from "./rotation";
import { adsForPage, buildServingPayload, parseServingPayload } from "./serving-payload";

/**
 * The ad engine (Part 1 of the advertising platform). Every rule the brief
 * names is pinned here against fixtures; the SQL half (prices, payment,
 * activation, slots, RLS) is pinned in sql-contract.test.ts and was executed
 * against a real Postgres when 0195 was written.
 */

const NOW = Date.parse("2026-10-07T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const DAY = 86_400_000;

function fmt(code: string, over: Partial<SnapshotFormat> = {}): SnapshotFormat {
  return {
    code, media_types: ["image", "video"], width: 320, height: 200, rotation_seconds: 5, slot_count: 10,
    no_consecutive_repeat: false, max_duration_seconds: 30, max_file_bytes: 10_485_760, max_width: 2160, max_height: 3840,
    min_gap_seconds: 0, enabled: true, ...over,
  };
}

function creative(id: string, over: Partial<SnapshotCreative> = {}): SnapshotCreative {
  return {
    id, format_code: "TOP_BANNER", media_type: "image", media_url: `https://cdn.frenzsave.com/${id}.webp`, thumbnail_url: null,
    destination_url: "https://acme.com/sale", headline: "Sale", description: null, duration_seconds: null, width: 640, height: 64,
    file_size_bytes: 20_000, status: "active", validation_status: "valid", url_validation_status: "valid", ...over,
  };
}

function campaign(id: string, over: Partial<SnapshotCampaign> = {}, cr: Partial<SnapshotCreative> = {}): SnapshotCampaign {
  return {
    id, placement_code: "global_top_banner", status: "active", payment_verified: true, advertiser_status: "active",
    advertiser_name: "Acme", start_at: iso(-DAY), end_at: iso(6 * DAY), target_pages: [], slot_number: 1,
    creatives: [creative(`${id}-cr`, cr)], ...over,
  };
}

function snapshot(campaigns: SnapshotCampaign[], over: Partial<ServingSnapshot> = {}): ServingSnapshot {
  return {
    settings: { ads_enabled: true, default_slot_count: 10 },
    formats: [
      fmt("TOP_BANNER", { media_types: ["image"], width: null, height: 32, max_duration_seconds: null }),
      fmt("INTERSTITIAL", { rotation_seconds: null, no_consecutive_repeat: true, min_gap_seconds: 120 }),
      fmt("REWARD_VIDEO", { media_types: ["video"], rotation_seconds: null, no_consecutive_repeat: true, max_duration_seconds: 15 }),
    ],
    placements: [
      { code: "global_top_banner", format_code: "TOP_BANNER", page_scope: ["all_pages"], enabled: true, priority: 100 },
      { code: "interstitial", format_code: "INTERSTITIAL", page_scope: ["all_pages"], enabled: true, priority: 100 },
      { code: "ai_video_save_reward", format_code: "REWARD_VIDEO", page_scope: ["ai", "ai_reels"], enabled: true, priority: 100 },
      { code: "feed_banner", format_code: "TOP_BANNER", page_scope: ["feed"], enabled: true, priority: 100 },
    ],
    campaigns,
    ...over,
  };
}

const top = (s: ServingSnapshot, page: "download" | "feed" | "ai" = "download", now = NOW) =>
  getEligibleAds(s, { placement: "global_top_banner", page, now }).map((a) => a.c);

describe("getEligibleAds — the one engine", () => {
  it("serves an active, paid, valid campaign in its window", () => {
    expect(top(snapshot([campaign("a")]))).toEqual(["a"]);
  });

  it.each([
    ["paused", { status: "paused" }],
    ["expired status", { status: "expired" }],
    ["payment unverified", { payment_verified: false }],
    ["advertiser suspended", { advertiser_status: "suspended" }],
    ["advertiser restricted", { advertiser_status: "restricted" }],
    ["window ended", { end_at: iso(-1) }],
    ["not started yet", { start_at: iso(60_000) }],
    ["no window", { start_at: null }],
  ] as const)("does not serve: %s", (_label, over) => {
    expect(top(snapshot([campaign("a", over as Partial<SnapshotCampaign>)]))).toEqual([]);
  });

  it.each([
    ["creative pending", { validation_status: "pending" }],
    ["creative invalid", { validation_status: "invalid" }],
    ["creative blocked", { validation_status: "blocked" }],
    ["destination pending", { url_validation_status: "pending" }],
    ["destination blocked", { url_validation_status: "blocked" }],
    ["destination marked valid but is javascript:", { destination_url: "javascript:alert(1)" }],
    ["destination marked valid but is plain http", { destination_url: "http://acme.com/" }],
    ["creative paused", { status: "paused" }],
    ["wrong format", { format_code: "INTERSTITIAL" }],
    ["video on an image-only format", { media_type: "video", duration_seconds: 5 }],
    ["no media", { media_url: null }],
  ] as const)("does not serve a creative that is %s", (_label, over) => {
    expect(top(snapshot([campaign("a", {}, over as Partial<SnapshotCreative>)]))).toEqual([]);
  });

  it("the global switch, a disabled placement and a disabled format each empty the placement", () => {
    const s = snapshot([campaign("a")]);
    expect(top({ ...s, settings: { ads_enabled: false, default_slot_count: 10 } })).toEqual([]);
    expect(top({ ...s, placements: s.placements.map((p) => ({ ...p, enabled: false })) })).toEqual([]);
    expect(top({ ...s, formats: s.formats.map((f) => ({ ...f, enabled: false })) })).toEqual([]);
    // teeth: the same snapshot with everything on serves
    expect(top(s)).toEqual(["a"]);
  });

  it("a format asked for that is not the placement's format serves nothing", () => {
    const s = snapshot([campaign("a")]);
    expect(getEligibleAds(s, { placement: "global_top_banner", format: "TOP_BANNER", page: "download", now: NOW })).toHaveLength(1);
    expect(getEligibleAds(s, { placement: "global_top_banner", format: "INTERSTITIAL", page: "download", now: NOW })).toHaveLength(0);
  });

  it("an ad-free member (Pro) is served nothing", () => {
    expect(getEligibleAds(snapshot([campaign("a")]), { placement: "global_top_banner", page: "feed", now: NOW, user: { adFree: true } })).toEqual([]);
  });

  it("page targeting: the placement's scope AND the campaign's own pages", () => {
    const s = snapshot([campaign("all"), campaign("feedOnly", { target_pages: ["feed"], slot_number: 2 })]);
    expect(top(s, "feed")).toEqual(["all", "feedOnly"]);
    expect(top(s, "download")).toEqual(["all"]);
    const feed = snapshot([campaign("f", { placement_code: "feed_banner" })]);
    expect(getEligibleAds(feed, { placement: "feed_banner", page: "feed", now: NOW }).map((a) => a.c)).toEqual(["f"]);
    expect(getEligibleAds(feed, { placement: "feed_banner", page: "reels" as "feed", now: NOW })).toEqual([]);
  });

  it("10-slot pool: ordered by slot, capped at the format's slot count", () => {
    const many = Array.from({ length: 12 }, (_, i) => campaign(`c${12 - i}`, { slot_number: 12 - i }));
    const pool = top(snapshot(many));
    expect(pool).toHaveLength(10);
    expect(pool[0]).toBe("c1");
    expect(pool[9]).toBe("c10");
    // the admin's number, not a constant: 3 slots ⇒ 3
    const s3 = snapshot(many);
    s3.formats = s3.formats.map((f) => (f.code === "TOP_BANNER" ? { ...f, slot_count: 3 } : f));
    expect(top(s3)).toHaveLength(3);
    // null slot_count falls back to the platform default
    const sd = snapshot(many, { settings: { ads_enabled: true, default_slot_count: 4 } });
    sd.formats = sd.formats.map((f) => ({ ...f, slot_count: null }));
    expect(top(sd)).toHaveLength(4);
  });
});

describe("reward video — the creative limit is the admin's CURRENT number", () => {
  const reward = (seconds: number | null, max = 15) => {
    const s = snapshot([campaign("r", { placement_code: "ai_video_save_reward" }, { format_code: "REWARD_VIDEO", media_type: "video", duration_seconds: seconds, media_url: "https://cdn.frenzsave.com/r.mp4" })]);
    s.formats = s.formats.map((f) => (f.code === "REWARD_VIDEO" ? { ...f, max_duration_seconds: max } : f));
    return getEligibleAds(s, { placement: "ai_video_save_reward", page: "ai", now: NOW }).length === 1;
  };
  it("default 15 s: 15 s serves, 30 s does not, unknown does not", () => {
    expect(reward(15)).toBe(true);
    expect(reward(30)).toBe(false);
    expect(reward(15.5)).toBe(false);
    expect(reward(null)).toBe(false);
  });
  it("admin raises to 20 s: 15 and 18 serve, 21 does not — no deploy, same creative rows", () => {
    expect(reward(15, 20)).toBe(true);
    expect(reward(18, 20)).toBe(true);
    expect(reward(21, 20)).toBe(false);
  });
  it("admin lowers to 10 s: an already-valid 15 s video stops serving at once", () => {
    expect(reward(15, 10)).toBe(false);
  });
});

describe("three different lengths are never confused", () => {
  it("a 7-day campaign with a 15 s video and a 5 s rotation — changing one moves nothing else", () => {
    const base = snapshot([campaign("r", { placement_code: "ai_video_save_reward", start_at: iso(-DAY), end_at: iso(6 * DAY) }, { format_code: "REWARD_VIDEO", media_type: "video", duration_seconds: 15, media_url: "https://cdn.frenzsave.com/r.mp4" })]);
    const served = (s: ServingSnapshot) => getEligibleAds(s, { placement: "ai_video_save_reward", page: "ai", now: NOW });
    const [ad] = served(base);
    expect(ad!.duration).toBe(15);
    expect(Date.parse(ad!.end) - Date.parse(ad!.start)).toBe(7 * DAY);
    // a rotation change does not touch the window or the creative limit
    const rot = { ...base, formats: base.formats.map((f) => ({ ...f, rotation_seconds: 60 })) };
    expect(served(rot)[0]!.end).toBe(ad!.end);
    expect(served(rot)[0]!.duration).toBe(15);
    // a video limit change does not touch the window
    const lim = { ...base, formats: base.formats.map((f) => ({ ...f, max_duration_seconds: 120 })) };
    expect(served(lim)[0]!.end).toBe(ad!.end);
  });
});

describe("validateCreative — the verdict written to the row", () => {
  const REWARD: CreativeLimits = { code: "REWARD_VIDEO", mediaTypes: ["video"], maxDurationSeconds: 15, maxFileBytes: 50 * 1024 * 1024, maxWidth: 2160, maxHeight: 3840 };
  const video = (durationSeconds: number | null, over: object = {}) =>
    validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", mimeType: "video/mp4", durationSeconds, fileSizeBytes: 4_000_000, width: 1080, height: 1920, destinationUrl: "https://acme.com/", ...over }, REWARD);

  it("15 s valid, 30 s invalid, over-limit by a fraction invalid", () => {
    expect(video(15).status).toBe("valid");
    expect(video(30)).toEqual({ status: "invalid", errors: ["video_too_long"] });
    expect(video(15.01).status).toBe("invalid");
  });
  it("uses the limit it is given: max 20 ⇒ 18 valid, 21 invalid", () => {
    const at20 = { ...REWARD, maxDurationSeconds: 20 };
    const v = (d: number) => validateCreative({ formatCode: "REWARD_VIDEO", mediaType: "video", durationSeconds: d, fileSizeBytes: 1, width: 1, height: 1, destinationUrl: "https://acme.com/" }, at20).status;
    expect([v(15), v(18), v(20), v(21)]).toEqual(["valid", "valid", "valid", "invalid"]);
  });
  it("refuses an image on a video-only format, a wrong mime, too large, unknown facts, a bad URL", () => {
    expect(video(10, { mediaType: "image", mimeType: "image/png" }).errors).toContain("media_type_not_allowed");
    expect(video(10, { mimeType: "video/x-msvideo" }).errors).toContain("mime_not_allowed");
    // 0209: a MOV is refused only when nothing can transcode it — with "export as MP4", not "wrong type"
    expect(video(10, { mimeType: "video/quicktime" }).errors).toContain("quicktime");
    expect(video(10, { fileSizeBytes: 60 * 1024 * 1024 }).errors).toContain("file_too_large");
    expect(video(10, { width: 4000 }).errors).toContain("dimensions_too_large");
    expect(video(null).errors).toContain("duration_unknown");
    expect(video(10, { fileSizeBytes: null, width: null }).errors).toEqual(expect.arrayContaining(["size_unknown", "dimensions_unknown"]));
    expect(video(10, { destinationUrl: "ftp://acme.com" }).errors).toContain("destination_not_valid");
    expect(video(10, { formatCode: "TOP_BANNER" }).errors).toContain("format_mismatch");
  });
});

describe("checkDestinationUrl — never an obviously invalid URL", () => {
  it.each(["https://acme.com", "https://shop.acme.co.uk/p?id=1#x", "https://xn--80ak6aa92e.com/", "https://acme.com:443/a"])("valid: %s", (u) => {
    expect(checkDestinationUrl(u).status).toBe("valid");
  });
  it.each([
    "javascript:alert(1)", "data:text/html,hi", "http://acme.com", "https://localhost/", "https://192.168.0.1/", "https://[::1]/",
    "https://user:pw@acme.com/", "https://acme.com:8443/", "https://acme", "https://printer.local/", "https://a.internal/", "not a url",
    "https://acme .com", "https://-acme.com/", "", "https://acme.c0m/",
  ])("blocked: %s", (u) => {
    expect(checkDestinationUrl(u).status).toBe("blocked");
  });
  it("never throws on junk", () => {
    expect(checkDestinationUrl(null).status).toBe("blocked");
    expect(checkDestinationUrl(undefined).status).toBe("blocked");
    expect(checkDestinationUrl("https://" + "a".repeat(3000) + ".com").status).toBe("blocked");
  });
});

describe("rotation — local, no request", () => {
  it("5-second banner rotation walks the pool and wraps", () => {
    const seq = [0, 4_999, 5_000, 9_999, 10_000, 15_000, 50_000].map((ms) => bannerIndexAt(ms, 5, 3));
    expect(seq).toEqual([0, 0, 1, 1, 2, 0, 1]);
    expect(bannerIndexAt(12_000, 5, 1)).toBe(0);
    expect(bannerIndexAt(12_000, null, 4)).toBe(0);
    expect(msUntilNextRotation(1_200, 5, 3)).toBe(3_800);
    expect(msUntilNextRotation(1_200, 5, 1)).toBeNull();
  });

  it("no consecutive duplicate across 1000 interstitials while ≥2 ads exist", () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ cr: `ad${i + 1}` }));
    let last: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const next: { cr: string } = pickNextNoRepeat(pool, last, () => 0.37)!;
      expect(next.cr).not.toBe(last);
      seen.push(next.cr);
      last = next.cr;
    }
    expect(new Set(seen).size).toBe(10); // every slot gets its turn
    expect(seen.slice(0, 4)).toEqual(["ad4", "ad5", "ad6", "ad7"]); // round-robin: Ad 1, Ad 2, Ad 3 …
  });

  it("two ads alternate, one ad repeats (nothing else to show), none ⇒ null", () => {
    const two = [{ cr: "a" }, { cr: "b" }];
    expect([pickNextNoRepeat(two, "a")!.cr, pickNextNoRepeat(two, "b")!.cr]).toEqual(["b", "a"]);
    expect(pickNextNoRepeat([{ cr: "a" }], "a")!.cr).toBe("a");
    expect(pickNextNoRepeat([], null)).toBeNull();
    // teeth: a last id no longer in the pool restarts from the spread start
    expect(pickNextNoRepeat(two, "gone", () => 0.9)!.cr).toBe("b");
  });

  it("frequency limit: the format's min gap", () => {
    expect(gapElapsed(null, 120, NOW)).toBe(true);
    expect(gapElapsed(NOW - 119_000, 120, NOW)).toBe(false);
    expect(gapElapsed(NOW - 120_000, 120, NOW)).toBe(true);
    expect(gapElapsed(NOW, 0, NOW)).toBe(true);
  });
});

describe("serving payload — one small public answer", () => {
  const s = snapshot([campaign("a"), campaign("late", { slot_number: 2, start_at: iso(2 * 60_000) }), campaign("feed", { slot_number: 3, target_pages: ["feed"] })]);
  const payload = buildServingPayload(s, 123, NOW);

  it("carries the pool, the admin rules and nothing private", () => {
    expect(Object.keys(payload.placements)).toEqual(["global_top_banner"]); // empty placements are left out
    const p = payload.placements.global_top_banner!;
    expect(p.rules).toMatchObject({ rotationSeconds: 5, slotCount: 10, noRepeat: false });
    expect(p.ads.map((a) => a.c)).toEqual(["a", "late", "feed"]);
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/payment|price|email|status|validation|review|business/i);
    expect(json.length).toBeLessThan(2_000);
  });

  it("stage 2 in the browser: time and page, to the second, with no request", () => {
    expect(adsForPage(payload, "global_top_banner", "download", NOW).ads.map((a) => a.c)).toEqual(["a"]);
    expect(adsForPage(payload, "global_top_banner", "feed", NOW).ads.map((a) => a.c)).toEqual(["a", "feed"]);
    expect(adsForPage(payload, "global_top_banner", "download", NOW + 3 * 60_000).ads.map((a) => a.c)).toEqual(["a", "late"]);
    expect(adsForPage(payload, "global_top_banner", "download", NOW + 7 * DAY).ads).toEqual([]);
    expect(adsForPage(payload, "interstitial", "download", NOW).ads).toEqual([]);
    expect(adsForPage(null, "global_top_banner", "download", NOW).ads).toEqual([]);
  });

  it("global off ⇒ enabled:false and no placements", () => {
    const off = buildServingPayload({ ...s, settings: { ads_enabled: false, default_slot_count: 10 } }, 1, NOW);
    expect(off).toEqual({ v: 1, enabled: false, b: 1, placements: {} });
    expect(adsForPage(off, "global_top_banner", "download", NOW).ads).toEqual([]);
  });

  it("parse: round-trips, refuses junk", () => {
    expect(parseServingPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    for (const bad of [null, 1, {}, { v: 2, enabled: true, b: 1, placements: {} }, { v: 1, enabled: true, b: 1, placements: { x: { ads: "no" } } }]) {
      expect(parseServingPayload(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
