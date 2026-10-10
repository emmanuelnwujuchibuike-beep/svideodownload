import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { eligibleForPlacement, type ServingSnapshot, type SnapshotCampaign, type SnapshotCreative, type SnapshotFormat } from "./eligibility";

/**
 * 0211 — "All slots" (owner, 2026-10-09): "All slot shows on all available
 * slots and also rotates when others buy all slots."
 */
const NOW = Date.parse("2026-10-10T12:00:00Z");
const fmt = (code: string, media: string[], over: Partial<SnapshotFormat> = {}): SnapshotFormat => ({
  code, media_types: media, width: null, height: null, rotation_seconds: 5, slot_count: 10, no_consecutive_repeat: false,
  max_duration_seconds: null, max_file_bytes: 10_000_000, max_width: 2160, max_height: 3840, min_gap_seconds: 0, enabled: true, ...over,
});
const creative = (format: string, media: "image" | "video", over: Partial<SnapshotCreative> = {}): SnapshotCreative => ({
  id: `cr-${Math.random().toString(36).slice(2, 8)}`, format_code: format, media_type: media, media_url: `https://cdn.example/${media}`,
  thumbnail_url: null, destination_url: "https://shop.example.com", headline: null, description: null, duration_seconds: media === "video" ? 12 : null,
  width: 1280, height: 800, file_size_bytes: 1000, status: "active", validation_status: "valid", url_validation_status: "valid", ...over,
});
const campaign = (id: string, placement: string, cr: SnapshotCreative, startHoursAgo = 1, slot: number | null = null): SnapshotCampaign => ({
  id, placement_code: placement, status: "active", payment_verified: true, advertiser_status: "active", advertiser_name: id,
  start_at: new Date(NOW - startHoursAgo * 3_600_000).toISOString(), end_at: new Date(NOW + 86_400_000).toISOString(), target_pages: [], slot_number: slot, creatives: [cr],
});

function snap(campaigns: SnapshotCampaign[], slotCount = 10): ServingSnapshot {
  return {
    settings: { ads_enabled: true, default_slot_count: 10 },
    formats: [
      fmt("TOP_BANNER", ["image"], { slot_count: slotCount }),
      fmt("CONTENT_BANNER", ["image", "video"], { max_duration_seconds: 30, slot_count: slotCount }),
      fmt("REWARD_VIDEO", ["video"], { max_duration_seconds: 15 }),
      fmt("ALL_SLOTS", ["image", "video"], { max_duration_seconds: 15 }),
    ],
    placements: [
      { code: "global_top_banner", format_code: "TOP_BANNER", page_scope: ["all_pages"], enabled: true, priority: 100 },
      { code: "feed_banner", format_code: "CONTENT_BANNER", page_scope: ["feed"], enabled: true, priority: 100 },
      { code: "ai_video_save_reward", format_code: "REWARD_VIDEO", page_scope: ["ai"], enabled: true, priority: 100 },
      { code: "all_slots", format_code: "ALL_SLOTS", page_scope: ["all_pages"], enabled: true, priority: 100 },
    ],
    campaigns,
  };
}

describe("All slots", () => {
  it("an All-slots IMAGE shows in every image slot, and not in a video-only slot", () => {
    const s = snap([campaign("everywhere", "all_slots", creative("ALL_SLOTS", "image"))]);
    expect(eligibleForPlacement(s, "global_top_banner", NOW).map((a) => a.c)).toEqual(["everywhere"]);
    expect(eligibleForPlacement(s, "feed_banner", NOW).map((a) => a.c)).toEqual(["everywhere"]);
    expect(eligibleForPlacement(s, "ai_video_save_reward", NOW)).toEqual([]);
  });

  it("an All-slots VIDEO also runs as a reward video when it fits the reward length", () => {
    const s = snap([campaign("vid", "all_slots", creative("ALL_SLOTS", "video", { duration_seconds: 12 }))]);
    expect(eligibleForPlacement(s, "ai_video_save_reward", NOW).map((a) => a.c)).toEqual(["vid"]);
    expect(eligibleForPlacement(s, "global_top_banner", NOW)).toEqual([]); // the strip takes images only
    const long = snap([campaign("long", "all_slots", creative("ALL_SLOTS", "video", { duration_seconds: 20 }))]);
    expect(eligibleForPlacement(long, "ai_video_save_reward", NOW)).toEqual([]); // over the reward slot's own limit
  });

  it("rotates with the slot's own buyers and with other All-slots buyers — own buyers first", () => {
    const s = snap([
      campaign("all-old", "all_slots", creative("ALL_SLOTS", "image"), 5),
      campaign("own", "feed_banner", creative("CONTENT_BANNER", "image"), 1, 1),
      campaign("all-new", "all_slots", creative("ALL_SLOTS", "image"), 2),
    ]);
    expect(eligibleForPlacement(s, "feed_banner", NOW).map((a) => a.c)).toEqual(["own", "all-old", "all-new"]);
  });

  it("a full slot keeps its own buyers; All-slots ads fill only the room left", () => {
    const s = snap([campaign("own1", "feed_banner", creative("CONTENT_BANNER", "image"), 1, 1), campaign("all", "all_slots", creative("ALL_SLOTS", "image"))], 1);
    expect(eligibleForPlacement(s, "feed_banner", NOW).map((a) => a.c)).toEqual(["own1"]);
  });

  it("teeth: a paused or unpaid All-slots campaign shows nowhere; a normal creative of another format still never leaks", () => {
    const paused = { ...campaign("p", "all_slots", creative("ALL_SLOTS", "image")), status: "paused" };
    const unpaid = { ...campaign("u", "all_slots", creative("ALL_SLOTS", "image")), payment_verified: false };
    const s = snap([paused, unpaid, campaign("feed-only", "feed_banner", creative("CONTENT_BANNER", "image"))]);
    expect(eligibleForPlacement(s, "global_top_banner", NOW)).toEqual([]);
    expect(eligibleForPlacement(s, "feed_banner", NOW).map((a) => a.c)).toEqual(["feed-only"]);
  });
});

describe("0214: All slots uploads like every other video format", () => {
  // 0211 created ALL_SLOTS after 0208 filled max_upload_bytes, and the upload step
  // reads a null there as "no transcoding" - every MOV refused, every video over 10 MB too
  const sql = readFileSync("supabase/migrations/0214_ad_all_slots_upload.sql", "utf8");
  const clause = (s: string) => /update public\.ad_formats set max_upload_bytes = (\d+)\s+where ([^;]+);/.exec(s);

  it("fills the 200 MB the other video formats got in 0208, for ALL_SLOTS only, and only when unset", () => {
    const m = clause(sql);
    expect(m?.[1]).toBe(String(200 * 1024 * 1024));
    expect(m?.[2]).toContain("code = 'ALL_SLOTS'");
    expect(m?.[2]).toContain("max_upload_bytes is null");
  });

  it("teeth: a version that overwrote an admin's own value is caught", () => {
    const mutant = sql.replace(" and max_upload_bytes is null", "");
    expect(clause(mutant)?.[2]).not.toContain("max_upload_bytes is null");
  });

  it("the upload step still reads max_upload_bytes as the transcoding switch (why the null mattered)", () => {
    expect(readFileSync("features/ads-platform/creative-step.tsx", "utf8")).toContain("videoProcessing: format.max_upload_bytes != null");
  });
});
