import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When a mounted ad spot re-reads the admin's choice (code review, 2026-10-30). It used to be a plain 5-minute interval
 * from mount: one that fired just BEFORE a bucket edge re-read the OLD bucket, so a switch turned off kept firing for up
 * to ten minutes — and it kept running in background tabs. Now: just past every edge, only while the tab is visible,
 * and at once when a tab comes back after a bucket turned.
 */
vi.mock("@/features/monetization/use-show-ads", () => ({ useShowAds: () => ({ showAds: false, ready: false }) }));

const { msUntilNextBucket, startBucketRefresh, BUCKET_EDGE_SLACK_MS } = await import("./use-direct-link");
const { CDN_BUCKET_MS } = await import("@/lib/net/cdn-bucket");

const EDGE = 1_800_000_000_000 - (1_800_000_000_000 % CDN_BUCKET_MS); // a bucket boundary
let listeners: Set<() => void>;
const doc = {
  visibilityState: "visible" as DocumentVisibilityState,
  addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
};
const setVisibility = (v: DocumentVisibilityState) => {
  doc.visibilityState = v;
  for (const fn of [...listeners]) fn();
};

beforeEach(() => {
  vi.useFakeTimers();
  listeners = new Set();
  doc.visibilityState = "visible";
});
afterEach(() => vi.useRealTimers());

describe("ad spot config refresh", () => {
  it("waits for just past the next bucket edge, wherever in the bucket it starts", () => {
    expect(msUntilNextBucket(EDGE)).toBe(CDN_BUCKET_MS + BUCKET_EDGE_SLACK_MS);
    expect(msUntilNextBucket(EDGE + CDN_BUCKET_MS - 1)).toBe(1 + BUCKET_EDGE_SLACK_MS);
    expect(msUntilNextBucket(EDGE + 120_000)).toBe(CDN_BUCKET_MS - 120_000 + BUCKET_EDGE_SLACK_MS);
  });

  it("🔴 mounted a second before an edge: re-reads right after that edge — not five minutes later (teeth: the old interval did)", () => {
    vi.setSystemTime(EDGE + CDN_BUCKET_MS - 1000);
    const load = vi.fn();
    const stop = startBucketRefresh(load, doc);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000 + BUCKET_EDGE_SLACK_MS - 1);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);
    // then once per bucket
    vi.advanceTimersByTime(CDN_BUCKET_MS);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("nothing runs in a hidden tab; coming back after a bucket turned re-reads at once, once", () => {
    vi.setSystemTime(EDGE + 10_000);
    const load = vi.fn();
    const stop = startBucketRefresh(load, doc);
    setVisibility("hidden");
    vi.advanceTimersByTime(4 * CDN_BUCKET_MS);
    expect(load).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(load).toHaveBeenCalledTimes(1);
    // and is back on the edge schedule, without a second timer stacked on the first
    vi.advanceTimersByTime(msUntilNextBucket(Date.now()));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("coming back inside the same bucket reads nothing new", () => {
    vi.setSystemTime(EDGE + 10_000);
    const load = vi.fn();
    const stop = startBucketRefresh(load, doc);
    setVisibility("hidden");
    vi.advanceTimersByTime(30_000);
    setVisibility("visible");
    expect(load).not.toHaveBeenCalled();
    stop();
  });

  it("stop() ends it: no timer, no listener", () => {
    vi.setSystemTime(EDGE + 10_000);
    const load = vi.fn();
    const stop = startBucketRefresh(load, doc);
    stop();
    expect(listeners.size).toBe(0);
    vi.advanceTimersByTime(3 * CDN_BUCKET_MS);
    expect(load).not.toHaveBeenCalled();
  });
});
