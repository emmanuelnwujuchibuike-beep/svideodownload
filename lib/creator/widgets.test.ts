import { describe, expect, it } from "vitest";

import {
  DEFAULT_PINNED_METRICS,
  DEFAULT_WIDGET_ORDER,
  MAX_PINNED_METRICS,
  moveWidget,
  resolveLayout,
  resolvePinnedMetrics,
  STUDIO_WIDGETS,
  type WidgetId,
} from "@/lib/creator/widgets";

describe("resolveLayout", () => {
  it("falls back to the catalogue order when nothing was saved", () => {
    expect(resolveLayout({})).toEqual(DEFAULT_WIDGET_ORDER);
    expect(resolveLayout({ widgetOrder: null, hiddenWidgets: null })).toEqual(DEFAULT_WIDGET_ORDER);
  });

  it("honours a saved order", () => {
    const saved: WidgetId[] = ["assistant", "goal", "performance"];
    const layout = resolveLayout({ widgetOrder: saved });
    expect(layout.slice(0, 3)).toEqual(saved);
  });

  it("drops ids that are no longer in the catalogue instead of rendering a blank slot", () => {
    const layout = resolveLayout({ widgetOrder: ["performance", "a-widget-we-deleted", "goal"] });
    expect(layout).not.toContain("a-widget-we-deleted");
    expect(layout.slice(0, 2)).toEqual(["performance", "goal"]);
  });

  it("🔴 appends widgets added to the catalogue after a layout was saved", () => {
    // Otherwise shipping a new dashboard card silently reaches nobody who ever
    // customised their Studio.
    const layout = resolveLayout({ widgetOrder: ["performance"] });
    expect(layout).toHaveLength(STUDIO_WIDGETS.length);
    expect(layout[0]).toBe("performance");
    for (const w of STUDIO_WIDGETS) expect(layout).toContain(w.id);
  });

  it("hides what the creator hid", () => {
    const layout = resolveLayout({ hiddenWidgets: ["assistant", "lounge"] });
    expect(layout).not.toContain("assistant");
    expect(layout).not.toContain("lounge");
  });

  it("keeps required widgets even if something hides them", () => {
    const layout = resolveLayout({ hiddenWidgets: ["performance"] });
    expect(layout).toContain("performance");
  });

  it("never returns an empty dashboard", () => {
    const layout = resolveLayout({ hiddenWidgets: DEFAULT_WIDGET_ORDER });
    expect(layout.length).toBeGreaterThan(0);
  });

  it("never duplicates a widget when the saved order repeats one", () => {
    const layout = resolveLayout({ widgetOrder: ["goal", "goal", "performance"] });
    // A repeated id in a stored array must not render the card twice.
    expect(layout.filter((id) => id === "goal")).toHaveLength(1);
    expect(new Set(layout).size).toBe(layout.length);
    expect(layout.slice(0, 2)).toEqual(["goal", "performance"]);
  });
});

describe("moveWidget", () => {
  const order: WidgetId[] = ["performance", "goal", "latest"];

  it("moves a widget down", () => {
    expect(moveWidget(order, "performance", 1)).toEqual(["goal", "performance", "latest"]);
  });

  it("moves a widget up", () => {
    expect(moveWidget(order, "latest", -1)).toEqual(["performance", "latest", "goal"]);
  });

  it("is a no-op at either end, so a double-tap cannot corrupt the layout", () => {
    expect(moveWidget(order, "performance", -1)).toEqual(order);
    expect(moveWidget(order, "latest", 1)).toEqual(order);
  });

  it("is a no-op for a widget that is not in the layout", () => {
    expect(moveWidget(order, "assistant", 1)).toEqual(order);
  });

  it("does not mutate the array it was given", () => {
    const copy = [...order];
    moveWidget(order, "performance", 1);
    expect(order).toEqual(copy);
  });
});

describe("resolvePinnedMetrics", () => {
  it("defaults when nothing is pinned", () => {
    expect(resolvePinnedMetrics(null)).toEqual(DEFAULT_PINNED_METRICS);
    expect(resolvePinnedMetrics([])).toEqual(DEFAULT_PINNED_METRICS);
  });

  it("drops unknown metric ids", () => {
    expect(resolvePinnedMetrics(["views", "not-a-metric"])).toEqual(["views"]);
  });

  it("falls back to defaults when every saved id is unknown", () => {
    expect(resolvePinnedMetrics(["nope", "also-nope"])).toEqual(DEFAULT_PINNED_METRICS);
  });

  it("de-dupes", () => {
    expect(resolvePinnedMetrics(["views", "views", "posts"])).toEqual(["views", "posts"]);
  });

  it("caps the header strip", () => {
    const pinned = resolvePinnedMetrics(["views", "followers", "posts", "comments", "shares", "saves"]);
    expect(pinned).toHaveLength(MAX_PINNED_METRICS);
  });
});

describe("the catalogue itself", () => {
  it("has unique ids", () => {
    const ids = STUDIO_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks at least one widget required, so a dashboard is never blank", () => {
    expect(STUDIO_WIDGETS.some((w) => w.required)).toBe(true);
  });
});
