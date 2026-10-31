import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31: "the pwa white shows before any logo appears". iOS uses an apple-touch-startup-image only when the
  page it was installed from carries <meta name="apple-mobile-web-app-capable" content="yes">. Next 15 renders
  `appleWebApp.capable` as `mobile-web-app-capable` only, so production had none and every launch began on white.
*/
const layout = readFileSync("app/layout.tsx", "utf8");

const declaresIt = (src: string) => /["']apple-mobile-web-app-capable["']\s*:\s*["']yes["']/.test(src);

describe("the iOS launch image can be used", () => {
  it("the root layout declares apple-mobile-web-app-capable itself (not only through appleWebApp)", () => {
    expect(declaresIt(layout)).toBe(true);
    // and the launch images it unlocks are still declared
    expect(layout).toMatch(/apple-touch-startup-image/);
  });
  it("teeth: relying on appleWebApp.capable alone fails", () => {
    expect(declaresIt(layout.replace(/\s*["']apple-mobile-web-app-capable["']\s*:\s*["']yes["'],?/, ""))).toBe(false);
  });
});
