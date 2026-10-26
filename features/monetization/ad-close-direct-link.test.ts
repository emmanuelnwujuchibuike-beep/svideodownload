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

  it("is on for the Download complete and reward ads — each its OWN spot (2026-10-24) — and nowhere else by accident", () => {
    expect(src("features/monetization/download-interstitial.tsx")).toContain('directLinkSpot="downloadAdClose"');
    expect(src("features/monetization/download-complete-ad.tsx")).toContain('useCloseViaDirectLink("downloadAdClose", close)');
    expect(src("features/monetization/wallpaper-reward-gate.tsx")).toContain('directLinkSpot="rewardAdClose"');
    // the self-serve full-screen ad: its reward video is the reward spot, the rest the download-complete spot
    expect(src("features/ads-platform/serve/self-interstitial.tsx")).toContain("useCloseViaDirectLink(adCloseSpot(reward), onClose)");
    for (const other of ["features/monetization/idle-interstitial.tsx", "features/monetization/exit-intent.tsx"]) {
      expect(src(other)).not.toContain("directLinkSpot");
    }
  });

  it("owner, 2026-10-25: the free batch — its reward gates' X and its save buttons are spots; the save button says 'Ad'", () => {
    // the batch gate is a reward ad, the after-batch ad a download-complete ad; the multi-link fetch gate a reward ad
    expect(src("features/downloader/batch-ad-gate.tsx")).toContain('directLinkSpot={isGate ? "rewardAdClose" : "downloadAdClose"}');
    expect(src("features/downloader/multi-link/fetch-ad-gate.tsx")).toContain('directLinkSpot="rewardAdClose"');
    // Download selected + Save as ZIP in the panel, Download source on each card — all the "batchSave" spot
    const panel = src("features/downloader/multi-link/multi-link-panel.tsx");
    expect(panel).toContain('const openBatchSpot = useDirectLink("batchSave");');
    expect(panel.match(/data-ad-spot="batchSave"/g)).toHaveLength(2);
    expect(panel).toContain("onSaveSpot={openBatchSpot}");
    expect(src("features/downloader/multi-link/source-card.tsx")).toContain('data-ad-spot="batchSave"');
    // the quiet "Ad" tag on Download selected, only while ads are on (never for a member who doesn't see ads)
    expect(panel).toMatch(/batchAdsReady && batchShowsAds && canDownload[\s\S]{0,400}>\s*Ad\s*</);
  });

  it("the admin can switch it off — its own spot, saved and served like the others", () => {
    expect(DIRECT_LINK_SPOTS).toEqual(["download", "resultPreview", "wallpaper", "rewardAdClose", "downloadAdClose", "batchSave"]);
    // the admin's switches are one per spot (SpotSwitches), the save validates every spot
    expect(src("features/admin/monetization-settings.tsx")).toContain("{DIRECT_LINK_SPOTS.map((id) => (");
    expect(src("app/api/admin/monetization/route.ts")).toContain("downloadAdClose: z.boolean().default(d.downloadAdClose)");
    expect(src("app/api/admin/monetization/route.ts")).toContain("rewardAdClose: z.boolean().default(d.rewardAdClose)");
    const on = { enabled: true, url: "https://example.com/dl", spots: { ...DEFAULT_DIRECT_LINK.spots }, chancePercent: 100 };
    expect(publicDirectLink(on, true)?.spots).toContain("downloadAdClose");
    // switched off by the admin: the spot is not served, so the ring and backdrop just close
    expect(publicDirectLink({ ...on, spots: { ...on.spots, downloadAdClose: false } }, true)?.spots).not.toContain("downloadAdClose");
    // each X separately: the reward ad's X can stay on while the download-complete X is off
    expect(publicDirectLink({ ...on, spots: { ...on.spots, downloadAdClose: false } }, true)?.spots).toContain("rewardAdClose");
  });
});
