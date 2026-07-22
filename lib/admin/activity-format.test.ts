import { describe, expect, it } from "vitest";

import { eventDetail, eventLabel, NOTABLE } from "./activity-format";

describe("activity — eventLabel", () => {
  it("uses the Event Registry label for a known type", () => {
    expect(eventLabel("ad_click")).toBe("Ad click");
    expect(eventLabel("subscribe")).toBe("Subscribe");
  });
  it("falls back to the raw type for an unknown one", () => {
    expect(eventLabel("something_new")).toBe("something_new");
  });
});

describe("activity — eventDetail", () => {
  it("pulls the meaningful field per type", () => {
    expect(eventDetail("ad_click", { zone: "download_result_page" })).toBe("download_result_page");
    expect(eventDetail("subscribe", { plan: "pro" })).toBe("pro");
    expect(eventDetail("affiliate_click", { offerId: "x" })).toBe("x");
  });
  it("is null when there's nothing useful or no metadata", () => {
    expect(eventDetail("ad_click", {})).toBeNull();
    expect(eventDetail("download", { platform: "tiktok" })).toBeNull();
    expect(eventDetail("subscribe", null)).toBeNull();
  });
});

describe("activity — NOTABLE set", () => {
  it("includes what an operator wants to see and excludes the noise", () => {
    expect(NOTABLE.has("download")).toBe(true);
    expect(NOTABLE.has("ad_click")).toBe(true);
    // These would flood the feed and are deliberately excluded.
    expect(NOTABLE.has("api_call")).toBe(false);
    expect(NOTABLE.has("experiment_exposure")).toBe(false);
  });
});
