"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The persistent banner, pinned to the TOP of the download page.
 *
 * The owner wanted the site's all-pages bottom banner brought to the top of the
 * download page, under the app top bar, and staying put on scroll while the top
 * bar slides away. The app top bar is `sticky top-0` and hides itself on
 * scroll-down; this is `sticky top-0` too, so once the bar slides up this becomes
 * the pinned top element — exactly that behaviour, with no fixed-positioning
 * fight. Serves the same `bottom_banner` zone the site banner uses, so anything
 * the operator puts there appears here.
 *
 * Premium card treatment (solid, hairline, the page's shadow language), and it
 * collapses to nothing until the zone is filled, so an unconfigured site shows
 * no empty bar.
 */
export function StickyTopAd() {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);

  if (!ready || !showAds) return null;

  return (
    <div
      className={cn("sticky top-0 z-20 -mx-3 mb-4 sm:-mx-4", hasAd !== true && "hidden")}
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
