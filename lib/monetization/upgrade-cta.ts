import type { BillingPlan } from "@/lib/monetization/types";

/**
 * The upgrade call-to-action, for whatever plan the visitor is actually on.
 *
 * ── Why this is one shared function ───────────────────────────────────────
 * Owner (2026-08-04): "a pro or business user still sees an upgrade to pro in
 * the download page." The rule was being re-implemented at every upgrade
 * surface — the quota gate, the usage meter, the interstitial upsell, the batch
 * gate, the result offer — and each copy had to remember, independently, that a
 * Pro user must be offered Business and a Business user must be offered nothing.
 * One of them was always going to be missed, and asking a paying customer to buy
 * what they already have is the kind of mistake that reads as carelessness.
 *
 * So the rule lives here once, returns `null` when there is nothing honest to
 * offer, and every surface renders whatever it gets back.
 *
 * Pure: no React, no I/O.
 */
export interface UpgradeCta {
  /** Button text. */
  label: string;
  /** Short line of reasoning, for surfaces that show one. */
  blurb: string;
  href: string;
  /** The plan being sold — useful for styling/analytics. */
  target: "pro" | "business";
}

/**
 * Returns `null` for a Business customer: they are on the top plan, so there is
 * genuinely nothing to sell them, and any "upgrade" button would be a dead end.
 * Callers MUST handle null by rendering nothing.
 */
export function upgradeCta(plan: BillingPlan, signedIn = true): UpgradeCta | null {
  if (plan === "business") return null;

  if (plan === "pro") {
    return {
      label: "Upgrade to Business",
      blurb: "Unlimited storage, the API and priority processing.",
      href: "/pricing#business",
      target: "business",
    };
  }

  // Free, and signed-out visitors (who cannot be on a paid plan).
  if (!signedIn) {
    return {
      label: "Sign in to upgrade",
      blurb: "Go Pro for an ad-free library, more storage and faster downloads.",
      href: "/login?next=/pricing",
      target: "pro",
    };
  }

  return {
    label: "Upgrade to Pro",
    blurb: "An ad-free library, more storage and faster downloads.",
    href: "/pricing",
    target: "pro",
  };
}

/** The short "what would you like to change?" line above the CTA. */
export function upgradeHeadline(plan: BillingPlan): string {
  return plan === "pro" ? "Need more room?" : "Tired of ads?";
}
