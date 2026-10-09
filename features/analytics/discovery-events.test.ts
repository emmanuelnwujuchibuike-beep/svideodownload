import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DISCOVERY_EVENTS } from "./analytics-tracker";

/** Landing + Download brief §34 (owner, 2026-10-08). */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("discovery analytics", () => {
  it("only the brief's names can be reported, and each is a known event type", () => {
    const types = src("lib/analytics/types.ts");
    for (const e of DISCOVERY_EVENTS) expect(types).toContain(`| "${e}"`);
    expect(types).toContain('| "advertise_application_started"');
    expect(types).toContain('| "advertise_application_completed"');
  });

  it("one passive listener that never touches the navigation", () => {
    const t = src("features/analytics/analytics-tracker.tsx");
    expect(t).toContain('document.addEventListener("click", onClick, { capture: true, passive: true });');
    expect(t).not.toMatch(/preventDefault|stopPropagation|history\.|router\./);
  });

  it("the doors carry their tags", () => {
    expect(src("features/downloads/frenz-ai-cta.tsx")).toContain('data-track="ai_clicked"');
    expect(src("components/wallpapers/wallpaper-cta.tsx")).toContain('data-track="wallpapers_clicked"');
    expect(src("features/downloads/promote-button.tsx")).toContain('data-track="advertise_clicked"');
    const eco = src("components/landing/ecosystem.tsx");
    for (const t of ["ai_clicked", "ai_reels_clicked", "reels_clicked", "wallpapers_clicked", "advertise_clicked"]) expect(eco).toContain(t);
  });

  it("the application reports when it starts and when it is submitted", () => {
    const wiz = src("features/ads-platform/advertise-wizard.tsx");
    expect(wiz).toContain('if (!form.campaignId) trackAd("advertise_application_started"');
    expect(wiz).toContain('trackAd("advertise_application_completed"');
  });
});
