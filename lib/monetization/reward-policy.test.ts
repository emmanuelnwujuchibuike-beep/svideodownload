import { describe, expect, it } from "vitest";

import {
  DOUBLE_REWARD_THRESHOLD_BYTES,
  REWARD_THRESHOLD_BYTES,
  rewardAdsFor,
  SECOND_AD_SKIP_AFTER_SECONDS,
} from "./reward-policy";

const MB = 1024 * 1024;

describe("rewardAdsFor — the owner's thresholds", () => {
  it("does not gate a download under 100 MB", () => {
    expect(rewardAdsFor({ filesize: 99 * MB, showAds: true })).toEqual([]);
  });

  it("shows ONE unskippable 30s ad above 100 MB", () => {
    const ads = rewardAdsFor({ filesize: 101 * MB, showAds: true });
    expect(ads).toHaveLength(1);
    expect(ads[0]).toEqual({ durationSec: 30, skipAfterSec: null });
  });

  it("shows TWO ads above 500 MB — the second skippable after 15s", () => {
    const ads = rewardAdsFor({ filesize: 501 * MB, showAds: true });
    expect(ads).toHaveLength(2);
    expect(ads[0]!.skipAfterSec).toBeNull();
    expect(ads[1]!.durationSec).toBe(30);
    expect(ads[1]!.skipAfterSec).toBe(SECOND_AD_SKIP_AFTER_SECONDS);
  });

  it("uses strictly-greater-than at both boundaries", () => {
    // Exactly 100 MB is not "above 100mb".
    expect(rewardAdsFor({ filesize: REWARD_THRESHOLD_BYTES, showAds: true })).toEqual([]);
    expect(rewardAdsFor({ filesize: REWARD_THRESHOLD_BYTES + 1, showAds: true })).toHaveLength(1);
    expect(rewardAdsFor({ filesize: DOUBLE_REWARD_THRESHOLD_BYTES, showAds: true })).toHaveLength(1);
    expect(rewardAdsFor({ filesize: DOUBLE_REWARD_THRESHOLD_BYTES + 1, showAds: true })).toHaveLength(2);
  });
});

describe("rewardAdsFor — the cases that must never regress", () => {
  it("🔴 NEVER gates a viewer who paid for no ads, at any size", () => {
    // The worst outcome available here is an ad shown to someone who paid not to
    // see ads, so this is checked before every size rule.
    for (const filesize of [1 * MB, 200 * MB, 5000 * MB]) {
      expect(rewardAdsFor({ filesize, showAds: false })).toEqual([]);
    }
    expect(rewardAdsFor({ showAds: false, kind: "image" })).toEqual([]);
  });

  it("🔴 fails OPEN when the size is unknown", () => {
    // Progressive HLS and audio conversions often report no filesize. Gating on
    // a guess means an ad in front of a 2 MB audio file; missing one costs a
    // single impression.
    for (const filesize of [null, undefined, 0, Number.NaN, -1]) {
      expect(rewardAdsFor({ filesize, showAds: true })).toEqual([]);
    }
  });

  it("gates the real-world case that prompted this", () => {
    // A 60-minute set: 720p is 1.03 GB and was NOT the top format, so the old
    // rank-based rule let a gigabyte through ungated.
    expect(rewardAdsFor({ filesize: 1_033_405_283, showAds: true })).toHaveLength(2);
    // …while a 15-second clip's TOP format is a few MB and used to be gated.
    expect(rewardAdsFor({ filesize: 4 * MB, showAds: true })).toEqual([]);
  });

  it("never returns more than two ads, however large the file", () => {
    expect(rewardAdsFor({ filesize: 50_000 * MB, showAds: true })).toHaveLength(2);
  });
});

describe("rewardAdsFor — quality-tier gate (owner, 2026-08-16)", () => {
  it("gates a top-2 image with the configured short skippable ad", () => {
    const ads = rewardAdsFor({ showAds: true, kind: "image", qualityRank: 0 });
    expect(ads).toEqual([{ durationSec: 5, skipAfterSec: 5 }]);
    expect(rewardAdsFor({ showAds: true, kind: "image", qualityRank: 1 })).toHaveLength(1);
  });

  it("gates a top-2 audio download the same way images are", () => {
    const ads = rewardAdsFor({ showAds: true, kind: "audio", qualityRank: 1 });
    expect(ads).toEqual([{ durationSec: 5, skipAfterSec: 5 }]);
  });

  it("does NOT gate an image/audio option outside the top tier", () => {
    expect(rewardAdsFor({ showAds: true, kind: "image", qualityRank: 2 })).toEqual([]);
    expect(rewardAdsFor({ showAds: true, kind: "audio", qualityRank: 5 })).toEqual([]);
    expect(rewardAdsFor({ showAds: true, kind: "image" })).toEqual([]); // no rank known
  });

  it("gates a small top-2 VIDEO even under the 100MB size floor", () => {
    // The size rule alone would leave this free; the quality-tier rule
    // (owner: "ALL videos… top 2 highest quality") still gates it.
    const ads = rewardAdsFor({ filesize: 4 * MB, showAds: true, kind: "video", qualityRank: 0 });
    expect(ads).toEqual([{ durationSec: 30, skipAfterSec: null }]);
  });

  it("still applies the size rule to a large NON-top-2 video", () => {
    // Rank 3 (outside a top-2 tier) but 1GB — the size rule alone protects it.
    const ads = rewardAdsFor({ filesize: 1_033_405_283, showAds: true, kind: "video", qualityRank: 3 });
    expect(ads).toHaveLength(2);
  });

  it("a large top-2 video is gated by size, not doubled by also being top-tier", () => {
    const ads = rewardAdsFor({ filesize: 501 * MB, showAds: true, kind: "video", qualityRank: 0 });
    expect(ads).toHaveLength(2); // the size rule's max, not size-ads plus a tier ad
  });

  it("respects an admin-configured tier count and durations", () => {
    const tierConfig = { topTierCount: 1, videoTopTierSeconds: 45, imageAudioTopTierSeconds: 10, imageAudioSkipAfterSeconds: 3 };
    // Rank 1 no longer counts as top tier when the admin narrows it to 1.
    expect(rewardAdsFor({ showAds: true, kind: "image", qualityRank: 1, tierConfig })).toEqual([]);
    expect(rewardAdsFor({ showAds: true, kind: "image", qualityRank: 0, tierConfig })).toEqual([
      { durationSec: 10, skipAfterSec: 3 },
    ]);
    expect(
      rewardAdsFor({ filesize: 1 * MB, showAds: true, kind: "video", qualityRank: 0, tierConfig }),
    ).toEqual([{ durationSec: 45, skipAfterSec: null }]);
  });

  it("an admin who sets a duration of 0 turns that half of the gate off", () => {
    expect(
      rewardAdsFor({
        showAds: true,
        kind: "image",
        qualityRank: 0,
        tierConfig: { imageAudioTopTierSeconds: 0 },
      }),
    ).toEqual([]);
    expect(
      rewardAdsFor({
        filesize: 1 * MB,
        showAds: true,
        kind: "video",
        qualityRank: 0,
        tierConfig: { videoTopTierSeconds: 0 },
      }),
    ).toEqual([]);
  });
});
