import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { repairViewport } from "./resume-viewport";

function fakeWindow(y: number) {
  const calls: [number, number][] = [];
  return { calls, win: { scrollX: 0, scrollY: y, scrollTo: vi.fn((x: number, yy: number) => void calls.push([x, yy])) as unknown as Window["scrollTo"] } };
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

  it("the bottom nav mounts the repair, so it runs on every page with the nav", () => {
    const nav = readFileSync("features/app-shell/mobile-nav.tsx", "utf8");
    expect(nav).toContain("useResumeViewportRepair()");
  });
});
