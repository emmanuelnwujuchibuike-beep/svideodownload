"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The marketing pages' persistent ad bar — pinned to the TOP (owner, 2026-07-26:
 * "remove the bottom ad slot, put it at the top"). This replaces the old fixed
 * BOTTOM banner across the marketing group; the bottom is now the landing's app
 * nav.
 *
 * `fixed`, not `sticky`: it is mounted from the marketing LAYOUT *after* the page
 * content (and is deferred), so it has no top-of-flow anchor for `sticky` to pin
 * to — and `fixed` also means mounting it late never shifts the LCP-critical hero
 * (the download page's own StickyTopAd is `sticky` because it IS at the top of
 * that layout's flow; different placement, different tool).
 *
 * ── It is the topmost chrome ───────────────────────────────────────────────────
 *
 * The header sits directly below this bar and auto-hides on scroll-down, so
 * scrolling down leaves only this ad (see components/layout/site-header.tsx). The
 * zone id stays `bottom_banner` — a config key an operator already filled, not a
 * position — and `isPersistentZone` still treats it as chrome (no dismiss control).
 *
 * ── Safe area (installed PWA) ─────────────────────────────────────────────────
 *
 * The top inset (notch / status bar) must not carry an ad (owner: "in webapp the
 * ad slot shouldn't go to the safe area"). The bar's BACKGROUND fills the inset so
 * the notch is never a transparent gap, but the ad SLOT is padded below it by
 * `--frenz-safe-top`.
 *
 * ── Coupling with the header ──────────────────────────────────────────────────
 *
 * When an ad fills, the bar publishes its full height (including the safe-area
 * pad) as `--frenz-topad-h`; the header reads that to offset itself below the bar
 * and to drop its own safe-area padding (the bar already cleared the inset). Reset
 * to 0 when hidden/unmounted, so a site with no ad behaves exactly as before.
 */
export function TopBannerAd() {
  const { showAds, ready } = useShowAds();
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [hasLegacy, setHasLegacy] = useState<boolean | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const visible = hasPrimary === true || hasLegacy === true;
  const askLegacy = hasPrimary === false;

  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !barRef.current) {
      root.style.setProperty("--frenz-topad-h", "0px");
      return;
    }
    const bar = barRef.current;
    const setH = () => root.style.setProperty("--frenz-topad-h", `${bar.offsetHeight}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-topad-h", "0px");
    };
  }, [visible]);

  if (!ready || !showAds) return null;

  return (
    <div
      ref={barRef}
      className={cn(
        // z above the header (z-50) so the header hides BEHIND it; the mobile
        // drawer (z-[70]) still sits above both.
        "fixed inset-x-0 top-0 z-[60] border-b border-border/60 bg-card/95 pt-[var(--frenz-safe-top)] backdrop-blur-sm",
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
