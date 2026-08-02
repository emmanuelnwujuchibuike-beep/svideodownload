"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The marketing pages' persistent ad bar — pinned to the BOTTOM of the viewport,
 * DIRECTLY ABOVE the app-style bottom nav (owner, 2026-08-02: "move the top header
 * banner ad to the bottom on the bottom nav"). It previously sat under the header;
 * the header now stays fixed on scroll and this bar docks above MobileAppNav.
 *
 * `fixed`, not `sticky`: it is mounted from the marketing LAYOUT *after* the page
 * content (and is deferred), so it has no top-of-flow anchor for `sticky`, and
 * `fixed` also means mounting it late never shifts the LCP-critical hero.
 *
 * ── Where it sits ─────────────────────────────────────────────────────────────
 *
 * Its `bottom` rests just above the bottom nav: `max(env(safe-area-inset-bottom),
 * --frenz-bottomnav-h)`. MobileAppNav publishes its own height (which already
 * includes the home-indicator safe-area pad) as `--frenz-bottomnav-h`; on desktop
 * the nav is `display:none`, so that height is 0 and the bar instead rests on the
 * safe-area inset at the very bottom. The bar publishes its OWN height as
 * `--frenz-bottomad-h` so the layout reserves that much space and content clears it.
 *
 * The zone id stays `bottom_banner` — a config key an operator already filled, not a
 * position — and `isPersistentZone` still treats it as chrome (no dismiss control).
 * Its DISPLAY name in the admin is "Bottom banner" (see lib/monetization/ad-schema).
 */
export function TopBannerAd() {
  const { showAds, ready } = useShowAds();
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [hasLegacy, setHasLegacy] = useState<boolean | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const visible = hasPrimary === true || hasLegacy === true;
  const askLegacy = hasPrimary === false;

  // Publish the bar's height so the marketing layout can RESERVE that much space at
  // the bottom and the page content clears the ad instead of hiding under it. 0 when
  // hidden, so an ad-free site keeps its exact layout.
  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !barRef.current) {
      root.style.setProperty("--frenz-bottomad-h", "0px");
      return;
    }
    const bar = barRef.current;
    const setH = () => root.style.setProperty("--frenz-bottomad-h", `${bar.offsetHeight}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-bottomad-h", "0px");
    };
  }, [visible]);

  if (!ready || !showAds) return null;

  return (
    <div
      ref={barRef}
      style={{
        // Sit above the bottom nav (its height already includes the safe-area pad);
        // on desktop the nav is display:none so the var is 0 and the bar rests on the
        // safe-area inset at the very bottom instead.
        bottom: "max(env(safe-area-inset-bottom), var(--frenz-bottomnav-h, 0px))",
      }}
      className={cn(
        // z-40: below the header (z-50) and the mobile drawer (z-[70]), above content.
        // Solid, no blur — matches the de-glassed nav/header chrome. A top border
        // divides it from the content above; the nav below carries its own border.
        "fixed inset-x-0 z-40 border-t border-border/60 bg-card",
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
