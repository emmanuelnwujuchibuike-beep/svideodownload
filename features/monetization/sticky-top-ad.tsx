"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useSlotProvider } from "@/features/ads-platform/serve/use-slot-provider";

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
// Ad Platform Part 5: the paid provider's renderer, fetched only when a campaign occupies this slot
const SelfTopCreative = dynamic(() => import("@/features/ads-platform/serve/self-top-creative").then((m) => m.SelfTopCreative), { ssr: false });

export function StickyTopAd() {
  const { showAds, ready } = useShowAds();
  const [hasAd, setHasAd] = useState<boolean | null>(null);
  /*
    Ad Platform Part 5 — this bar IS the canonical `downloads_top` slot: a
    paid top banner (global_top_banner) or the network zone, ONE of them,
    in this frame (lib/ads-platform/slot-registry.ts).
  */
  const { state: occupant, networkEmpty } = useSlotProvider("downloads_top", "download");
  const paid = occupant.status === "ready" && occupant.provider === "frenzsave" ? occupant : null;
  const network = occupant.status === "ready" && occupant.provider === "network";
  const shown = !!paid || (network && hasAd === true);

  if (!ready || !showAds) return null;

  return (
    <div
      data-ad-slot="downloads_top"
      data-ad-provider={paid ? "frenzsave" : "network"}
      className={cn("sticky top-[var(--frenz-safe-top)] z-20", !shown && "hidden")}
      aria-hidden={!shown}
    >
      <div className="border-b border-border/60 bg-card/95 px-3 py-2 shadow-soft backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
          <span className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">Sponsored</span>
          {paid ? (
            <SelfTopCreative ads={paid.ads} rules={paid.rules} page="download" />
          ) : network ? (
            <AdSlot
              zone="bottom_banner"
              dismissible={false}
              onResolved={(has) => {
                setHasAd(has);
                if (!has) networkEmpty();
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
