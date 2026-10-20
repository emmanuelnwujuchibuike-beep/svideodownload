import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Step 20 — the Subscriptions dashboard (design/SubsDashboard.dc.html, owner 2026-10-19). Pinned to the
 * source, each rule with a case that fails when it's taken out.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = src("features/sub/subs-dashboard.tsx");
const route = src("app/(app)/exclusive/dashboard/page.tsx");

function rules(s: string) {
  return {
    // every figure is the server's — "—" on a failed read, never a guess
    realFigures: s.includes("useSubEarnings(true)") && s.includes('failed ? "—" : "…"') && ["availableCents", "lifetimeCents", "pendingCents", "withdrawnCents"].every((k) => s.includes(`e?.${k}`)),
    // the same controls the profile card had: withdraw sheet, price save, pause, announcements, notifications, payout
    sameControls: s.includes("<SubWithdrawSheet") && s.includes("saveSubSettings({ priceCents: cents })") && s.includes("saveSubSettings({ active: !prev.active })") && s.includes("<CreatorAnnouncements") && s.includes("<CreatorNotifySettings") && s.includes('<SubPayoutSettings variant="list"'),
    // Pause is a switch, and on = paused
    pauseSwitch: s.includes('role="switch" aria-checked={!settings.active} aria-label="Pause new subscribers"'),
    analytics: s.includes('href="/exclusive/earnings"'),
  };
}

describe("the Subscriptions dashboard (step 20)", () => {
  it("keeps every rule of the design and the owner's notes", () => {
    expect(rules(page)).toEqual({ realFigures: true, sameControls: true, pauseSwitch: true, analytics: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(page.replace("useSubEarnings(true)", "useSubEarnings(false)")).realFigures).toBe(false);
    expect(rules(page.replace("<SubWithdrawSheet", "<div")).sameControls).toBe(false);
    expect(rules(page.replace("aria-checked={!settings.active}", "aria-checked={settings.active}")).pauseSwitch).toBe(false);
  });

  it("only the creator, and only once set up — anyone else is sent away", () => {
    expect(route).toContain('redirect("/login?next=/exclusive/dashboard")');
    expect(route).toContain("subTabFor(user.id,");
    expect(route).toContain("!data.settings.setupCompleted");
  });

  it("the profile card's Dashboard button opens this page", () => {
    expect(src("features/sub/sub-tab.tsx")).toContain('<Link href="/exclusive/dashboard"');
  });
});
