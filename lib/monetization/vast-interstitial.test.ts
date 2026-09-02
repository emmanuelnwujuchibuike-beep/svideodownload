import { describe, expect, it } from "vitest";

import {
  DEFAULT_VAST_INTERSTITIAL,
  effectiveSkipSeconds,
  normalizeVastInterstitial,
  SKIP_STALL_GRACE_SECONDS,
  skipRemainingSeconds,
  VAST_LIMITS,
} from "./vast-interstitial";

/**
 * The post-download interstitial's two timing rules, which are the whole reason
 * the arithmetic was pulled out of the plain-DOM overlay: that file builds a
 * `<video>` and a full-screen stage, so none of this could be asserted where it
 * used to live.
 *
 * Owner, 2026-08-30: "sometimes google adsense can have a 5 sec ad in their
 * inventory and i set 10sec, it should be skipable for 5 secs, time should be
 * according to the ad network timer."
 */

describe("effectiveSkipSeconds — the admin number is a CEILING", () => {
  it("🔴 a 5s ad under a 10s setting unlocks Skip at 5s, not 10", () => {
    // The owner's exact scenario. Getting this wrong leaves "Skip in 5…4…3…"
    // counting down after the ad has already ended, on an overlay whose only
    // other exit is that same control.
    expect(effectiveSkipSeconds({ configuredSeconds: 10, vastDurationSeconds: 5 })).toBe(5);
  });

  it("keeps the admin number when the ad is longer than it", () => {
    expect(effectiveSkipSeconds({ configuredSeconds: 10, vastDurationSeconds: 30 })).toBe(10);
    expect(effectiveSkipSeconds({ configuredSeconds: 15, vastDurationSeconds: 15 })).toBe(15);
  });

  it("takes the SHORTEST of the VAST claim and the real file", () => {
    // A response that declares 30s and delivers 6s would otherwise hold the
    // skip control 24 seconds past the end of the ad.
    expect(
      effectiveSkipSeconds({ configuredSeconds: 15, vastDurationSeconds: 30, mediaDurationSeconds: 6 }),
    ).toBe(6);
    // …and the reverse: a longer file does not extend the delay.
    expect(
      effectiveSkipSeconds({ configuredSeconds: 15, vastDurationSeconds: 8, mediaDurationSeconds: 30 }),
    ).toBe(8);
  });

  it("🔴 ignores unusable durations instead of collapsing the delay to zero", () => {
    // Every one of these means "no usable length". Treating any of them as 0
    // would give the ad away entirely; treating them as a real number would be
    // worse. `null` is what parseVast returns for an absent <Duration>.
    for (const bad of [null, undefined, 0, NaN, Infinity, -5]) {
      expect(effectiveSkipSeconds({ configuredSeconds: 10, vastDurationSeconds: bad }), String(bad)).toBe(10);
    }
  });

  it("never returns a negative delay, whatever it is handed", () => {
    expect(effectiveSkipSeconds({ configuredSeconds: -5 })).toBe(0);
    expect(effectiveSkipSeconds({ configuredSeconds: 0, vastDurationSeconds: 30 })).toBe(0);
  });

  it("falls back to the shipped default when the setting is not a number", () => {
    expect(effectiveSkipSeconds({ configuredSeconds: NaN })).toBe(
      DEFAULT_VAST_INTERSTITIAL.skipAfterSeconds,
    );
  });
});

describe("skipRemainingSeconds — playback drives it, the wall clock rescues it", () => {
  it("counts down with PLAYBACK, not wall time", () => {
    expect(skipRemainingSeconds({ skipAtSeconds: 10, playedSeconds: 0, elapsedSeconds: 0 })).toBe(10);
    expect(skipRemainingSeconds({ skipAtSeconds: 10, playedSeconds: 4, elapsedSeconds: 4 })).toBe(6);
    expect(skipRemainingSeconds({ skipAtSeconds: 10, playedSeconds: 10, elapsedSeconds: 10 })).toBe(0);
  });

  it("🔴 does not unlock early while the ad is buffering", () => {
    // 8 wall seconds but only 2 played: the advertiser has been shown 2s of ad.
    // A wall-clock countdown (what this replaced) would say 2 remaining.
    expect(skipRemainingSeconds({ skipAtSeconds: 10, playedSeconds: 2, elapsedSeconds: 8 })).toBe(5);
  });

  it("🔴 releases the visitor when playback stalls dead", () => {
    // currentTime frozen at 2s forever — a dead CDN mid-roll. Without the
    // wall-clock floor the skip never unlocks and the overlay has no exit.
    expect(skipRemainingSeconds({ skipAtSeconds: 10, playedSeconds: 2, elapsedSeconds: 13 })).toBe(0);
  });

  it("the stall grace is what separates buffering from trapped", () => {
    const at = (elapsedSeconds: number) =>
      skipRemainingSeconds({ skipAtSeconds: 5, playedSeconds: 0, elapsedSeconds });
    expect(at(SKIP_STALL_GRACE_SECONDS)).toBe(5);
    expect(at(SKIP_STALL_GRACE_SECONDS + 5)).toBe(0);
  });

  it("survives NaN from a video element that has no duration yet", () => {
    expect(skipRemainingSeconds({ skipAtSeconds: 5, playedSeconds: NaN, elapsedSeconds: NaN })).toBe(5);
  });
});

describe("the two download moments", () => {
  it("🔴 defaults to the COMPLETION ad, with the start ad off", () => {
    /*
      Both on means two interstitials for one download inside the default 90s
      cooldown — so the completion ad, the one actually asked for, would be the
      one suppressed. The defaults have to pick, and they pick completion.
    */
    expect(DEFAULT_VAST_INTERSTITIAL.enabledOnDownloadComplete).toBe(true);
    expect(DEFAULT_VAST_INTERSTITIAL.enabledOnDownload).toBe(false);
  });

  it("normalizes a settings row written before the field existed", () => {
    // Every already-stored row is missing this key. Reading it must not turn
    // the placement off, and must not throw.
    const legacy = normalizeVastInterstitial({ enabled: true, enabledOnDownload: true, skipAfterSeconds: 10 });
    expect(legacy.enabledOnDownloadComplete).toBe(true);
    expect(legacy.enabledOnDownload).toBe(true);
    expect(legacy.skipAfterSeconds).toBe(10);
  });

  it("still clamps everything it did before", () => {
    const wild = normalizeVastInterstitial({ skipAfterSeconds: 9999, timeoutMs: -1, cooldownMs: "x" });
    expect(wild.skipAfterSeconds).toBe(30);
    expect(wild.timeoutMs).toBe(500);
    expect(wild.cooldownMs).toBe(DEFAULT_VAST_INTERSTITIAL.cooldownMs);
  });
});

describe("🔴🔴 the two budgets — the split that fixed a zero-impression VAST zone", () => {
  /*
    The zone reported 0 impressions while banner and slider zones served
    normally. `timeoutMs` covered BOTH resolving the VAST and reaching the
    video's `playing` event, defaulted to 3000ms and was hard-capped at
    5000ms. Measured on production (scripts/vast-playback-probe.mjs), an
    unthrottled cold start reaches `playing` at ~10.9s — so the overlay always
    aborted first, and `overlay.ts` fires <Impression> from that very event.
  */
  it("🔴 gives PLAYBACK a budget that clears the measured ~10.9s cold start", () => {
    expect(DEFAULT_VAST_INTERSTITIAL.startTimeoutMs).toBeGreaterThan(10_900);
    expect(VAST_LIMITS.startTimeoutMs.max).toBeGreaterThan(10_900);
  });

  it("🔴 keeps the LOOKUP budget short — a visitor must not wait for nothing", () => {
    // Before a creative exists there may be no ad at all, so failing open
    // fast is still right. This half deliberately did NOT change.
    expect(VAST_LIMITS.timeoutMs.max).toBeLessThanOrEqual(5000);
    expect(DEFAULT_VAST_INTERSTITIAL.timeoutMs).toBeLessThanOrEqual(5000);
  });

  it("🔴 keeps them SEPARATE fields — one timer for two waits is the bug", () => {
    expect(DEFAULT_VAST_INTERSTITIAL.startTimeoutMs).not.toBe(
      DEFAULT_VAST_INTERSTITIAL.timeoutMs,
    );
    expect(DEFAULT_VAST_INTERSTITIAL.startTimeoutMs).toBeGreaterThan(
      DEFAULT_VAST_INTERSTITIAL.timeoutMs,
    );
  });

  it("clamps a stored playback budget rather than honouring it", () => {
    expect(normalizeVastInterstitial({ startTimeoutMs: 1 }).startTimeoutMs).toBe(
      VAST_LIMITS.startTimeoutMs.min,
    );
    expect(normalizeVastInterstitial({ startTimeoutMs: 999_999 }).startTimeoutMs).toBe(
      VAST_LIMITS.startTimeoutMs.max,
    );
    // A blob written before this field existed must still normalise.
    expect(normalizeVastInterstitial({}).startTimeoutMs).toBe(
      DEFAULT_VAST_INTERSTITIAL.startTimeoutMs,
    );
  });
});
