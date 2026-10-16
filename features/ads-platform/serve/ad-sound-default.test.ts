import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/*
  Owner, 2026-10-16: "History grid ad plays sound in background even when the sound is not turned on, no sound
  should play when is not turned on, all video ads stay mute in default, and no sounds should play in background".
*/

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("ad sound", () => {
  it("starts OFF for every video ad, and only the person's own tap turns it on (for this session)", async () => {
    const s = await import("./ad-sound");
    expect(s.adSoundOn()).toBe(false);
    s.setAdSound(true);
    expect(s.adSoundOn()).toBe(true);
    vi.resetModules();
    expect((await import("./ad-sound")).adSoundOn()).toBe(false); // a new page: muted again
  });

  it("a dialog covers an ad that is not inside it — and never the full-screen ad's own video", async () => {
    const adInGrid = { id: "grid-ad" };
    const adInDialog = { id: "dialog-ad" };
    const viewer = { getClientRects: () => [1], contains: (el: unknown) => el === adInDialog };
    const hiddenDialog = { getClientRects: () => [], contains: () => false };
    let open: unknown[] = [];
    const selectors: string[] = [];
    vi.stubGlobal("document", { querySelectorAll: (sel: string) => (selectors.push(sel), open) });
    const { dialogCovers } = await import("@/lib/ui/modal-open");
    expect(dialogCovers(adInGrid as unknown as Element)).toBe(false); // nothing open
    open = [hiddenDialog];
    expect(dialogCovers(adInGrid as unknown as Element)).toBe(false); // mounted but not on screen
    open = [viewer];
    expect(dialogCovers(adInGrid as unknown as Element)).toBe(true); // the History player over the grid
    expect(dialogCovers(adInDialog as unknown as Element)).toBe(false); // the ad inside the dialog plays
    expect(selectors[0]).toContain("dialog[open]"); // a native <dialog> (the History player) counts too
  });

  it("the occlusion gate really pauses the video holding playback, and holds it while open", async () => {
    const vc = await import("@/lib/media/video-coordinator");
    const ad = { pause: vi.fn() };
    vc.claimPlayback(ad as never);
    const release = vc.suspendPlayback();
    expect(ad.pause).toHaveBeenCalledTimes(1);
    expect(vc.isSuspended()).toBe(true);
    release();
    expect(vc.isSuspended()).toBe(false);
  });

  it("an ad never starts under a cover, and the History player holds the occlusion gate", () => {
    const c = readFileSync(join(process.cwd(), "features/ads-platform/serve/self-ad-creative.tsx"), "utf8");
    expect(c).toContain('document.visibilityState === "visible" && !isSuspended() && !dialogCovers(v)) {');
    expect(c).toContain("claimPlayback(v);"); // so suspendPlayback() can pause it
    expect(c).toMatch(/<video[\s\S]{0,400}\n\s+muted\n/); // the element starts muted: no first frame of sound
    const player = readFileSync(join(process.cwd(), "features/downloads/download-player.tsx"), "utf8");
    expect(player).toContain("const releasePlayback = suspendPlayback();");
    expect(player).toContain("releasePlayback();");
  });
});
