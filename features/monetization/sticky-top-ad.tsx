"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The persistent banner, pinned to the TOP of the download page.
 *
 * The owner wanted the site's all-pages bottom banner brought to the top of the
 * download page, staying put on scroll while the app top bar slides away — and
 * NOT sliding up under the Dynamic Island. So it is `sticky` at
 * `top: var(--frenz-safe-top)` (below the status-bar inset), and it is mounted in
 * the (app) LAYOUT — OUTSIDE the page-transition template. A transformed ancestor
 * is a containing block that breaks `position: sticky` mid-transition, which is
 * why it sometimes "scrolled past" when the page hadn't settled; mounting it
 * outside that wrapper makes the pin reliable. Serves the `bottom_banner` zone,
 * and collapses to nothing until the zone is filled.
 */
export function StickyTopAd() {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  if (!ready || !showAds) return null;

  return (
    <div
      className={cn("sticky top-[var(--frenz-safe-top)] z-20", hasAd !== true && "hidden")}
      aria-hidden={hasAd !== true}
    >
      <div className="border-b border-border/60 bg-card/95 px-3 py-2 shadow-soft backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
          <span className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Sponsored</span>
          <AdSlot zone="bottom_banner" dismissible={false} onResolved={setHasAd} />
        </div>
      </div>
    </div>
  );
}
