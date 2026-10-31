import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner 2026-10-31: the profile section row (Posts / Reels / Exclusive / Collections / Saved) navigates like the
 * bottom nav — one underline that SPRINGS to the tapped tab on the nav's own curve, a spring press on each label,
 * and the nav's haptic + tap tone. Guards against a return to the per-tab underline that just jumped.
 */
const SRC = readFileSync(join(process.cwd(), "features/profile/profile-tabs.tsx"), "utf8");

export function checkProfileTabsSpring(src: string): string[] {
  const problems: string[] = [];
  if (!/data-profile-tab-underline/.test(src)) problems.push("no single measured underline");
  if (!/transform 500ms var\(--ease-spring\)/.test(src)) problems.push("underline does not spring on --ease-spring");
  if (!/<PressIcon[^>]*>[\s\S]{0,300}\{s\.label\}/.test(src)) problems.push("tab labels have no spring press");
  if (!/haptic\("light"\)/.test(src) || !/playSound\("tap"\)/.test(src)) problems.push("no haptic + tap tone on tap");
  // the static per-tab underline may only show before the row has measured itself
  if (/\{isActive \? <span aria-hidden className="absolute inset-x-3/.test(src)) problems.push("per-tab underline still jumps");
  if (!/prefers-reduced-motion/.test(src)) problems.push("ignores reduced motion");
  return problems;
}

describe("profile tabs move like the bottom nav", () => {
  it("has the springing underline, press spring and tap feedback", () => {
    expect(checkProfileTabsSpring(SRC)).toEqual([]);
  });

  it("has teeth — the old jumping underline fails", () => {
    const old = `{s.label}
                {isActive ? <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-frenz-gradient-x" /> : null}`;
    expect(checkProfileTabsSpring(old).length).toBeGreaterThan(0);
  });
});
