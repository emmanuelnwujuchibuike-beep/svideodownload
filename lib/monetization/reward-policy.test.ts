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

  it("keeps images gated regardless of size", () => {
    // A wallpaper is a few hundred KB and IS the whole product of that
    // download — a byte threshold would make every image free.
    const ads = rewardAdsFor({ filesize: 300 * 1024, showAds: true, kind: "image" });
    expect(ads).toHaveLength(1);
    expect(ads[0]!.skipAfterSec).toBeNull();
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
