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
      /*
        🔴 "priority processing" removed (2026-10-04). No priority flag or queue
        exists anywhere in the pipeline — the pricing page's own 2026-08-26
        audit struck the same claim for the same reason. Every word here is now
        a real Business gate: storage is unlimited, creator analytics is a hard
        `plan !== "business"` lock, and 50,000/day is the top API ceiling.
      */
      blurb: "Unlimited storage, creator analytics and the highest API limit.",
      href: "/pricing#business",
      target: "business",
    };
  }

  /*
    ── 🔴 PRO IS NOT AN AD-BLOCKER (owner, 2026-10-04) ──────────────────────

    "The go pro buttons still didn't change from earlier fix — to show the AI
    features and not only remove ads."

    The earlier pass rewrote `tired-of-ads.tsx`, which is only ONE of the five
    upgrade surfaces. This function is what the rest of them render, and it
    still said "an ad-free library, more storage and faster downloads" — so the
    card the owner actually sees never changed. (The standing rule: fix the
    branch the owner actually hits.)

    `faster downloads` is also gone, and not for brevity: no download-speed or
    queue differentiation exists in the pipeline. It has now been written on
    three separate surfaces and struck from all three.

    What replaces it leads with capability rather than subtraction, and every
    clause is a real gate — see `plan-features.ts`, which is the one list these
    strings are a short form of.
  */
  const PRO_BLURB = "No ad before big files, unlimited batch downloads, 50 GB storage and two Frenz AI generations at once.";

  // Free, and signed-out visitors (who cannot be on a paid plan).
  if (!signedIn) {
    return {
      label: "Sign in to upgrade",
      blurb: PRO_BLURB,
      href: "/login?next=/pricing",
      target: "pro",
    };
  }

  return {
    label: "Upgrade to Pro",
    blurb: PRO_BLURB,
    href: "/pricing",
    target: "pro",
  };
}

/**
 * The short line above the CTA.
 *
 * 🔴 "Tired of ads?" is gone for the free tier (owner, 2026-10-04). It framed
 * the entire paid product as an ad-blocker, which is the complaint — and it did
 * so in the largest text on the card, so the body copy underneath never got a
 * chance to say otherwise.
 */
export function upgradeHeadline(plan: BillingPlan): string {
  return plan === "pro" ? "Need more room?" : "Unlock everything Pro";
}
