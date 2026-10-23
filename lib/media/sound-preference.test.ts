import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 2026-10-23: videos play WITH sound on landing and scrolling unless the member muted by hand; that
 * choice is remembered for every video. A browser refusing sound before the first touch plays muted and the
 * first tap brings the sound in. Real module, scripted window/localStorage/media element.
 */

let store: Map<string, string>;
let listeners: Map<string, Set<(e: Event) => void>>;

beforeEach(() => {
  vi.resetModules();
  store = new Map();
  listeners = new Map();
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener: (t: string, fn: (e: Event) => void) => void (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(fn),
    removeEventListener: (t: string, fn: (e: Event) => void) => void listeners.get(t)?.delete(fn),
    dispatchEvent: (e: Event) => (listeners.get(e.type)?.forEach((fn) => fn(e)), true),
  });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => 0 });
});
afterEach(() => vi.unstubAllGlobals());

const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn(new Event(type)));
/** a <video>: `refuseSound` = the browser's autoplay rule refuses unmuted play */
function media(refuseSound: boolean) {
  const v = { muted: true, volume: 1, paused: true, play: vi.fn(async () => {
    if (refuseSound && !v.muted) throw Object.assign(new Error("NotAllowedError"), { name: "NotAllowedError" });
    v.paused = false;
  }) };
  return v as unknown as HTMLMediaElement & { play: ReturnType<typeof vi.fn> };
}

describe("one sound preference for every video", () => {
  it("default: SOUND ON — a clip starts unmuted", async () => {
    const { playWithPreferredSound } = await import("./sound-preference");
    const v = media(false);
    expect(await playWithPreferredSound(v)).toBe("sound");
    expect(v.muted).toBe(false);
  });

  it("muted by hand → every later clip starts muted, remembered across visits, until unmuted", async () => {
    const m = await import("./sound-preference");
    m.setUserMutedSound(true);
    vi.resetModules();
    const again = await import("./sound-preference");
    const v = media(false);
    v.muted = false;
    expect(await again.playWithPreferredSound(v)).toBe("muted");
    expect(v.muted).toBe(true);
    again.setUserMutedSound(false);
    const w = media(false);
    expect(await again.playWithPreferredSound(w)).toBe("sound");
  });

  it("the browser refuses sound before the first touch → plays muted; the first tap unlocks the sound", async () => {
    const m = await import("./sound-preference");
    const v = media(true);
    expect(await m.playWithPreferredSound(v)).toBe("muted");
    expect(v.muted).toBe(true);
    const unlocked = vi.fn();
    m.onSoundUnlocked(unlocked);
    fire("pointerdown");
    expect(unlocked).toHaveBeenCalledTimes(1);
    fire("pointerdown");
    expect(unlocked).toHaveBeenCalledTimes(1);
  });

  it("a refusal never unlocks for a member who muted by hand", async () => {
    const m = await import("./sound-preference");
    await m.playWithPreferredSound(media(true));
    m.setUserMutedSound(true);
    const unlocked = vi.fn();
    m.onSoundUnlocked(unlocked);
    fire("pointerdown");
    expect(unlocked).not.toHaveBeenCalled();
  });

  it("a mute on one video reaches every other one", async () => {
    const m = await import("./sound-preference");
    const seen: boolean[] = [];
    m.onSoundPreference((muted) => seen.push(muted));
    m.setUserMutedSound(true);
    m.setUserMutedSound(false);
    expect(seen).toEqual([true, false]);
  });

  it("feed and reels both use it; the feed's controls sit at the bottom-right", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const feed = src("features/media/feed-video.tsx");
    expect(feed).toContain("void playWithPreferredSound(v);");
    expect(feed).toContain("setUserMutedSound(v.muted);");
    expect(feed).toContain('className="absolute bottom-0 right-0 z-10 flex items-center gap-0.5 p-1"');
    const reels = src("features/feed/reel-viewer.tsx");
    expect(reels).toContain('void playWithPreferredSound(v).then((r) => setMutedAuto(r !== "sound"));');
    expect(reels).toContain("setUserMutedSound(true);");
  });
});
