import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DIRECT_LINK, DIRECT_LINK_SPOTS, publicDirectLink } from "@/lib/monetization/direct-link";

/**
 * Owner, 2026-10-19: on the Download complete and reward ads, a tap on the close control's ring or dark
 * circle, or on the dark backdrop, opens the Monetag direct link; only the X itself closes the ad. The
 * admin turns it off under Monetization › Direct link › "Ad close button".
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const shell = src("features/monetization/fullscreen-interstitial.tsx");

function rules(s: string) {
  return {
    // the X glyph is its own button: it stops the tap reaching the ring and closes
    xCloses: /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onClose\(\);\s*\}\}[\s\S]{0,200}aria-label="Close advertisement"/.test(s),
    // the ring opens the link; with no link set up it closes, as before
    ringOpens: /onClick=\{\(\) => \{\s*if \(!openDirectLink\(\)\) onClose\(\);\s*\}\}/.test(s),
    // the backdrop opens the link first, and only closes (once skippable) without one
    backdropOpens: /if \(directLinkSpot && openDirectLink\(\)\) return;\s*if \(canSkip\) onClose\(\);/.test(s),
  };
}

describe("the ad close control's direct link", () => {
  it("only the X closes; the ring, circle and backdrop open the direct link", () => {
    expect(rules(shell)).toEqual({ xCloses: true, ringOpens: true, backdropOpens: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(shell.replace("e.stopPropagation();", "")).xCloses).toBe(false);
    expect(rules(shell.replace("if (!openDirectLink()) onClose();", "onClose();")).ringOpens).toBe(false);
    expect(rules(shell.replace("if (directLinkSpot && openDirectLink()) return;", "")).backdropOpens).toBe(false);
  });

  it("is on for the Download complete and reward ads, and nowhere else by accident", () => {
    expect(src("features/monetization/download-interstitial.tsx")).toContain('directLinkSpot="adClose"');
    expect(src("features/monetization/wallpaper-reward-gate.tsx")).toContain('directLinkSpot="adClose"');
    for (const other of ["features/monetization/idle-interstitial.tsx", "features/monetization/exit-intent.tsx"]) {
      expect(src(other)).not.toContain("directLinkSpot");
    }
  });

  it("the admin can switch it off — its own spot, saved and served like the others", () => {
    expect(DIRECT_LINK_SPOTS).toContain("adClose");
    expect(src("features/admin/monetization-settings.tsx")).toContain('{ id: "adClose", label: "Ad close button (Download complete & reward ads)"');
    expect(src("app/api/admin/monetization/route.ts")).toContain("adClose: z.boolean().default(true)");
    const on = { enabled: true, url: "https://example.com/dl", spots: { ...DEFAULT_DIRECT_LINK.spots }, chancePercent: 100 };
    expect(publicDirectLink(on, true)?.spots).toContain("adClose");
    // switched off by the admin: the spot is not served, so the ring and backdrop just close
    expect(publicDirectLink({ ...on, spots: { ...on.spots, adClose: false } }, true)?.spots).not.toContain("adClose");
  });
});
