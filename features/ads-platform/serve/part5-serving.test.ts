import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EligibleAd, FormatRules } from "@/lib/ads-platform/eligibility";
import { bannerIndexAt, msUntilNextRotation } from "@/lib/ads-platform/rotation";
import type { ServingPayload } from "@/lib/ads-platform/serving-payload";
import {
  __resetServingState,
  claimMoment,
  creativeFailed,
  markCreativeFailed,
  mayShowAgain,
  MOMENT_CLAIM_MS,
  momentClaimed,
  nextFromPool,
  pageForPath,
  poolFor,
  recordShown,
} from "@/lib/ads-platform/serving-state";
import { AD_SLOTS, creativeFitsSlot, NETWORK_ONLY_ZONES, providerOrder, resolveSlotProvider, slotById, slotForZone } from "@/lib/ads-platform/slot-registry";
import { AD_PLACEMENT_CODES } from "@/lib/ads-platform/catalog";
import { AD_ZONES } from "@/lib/monetization/ad-schema";

/** Ad Platform Part 5 — serving, rotation and delivery (docs/AD_PLATFORM_PART5_BRIEF.md §41). */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const NOW = Date.parse("2026-10-08T12:00:00Z");
const HOUR = 3_600_000;

function ad(i: number, over: Partial<EligibleAd> = {}): EligibleAd {
  return {
    c: `c${i}`,
    cr: `cr${i}`,
    slot: i,
    mediaType: "image",
    media: `https://cdn.example/ad${i}.webp`,
    thumb: null,
    url: "https://brand.example/",
    headline: `Ad ${i}`,
    body: null,
    sponsor: `Brand ${i}`,
    duration: null,
    w: 320,
    h: 200,
    start: new Date(NOW - HOUR).toISOString(),
    end: new Date(NOW + HOUR).toISOString(),
    pages: [],
    ...over,
  };
}

const rules = (over: Partial<FormatRules> = {}): FormatRules => ({ rotationSeconds: 5, slotCount: 10, noRepeat: true, maxDurationSeconds: 15, minGapSeconds: 0, width: null, height: null, ...over });

function payload(placements: ServingPayload["placements"], enabled = true): ServingPayload {
  return { v: 1, enabled, b: 1, placements };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  __resetServingState();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pages", () => {
  it("maps the real routes; AI Reels is the deck's AI tab", () => {
    expect(pageForPath("/")).toBe("download");
    expect(pageForPath("/downloads")).toBe("download");
    expect(pageForPath("/reels")).toBe("reels");
    expect(pageForPath("/reels", "ai")).toBe("ai_reels");
    expect(pageForPath("/feed")).toBe("feed");
    expect(pageForPath("/ai/lip-sync")).toBe("ai");
    expect(pageForPath("/studio/ai/history")).toBe("ai");
    expect(pageForPath("/academy")).toBeNull();
  });

  it("a page outside every area only gets all_pages placements", () => {
    const p = payload({
      global_top_banner: { format: "TOP_BANNER", pages: ["all_pages"], rules: rules(), ads: [ad(1)] },
      feed_banner: { format: "CONTENT_BANNER", pages: ["feed"], rules: rules(), ads: [ad(2)] },
    });
    expect(poolFor(p, "global_top_banner", null, NOW).ads).toHaveLength(1);
    expect(poolFor(p, "feed_banner", null, NOW).ads).toHaveLength(0);
    // a campaign targeting only Feed never rides the global strip onto /academy
    const targeted = payload({ global_top_banner: { format: "TOP_BANNER", pages: ["all_pages"], rules: rules(), ads: [ad(3, { pages: ["feed"] })] } });
    expect(poolFor(targeted, "global_top_banner", null, NOW).ads).toHaveLength(0);
    expect(poolFor(targeted, "global_top_banner", "feed", NOW).ads).toHaveLength(1);
  });
});

describe("TOP_BANNER — 10 ads, 5-second LOCAL rotation", () => {
  it("cycles ad1 → ad10 → ad1 from the pool it holds, by time alone", () => {
    const shown = Array.from({ length: 12 }, (_, k) => bannerIndexAt(k * 5000 + 1, 5, 10));
    expect(shown).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    expect(msUntilNextRotation(1200, 5, 10)).toBe(3800);
  });

  it("the banner keeps ONE timeout, no interval and no request per swap", () => {
    const b = code("features/ads-platform/serve/self-ad-banner.tsx");
    expect(b).not.toMatch(/setInterval\s*\(/);
    expect(b).not.toMatch(/fetch\s*\(|loadSelfAds|loadAdInventory/);
    expect(b).toContain("setTimeout(");
    expect(b).toContain('document.addEventListener("visibilitychange", onVis)'); // stops while hidden
    expect(b).toContain("if (timer) clearTimeout(timer);"); // and on unmount
  });

  it("only the NEXT creative is warmed, and only an image", () => {
    const b = code("features/ads-platform/serve/self-ad-banner.tsx");
    expect(b).toContain('if (next?.mediaType !== "image") return;');
    expect(b.match(/new Image\(\)/g)).toHaveLength(1);
  });

  it("the paid top banner lives INSIDE the existing top-banner containers — no strip of its own", () => {
    const containers: [string, string][] = [["features/monetization/top-page-banner-ad.tsx", "top_banner"], ["features/monetization/sticky-top-ad.tsx", "downloads_top"]];
    for (const [file, slot] of containers) {
      const c = src(file);
      expect(c, file).toContain('useSlotProvider("' + slot + '"');
      expect(c, file).toContain('data-ad-slot="' + slot + '"');
      expect(c, file).toMatch(/\{paid \? \(\s*<SelfTopCreative[\s\S]*?\) : network \? \(\s*<AdSlot/);
    }
    expect(existsSync(join(process.cwd(), "features/ads-platform/serve/self-top-banner.tsx"))).toBe(false);
    for (const l of ["app/(app)/layout.tsx", "app/(marketing)/layout.tsx"]) expect(src(l)).not.toContain("selfbanner");
  });

  it("the paid top creative keeps its 10:1 shape (not a 32 px sliver)", () => {
    const t = src("features/ads-platform/serve/self-top-creative.tsx");
    expect(t).toContain("max-w-[728px]");
    expect(t).toContain("style={{ aspectRatio: String(ratio) }}");
  });
});

describe("eligibility in the browser narrows, never widens", () => {
  it("an expired campaign disappears at its end second, even from a cached pool", () => {
    const p = payload({ feed_banner: { format: "CONTENT_BANNER", pages: ["feed"], rules: rules(), ads: [ad(1, { end: new Date(NOW + 1000).toISOString() })] } });
    expect(poolFor(p, "feed_banner", "feed", NOW).ads).toHaveLength(1);
    expect(poolFor(p, "feed_banner", "feed", NOW + 1000).ads).toHaveLength(0);
  });

  it("a campaign that has not started yet is not served", () => {
    const p = payload({ feed_banner: { format: "CONTENT_BANNER", pages: ["feed"], rules: rules(), ads: [ad(1, { start: new Date(NOW + HOUR).toISOString() })] } });
    expect(poolFor(p, "feed_banner", "feed", NOW).ads).toHaveLength(0);
  });

  it("global disable: an enabled:false payload serves nothing anywhere", () => {
    const p = payload({ feed_banner: { format: "CONTENT_BANNER", pages: ["feed"], rules: rules(), ads: [ad(1)] } }, false);
    expect(poolFor(p, "feed_banner", "feed", NOW).ads).toHaveLength(0);
    expect(poolFor(null, "feed_banner", "feed", NOW).ads).toHaveLength(0);
  });
});

describe("REWARD_VIDEO — duration against the ADMIN limit, default 15 s", () => {
  const videos = Array.from({ length: 10 }, (_, i) => ad(i + 1, { mediaType: "video", duration: 10 + i }));
  const at = (max: number | null) => poolFor(payload({ ai_video_save_reward: { format: "REWARD_VIDEO", pages: ["ai"], rules: rules({ maxDurationSeconds: max }), ads: videos } }), "ai_video_save_reward", "ai", NOW).ads.map((a) => a.duration);

  it("15 s default: 10–15 s serve, 16–19 s do not", () => {
    expect(at(15)).toEqual([10, 11, 12, 13, 14, 15]);
  });
  it("an admin raising it to 18 s lets 16–18 s through; lowering to 12 takes 13+ out", () => {
    expect(at(18)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(at(12)).toEqual([10, 11, 12]);
  });
  it("a video with no measured duration never serves", () => {
    const p = payload({ ai_video_save_reward: { format: "REWARD_VIDEO", pages: ["ai"], rules: rules(), ads: [ad(1, { mediaType: "video", duration: null })] } });
    expect(poolFor(p, "ai_video_save_reward", "ai", NOW).ads).toHaveLength(0);
  });
});

describe("INTERSTITIAL / DOWNLOAD_COMPLETED — no consecutive duplicate, frequency cap", () => {
  it("never the same ad twice in a row while another exists (200 moments)", () => {
    const pool = Array.from({ length: 10 }, (_, i) => ad(i + 1));
    let last: string | null = null;
    const seen = new Set<string>();
    for (let k = 0; k < 200; k++) {
      const next = nextFromPool("interstitial", pool)!;
      expect(next.cr).not.toBe(last);
      recordShown("interstitial", next.cr, NOW + k);
      last = next.cr;
      seen.add(next.cr);
    }
    expect(seen.size).toBe(10); // the whole pool gets its share
  });

  it("one ad in the pool is shown again (nothing else exists)", () => {
    recordShown("interstitial", "cr1", NOW);
    expect(nextFromPool("interstitial", [ad(1)])!.cr).toBe("cr1");
  });

  it("the admin gap (min_gap_seconds) holds the next one back", () => {
    expect(mayShowAgain("interstitial", rules({ minGapSeconds: 120 }), NOW)).toBe(true);
    recordShown("interstitial", "cr1", NOW);
    expect(mayShowAgain("interstitial", rules({ minGapSeconds: 120 }), NOW + 119_000)).toBe(false);
    expect(mayShowAgain("interstitial", rules({ minGapSeconds: 120 }), NOW + 120_000)).toBe(true);
    expect(mayShowAgain("download_completed_interstitial", rules({ minGapSeconds: 0 }), NOW)).toBe(true);
  });

  it("empty inventory: nothing to pick, no error", () => {
    expect(nextFromPool("interstitial", [])).toBeNull();
    expect(poolFor(payload({}), "interstitial", "download", NOW)).toEqual({ ads: [], rules: null });
  });
});

describe("a broken creative is skipped for the session, never retried", () => {
  it("leaves every pool at once and the rotation continues with the rest", () => {
    const p = payload({ feed_banner: { format: "CONTENT_BANNER", pages: ["feed"], rules: rules(), ads: [ad(1), ad(2), ad(3)] } });
    markCreativeFailed("cr2");
    expect(creativeFailed("cr2")).toBe(true);
    expect(poolFor(p, "feed_banner", "feed", NOW).ads.map((a) => a.cr)).toEqual(["cr1", "cr3"]);
  });

  it("the renderer marks it failed on the media's own error and moves on", () => {
    const c = code("features/ads-platform/serve/self-ad-creative.tsx");
    expect(c).toContain("markCreativeFailed(ad.cr);");
    expect(c.match(/onError=\{fail\}/g)).toHaveLength(2); // image and video
  });
});

describe("one ad per moment — paid first, the network stands down", () => {
  it("a claim lasts a minute, then expires", () => {
    expect(momentClaimed("download-complete", NOW)).toBe(false);
    claimMoment("download-complete", NOW);
    expect(momentClaimed("download-complete", NOW + MOMENT_CLAIM_MS - 1)).toBe(true);
    expect(momentClaimed("download-complete", NOW + MOMENT_CLAIM_MS)).toBe(false);
  });

  it("every network unit for the same moment checks the claim", () => {
    expect(src("features/monetization/vast-interstitial/download-complete-trigger.tsx")).toContain('momentClaimed("download-complete") ? undefined : m.requestVastInterstitial("download-complete")');
    expect(src("features/monetization/download-complete-ad.tsx")).toContain('if (open && momentClaimed("download-complete")) close();');
    const idle = src("features/monetization/idle-interstitial.tsx");
    expect(idle).toContain('if (momentClaimed("return")) return false;');
    expect(idle).toContain("if (away >= AWAY_MS) window.setTimeout(show, 0);");
    expect(src("features/monetization/top-page-banner-ad.tsx")).toContain("const visible = allowedPath && (!!paid || (network && hasAd === true));");
  });

  it("the claim module the network imports is tiny — no engine on every page", () => {
    expect(src("lib/ads-platform/moment-events.ts")).not.toMatch(/^import /m);
  });
});

describe("DOWNLOAD_COMPLETED — only after a real completion, never over the save", () => {
  it("listens to the manager's completion event and waits while the viewer holds the file", () => {
    const m = code("features/ads-platform/serve/self-moments.tsx");
    expect(m).toContain("window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);");
    expect(m).toContain("if (!isPlayerOpen()) {");
    expect(m).toContain("window.addEventListener(SAVED_TO_DEVICE_EVENT, done);");
    expect(m).toContain("now - lastMomentAt.current < SAME_MOMENT_MS"); // a batch is one moment
  });
});

describe("REWARD_VIDEO never gates an AI save", () => {
  it("the event fires AFTER the save started, and the save returns regardless", () => {
    const d = code("features/ai/ai-result-download.ts");
    const started = d.indexOf("const taskId = startDownload(");
    const fired = d.indexOf("window.dispatchEvent(new Event(AI_VIDEO_SAVE_EVENT))");
    expect(started).toBeGreaterThan(-1);
    expect(fired).toBeGreaterThan(started);
    expect(d).toContain("return taskId;");
    expect(d).not.toMatch(/await/);
  });

  it("Continue and close work from the first frame; completion only on a real end", () => {
    const s = code("features/ads-platform/serve/self-interstitial.tsx");
    expect(s).not.toMatch(/disabled=/);
    expect(s).toContain('if (reward && view.current) trackAdEvent(view.current, "reward_video_complete");');
    expect(s.match(/reward_video_complete/g)).toHaveLength(1);
    expect(s).toContain('if (e.key === "Escape") onClose();');
  });
});

describe("cost: nothing until a campaign is live", () => {
  it("the gate waits for idle, skips ad-free members and needs the inventory's self:true", () => {
    const g = code("features/ads-platform/serve/self-ads-gate.tsx");
    expect(g).toContain("if (!ready || !showAds) return;");
    expect(g).toContain("requestIdleCallback");
    expect(g).toContain("if (alive && mayServeSelf(inv)) setOn(true);");
    expect(g).toMatch(/dynamic\(\(\) => import\("\.\/self-ads-root"\)/);
    expect(src("features/app-shell/deferred-shell.tsx")).toContain("<SelfAdsGate />");
  });

  it("every paid renderer in a shared container is a dynamic import", () => {
    for (const f of ["features/monetization/ad-surface.tsx", "features/monetization/result-ad.tsx", "features/monetization/reels-ad-slide.tsx", "features/ads-platform/serve/self-ad-slot.tsx"]) {
      expect(src(f), f).toMatch(/const SelfAdCard = dynamic\(/);
    }
    for (const f of ["features/monetization/top-page-banner-ad.tsx", "features/monetization/sticky-top-ad.tsx"]) expect(src(f), f).toMatch(/const SelfTopCreative = dynamic\(/);
    expect(src("features/app-shell/dashboard/stories-row.tsx")).toMatch(/const SelfStoryCard = dynamic\(/);
  });

  it("media comes straight from the storage CDN — no next/image proxy, no API route", () => {
    const c = code("features/ads-platform/serve/self-ad-creative.tsx");
    expect(c).toContain("src={ad.media}");
    expect(c).not.toMatch(/next\/image|\/api\//);
  });
});

describe("ONE physical slot → ONE provider (slots addendum)", () => {
  it("the registry covers every network zone exactly once, and every paid placement", () => {
    const zones: string[] = [...AD_ZONES];
    const covered = [...AD_SLOTS.map((x) => x.networkZone).filter((z): z is string => !!z), ...NETWORK_ONLY_ZONES];
    expect([...covered].sort()).toEqual([...zones].sort());
    expect(new Set(covered).size).toBe(covered.length);
    const paid = new Set(AD_SLOTS.map((x) => x.paidPlacement));
    for (const p of AD_PLACEMENT_CODES) expect(paid.has(p), p).toBe(true);
  });

  it("new inventory only where no network slot existed", () => {
    const created = AD_SLOTS.filter((x) => x.newInventory);
    expect(created.map((x) => x.id).sort()).toEqual(["ai_hub_card", "ai_save_moment", "stories_between"]);
    for (const x of created) expect(x.networkZone, x.id).toBeNull();
    for (const x of AD_SLOTS.filter((y) => !y.newInventory)) expect(x.networkZone, x.id).not.toBeNull();
  });

  it("the order is the admin's when valid, else the registry default", () => {
    const top = slotById("top_banner")!;
    expect(providerOrder(top, null)).toEqual(["frenzsave", "network"]);
    expect(providerOrder(top, { top_banner: ["network", "frenzsave"] })).toEqual(["network", "frenzsave"]);
    expect(providerOrder(top, { top_banner: ["bogus"] })).toEqual(["frenzsave", "network"]);
    // a slot with no network zone can never be handed to "network"
    expect(providerOrder(slotById("ai_hub_card")!, { ai_hub_card: ["network"] })).toEqual(["frenzsave"]);
  });

  it("resolves the first AVAILABLE provider, and falls back when the network does not fill", () => {
    expect(resolveSlotProvider(["frenzsave", "network"], { frenzsave: true, network: true })).toBe("frenzsave");
    expect(resolveSlotProvider(["frenzsave", "network"], { frenzsave: false, network: true })).toBe("network");
    expect(resolveSlotProvider(["network", "frenzsave"], { frenzsave: true, network: true })).toBe("network");
    expect(resolveSlotProvider(["network", "frenzsave"], { frenzsave: true, network: true, networkEmpty: true })).toBe("frenzsave");
    expect(resolveSlotProvider(["network", "frenzsave"], { frenzsave: true, network: false })).toBe("frenzsave");
    expect(resolveSlotProvider(["frenzsave", "network"], { frenzsave: false, network: false })).toBeNull();
    expect(resolveSlotProvider(["frenzsave", "network"], { frenzsave: false, network: null })).toBe("network"); // unknown inventory = ask, as before
  });

  it("a creative must fit the physical box", () => {
    const card = slotById("under_download")!;
    expect(creativeFitsSlot(card, 640, 400)).toBe(true);
    expect(creativeFitsSlot(card, 1080, 1920)).toBe(false);
    expect(creativeFitsSlot(slotById("top_banner")!, 640, 64)).toBe(true);
    expect(creativeFitsSlot(slotById("top_banner")!, 640, 400)).toBe(false);
  });

  it("AdSurface decides the provider first and mounts only that one — no second container", () => {
    const a = src("features/monetization/ad-surface.tsx");
    expect(a).toContain("const slot = slotForZone(zone);");
    expect(a).toContain('if (occupant.status === "pending") return null;');
    expect(a).toContain("if (occupant.provider === null) return null;");
    expect(a).not.toContain("self={{");
    for (const f of ["features/feed/feed-ad-slot.tsx", "features/downloads/download-page-core.tsx", "features/downloader/downloader.tsx"]) expect(src(f), f).not.toContain("self={{");
    expect(slotForZone("feed_inline")!.paidPlacement).toBe("feed_banner");
    expect(slotForZone("homepage_top")).toBeNull(); // network-only zones keep their exact old path
  });

  it("every box slot's network unit reports EMPTY so the next provider gets the slot", () => {
    expect(src("features/monetization/ad-surface.tsx")).toContain("if (!has && slot) networkEmpty();");
    expect(src("features/monetization/result-ad.tsx")).toContain("if (ad === null) onEmpty?.();");
    expect(src("features/monetization/reels-ad-slide.tsx")).toContain("if (!has) onNetworkEmpty?.();");
    expect(src("features/monetization/top-page-banner-ad.tsx")).toContain("if (!has) networkEmpty();");
  });

  it("placements are mounted where the brief puts them", () => {
    expect(src("features/monetization/result-ad.tsx")).toContain('useSlotProvider("download_result_page", "download_result")');
    expect(src("features/feed/reel-viewer.tsx")).toContain('useSlotProvider("reels_interstitial", adPage)');
    expect(src("features/reels/reels-feed.tsx")).toContain('adPage={tab === "ai" ? "ai_reels" : "reels"}');
    expect(src("features/ai/frenz-ai-welcome.tsx")).toContain('<SelfAdSlot slot="ai_hub_card" placement="ai_banner" page="ai"');
    expect(src("features/app-shell/dashboard/stories-row.tsx")).toContain('useSelfAdPool("stories_card", "stories")');
  });

  it("a story card only between two people's stories, within the gap", () => {
    const s = src("features/app-shell/dashboard/stories-row.tsx");
    expect(s).toMatch(/else if \(gi < groups\.length - 1\) \{\s*if \(storyAds\.status === "ready" && storyAds\.ads\.length && mayShowAgain\("stories_card", storyAds\.rules\)\)/);
    expect(s).toContain("replying || holding || paidCard");
  });
});
