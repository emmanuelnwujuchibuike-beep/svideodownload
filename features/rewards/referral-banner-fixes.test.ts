import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { markSharedToday, sharedToday } from "./referral-shared-today";

/** Owner, 2026-10-08 — the referral banner after downloads. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared once → quiet until tomorrow", () => {
  it("is silent for the rest of the day after a share, and back the next day", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 15, 0));
    expect(sharedToday()).toBe(false);
    markSharedToday();
    expect(sharedToday()).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 8, 23, 59));
    expect(sharedToday()).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 9, 0, 1));
    expect(sharedToday()).toBe(false);
  });

  it("no storage (private mode) never breaks — it just may show again", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => markSharedToday()).not.toThrow();
    expect(sharedToday()).toBe(false);
  });

  it("a share or copy marks the day; the trigger checks it before and after waiting", () => {
    expect(src("features/rewards/referral-banner.tsx")).toMatch(/if \(out === "shared" \|\| out === "copied"\) \{\s*markSharedToday\(\);/);
    const t = src("features/rewards/referral-banner-trigger.tsx");
    expect(t).toContain("|| sharedToday()) return;");
    expect(t).toContain("if (!sharedToday() && !anotherModalOpen()) setShow(true);");
  });
});

describe("the Skip / X actually closes it", () => {
  it("the button sits on its own layer above the later, relative content block", () => {
    expect(src("features/rewards/referral-banner.tsx")).toContain('className="absolute right-3 top-3 z-10 inline-flex');
  });
});

describe("after the download is really delivered, not over Save to device", () => {
  it("while the viewer is open it waits for a real save or the viewer closing — no timer", () => {
    const t = src("features/rewards/referral-banner-trigger.tsx");
    expect(t).toContain("if (isPlayerOpen()) {\n          waitForDelivery();");
    expect(t).toContain("window.addEventListener(SAVED_TO_DEVICE_EVENT, done);");
    expect(t).toContain("const offPlayer = onPlayerChange(() => {");
    expect(src("features/downloads/download-player.tsx")).toContain("window.dispatchEvent(new Event(SAVED_TO_DEVICE_EVENT));");
  });
});
