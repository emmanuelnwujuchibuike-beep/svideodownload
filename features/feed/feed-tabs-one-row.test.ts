import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { requestFeedTab, takeRequestedFeedTab } from "./feed-topbar-tabs";

/*
  Owner, 2026-10-31: "navigation with the top nav in feed page reload on going back, from exclusive page to for you and
  following and the top nav structure changes when I enter the exclusive feed page … the top nav in feed page is
  supposed to navigate like the bottom NAV". The Exclusive page had its own copy of the row (laid out differently) and
  went to /home?tab=… — a different address from the bottom nav's /home, so a fresh server load every time.
*/
const tabs = readFileSync("features/feed/feed-topbar-tabs.tsx", "utf8");
const feed = readFileSync("features/feed/smart-feed.tsx", "utf8");

const oneRow = (src: string) => {
  const exclusive = src.slice(src.indexOf("export function FeedTabLinks"));
  return (
    /<FeedTabRow active="exclusive" \/>/.test(exclusive) &&
    !/<nav\b/.test(exclusive) && // no second, differently laid-out row
    !/\/home\?tab=/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) && // never the uncached address (comments aside)
    /href="\/home"/.test(src)
  );
};

describe("one Feed tab row, navigating like the bottom nav", () => {
  it("the Exclusive page renders the Feed's own row, and goes to plain /home", () => {
    expect(oneRow(tabs)).toBe(true);
  });
  it("teeth: a separate copy, or the ?tab= address, fails", () => {
    expect(oneRow(tabs.replace('<FeedTabRow active="exclusive" />', '<nav className="flex gap-[22px]" />'))).toBe(false);
    expect(oneRow(tabs.replace('href="/home"', 'href="/home?tab=for_you"'))).toBe(false);
  });
  /*
    Owner, 2026-10-31: "the exclusive button should prefetch so it doesn't load, they should all navigate like the bottom
    NAV exactly even with the spring press movement to the next".
  */
  it("navigates like the bottom nav: the indicator springs on the tap, the press springs, Exclusive is warm before the tap", () => {
    const likeTheBottomNav = (src: string) =>
      // one underline on the lens's own spring curve (globals.css .frenz-nav-lens)
      /transform 500ms var\(--ease-spring\), width 500ms var\(--ease-spring\)/.test(src) &&
      /width: bar\.w,\s*transform: `translateX\(\$\{bar\.x\}px\)`,/.test(src) &&
      // the tap makes the tab active before the next page is live (mobile-nav's pendingHref)
      /setPending\("exclusive"\)/.test(src) &&
      /setPending\(t\.key as TabKey\)/.test(src) &&
      // the nav's own press
      (src.match(/<PressIcon /g) ?? []).length >= 4 &&
      // Exclusive AND Reels in FULL after the Feed has loaded, and again on touch (owner 2026-10-31: Reels showed a
      // black loading screen first — /reels is dynamic, so a plain Link prefetch only reached its loading.tsx)
      /return afterPageLoad\(\(\) => \{\s*warmReelsFully\(router\);\s*warmExclusiveFully\(router\);/.test(src) &&
      /router\.prefetch\("\/exclusive", \{ kind: "full" \}/.test(src) &&
      /router\.prefetch\("\/reels", \{ kind: "full" \}/.test(src) &&
      /onPointerDown=\{\(\) => warmExclusiveFully\(router\)\}/.test(src) &&
      /href="\/reels"\s*prefetch=\{false\}\s*onPointerDown=\{\(\) => warmReelsFully\(router\)\}/.test(src);
    expect(likeTheBottomNav(tabs)).toBe(true);
    // teeth: an underline that jumps, a tap that waits for the page, or a cold Exclusive each fail
    expect(likeTheBottomNav(tabs.replace("transform 500ms var(--ease-spring), width 500ms var(--ease-spring)", "transform 500ms linear"))).toBe(false);
    expect(likeTheBottomNav(tabs.replace('setPending("exclusive")', "void 0"))).toBe(false);
    expect(likeTheBottomNav(tabs.replace("warmReelsFully(router);\n      warmExclusiveFully(router);", ""))).toBe(false);
    expect(likeTheBottomNav(tabs.replace('router.prefetch("/reels", { kind: "full" }', 'router.prefetch("/reels", {}'))).toBe(false);
    expect(likeTheBottomNav(tabs.replace("onPointerDown={() => warmReelsFully(router)}", ""))).toBe(false);
  });

  it("the wanted tab is handed over in memory, once", () => {
    expect(takeRequestedFeedTab()).toBeNull();
    requestFeedTab("following");
    expect(takeRequestedFeedTab()).toBe("following");
    expect(takeRequestedFeedTab()).toBeNull();
    // and the Feed takes it on mount
    expect(feed).toMatch(/const requested = takeRequestedFeedTab\(\);/);
  });
});
