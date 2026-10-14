import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RETURN_INTERSTITIAL_ENABLED } from "@/lib/monetization/return-interstitial";

/**
 * Owner, 2026-10-14 (twice): no full-screen ad when entering the app back from outside.
 * The explicit return triggers were switched off, but three paths still produced one:
 * the phone "exit" modal (opened on hide, seen on return) and both idle countdowns,
 * which restarted on becoming visible / on a fresh load.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("no ad on coming back to the app", () => {
  it("the explicit return triggers stay off", () => {
    expect(RETURN_INTERSTITIAL_ENABLED).toBe(false);
  });

  it("🔴 the exit modal no longer opens when the page is hidden", () => {
    const s = code("features/monetization/exit-intent.tsx");
    expect(s).not.toContain('addEventListener("visibilitychange"');
  });

  for (const f of ["features/monetization/vast-interstitial/triggers.tsx", "features/monetization/idle-interstitial.tsx"]) {
    it(`🔴 ${f}: becoming visible or loading fresh starts no idle countdown`, () => {
      const s = code(f);
      expect(s).not.toContain('document.addEventListener("visibilitychange", arm)');
      // a bare arm() call on its own line is the countdown starting on mount
      expect(s).not.toMatch(/^\s*arm\(\);\s*$/m);
      // the app scrolling itself on return is not the visitor acting
      const list = s.match(/const ACTIVITY = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
      expect(list).toContain('"touchstart"');
      expect(list.replace(/\/\/.*$/gm, "")).not.toContain('"scroll"');
    });
  }
});
