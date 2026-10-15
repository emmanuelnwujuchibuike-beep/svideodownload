import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HISTORY_STORY_AD_EVENT, requestPaidHistoryStoryAd, type HistoryStoryAdRequest } from "@/lib/ads-platform/history-story-event";
import { MOMENT_SLOTS } from "@/lib/ads-platform/slot-moments";
import type { DownloadRecord } from "@/types";

import {
  closePlayer,
  isPlayerAdPending,
  openPlayer,
  openPlayerQueue,
  openPlayerQueueWithAds,
  playerAdDone,
  playerClipEnded,
  playerNext,
  playerPrev,
} from "./player-store";

/**
 * Owner, 2026-10-14: "Ad doesn't show in the history. When a user watched 3
 * medias from history he or she should see the full screen ad, can be image or
 * video. Include it to the self ad application and service."
 */
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }) as unknown as DownloadRecord);
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

afterEach(() => closePlayer());

/** Tap next until an ad holds the advance; how many media were watched before it. */
function watchedBeforeAd(start: number): number {
  openPlayerQueueWithAds(items(20), start, 3);
  let watched = 1;
  for (let i = 0; i < 10; i++) {
    playerNext();
    if (isPlayerAdPending()) return watched;
    watched++;
  }
  return -1;
}

describe("History viewer: an ad after every 3 media WATCHED", () => {
  it("3 watched, then the ad — wherever the queue opens (it was the queue position: opening at the 6th gave an ad after 1)", () => {
    for (const start of [0, 1, 2, 4, 5, 7]) expect(watchedBeforeAd(start), `opened at ${start}`).toBe(3);
  });

  it("the ad holds the advance, then the next three start again", () => {
    openPlayerQueueWithAds(items(20), 5, 3);
    playerNext();
    playerClipEnded(); // a clip played to the end counts the same as a tap
    expect(isPlayerAdPending()).toBe(false);
    playerNext();
    expect(isPlayerAdPending()).toBe(true);
    playerAdDone();
    expect(isPlayerAdPending()).toBe(false);
    playerNext();
    playerNext();
    expect(isPlayerAdPending()).toBe(false);
    playerNext();
    expect(isPlayerAdPending()).toBe(true);
  });

  it("going back to a media counts as watching it", () => {
    openPlayerQueueWithAds(items(20), 5, 3);
    playerPrev();
    playerPrev();
    playerNext();
    expect(isPlayerAdPending()).toBe(true);
  });

  it("no ad before the end of the queue has a next media to hold", () => {
    openPlayerQueueWithAds(items(3), 0, 3);
    playerNext();
    playerNext();
    playerNext(); // at the last item: no-op
    expect(isPlayerAdPending()).toBe(false);
  });

  it("only the history gallery's queue has ads — a queue opened after it never inherits the cadence", () => {
    openPlayerQueueWithAds(items(20), 0, 3);
    closePlayer();
    openPlayerQueue(items(20), 0);
    for (let i = 0; i < 6; i++) playerNext();
    expect(isPlayerAdPending()).toBe(false);
    openPlayer(items(1)[0]!);
    expect(isPlayerAdPending()).toBe(false);
  });
});

describe("the ad is SEEN: the top-layer player is not mounted while it shows", () => {
  it("DownloadPlayer renders the ad INSTEAD of PlayerInner (a modal <dialog> covers anything outside the top layer)", () => {
    const c = code("features/downloads/download-player.tsx");
    const outer = c.slice(c.indexOf("export function DownloadPlayer"), c.indexOf("function PlayerInner"));
    expect(outer).toMatch(/if \(adPending\) \{[\s\S]*?return \([\s\S]*?\);\s*\}\s*return <PlayerInner /);
    expect(outer).toContain("requestPaidHistoryStoryAd(playerAdDone)");
    expect(outer).toMatch(/adBy === "network" \? <StoryAdSlide/);
  });

  it("the network's VAST path does not release the player before its overlay closes", () => {
    const c = code("features/monetization/story-ad-slide.tsx");
    const vast = c.slice(c.indexOf('if (mode !== "vast" || fired.current) return;'), c.indexOf(".finally(onNext)"));
    expect(vast).not.toContain("onResolved(false)");
  });
});

describe("the paid side (self-serve placement `history_story`)", () => {
  it("is the moment slot of the network zone, paid first", () => {
    const slot = MOMENT_SLOTS.find((s) => s.id === "history_story_ad");
    expect(slot).toMatchObject({ kind: "moment", paidPlacement: "history_story", networkZone: "history_story_ad", pages: ["history"], order: ["frenzsave", "network"] });
  });

  it("the request is answered synchronously: handled → the paid ad; unanswered → the network", () => {
    const g = globalThis as unknown as { window?: unknown };
    const had = "window" in g;
    const target = new EventTarget();
    g.window = target;
    try {
      expect(requestPaidHistoryStoryAd(() => {})).toBe(false);
      let done = 0;
      const take = (e: Event) => {
        const req = (e as CustomEvent<HistoryStoryAdRequest>).detail;
        req.handled = true;
        req.onDone();
      };
      target.addEventListener(HISTORY_STORY_AD_EVENT, take);
      expect(requestPaidHistoryStoryAd(() => done++)).toBe(true);
      expect(done).toBe(1);
    } finally {
      if (!had) delete g.window;
    }
  });

  it("SelfMoments takes it on the history page, without the format's gap, and completes the advance on close", () => {
    const c = code("features/ads-platform/serve/self-moments.tsx");
    expect(c).toContain("window.addEventListener(HISTORY_STORY_AD_EVENT, onStory)");
    expect(c).toMatch(/pick\(HISTORY_STORY, null, \{ page: "history", gap: false \}\)/);
    expect(c).toMatch(/open\(\{ \.\.\.s, after: req\.onDone \}\)/);
    expect(c).toMatch(/const close = useCallback\([\s\S]*?showingRef\.current\?\.after\?\.\(\);/);
  });
});

describe("2026-10-15: the History ad moves on by a side tap or a swipe — only after the countdown", () => {
  const c = code("features/ads-platform/serve/self-interstitial.tsx");

  it("the side zones exist only once the ad may be skipped", () => {
    expect(c).toMatch(/\{swipeNext && canSkip \? \([\s\S]*?data-ad-next="left"[\s\S]*?data-ad-next="right"[\s\S]*?\) : null\}/);
  });

  it("a swipe left, right or up moves on, and a swipe during the countdown does nothing", () => {
    expect(c).toMatch(/swipeFrom\.current = swipeNext && canSkipRef\.current \? \{ x: e\.clientX, y: e\.clientY \} : null;/);
    expect(c).toMatch(/if \(!from \|\| !canSkipRef\.current\) return;/);
    expect(c).toMatch(/if \(Math\.abs\(dx\) >= SWIPE_PX \|\| dy <= -SWIPE_PX\) onClose\(\);/);
  });

  it("only the History viewer's ad gets it", () => {
    expect(code("features/ads-platform/serve/self-moments.tsx")).toContain("swipeNext={showing.placement === HISTORY_STORY}");
  });
});
