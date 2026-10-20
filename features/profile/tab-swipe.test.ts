import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Owner, 2026-10-19: swipe left/right between Posts, Reels, Collections and Exclusive — instant, like one page. */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const rules = (tabs: string, hook: string) => ({
  wired: tabs.includes("useTabSwipe({") && tabs.includes("onCommit: (k) => select(k)"),
  keepsVisitedMounted: tabs.includes("mounted.map") || tabs.includes(": mounted).map((k) =>"),
  neighboursOnTouch: tabs.includes("mount(prevKey, nextKey)"),
  noStandingTransform: !/will-change-transform/.test(tabs),
  directionLock: hook.includes('axis = Math.abs(mx) > Math.abs(my) ? "h" : "v"'),
  edgeLeftToBackGesture: hook.includes("p.clientX < EDGE_PX"),
  noRenderPerFrame: hook.includes("t.style.transform = x ?"),
});

describe("profile section swipe", () => {
  it("is wired, keeps sections mounted, and leaves vertical scroll and the back edge alone", () => {
    const r = rules(code("features/profile/profile-tabs.tsx"), code("features/profile/use-tab-swipe.ts"));
    for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true);
  });
  it("fails on a bad fixture (teeth)", () => {
    const r = rules("{renderActive()}", "");
    expect(Object.values(r).filter(Boolean)).toEqual([true]); // only noStandingTransform holds
  });
});
