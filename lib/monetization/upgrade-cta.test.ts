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
  /*
    ── 🔴 THIS TEST USED TO REQUIRE THE BUG ──────────────────────────────────

    It asserted `upgradeHeadline("free")` CONTAINS "ads", pinning the old
    "Tired of ads?" copy in place. That is the exact framing the owner asked to
    remove on 2026-10-04 — "the go pro buttons still didn't change from earlier
    fix — to show the AI features and not only remove ads" — because it cast
    the whole paid product as an ad-blocker in the largest text on the card,
    where the body copy underneath never got a chance to say otherwise.

    A guard that fails when the bug is FIXED is worse than no guard. The rule
    it should have been enforcing is the one below: no headline, on any plan,
    sells the product by what it takes away.
  */
  it("never sells either plan as an ad-blocker", () => {
    for (const plan of ["free", "pro"] as const) {
      const headline = upgradeHeadline(plan).toLowerCase();
      expect(headline, plan).not.toContain("ad");
      expect(headline.length, plan).toBeGreaterThan(5);
    }
  });

  it("says something different to a Pro user than to a free one", () => {
    // teeth: one constant string would satisfy the rule above and tell a
    // paying member nothing they do not already have.
    expect(upgradeHeadline("pro")).not.toBe(upgradeHeadline("free"));
  });
});

describe("the blurbs claim only things that are really gated", () => {
  /*
    Golden rule #2 — never a fabricated claim. Each of these was written on a
    Go Pro card at some point and each was false: quality and AI access are not
    plan-gated at all, no speed or queue differentiation exists anywhere, the
    library is not Pro-only, and Pro's 1,000 downloads a day is not unlimited.
    `lib/monetization/plan-features.ts` is the one list; these strings are its
    short form.
  */
  const FORBIDDEN = ["faster download", "priority", "unlimited download", "exclusive", "ad-free", "all features"];

  it("no CTA repeats a struck claim", () => {
    for (const plan of ["free", "pro"] as const) {
      for (const signedIn of [true, false]) {
        const blurb = upgradeCta(plan, signedIn)?.blurb.toLowerCase() ?? "";
        for (const claim of FORBIDDEN) expect(blurb, `${plan}/${signedIn}: "${claim}"`).not.toContain(claim);
      }
    }
  });
});
