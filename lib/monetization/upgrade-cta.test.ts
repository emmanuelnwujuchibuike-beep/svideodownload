import { describe, expect, it } from "vitest";

import { upgradeCta, upgradeHeadline } from "@/lib/monetization/upgrade-cta";

describe("upgradeCta", () => {
  it("NEVER offers Pro to someone who is already on Pro", () => {
    const cta = upgradeCta("pro");
    expect(cta).not.toBeNull();
    expect(cta!.label).toBe("Upgrade to Business");
    expect(cta!.target).toBe("business");
    expect(cta!.label.toLowerCase()).not.toContain("to pro");
  });

  it("offers a Business customer nothing at all", () => {
    // They are on the top plan — any upgrade button would be a dead end.
    expect(upgradeCta("business")).toBeNull();
    expect(upgradeCta("business", false)).toBeNull();
  });

  it("offers Pro to a signed-in free user", () => {
    const cta = upgradeCta("free");
    expect(cta!.label).toBe("Upgrade to Pro");
    expect(cta!.href).toBe("/pricing");
  });

  it("sends a signed-out visitor to sign in first", () => {
    const cta = upgradeCta("free", false);
    expect(cta!.href).toContain("/login");
    expect(cta!.target).toBe("pro");
  });

  it("a paid plan ignores the signedIn flag — you cannot pay while signed out", () => {
    expect(upgradeCta("pro", false)!.target).toBe("business");
    expect(upgradeCta("business", false)).toBeNull();
  });

  it("every CTA links somewhere real and explains itself", () => {
    for (const plan of ["free", "pro"] as const) {
      for (const signedIn of [true, false]) {
        const cta = upgradeCta(plan, signedIn);
        expect(cta!.href.startsWith("/")).toBe(true);
        expect(cta!.label.length).toBeGreaterThan(0);
        expect(cta!.blurb.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("upgradeHeadline", () => {
  it("never mentions ads to a Pro user, who has none", () => {
    expect(upgradeHeadline("pro").toLowerCase()).not.toContain("ads");
    expect(upgradeHeadline("free").toLowerCase()).toContain("ads");
  });
});
