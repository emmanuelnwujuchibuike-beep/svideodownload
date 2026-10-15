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
    expect(t).toContain("setShow(true);");
  });
});

describe("the Skip / X actually closes it", () => {
  it("the button sits on its own layer above the later, relative content block", () => {
    expect(src("features/rewards/referral-banner.tsx")).toContain('className="absolute right-2.5 top-2.5 z-10 inline-flex');
  });
});

describe("owner, 2026-10-15: shown while PREPARING, never at completion, and not intrusive", () => {
  const t = () => src("features/rewards/referral-banner-trigger.tsx");
  it("opens on the preparing event; a download that finishes first drops it", () => {
    expect(src("features/downloads/manager.ts")).toContain("window.dispatchEvent(new Event(DOWNLOAD_PREPARING_EVENT));");
    expect(t()).toContain("window.addEventListener(DOWNLOAD_PREPARING_EVENT, onPreparing);");
    // teeth: the completion event must only CANCEL a pending show, never open it
    const completed = t().slice(t().indexOf("const onCompleted = () => {"), t().indexOf("window.addEventListener(DOWNLOAD_PREPARING_EVENT"));
    expect(completed).toContain("clearTimeout(waitTimer)");
    expect(completed).not.toContain("setShow(true)");
    expect(t()).not.toContain("waitForDelivery");
  });
  it("the snooze is only written by 'I understood'; Skip just closes", () => {
    const b = src("features/rewards/referral-banner.tsx");
    expect(b).toContain("I understood, don&apos;t show this again this week");
    expect(b).toContain("localStorage.setItem(SNOOZE_KEY, String(snoozeUntil(new Date())));");
    const code = b.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/SNOOZE_KEY/g)?.length).toBe(2); // the import and the one write
    expect(t()).toContain("isSnoozed(localStorage.getItem(SNOOZE_KEY), new Date())");
  });
  it("is a docked card with no dimming backdrop and a 5 s skip", () => {
    const b = src("features/rewards/referral-banner.tsx");
    expect(b).toContain("const SKIP_AFTER_S = 5;");
    expect(b).toContain('aria-modal="false"');
    expect(b).not.toContain("bg-slate-950/55");
  });
});
