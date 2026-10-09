import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-09: "Remove the full bleed features and let there be only one
 * experience which is the Download experience. Move the full bleed home (the
 * complete feed page) to the bottom NAV feed button … remove the feed button from
 * the Landing bottom NAV and replace it with the earn button … add description to
 * the landing bottom NAVs … the former full bleed bottom NAV should not be used
 * anywhere."
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const nav = code("features/app-shell/mobile-nav.tsx");

/** The tab rule as a function of the nav's source, so the teeth can run it on a broken copy. */
function oneTabSet(src: string): boolean {
  return (
    !/fullBleed|useAppMode|FrenzReelsOutline|FrenzFriendsOutline/.test(src) &&
    /label="Feed"\s+href="\/home"\s+icon=\{FrenzFeedOutline\}/.test(src) &&
    src.includes('<NavTab label="Earn" href="/quests" icon={FrenzEarnOutline} activeIcon={FrenzEarnSolid}') &&
    src.includes("<NavLabel active={active}>{label}</NavLabel>") &&
    src.includes("<NavLabel active={profileActive}>Profile</NavLabel>")
  );
}

describe("one experience", () => {
  it("one tab set: member Feed opens /home, guest gets Earn, every tab labelled", () => {
    expect(oneTabSet(nav)).toBe(true);
  });
  it("teeth: the old Full Bleed branch, or Feed back on the guest bar, fails", () => {
    expect(oneTabSet(nav.replace("{handle ? (\n          /* The complete feed", "{fullBleedActive ? (\n          /* The complete feed"))).toBe(false);
    expect(oneTabSet(nav.replace('label="Earn" href="/quests"', 'label="Feed" href="/feed"'))).toBe(false);
  });
  it("no mode anywhere: the switch, the prompt, the cookie routing and the launch page", () => {
    for (const f of ["features/app-shell/use-app-mode.ts", "features/app-shell/app-mode-switcher.tsx", "features/app-shell/switch-mode-prompt.tsx", "lib/app-mode.ts"]) expect(existsSync(join(process.cwd(), f)), f).toBe(false);
    const mw = code("middleware.ts");
    expect(mw).not.toContain("frenz_mode");
    expect(mw).toContain('const toHome = () => NextResponse.redirect(new URL("/downloads", request.url));');
    expect(code("public/launch.html")).not.toContain("frenz_mode=");
    expect(code("features/app-shell/app-topbar.tsx")).not.toContain('mode !== "downloader"');
  });
  it("Reels stays reachable from the feed's own top tabs on /home", () => {
    expect(code("features/feed/smart-feed.tsx")).toContain('showReelsLink={pathname === "/feed" || pathname === "/home"}');
  });
});
