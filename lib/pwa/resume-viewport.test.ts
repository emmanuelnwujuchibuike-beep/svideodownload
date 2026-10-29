import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { repairViewport } from "./resume-viewport";

function fakeWindow(y: number, viewportHeight = 800) {
  const calls: [number, number][] = [];
  return { calls, win: { scrollX: 0, scrollY: y, innerHeight: 800, visualViewport: { height: viewportHeight }, scrollTo: vi.fn((x: number, yy: number) => void calls.push([x, yy])) as unknown as Window["scrollTo"] } };
}

describe("resume viewport repair", () => {
  it("nudges the scroll one pixel and returns to exactly where the page was", () => {
    const { calls, win } = fakeWindow(840);
    repairViewport(win, { activeElement: null });
    expect(calls).toEqual([
      [0, 841],
      [0, 840],
    ]);
  });

  it("a repair that only scrolls one way would leave the page moved (teeth)", () => {
    const { calls, win } = fakeWindow(0);
    repairViewport(win, { activeElement: null });
    expect(calls.at(-1)).toEqual([0, 0]);
    expect(calls.length).toBe(2);
  });

  // owner 2026-10-12: nav floating mid-screen, header gone, after returning to a minimised tab/PWA
  it("a text field left focused with NO keyboard up is stale focus — dropped on resume", () => {
    const { win } = fakeWindow(0, 790);
    const blur = vi.fn();
    repairViewport(win, { activeElement: { tagName: "INPUT", type: "url", blur } as unknown as Element });
    expect(blur).toHaveBeenCalledTimes(1);
  });
  it("someone really typing (keyboard up) keeps their focus", () => {
    const { win } = fakeWindow(0, 420);
    const blur = vi.fn();
    repairViewport(win, { activeElement: { tagName: "TEXTAREA", blur } as unknown as Element });
    expect(blur).not.toHaveBeenCalled();
  });
  it("a focused button is not a text field and is left alone", () => {
    const { win } = fakeWindow(0, 800);
    const blur = vi.fn();
    repairViewport(win, { activeElement: { tagName: "BUTTON", blur } as unknown as Element });
    expect(blur).not.toHaveBeenCalled();
  });

  // owner 2026-10-29: chat header under the clock after minimising — a one-screen page ignored the nudge
  it("a page that cannot scroll is one pixel taller during the nudge, and put back after", () => {
    const style = { minHeight: "" };
    const seen: string[] = [];
    const win = { scrollX: 0, scrollY: 0, innerHeight: 800, visualViewport: { height: 800 }, scrollTo: vi.fn(() => void seen.push(style.minHeight)) as unknown as Window["scrollTo"] };
    repairViewport(win, { activeElement: null, documentElement: { style } });
    expect(seen).toEqual(["calc(100% + 1px)", "calc(100% + 1px)"]);
    expect(style.minHeight).toBe("");
  });

  it("the bottom nav mounts the repair, so it runs on every page with the nav", () => {
    const nav = readFileSync("features/app-shell/mobile-nav.tsx", "utf8");
    expect(nav).toContain("useResumeViewportRepair()");
  });
});
