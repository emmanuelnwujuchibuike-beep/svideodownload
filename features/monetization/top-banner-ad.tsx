"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The marketing pages' persistent ad bar — pinned to the top, DIRECTLY BELOW the
 * header (owner, 2026-07-26: "put it at the top", then "make the ad slot … be below
 * the top header"). It replaces the old fixed BOTTOM banner across the marketing
 * group; the bottom is now the app-style nav.
 *
 * `fixed`, not `sticky`: it is mounted from the marketing LAYOUT *after* the page
 * content (and is deferred), so it has no top-of-flow anchor for `sticky`, and
 * `fixed` also means mounting it late never shifts the LCP-critical hero.
 *
 * ── Where it sits, and the header auto-hide ───────────────────────────────────
 *
 * Its `top` follows the header's published bottom edge (`--frenz-header-bottom`),
 * so it hugs the underside of the header. When the header auto-hides on scroll-down
 * that var collapses to 0, and `max(--frenz-safe-top, …)` slides the bar up to just
 * under the notch — so scrolling down leaves only the ad, and the ad SLOT never
 * enters the safe-area inset (owner: "in webapp the ad slot shouldn't go to the
 * safe area").
 *
 * The zone id stays `bottom_banner` — a config key an operator already filled, not a
 * position — and `isPersistentZone` still treats it as chrome (no dismiss control).
 * Its DISPLAY name in the admin is "Top banner" (see lib/monetization/ad-schema).
 */
export function TopBannerAd() {
  const { showAds, ready } = useShowAds();
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [hasLegacy, setHasLegacy] = useState<boolean | null>(null);

  const visible = hasPrimary === true || hasLegacy === true;
  const askLegacy = hasPrimary === false;

  if (!ready || !showAds) return null;

  return (
    <div
      style={{
        top: "max(var(--frenz-safe-top), var(--frenz-header-bottom, calc(var(--frenz-safe-top) + 4rem)))",
      }}
      className={cn(
        // z-40: below the header (z-50) and the mobile drawer (z-[70]), above content.
        "fixed inset-x-0 z-40 border-b border-border/60 bg-card/95 backdrop-blur-sm transition-[top] duration-300",
        !visible && "hidden",
      )}
      aria-hidden={!visible}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center px-3 py-2">
        <div className={cn(hasPrimary !== true && "hidden")}>
          <AdSlot zone="bottom_banner" dismissible={false} onResolved={setHasPrimary} />
        </div>

        {askLegacy ? (
          <div className={cn("md:hidden", hasLegacy !== true && "hidden")}>
            <AdSlot zone="mobile_bottom_banner" dismissible={false} onResolved={setHasLegacy} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
