import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AD_EVENT_TYPES } from "@/lib/ads-platform/catalog";

/** Owner list of 2026-10-09 (second batch): ad details in-page, ad periods, promote bubble, streak placement. */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a tapped ad opens its link at once, like Snapchat (owner, 2026-10-15)", () => {
  // was 2026-10-09: open the details sheet, then a "you're leaving" warning. Owner, 2026-10-15: "it shouldn't show preview or confirmation"
  const SURFACES = ["self-ad-banner.tsx", "fullscreen-video-ad.tsx"];
  /** Every surface visits straight away and none opens the sheet — a function so the teeth can run it on a broken copy. */
  const visitsAtOnce = (src: string) => /visitAd\(/.test(src) && !src.includes("openAdDetail(");
  it("the banner, the card and the full-screen layout (interstitial, story card, Reels slide) all visit directly", () => {
    for (const f of SURFACES) expect(visitsAtOnce(code(`features/ads-platform/serve/${f}`)), f).toBe(true);
    for (const f of ["self-interstitial.tsx", "self-story-card.tsx"]) expect(code(`features/ads-platform/serve/${f}`), f).toContain("<FullscreenAd");
  });
  it("teeth: a surface that goes back to the details sheet fails", () => {
    const b = code("features/ads-platform/serve/self-ad-banner.tsx");
    expect(visitsAtOnce(b.replace("visitAd(current, viewRef.current);", "openAdDetail(current, viewRef.current);"))).toBe(false);
  });
  it("a visit counts a click AND an outbound, and opens inside the tap", () => {
    const store = code("features/ads-platform/serve/ad-detail-store.ts");
    expect(store).toContain('trackAdEvent(view, "click");\n    trackAdEvent(view, "outbound");');
    // 2026-10-16: a target=_blank link clicked inside the tap — never this tab (see ad-new-tab.test.ts)
    expect(store).toContain("openAdInNewTab(ad.url);");
    expect(store).not.toContain("window.location.assign(ad.url)");
    expect(AD_EVENT_TYPES).toContain("conversion");
    expect(AD_EVENT_TYPES).toContain("outbound");
  });
  it("0201 counts both and the dashboard shows them", () => {
    const m = code("supabase/migrations/0201_ad_detail_conversions.sql");
    expect(m).toContain("(v_type = 'conversion')::int, (v_type = 'outbound')::int)");
    expect(m).toContain("'conversions', (select conversions from stats), 'outbounds', (select outbounds from stats),");
    expect(code("features/ads-platform/my-campaigns.tsx")).toContain('<Stat label="Conversions" value={num(s.conversions)}');
    expect(code("features/ads-platform/dashboard/campaign-detail.tsx")).toContain('{ l: "Conversions", v: num(t.conversions) }');
  });
});

describe("admin can switch a campaign period off", () => {
  it("the switch writes ad_durations.enabled, which the quote and the extension already refuse", () => {
    expect(code("app/api/admin/ads/durations/route.ts")).toContain('.update({ enabled: parsed.data.enabled');
    expect(code("features/admin/ad-manager.tsx")).toContain("<AdDurationsPanelLazy />");
    expect(code("supabase/migrations/0195_ad_platform_foundation.sql")).toContain("if not coalesce(v_d_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;");
    expect(code("supabase/migrations/0198_ad_platform_dashboard.sql")).toContain("if not coalesce(v_d_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'duration_disabled'); end if;");
  });
});

describe("the My ads button (was Promote) has fixed homes — no dragging, no floating (owner, 2026-10-09; 2026-10-15)", () => {
  /** Where it lives, as a function of the sources, so the teeth can run it on broken copies. */
  function fixedHomes(core: string, header: string, button: string, topbar: string = TOPBAR): boolean {
    return (
      // 2026-10-15 (owner): "move it to the top header" — on /downloads it is in the top bar, no longer in the hero
      !core.includes("<PromoteButton") &&
      topbar.includes('{pathname === "/downloads" && !searchActive ? <PromoteButton /> : null}') &&
      // 2026-10-28 (owner, "lean desktop header", 31573c6): the PHONE row keeps it beside Install; the desktop row lost it
      // and reaches advertising through the menu drawer's Advertise entry
      (header.match(/\{landing \? <PromoteButton size="header" \/> : null\}/g) ?? []).length === 1 &&
      header.includes('{ href: "/advertise", labelKey: "nav.advertise" }') &&
      !/drag|createPortal|pointermove|position: fixed|\bfixed\b/.test(button) &&
      // 2026-10-25 (owner): "just the ad icon" — "My ads" is the accessible name, no longer visible text
      button.includes('aria-label="My ads"')
    );
  }
  const core = code("features/downloads/download-page-core.tsx");
  const TOPBAR = code("features/app-shell/app-topbar.tsx");
  const header = code("components/layout/site-header.tsx");
  // comments stripped: the file documents the bubble it replaced
  const button = code("features/downloads/promote-button.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("in the /downloads top bar and beside Install in the landing's phone row (the desktop has the drawer), labelled My ads", () => {
    expect(fixedHomes(core, header, button)).toBe(true);
  });
  it("teeth: a draggable/fixed button, or losing a home, fails", () => {
    expect(fixedHomes(core, header, button + "\nconst drag = 1;")).toBe(false);
    expect(fixedHomes(core, header, button, TOPBAR.replace('{pathname === "/downloads" && !searchActive ? <PromoteButton /> : null}', ""))).toBe(false);
    expect(fixedHomes(core, header.replace('{landing ? <PromoteButton size="header" /> : null}', ""), button)).toBe(false);
  });
  it("just the ad icon, set into the header like its other icons (owner, 2026-10-25), and the floating bubble is gone", () => {
    // the shared header icon tile and target — not a pill with words
    expect(button).toContain("<IconTile>");
    expect(button).toContain("inline-flex h-11 w-11");
    expect(button).not.toMatch(/>\s*My ads\s*</);
    // the megaphone stays, with no disc behind it (owner, 2026-10-15)
    expect(button).toContain("<Megaphone");
    expect(button).not.toContain("bg-gradient-to-br from-violet-100");
    expect(() => code("features/downloads/promote-bubble.tsx")).toThrow();
    expect(() => code("features/downloads/promote-bubble-lazy.tsx")).toThrow();
  });
});

describe("streak placement", () => {
  it("the chip on your own profile (moved from messages, owner 2026-10-09); the ceremony plays on downloads and messages", () => {
    expect(code("app/u/[handle]/page.tsx")).toContain('aside={<StreakHeaderChip variant="pill" />}');
    expect(code("features/social/inbox-mobile-chrome.tsx")).not.toContain("<StreakHeaderChip");
    const c = code("features/streaks/streak-unlock-celebration.tsx");
    expect(c).toContain('const here = replay || pathname === "/downloads" || pathname.startsWith("/messages");');
    expect(c).toContain("if (!here) return;");
    expect(c).toContain("if (!here) return null;");
  });
  it("the pair streak sits beside the name in the chat header too", () => {
    expect(code("features/social/thread-header.tsx")).toContain("<ChatStreakBadge days={streakDays} />");
  });
});

describe("reward videos for HD and batch downloads in the promote formats (0203)", () => {
  it("two REWARD_VIDEO placements, moment slots paid-first then network, and the gate asks the paid layer first", () => {
    const m = code("supabase/migrations/0203_download_reward_placements.sql");
    expect(m).toContain("('hd_download_reward', 'HD download reward'");
    expect(m).toContain("('batch_download_reward', 'Batch download reward'");
    expect(m).toContain("'REWARD_VIDEO'");
    const slots = code("lib/ads-platform/slot-moments.ts");
    expect(slots).toContain('{ id: "hd_download_reward", kind: "moment", paidPlacement: "hd_download_reward", networkZone: null, pages: ["download", "download_result"], aspect: null, order: PAID_FIRST }');
    const flow = code("features/monetization/use-reward-flow.ts");
    expect(flow).toContain('DOWNLOAD_UNLOCK: "hd_download_reward",');
    expect(flow).toContain('BATCH_UNLOCK: "batch_download_reward",');
    // the network ad still runs when no paid campaign takes the gate
    expect(flow.indexOf("requestPaidReward(")).toBeLessThan(flow.indexOf("gpt.request(adUnitPath"));
    expect(code("features/ads-platform/serve/self-moments.tsx")).toContain("window.addEventListener(PAID_REWARD_EVENT, onGate);");
  });
});

describe("stacked network units rotate in one slot", () => {
  /** Each spot wraps its units in ONE RotatingAdStack — a function so the teeth can run it on a broken copy. */
  const rotates = (src: string, first: string) => {
    const at = src.indexOf(first);
    const open = src.lastIndexOf("<RotatingAdStack>", at);
    const close = src.indexOf("</RotatingAdStack>", at);
    return open !== -1 && close !== -1 && at - open < 200;
  };
  it("under the wallpaper button and between history periods", () => {
    expect(rotates(code("features/downloads/download-page-core.tsx"), '<LazyAdSurface zone="landing_under_wallpaper" />')).toBe(true);
    expect(rotates(code("features/history/media-gallery.tsx"), '<AdSurface zone="history_between_periods"')).toBe(true);
  });
  it("teeth: the old stacked markup fails", () => {
    const g = code("features/history/media-gallery.tsx").replace("<RotatingAdStack>", "<div>");
    expect(rotates(g, '<AdSurface zone="history_between_periods"')).toBe(false);
  });
  it("never reloads an ad: all stay mounted, one is visible, only filled units take a turn, paused when hidden", () => {
    const r = code("features/monetization/rotating-ad-stack.tsx");
    expect(r).toContain('className={i === current ? "relative" : "pointer-events-none invisible absolute inset-x-0 top-0"}');
    expect(r).toContain('if (document.visibilityState !== "visible") return;');
    expect(r).toContain("(boxes.current[i]?.scrollHeight ?? 0) > FILLED_PX");
  });
});
