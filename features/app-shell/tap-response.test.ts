import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-17: "The history page still doesn't have a stripe loader that shows when the tap
 * haven't responded … the icons in the bottom NAV are a bit too big", plus the Exclusive tray button
 * and the "Stay close" card behind a notifications button that responds on tap instantly.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const nav = code("features/app-shell/mobile-nav.tsx");

describe("a nav tap answers at once", () => {
  it("every tab and the profile button start the pending stripe on the tap", () => {
    const tabs = nav.match(/<NavTab[\s\S]*?\/>/g) ?? [];
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    for (const t of tabs) expect(t).toContain("onGo={go}");
    expect(nav).toMatch(/onPointerDown=\{\(\) => router\.prefetch\(profileHref\)\}[\s\S]{0,160}go\(profileHref\)/);
    expect(nav).toMatch(/onClick=\{\(e\) => \{[\s\S]{0,120}onGo\?\.\(href\)/);
  });

  it("the stripe renders OUTSIDE the transformed nav wrapper (a fixed child of a transform is pinned to it, not the screen)", () => {
    expect(nav).toMatch(/return \(\s*<>\s*\{pendingHref \? <NavPendingStripe \/> : null\}/);
    expect(nav).toMatch(/function NavPendingStripe[\s\S]*?fixed inset-x-0 top-0/);
  });

  it("it ends when the new path is live, and never sticks (a timeout)", () => {
    expect(nav).toContain("useEffect(() => setPendingHref(null), [pathname]);");
    expect(nav).toMatch(/setTimeout\(\(\) => setPendingHref\(null\), NAV_PENDING_MAX_MS\)/);
  });

  it("no global navigation runtime: no history patching, no document-wide click listener", () => {
    expect(nav).not.toMatch(/history\.(pushState|replaceState)\s*=/);
    expect(nav).not.toMatch(/document\.addEventListener\(\s*["']click/);
  });

  it("the tab glyphs are 22 px (were 26)", () => {
    expect(nav).toContain('className={cn("h-[22px] w-[22px] transition-colors"');
    expect(nav).not.toContain("h-[26px] w-[26px]");
  });
});

describe("Exclusive in the profile tray, alerts behind a button", () => {
  it("the profile's Exclusive tab carries its lock, preloads on touch, and the feed lives on the Feed's own tab (design, 2026-10-18)", () => {
    const tabs = code("features/profile/profile-tabs.tsx");
    expect(code("features/profile/profile-sections.tsx")).toContain('sections.push({ key: SUB_TAB_KEY, label: "Exclusive", icon: "Lock" })');
    expect(tabs).toContain("{s.key === SUB_TAB_KEY ? <Lock ");
    expect(tabs).not.toContain('aria-label="Exclusive posts feed"');
    expect(code("features/feed/feed-topbar-tabs.tsx")).toMatch(/<Link href="\/exclusive"[\s\S]{0,200}Exclusive/);
  });

  it("the Stay-close card is mounted behind a Notifications button that toggles it with no fetch on the tap", () => {
    const tab = code("features/sub/sub-tab.tsx");
    expect(tab).toMatch(/aria-expanded=\{alertsOpen\}[\s\S]{0,400}setAlertsOpen\(\(o\) => !o\)/);
    expect(tab).toMatch(/<div id="sub-alerts-panel" hidden=\{!alertsOpen\}>\s*<ExclusiveAlerts/);
  });

  it("the creator's announcement composer sits behind an Announcements button, mounted and toggled on the tap", () => {
    const tab = code("features/sub/sub-tab.tsx");
    expect(tab).toMatch(/aria-expanded=\{announceOpen\}[\s\S]{0,400}setAnnounceOpen\(\(o\) => !o\)/);
    expect(tab).toMatch(/<div id="sub-announce-panel" hidden=\{!announceOpen\}>\s*<CreatorAnnouncements/);
  });

  it("the creator's OWN notification settings sit behind a Notifications button too — never an open card (owner 2026-10-17)", () => {
    const tab = code("features/sub/sub-tab.tsx");
    expect(tab).toMatch(/aria-expanded=\{notifyOpen\}[\s\S]{0,400}setNotifyOpen\(\(o\) => !o\)/);
    expect(tab).toMatch(/<div id="sub-notify-panel" hidden=\{!notifyOpen\}>\s*<CreatorNotifySettings/);
    // exactly one place renders it, and that place is the hidden panel
    expect(tab.match(/<CreatorNotifySettings\b/g)).toHaveLength(1);
  });
});
