import { describe, expect, it } from "vitest";

import { NOTABLE } from "./activity-format";
import {
  ACTIVITY_CATEGORIES,
  DOWNLOAD_KIND,
  categoryNeedsDownloads,
  categoryOf,
  isActivityCategory,
  kindsInCategory,
} from "./activity-categories";

describe("activity categories", () => {
  it("puts every ad family in `ads`, including ones added later by prefix", () => {
    for (const kind of [
      "ad_impression",
      "ad_click",
      "banner_filled",
      "banner_empty",
      "interstitial_click",
      "monetag_requested",
      "monetag_rendered",
      "monetag_interaction",
      "reward_started",
      "reward_granted",
      "affiliate_click",
      // The point of matching on a prefix: this one does not exist yet.
      "banner_something_new",
      "monetag_format_invented_tomorrow",
    ]) {
      expect(categoryOf(kind)).toBe("ads");
    }
  });

  it("separates downloads, installs, members and API from the ad stream", () => {
    expect(categoryOf(DOWNLOAD_KIND)).toBe("downloads");
    expect(categoryOf("batch_started")).toBe("downloads");
    expect(categoryOf("pwa_installed")).toBe("installs");
    expect(categoryOf("subscribe")).toBe("members");
    expect(categoryOf("subscribe_cancel")).toBe("members");
    expect(categoryOf("upgrade_prompt_view")).toBe("members");
    expect(categoryOf("api_key_created")).toBe("api");
  });

  it("never loses an unclassified kind — it lands in `other`, not nowhere", () => {
    expect(categoryOf("something_nobody_mapped")).toBe("other");
    expect(categoryOf("")).toBe("other");
  });

  it("classifies EVERY notable event into exactly one category", () => {
    // A kind the feed can deliver but no tab can show would be invisible to an
    // operator while still counting against the row limit.
    const covered = new Set<string>();
    for (const c of ACTIVITY_CATEGORIES) {
      if (c.id === "all") continue;
      for (const k of kindsInCategory(c.id) ?? []) {
        expect(covered.has(k)).toBe(false); // no kind in two tabs
        covered.add(k);
      }
    }
    for (const kind of [...NOTABLE, DOWNLOAD_KIND]) {
      expect(covered.has(kind)).toBe(true);
    }
  });

  it("returns null for `all`, so the query is not filtered at all", () => {
    // Deliberately not "every known kind": a full list would silently stop
    // matching anything added later, which is the staleness this avoids.
    expect(kindsInCategory("all")).toBeNull();
  });

  it("only asks for the downloads table when a tab actually shows downloads", () => {
    expect(categoryNeedsDownloads("all")).toBe(true);
    expect(categoryNeedsDownloads("downloads")).toBe(true);
    expect(categoryNeedsDownloads("ads")).toBe(false);
    expect(categoryNeedsDownloads("installs")).toBe(false);
  });

  it("validates category ids from the query string", () => {
    expect(isActivityCategory("ads")).toBe(true);
    expect(isActivityCategory("nope")).toBe(false);
    expect(isActivityCategory(null)).toBe(false);
  });
});
