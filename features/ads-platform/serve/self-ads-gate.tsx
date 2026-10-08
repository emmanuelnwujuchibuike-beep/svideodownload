"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";

import { loadAdInventory } from "@/features/monetization/ad-inventory-client";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { mayServeSelf } from "@/lib/monetization/ad-inventory-shape";

const SelfAdsRoot = dynamic(() => import("./self-ads-root").then((m) => m.SelfAdsRoot), { ssr: false });

/**
 * The paid-ad layer's front door, mounted once in the root DeferredShell (so
 * it survives every route change, both layouts, the PWA).
 *
 * It costs a page NOTHING until a paid campaign is actually live:
 *   · it waits for the browser to be idle — never competes with LCP
 *   · an ad-free member (Pro/Business) stops here
 *   · it asks the ad inventory every ad surface already shares (one
 *     CDN-cached answer per 5-minute bucket); `self: false` — the admin's
 *     global switch off, or no live campaign — stops here, so no ad code is
 *     downloaded, no payload requested, no media loaded, no event sent
 *   · only then is the layer's chunk fetched
 */
export function SelfAdsGate() {
  const { showAds, ready } = useShowAds();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!ready || !showAds) return;
    let alive = true;
    const go = () =>
      void loadAdInventory().then((inv) => {
        if (alive && mayServeSelf(inv)) setOn(true);
      });
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
    const id = ric.requestIdleCallback ? ric.requestIdleCallback(go, { timeout: 3000 }) : window.setTimeout(go, 1500);
    return () => {
      alive = false;
      if (ric.requestIdleCallback) ric.cancelIdleCallback?.(id);
      else window.clearTimeout(id);
    };
  }, [ready, showAds]);

  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <SelfAdsRoot />
    </Suspense>
  );
}
