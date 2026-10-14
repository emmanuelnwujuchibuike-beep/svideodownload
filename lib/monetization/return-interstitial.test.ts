import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RETURN_INTERSTITIAL_ENABLED } from "./return-interstitial";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("no interstitial on returning to the app (owner, 2026-10-14)", () => {
  it("the switch is off", () => {
    expect(RETURN_INTERSTITIAL_ENABLED).toBe(false);
  });

  it("every return trigger is behind the switch", () => {
    expect(src("features/monetization/idle-interstitial.tsx")).toContain(
      "if (RETURN_INTERSTITIAL_ENABLED && away >= AWAY_MS) window.setTimeout(show, 0);",
    );
    expect(src("features/monetization/monetag-placements.tsx")).toContain(
      'if (RETURN_INTERSTITIAL_ENABLED && hasReturn && away >= AWAY_MS) run("return");',
    );
    const self = src("features/ads-platform/serve/self-moments.tsx");
    const gate = self.indexOf("if (!RETURN_INTERSTITIAL_ENABLED) return;");
    expect(gate).toBeGreaterThan(-1);
    // the gate is in the return effect, ahead of its warm-up and its pick
    expect(gate).toBeLessThan(self.indexOf('warmFor("interstitial")'));
    expect(gate).toBeLessThan(self.indexOf('pick("interstitial", "return")'));
  });
});
