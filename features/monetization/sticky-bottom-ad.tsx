"use client";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * Sticky mobile anchor ad — the standard high-CTR bottom-of-screen placement
 * (Adsterra/PropellerAds 320×50 banners). Free users only; renders nothing for
 * premium users or until an ad is seeded for the `mobile_bottom_banner` zone.
 *
 * Mobile only (desktop already has homepage/sidebar/result placements). Sits at
 * z-20 — above page content but below the chat widget (z-30) and mobile menu
 * (z-40+), so it never traps taps. The wrapper is pointer-events-none so the
 * empty area (no ad seeded) never blocks the page.
 */
export function StickyBottomAd() {
  const { showAds, ready } = useShowAds();
  if (!ready || !showAds) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="pointer-events-auto">
        <AdSlot zone="mobile_bottom_banner" />
      </div>
    </div>
  );
}
