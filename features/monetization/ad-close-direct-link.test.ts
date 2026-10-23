import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DIRECT_LINK, DIRECT_LINK_SPOTS, publicDirectLink } from "@/lib/monetization/direct-link";

/**
 * Owner, 2026-10-19: on the Download complete and reward ads, a tap on the close control's ring or dark
 * circle, or on the dark backdrop, opens the Monetag direct link; the X opens it too and closes the ad. The
 * admin turns it off under Monetization › Direct link › "Ad close button".
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const shell = src("features/monetization/fullscreen-interstitial.tsx");

function rules(s: string) {
  return {
    // the X is its own button (data-ad-x): it opens the spot's ad, then closes. 2026-10-23: the tap is NOT stopped —
    // the pop-under's document listener must see it; the ring skips taps on the X instead (no double open)
    xCloses: /data-ad-x\s+data-ad-spot=\{directLinkSpot\}\s+onClick=\{\(\) => \{[\s\S]{0,400}?openDirectLink\(\);\s*onClose\(\);\s*\}\}[\s\S]{0,200}aria-label="Close advertisement"/.test(s),
    // the ring opens the link (skipping a tap that was the X's); with nothing set up it closes, as before
    ringOpens: /onClick=\{\(e\) => \{[^}]*closest\("\[data-ad-x\]"\)\) return;\s*if \(!openDirectLink\(\)\) onClose\(\);\s*\}\}/.test(s),
    // the backdrop opens the link first, and only closes (once skippable) without one
    backdropOpens: /if \(directLinkSpot && openDirectLink\(\)\) return;\s*if \(canSkip\) onClose\(\);/.test(s),
  };
}

describe("the ad close control's direct link", () => {
  it("the X opens the direct link and closes; so do the ring, circle and backdrop", () => {
    expect(rules(shell)).toEqual({ xCloses: true, ringOpens: true, backdropOpens: true });
  });

  it("the X no longer stops the tap (the pop-under must see it), and the ring ignores the X's own taps", () => {
    const x = shell.slice(shell.indexOf("data-ad-x"), shell.indexOf('aria-label="Close advertisement"', shell.indexOf("data-ad-x")));
    expect(x).not.toContain("stopPropagation");
    expect(rules(shell.replace('if ((e.target as Element).closest("[data-ad-x]")) return;', "")).ringOpens).toBe(false);
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(shell.replace(/openDirectLink\(\);\s*onClose\(\);(\s*\}\}\s*tabIndex)/, "onClose();$1")).xCloses).toBe(false);
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
