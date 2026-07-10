import { describe, expect, it } from "vitest";

import { HOME_MODULE_KEYS, normalizeOrder } from "./home-preferences";

describe("normalizeOrder", () => {
  it("resolves an empty/undefined saved order to the full default order", () => {
    expect(normalizeOrder(undefined)).toEqual([...HOME_MODULE_KEYS]);
    expect(normalizeOrder(null)).toEqual([...HOME_MODULE_KEYS]);
  });

  it("preserves a full valid saved order verbatim", () => {
    const saved = ["continue_watching", "stories", "trending_reels", "friend_activity"];
    expect(normalizeOrder(saved)).toEqual(saved);
  });

  it("keeps the given order for a partial saved list and appends missing keys", () => {
    const out = normalizeOrder(["trending_reels", "stories"]);
    expect(out).toEqual(["trending_reels", "stories", "friend_activity", "continue_watching"]);
  });

  it("drops garbage entries rather than passing them through", () => {
    const out = normalizeOrder(["stories", "not_a_real_module", 42, null]);
    expect(out[0]).toBe("stories");
    expect(out).toHaveLength(HOME_MODULE_KEYS.length);
  });

  it("always returns a full permutation — same length, no duplicates", () => {
    const out = normalizeOrder(["stories"]);
    expect(out).toHaveLength(HOME_MODULE_KEYS.length);
    expect(new Set(out).size).toBe(HOME_MODULE_KEYS.length);
  });
});
