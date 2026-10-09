import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AD_EVENT_TYPES } from "@/lib/ads-platform/catalog";

/** Owner list of 2026-10-09 (second batch): ad details in-page, ad periods, promote bubble, streak placement. */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a tapped ad opens its details on the same page", () => {
  const SURFACES = ["self-ad-banner.tsx", "self-interstitial.tsx", "self-story-card.tsx"];
  /** Every surface opens the detail instead of leaving — a function so the teeth can run it on a broken copy. */
  const opensDetail = (src: string) => /onClick=\{\(e\) => \{\s*e\.preventDefault\(\);\s*openAdDetail\(/.test(src) && !src.includes("trackAdClick(");
  it("banner, interstitial and story card all open the detail sheet", () => {
    for (const f of SURFACES) expect(opensDetail(code(`features/ads-platform/serve/${f}`)), f).toBe(true);
  });
  it("teeth: a surface that still links straight out fails", () => {
    const b = code("features/ads-platform/serve/self-ad-banner.tsx");
    expect(opensDetail(b.replace(/onClick=\{\(e\) => \{\s*e\.preventDefault\(\);\s*openAdDetail\(current, viewRef\.current\);\s*\}\}/, "onClick={() => trackAdClick(viewRef.current)}"))).toBe(false);
  });
  it("opening counts a click AND a conversion; visiting is behind a warning and counts an outbound", () => {
    const store = code("features/ads-platform/serve/ad-detail-store.ts");
    expect(store).toContain('trackAdEvent(view, "click");\n    trackAdEvent(view, "conversion");');
    const sheet = code("features/ads-platform/serve/ad-detail-sheet.tsx");
    expect(sheet).toContain("You&apos;re leaving Frenzsave");
    expect(sheet).toContain('if (view) trackAdEvent(view, "outbound");');
    expect(sheet).toContain('window.open(ad.url, "_blank", "noopener,noreferrer");');
    expect(AD_EVENT_TYPES).toContain("conversion");
    expect(AD_EVENT_TYPES).toContain("outbound");
  });
  it("0201 counts both and the dashboard shows them", () => {
    const m = code("supabase/migrations/0201_ad_detail_conversions.sql");
    expect(m).toContain("(v_type = 'conversion')::int, (v_type = 'outbound')::int)");
    expect(m).toContain("'conversions', (select conversions from stats), 'outbounds', (select outbounds from stats),");
    expect(code("features/ads-platform/my-campaigns.tsx")).toContain('<Stat label="Conversions" value={num(s.conversions)}');
    expect(code("features/ads-platform/dashboard/campaign-detail.tsx")).toContain(">Conversions</p>");
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

describe("the promote card is a floating, draggable, lazy side bubble", () => {
  it("the hero mounts the lazy loader; the bubble is portalled, labelled Promote, draggable, remembered and cached after its first appearance", () => {
    expect(code("features/downloads/downloads-sections.tsx")).toContain("<PromoteBubbleLazy />");
    const b = code("features/downloads/promote-bubble.tsx");
    // Portalled: into its dock beside the credits card by default (the improved
    // reference, 2026-10-09), or to <body> once dragged off to float.
    expect(b).toContain("createPortal(<span className={drag ? \"invisible\" : undefined}>{button(false)}</span>, dock)");
    expect(b).toContain("document.body)");
    // owner 2026-10-09: "change the ad text on the promote button to the promote not ad"
    expect(b).toMatch(/>\n\s*\{\/\* owner 2026-10-09: the tag reads "Promote", not "Ad" \*\/\}\n\s*Promote\n\s*<\/span>/);
    expect(b).not.toMatch(/>\n\s*Ad\n\s*<\/span>/);
    expect(b).toContain('const KEY = "frenz:promote-bubble:v1";');
    expect(b).toContain("if (!s.moved && Math.hypot(dx, dy) < 6) return;");
    expect(code("features/downloads/download-page-core.tsx")).toContain('<div id="frenz-promote-dock" className="flex h-10 w-10 shrink-0 items-center justify-center" />');
    const lazy = code("features/downloads/promote-bubble-lazy.tsx");
    expect(lazy).toContain("requestIdleCallback");
    // owner 2026-10-09: no idle wait again once it has appeared (back swipes, returns)
    expect(lazy).toContain("if (seenBefore()) {");
    expect(lazy).toContain('sessionStorage.setItem(SEEN_KEY, "1");');
  });
});

describe("streak placement", () => {
  it("the chip only on the messages page; the ceremony plays on downloads and messages", () => {
    expect(code("features/streaks/streak-header-chip.tsx")).toContain('const STREAK_ROUTES = new Set(["/messages"]);');
    expect(code("features/social/inbox-mobile-chrome.tsx")).toContain("<StreakHeaderChip />");
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
